import asyncio
import hashlib
import os
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient, Response
from sqlalchemy import Engine, create_engine, event, func, select
from sqlalchemy.orm import Session

from alembic import command
from app.core.config import Settings
from app.core.errors import BadRequestError
from app.main import create_app
from app.modules.auth.email import DevelopmentEmailProvider, EmailDeliveryError, EmailMessage
from app.modules.auth.models import (
    AuthSession,
    PasswordCredential,
    PasswordResetToken,
    SecurityEvent,
)
from app.modules.auth.password_reset import request_password_reset, reset_password
from app.modules.auth.passwords import verify_password
from app.modules.auth.sessions import REFRESH_COOKIE
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
            auth_signing_key="test-signing-key-at-least-thirty-two-bytes",
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


def test_password_reset_replaces_password_revokes_sessions_and_requires_login(
    password_reset_app: tuple[FastAPI, Engine, DevelopmentEmailProvider, Settings],
) -> None:
    app, engine, provider, _ = password_reset_app
    old_password = "long recovery passphrase"
    new_password = "new secure recovery passphrase"

    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client)
            requested = await client.post(
                "/api/v1/auth/password/forgot", json={"email": "recover@example.com"}
            )
            assert requested.status_code == 202
            token = _token_from_message(provider)

            access_tokens: list[str] = []
            refresh_tokens: list[str] = []
            for _ in range(2):
                login = await client.post(
                    "/api/v1/auth/password/login",
                    json={"identifier": "recover_user", "password": old_password},
                )
                assert login.status_code == 200, login.text
                access_tokens.append(login.json()["access_token"])
                refresh = login.cookies.get(REFRESH_COOKIE)
                assert refresh is not None
                refresh_tokens.append(refresh)

            reset = await client.post(
                "/api/v1/auth/password/reset",
                json={"token": token, "password": new_password},
            )
            assert reset.status_code == 204, reset.text
            assert reset.content == b""
            assert reset.headers["cache-control"] == "no-store"
            deletion_cookie = reset.headers["set-cookie"]
            assert deletion_cookie.startswith(f"{REFRESH_COOKIE}=")
            assert "Max-Age=0" in deletion_cookie
            assert "Path=/api/v1/auth" in deletion_cookie
            assert "Secure" in deletion_cookie

            for access in access_tokens:
                denied = await client.get(
                    "/api/v1/me", headers={"Authorization": f"Bearer {access}"}
                )
                assert denied.status_code == 401
            for refresh in refresh_tokens:
                client.cookies.set(REFRESH_COOKIE, refresh)
                denied = await client.post("/api/v1/auth/refresh")
                assert denied.status_code == 401

            old_login = await client.post(
                "/api/v1/auth/password/login",
                json={"identifier": "recover_user", "password": old_password},
            )
            assert old_login.status_code == 401
            new_login = await client.post(
                "/api/v1/auth/password/login",
                json={"identifier": "recover_user", "password": new_password},
            )
            assert new_login.status_code == 200, new_login.text

    asyncio.run(exercise())
    with Session(engine) as session:
        credential = session.scalars(select(PasswordCredential)).one()
        reset_token = session.scalars(select(PasswordResetToken)).one()
        sessions = session.scalars(select(AuthSession).order_by(AuthSession.created_at)).all()
        reset_event = session.scalars(
            select(SecurityEvent).where(SecurityEvent.event_type == "authentication.password_reset")
        ).one()
        assert verify_password(credential.password_hash, new_password)
        assert not verify_password(credential.password_hash, old_password)
        assert reset_token.consumed_at is not None
        assert len(sessions) == 3
        assert all(item.revoked_at is not None for item in sessions[:2])
        assert sessions[2].revoked_at is None
        assert reset_event.event_data == {"revoked_session_count": 2}


def test_password_reset_uses_one_generic_error_for_unusable_tokens(
    password_reset_app: tuple[FastAPI, Engine, DevelopmentEmailProvider, Settings],
) -> None:
    app, engine, provider, _ = password_reset_app

    async def exercise() -> list[Response]:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client)
            invalid = await client.post(
                "/api/v1/auth/password/reset",
                json={"token": "A" * 43, "password": "replacement passphrase one"},
            )
            for _ in range(2):
                response = await client.post(
                    "/api/v1/auth/password/forgot", json={"email": "recover@example.com"}
                )
                assert response.status_code == 202
            replaced_token = _token_from_message(provider, 0)
            expired_token = _token_from_message(provider, 1)
            replaced = await client.post(
                "/api/v1/auth/password/reset",
                json={"token": replaced_token, "password": "replacement passphrase two"},
            )
            with Session(engine) as session, session.begin():
                stored = session.scalars(
                    select(PasswordResetToken).where(
                        PasswordResetToken.token_hash
                        == hashlib.sha256(expired_token.encode()).hexdigest()
                    )
                ).one()
                stored.created_at = datetime.now(UTC) - timedelta(hours=2)
                stored.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            expired = await client.post(
                "/api/v1/auth/password/reset",
                json={"token": expired_token, "password": "replacement passphrase three"},
            )

            issued = await client.post(
                "/api/v1/auth/password/forgot", json={"email": "recover@example.com"}
            )
            assert issued.status_code == 202
            valid_token = _token_from_message(provider, 2)
            with Session(engine) as session, session.begin():
                user = session.scalars(select(User)).one()
                user.status = UserStatus.SUSPENDED
            suspended = await client.post(
                "/api/v1/auth/password/reset",
                json={"token": valid_token, "password": "replacement passphrase four"},
            )
            with Session(engine) as session, session.begin():
                user = session.scalars(select(User)).one()
                user.status = UserStatus.ACTIVE
            accepted = await client.post(
                "/api/v1/auth/password/reset",
                json={"token": valid_token, "password": "replacement passphrase four"},
            )
            assert accepted.status_code == 204
            reused = await client.post(
                "/api/v1/auth/password/reset",
                json={"token": valid_token, "password": "replacement passphrase five"},
            )
            return [invalid, replaced, expired, suspended, reused]

    errors = asyncio.run(exercise())
    first = errors[0]
    expected = first.json()["error"]
    assert expected["message"] == "Invalid or expired password reset token"
    for response in errors:
        assert response.status_code == 400
        assert response.json()["error"]["code"] == expected["code"]
        assert response.json()["error"]["message"] == expected["message"]
        assert "A" * 43 not in response.text


