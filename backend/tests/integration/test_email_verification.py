import asyncio
import hashlib
import os
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient
from sqlalchemy import Engine, create_engine, event, func, select
from sqlalchemy.orm import Session

from alembic import command
from app.core.config import Settings
from app.core.errors import BadRequestError
from app.main import create_app
from app.modules.auth.email import (
    DevelopmentEmailProvider,
    EmailDeliveryError,
    EmailMessage,
)
from app.modules.auth.email_verification import confirm_email_verification
from app.modules.auth.models import EmailVerificationToken, SecurityEvent
from app.modules.users.models import User
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set"),
]


@pytest.fixture
def verification_app(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[tuple[FastAPI, Engine, DevelopmentEmailProvider]]:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", url.render_as_string(False))
        command.upgrade(migration_config(), "head")
        engine = create_engine(url, hide_parameters=True)
        provider = DevelopmentEmailProvider()
        settings = Settings(
            database_url=url.render_as_string(False),
            email_provider="development",
            email_verification_url="https://app.example.com/verify-email",
            _env_file=None,
        )
        app = create_app(
            settings,
            engine=engine,
            email_provider=provider,
            configure_logs=False,
        )
        try:
            yield app, engine, provider
        finally:
            engine.dispose()


def _token_from_message(provider: DevelopmentEmailProvider, index: int = 0) -> str:
    message = provider.outbox[index]
    assert message.to == "verify@example.com"
    assert message.subject == "Verify your Outpost email"
    url = next(part for part in message.text_body.split() if part.startswith("https://"))
    return parse_qs(urlparse(url).query)["token"][0]


async def _register(client: AsyncClient, *, email: str = "verify@example.com") -> None:
    response = await client.post(
        "/api/v1/auth/password/register",
        json={
            "display_name": "Verify",
            "username": "verify_user",
            "email": email,
            "password": "long verification passphrase",
        },
    )
    assert response.status_code == 201, response.text


def test_email_verification_issues_hashed_token_and_confirms_once(
    verification_app: tuple[FastAPI, Engine, DevelopmentEmailProvider],
) -> None:
    app, engine, provider = verification_app

    async def exercise() -> str:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client)

            requested = await client.post(
                "/api/v1/auth/email-verification/request",
                json={"email": " VERIFY@EXAMPLE.COM "},
            )
            assert requested.status_code == 202, requested.text
            assert requested.content == b""
            assert requested.headers["cache-control"] == "no-store"
            token = _token_from_message(provider)

            confirmed = await client.post(
                "/api/v1/auth/email-verification/confirm",
                json={"token": token},
            )
            assert confirmed.status_code == 204, confirmed.text
            assert confirmed.content == b""

            reused = await client.post(
                "/api/v1/auth/email-verification/confirm",
                json={"token": token},
            )
            assert reused.status_code == 400
            assert reused.json()["error"]["message"] == (
                "Invalid or expired email verification token"
            )
            assert token not in reused.text
            already_verified = await client.post(
                "/api/v1/auth/email-verification/request",
                json={"email": "verify@example.com"},
            )
            assert already_verified.status_code == 202
            assert already_verified.content == requested.content
            assert len(provider.outbox) == 1
            return token

    token = asyncio.run(exercise())
    with Session(engine) as session:
        user = session.scalars(select(User)).one()
        stored = session.scalars(select(EmailVerificationToken)).one()
        event = session.scalars(
            select(SecurityEvent).where(SecurityEvent.event_type == "authentication.email_verified")
        ).one()
        assert user.email_verified_at is not None
        assert stored.consumed_at == user.email_verified_at
        assert stored.token_hash == hashlib.sha256(token.encode()).hexdigest()
        assert token not in stored.token_hash
        assert event.user_id == user.id


class FailingEmailProvider:
    def send(self, message: EmailMessage) -> None:
        del message
        raise EmailDeliveryError("injected delivery failure")


def test_verification_request_does_not_disclose_account_or_delivery_state(
    verification_app: tuple[FastAPI, Engine, DevelopmentEmailProvider],
) -> None:
    app, engine, _ = verification_app

    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            unknown = await client.post(
                "/api/v1/auth/email-verification/request",
                json={"email": "unknown@example.com"},
            )
            await _register(client)
            app.state.email_provider = FailingEmailProvider()
            failed_delivery = await client.post(
                "/api/v1/auth/email-verification/request",
                json={"email": "verify@example.com"},
            )
            assert unknown.status_code == failed_delivery.status_code == 202
            assert unknown.content == failed_delivery.content == b""
            assert unknown.headers["cache-control"] == "no-store"
            assert failed_delivery.headers["cache-control"] == "no-store"

    asyncio.run(exercise())
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(EmailVerificationToken)) == 1


