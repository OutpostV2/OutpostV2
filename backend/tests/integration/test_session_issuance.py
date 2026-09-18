import asyncio
import hashlib

import pytest
from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from app.modules.auth.models import AuthSession
from tests.integration.test_password_registration import auth_app as auth_app

pytestmark = pytest.mark.integration
PASSWORD = "long session passphrase"


def test_login_issues_secure_cookie_and_authenticated_access(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, engine = auth_app
    monkeypatch.setenv("OUTPOST_AUTH_SIGNING_KEY", "test-only-signing-key-with-at-least-32-bytes")
    from app.core.config import Settings

    app.state.settings = Settings(_env_file=None)

    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            registered = await client.post(
                "/api/v1/auth/password/register",
                json={
                    "display_name": "Session",
                    "username": "session_user",
                    "email": "session@example.com",
                    "password": PASSWORD,
                },
            )
            assert registered.status_code == 201
            response = await client.post(
                "/api/v1/auth/password/login",
                json={
                    "identifier": "SESSION@EXAMPLE.COM",
                    "password": PASSWORD,
                },
            )
            assert response.status_code == 200, response.text
            payload = response.json()
            assert payload["token_type"] == "bearer"
            assert payload["expires_in"] == 900
            assert "refresh_token" not in payload
            assert response.headers["cache-control"] == "no-store"
            cookie = response.headers["set-cookie"]
            assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=strict" in cookie
            assert "Path=/api/v1/auth" in cookie
            refresh = client.cookies.get("outpost_refresh")
            assert refresh is not None and len(refresh) >= 43
            assert refresh not in response.text
            with Session(engine) as session:
                stored = session.scalars(select(AuthSession)).one()
                assert stored.refresh_token_hash == hashlib.sha256(refresh.encode()).hexdigest()
                assert stored.revoked_at is None
            me = await client.get(
                "/api/v1/me",
                headers={
                    "Authorization": "Bearer " + payload["access_token"],
                },
            )
            assert me.status_code == 200
            assert me.json()["id"] == registered.json()["id"]
            assert "password" not in me.text
            assert (await client.get("/api/v1/me")).status_code == 401
            assert (
                await client.get(
                    "/api/v1/me",
                    headers={
                        "Authorization": "Bearer invalid-token",
                    },
                )
            ).status_code == 401
            for identifier, password in (("unknown", PASSWORD), ("session_user", "wrong password")):
                bad = await client.post(
                    "/api/v1/auth/password/login",
                    json={
                        "identifier": identifier,
                        "password": password,
                    },
                )
                assert bad.status_code == 401
                assert bad.json()["error"]["message"] == "Invalid credentials"
                assert "set-cookie" not in bad.headers
        with Session(engine) as session:
            assert session.scalar(select(func.count()).select_from(AuthSession)) == 1

    asyncio.run(exercise())


def test_missing_signing_configuration_fails_without_creating_session(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, engine = auth_app
    monkeypatch.delenv("OUTPOST_AUTH_SIGNING_KEY", raising=False)
    from app.core.config import Settings

    app.state.settings = Settings(_env_file=None)

    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await client.post(
                "/api/v1/auth/password/register",
                json={
                    "display_name": "No Key",
                    "username": "no_key",
                    "email": "nokey@example.com",
                    "password": PASSWORD,
                },
            )
            response = await client.post(
                "/api/v1/auth/password/login",
                json={
                    "identifier": "no_key",
                    "password": PASSWORD,
                },
            )
            assert response.status_code == 503
            assert "set-cookie" not in response.headers

    asyncio.run(exercise())
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(AuthSession)) == 0


def test_access_checks_live_session_and_user_state(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from datetime import UTC, datetime, timedelta
    from uuid import uuid4

    import jwt

    from app.core.config import Settings
    from app.modules.users.models import User, UserStatus

    app, engine = auth_app
    key = "test-only-signing-key-with-at-least-32-bytes"
    monkeypatch.setenv("OUTPOST_AUTH_SIGNING_KEY", key)
    app.state.settings = Settings(_env_file=None)

    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await client.post(
                "/api/v1/auth/password/register",
                json={
                    "display_name": "Live State",
                    "username": "live_state",
                    "email": "live@example.com",
                    "password": PASSWORD,
                },
            )
            response = await client.post(
                "/api/v1/auth/password/login",
                json={
                    "identifier": "live_state",
                    "password": PASSWORD,
                },
            )
            assert response.status_code == 200
            token = response.json()["access_token"]
            headers = {"Authorization": "Bearer " + token}
            with Session(engine) as session, session.begin():
                user = session.scalars(select(User)).one()
                user.status = UserStatus.SUSPENDED
            assert (await client.get("/api/v1/me", headers=headers)).status_code == 401
            with Session(engine) as session, session.begin():
                user = session.scalars(select(User)).one()
                user.status = UserStatus.ACTIVE
                stored = session.scalars(select(AuthSession)).one()
                stored.revoked_at = datetime.now(UTC)
            assert (await client.get("/api/v1/me", headers=headers)).status_code == 401
            with Session(engine) as session, session.begin():
                stored = session.scalars(select(AuthSession)).one()
                stored.revoked_at = None
                stored.created_at = datetime.now(UTC) - timedelta(days=2)
                stored.expires_at = datetime.now(UTC) - timedelta(days=1)
            assert (await client.get("/api/v1/me", headers=headers)).status_code == 401
            with Session(engine) as session, session.begin():
                stored = session.scalars(select(AuthSession)).one()
                stored.expires_at = datetime.now(UTC) + timedelta(days=1)
            claims = jwt.decode(token, key, algorithms=["HS256"], audience="outpost-api")
            for change in ({"sub": str(uuid4())}, {"sid": str(uuid4())}):
                forged = jwt.encode(claims | change, key, algorithm="HS256")
                assert (
                    await client.get(
                        "/api/v1/me",
                        headers={
                            "Authorization": "Bearer " + forged,
                        },
                    )
                ).status_code == 401

    asyncio.run(exercise())