def test_password_reset_policy_validation_does_not_consume_token(
    password_reset_app: tuple[FastAPI, Engine, DevelopmentEmailProvider, Settings],
) -> None:
    app, engine, provider, _ = password_reset_app

    async def exercise() -> str:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client)
            await client.post("/api/v1/auth/password/forgot", json={"email": "recover@example.com"})
            token = _token_from_message(provider)
            for password in ("short", "x" * 1025):
                rejected = await client.post(
                    "/api/v1/auth/password/reset",
                    json={"token": token, "password": password},
                )
                assert rejected.status_code == 422
                assert token not in rejected.text
                assert password not in rejected.text
            return token

    token = asyncio.run(exercise())
    with Session(engine) as session:
        stored = session.scalars(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == hashlib.sha256(token.encode()).hexdigest()
            )
        ).one()
        assert stored.consumed_at is None


def test_concurrent_password_reset_consumes_token_once(
    password_reset_app: tuple[FastAPI, Engine, DevelopmentEmailProvider, Settings],
) -> None:
    app, engine, provider, _ = password_reset_app

    async def prepare() -> str:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client)
            requested = await client.post(
                "/api/v1/auth/password/forgot", json={"email": "recover@example.com"}
            )
            assert requested.status_code == 202
            login = await client.post(
                "/api/v1/auth/password/login",
                json={
                    "identifier": "recover_user",
                    "password": "long recovery passphrase",
                },
            )
            assert login.status_code == 200
            return _token_from_message(provider)

    token = asyncio.run(prepare())
    candidates = ("concurrent replacement one", "concurrent replacement two")

    def attempt(password: str) -> bool:
        with Session(engine) as session:
            try:
                reset_password(session, token, password)
                return True
            except BadRequestError:
                return False

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(attempt, candidates)) == [False, True]

    with Session(engine) as session:
        credential = session.scalars(select(PasswordCredential)).one()
        assert sum(verify_password(credential.password_hash, item) for item in candidates) == 1
        assert session.scalars(select(PasswordResetToken)).one().consumed_at is not None
        assert session.scalars(select(AuthSession)).one().revoked_at is not None
        assert (
            session.scalar(
                select(func.count())
                .select_from(SecurityEvent)
                .where(SecurityEvent.event_type == "authentication.password_reset")
            )
            == 1
        )


def test_password_reset_rolls_back_every_change_if_event_write_fails(
    password_reset_app: tuple[FastAPI, Engine, DevelopmentEmailProvider, Settings],
) -> None:
    app, engine, provider, _ = password_reset_app

    async def prepare() -> str:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client)
            await client.post("/api/v1/auth/password/forgot", json={"email": "recover@example.com"})
            login = await client.post(
                "/api/v1/auth/password/login",
                json={
                    "identifier": "recover_user",
                    "password": "long recovery passphrase",
                },
            )
            assert login.status_code == 200
            return _token_from_message(provider)

    token = asyncio.run(prepare())
    with Session(engine) as session:
        original_hash = session.scalars(select(PasswordCredential.password_hash)).one()

    def fail_event(*args: object) -> None:
        raise RuntimeError("injected password reset event failure")

    event.listen(SecurityEvent, "before_insert", fail_event)
    try:
        with (
            Session(engine) as session,
            pytest.raises(RuntimeError, match="injected password reset event"),
        ):
            reset_password(session, token, "rollback replacement passphrase")
    finally:
        event.remove(SecurityEvent, "before_insert", fail_event)

    with Session(engine) as session:
        credential = session.scalars(select(PasswordCredential)).one()
        assert credential.password_hash == original_hash
        assert session.scalars(select(PasswordResetToken)).one().consumed_at is None
        assert session.scalars(select(AuthSession)).one().revoked_at is None
        assert (
            session.scalar(
                select(func.count())
                .select_from(SecurityEvent)
                .where(SecurityEvent.event_type == "authentication.password_reset")
            )
            == 0
        )
