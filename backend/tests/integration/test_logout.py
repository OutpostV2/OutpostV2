import asyncio

import pytest
from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.modules.auth.models import AuthSession, SecurityEvent
from tests.integration.test_password_registration import auth_app as auth_app

pytestmark = pytest.mark.integration


def test_logout_revokes_only_current_session_and_clears_cookie(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, engine = auth_app
    monkeypatch.setenv("OUTPOST_AUTH_SIGNING_KEY", "test-only-logout-signing-key-at-least-32-bytes")
    app.state.settings = Settings(_env_file=None)

    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            response = await client.post(
                "/api/v1/auth/password/register",
                json={
                    "display_name": "Logout",
                    "username": "logout_user",
                    "email": "logout@example.com",
                    "password": "long logout passphrase",
                },
            )
            assert response.status_code == 201
            tokens = []
            for _ in range(2):
                response = await client.post(
                    "/api/v1/auth/password/login",
                    json={
                        "identifier": "logout_user",
                        "password": "long logout passphrase",
                    },
                )
                assert response.status_code == 200
                tokens.append(response.json()["access_token"])
            # A browser cookie alone cannot authorize logout or other protected actions.
            assert (await client.post("/api/v1/auth/logout")).status_code == 401
            response = await client.post(
                "/api/v1/auth/logout",
                headers={
                    "Authorization": "Bearer " + tokens[1],
                },
            )
            assert response.status_code == 204, response.text
            assert response.content == b""
            assert "Max-Age=0" in response.headers["set-cookie"]
            assert "Path=/api/v1/auth" in response.headers["set-cookie"]
            assert client.cookies.get("outpost_refresh") is None
            assert response.headers["cache-control"] == "no-store"
            assert (
                await client.get(
                    "/api/v1/me",
                    headers={
                        "Authorization": "Bearer " + tokens[1],
                    },
                )
            ).status_code == 401
            assert (
                await client.get(
                    "/api/v1/me",
                    headers={
                        "Authorization": "Bearer " + tokens[0],
                    },
                )
            ).status_code == 200
            assert (
                await client.post(
                    "/api/v1/auth/logout",
                    headers={
                        "Authorization": "Bearer " + tokens[1],
                    },
                )
            ).status_code == 401

    asyncio.run(exercise())
    with Session(engine) as session:
        sessions = session.scalars(select(AuthSession)).all()
        assert sum(item.revoked_at is not None for item in sessions) == 1
        events = session.scalars(select(SecurityEvent)).all()
        assert sum(item.event_type == "authentication.logout" for item in events) == 1
