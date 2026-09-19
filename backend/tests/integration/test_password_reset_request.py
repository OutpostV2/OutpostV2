import asyncio
import hashlib
import os
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient
from sqlalchemy import Engine, create_engine, func, select
from sqlalchemy.orm import Session

from alembic import command
from app.core.config import Settings
from app.main import create_app
from app.modules.auth.email import DevelopmentEmailProvider, EmailDeliveryError, EmailMessage
from app.modules.auth.models import PasswordCredential, PasswordResetToken
from app.modules.auth.password_reset import request_password_reset
from app.modules.users.models import User, UserStatus
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set"),
]


@pytest.fixture
def password_reset_app(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[tuple[FastAPI, Engine, DevelopmentEmailProvider, Settings]]:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", url.render_as_string(False))
        command.upgrade(migration_config(), "head")
        engine = create_engine(url, hide_parameters=True)
        provider = DevelopmentEmailProvider()
        settings = Settings(
            database_url=url.render_as_string(False),
            email_provider="development",
            password_reset_url="https://app.example.com/reset-password?source=outpost",
            _env_file=None,
        )
        app = create_app(settings, engine=engine, email_provider=provider, configure_logs=False)
        try:
            yield app, engine, provider, settings
        finally:
            engine.dispose()


async def _register(client: AsyncClient, *, email: str = "recover@example.com") -> None:
    response = await client.post(
        "/api/v1/auth/password/register",
        json={
            "display_name": "Recover",
            "username": "recover_user",
            "email": email,
            "password": "long recovery passphrase",
        },
    )
    assert response.status_code == 201, response.text


def _token_from_message(provider: DevelopmentEmailProvider, index: int = 0) -> str:
    message = provider.outbox[index]
    assert message.to == "recover@example.com"
    assert message.subject == "Reset your Outpost password"
    url = next(part for part in message.text_body.split() if part.startswith("https://"))
    query = parse_qs(urlparse(url).query)
    assert query["source"] == ["outpost"]
    return query["token"][0]


def test_forgot_password_issues_only_a_hashed_one_hour_token(
    password_reset_app: tuple[FastAPI, Engine, DevelopmentEmailProvider, Settings],
) -> None:
    app, engine, provider, _ = password_reset_app

    async def exercise() -> str:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client)
            response = await client.post(
                "/api/v1/auth/password/forgot",
                json={"email": " RECOVER@EXAMPLE.COM "},
            )
            assert response.status_code == 202, response.text
            assert response.content == b""
            assert response.headers["cache-control"] == "no-store"
            return _token_from_message(provider)

    token = asyncio.run(exercise())
    with Session(engine) as session:
        stored = session.scalars(select(PasswordResetToken)).one()
        assert stored.token_hash == hashlib.sha256(token.encode()).hexdigest()
        assert token not in stored.token_hash
        assert stored.consumed_at is None
        assert timedelta(minutes=59) < stored.expires_at - stored.created_at <= timedelta(hours=1)


class FailingEmailProvider:
    def send(self, message: EmailMessage) -> None:
        del message
        raise EmailDeliveryError("injected delivery failure")


def test_forgot_password_does_not_disclose_account_eligibility_or_delivery(
    password_reset_app: tuple[FastAPI, Engine, DevelopmentEmailProvider, Settings],
) -> None:
    app, engine, provider, _ = password_reset_app

    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            unknown = await client.post(
                "/api/v1/auth/password/forgot", json={"email": "unknown@example.com"}
            )
            await _register(client)
            with Session(engine) as session, session.begin():
                user = session.scalars(select(User)).one()
                user.status = UserStatus.SUSPENDED
            suspended = await client.post(
                "/api/v1/auth/password/forgot", json={"email": "recover@example.com"}
            )
            with Session(engine) as session, session.begin():
                user = session.scalars(select(User)).one()
                user.status = UserStatus.ACTIVE
                credential = session.get(PasswordCredential, user.id)
                assert credential is not None
                session.delete(credential)
            passwordless = await client.post(
                "/api/v1/auth/password/forgot", json={"email": "recover@example.com"}
            )
            with Session(engine) as session, session.begin():
                user = session.scalars(select(User)).one()
                session.add(
                    PasswordCredential(user_id=user.id, password_hash="not-used-by-this-test")
                )
            app.state.email_provider = FailingEmailProvider()
            failed_delivery = await client.post(
                "/api/v1/auth/password/forgot", json={"email": "recover@example.com"}
            )
            for response in (unknown, suspended, passwordless, failed_delivery):
                assert response.status_code == 202
                assert response.content == b""
                assert response.headers["cache-control"] == "no-store"

    asyncio.run(exercise())
    assert provider.outbox == ()
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(PasswordResetToken)) == 1


def test_new_forgot_password_request_replaces_previous_token(
    password_reset_app: tuple[FastAPI, Engine, DevelopmentEmailProvider, Settings],
) -> None:
    app, engine, provider, _ = password_reset_app

    async def exercise() -> tuple[str, str]:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client)
            for _ in range(2):
                response = await client.post(
                    "/api/v1/auth/password/forgot",
                    json={"email": "recover@example.com"},
                )
                assert response.status_code == 202
            return _token_from_message(provider, 0), _token_from_message(provider, 1)

    first_token, second_token = asyncio.run(exercise())
    assert first_token != second_token
    with Session(engine) as session:
        stored = {
            item.token_hash: item for item in session.scalars(select(PasswordResetToken)).all()
        }
        assert stored[hashlib.sha256(first_token.encode()).hexdigest()].consumed_at is not None
        assert stored[hashlib.sha256(second_token.encode()).hexdigest()].consumed_at is None


def test_concurrent_forgot_password_requests_leave_one_active_token(
    password_reset_app: tuple[FastAPI, Engine, DevelopmentEmailProvider, Settings],
) -> None:
    app, engine, provider, settings = password_reset_app

    async def register() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client)

    asyncio.run(register())

    def request(_: int) -> None:
        with Session(engine) as session:
            request_password_reset(session, settings, provider, "recover@example.com")

    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(request, (1, 2)))

    with Session(engine) as session:
        tokens = session.scalars(select(PasswordResetToken)).all()
        assert len(tokens) == 2
        assert sum(token.consumed_at is None for token in tokens) == 1