def test_new_request_replaces_previous_token_and_expired_token_is_rejected(
    verification_app: tuple[FastAPI, Engine, DevelopmentEmailProvider],
) -> None:
    app, engine, provider = verification_app

    async def exercise() -> tuple[str, str]:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client)
            for _ in range(2):
                response = await client.post(
                    "/api/v1/auth/email-verification/request",
                    json={"email": "verify@example.com"},
                )
                assert response.status_code == 202
            first_token = _token_from_message(provider, 0)
            second_token = _token_from_message(provider, 1)
            assert first_token != second_token

            replaced = await client.post(
                "/api/v1/auth/email-verification/confirm",
                json={"token": first_token},
            )
            assert replaced.status_code == 400
            with Session(engine) as session, session.begin():
                current = session.scalars(
                    select(EmailVerificationToken).where(
                        EmailVerificationToken.token_hash
                        == hashlib.sha256(second_token.encode()).hexdigest()
                    )
                ).one()
                current.created_at = datetime.now(UTC) - timedelta(days=2)
                current.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            expired = await client.post(
                "/api/v1/auth/email-verification/confirm",
                json={"token": second_token},
            )
            assert expired.status_code == 400
            assert expired.json()["error"]["code"] == replaced.json()["error"]["code"]
            assert expired.json()["error"]["message"] == replaced.json()["error"]["message"]
            return first_token, second_token

    first_token, second_token = asyncio.run(exercise())
    with Session(engine) as session:
        stored = {item.token_hash: item for item in session.scalars(select(EmailVerificationToken))}
        assert stored[hashlib.sha256(first_token.encode()).hexdigest()].consumed_at is not None
        assert stored[hashlib.sha256(second_token.encode()).hexdigest()].consumed_at is None
        assert session.scalars(select(User)).one().email_verified_at is None


def test_confirmation_rolls_back_if_security_event_write_fails(
    verification_app: tuple[FastAPI, Engine, DevelopmentEmailProvider],
) -> None:
    app, engine, provider = verification_app

    async def issue() -> str:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client)
            response = await client.post(
                "/api/v1/auth/email-verification/request",
                json={"email": "verify@example.com"},
            )
            assert response.status_code == 202
            return _token_from_message(provider)

    token = asyncio.run(issue())

    def fail_event(*args: object) -> None:
        raise RuntimeError("injected verification event failure")

    event.listen(SecurityEvent, "before_insert", fail_event)
    try:
        with (
            Session(engine) as session,
            pytest.raises(RuntimeError, match="injected verification event"),
        ):
            confirm_email_verification(session, token)
    finally:
        event.remove(SecurityEvent, "before_insert", fail_event)

    with Session(engine) as session:
        assert session.scalars(select(User)).one().email_verified_at is None
        assert session.scalars(select(EmailVerificationToken)).one().consumed_at is None
        assert session.scalar(select(func.count()).select_from(SecurityEvent)) == 0


def test_concurrent_confirmation_consumes_token_once(
    verification_app: tuple[FastAPI, Engine, DevelopmentEmailProvider],
) -> None:
    app, engine, provider = verification_app

    async def issue() -> str:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client)
            response = await client.post(
                "/api/v1/auth/email-verification/request",
                json={"email": "verify@example.com"},
            )
            assert response.status_code == 202
            return _token_from_message(provider)

    token = asyncio.run(issue())

    def attempt_confirmation(_: int) -> bool:
        with Session(engine) as session:
            try:
                confirm_email_verification(session, token)
                return True
            except BadRequestError:
                return False

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(attempt_confirmation, (1, 2))) == [False, True]
    with Session(engine) as session:
        assert session.scalars(select(User)).one().email_verified_at is not None
        assert session.scalars(select(EmailVerificationToken)).one().consumed_at is not None
        assert (
            session.scalar(
                select(func.count())
                .select_from(SecurityEvent)
                .where(SecurityEvent.event_type == "authentication.email_verified")
            )
            == 1
        )
