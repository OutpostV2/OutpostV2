import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.modules.auth.models import AuthSession
from app.modules.auth.tokens import decode_access_token
from tests.integration.test_password_registration import auth_app as auth_app

pytestmark = pytest.mark.integration
SIGNING_KEY = "test-only-session-listing-key-at-least-32-bytes"
PASSWORD = "long session listing passphrase"


def test_session_listing_returns_only_the_users_usable_leaf_sessions(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, engine = auth_app
    monkeypatch.setenv("OUTPOST_AUTH_SIGNING_KEY", SIGNING_KEY)
    app.state.settings = Settings(_env_file=None)
    select_count = 0

    def count_selects(
        connection: object,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,
    ) -> None:
        del connection, cursor, parameters, context, executemany
        nonlocal select_count
        if statement.lstrip().upper().startswith("SELECT"):
            select_count += 1

    async def exercise() -> None:
        nonlocal select_count
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            registered = await client.post(
                "/api/v1/auth/password/register",
                json={
                    "display_name": "Session Owner",
                    "username": "session_owner",
                    "email": "session-owner@example.com",
                    "password": PASSWORD,
                },
            )
            assert registered.status_code == 201
            tokens: list[str] = []
            for number in range(5):
                response = await client.post(
                    "/api/v1/auth/password/login",
                    headers={"user-agent": f"Outpost Test Device {number}"},
                    json={"identifier": "session_owner", "password": PASSWORD},
                )
                assert response.status_code == 200
                tokens.append(response.json()["access_token"])

            session_ids = [decode_access_token(app.state.settings, token)[1] for token in tokens]
            now = datetime.now(UTC)
            with Session(engine) as session, session.begin():
                stored = {
                    item.id: item
                    for item in session.scalars(
                        select(AuthSession).where(AuthSession.id.in_(session_ids))
                    )
                }
                stored[session_ids[0]].last_used_at = now - timedelta(minutes=2)
                stored[session_ids[1]].last_used_at = now - timedelta(minutes=1)
                stored[session_ids[2]].revoked_at = now
                stored[session_ids[3]].created_at = now - timedelta(days=2)
                stored[session_ids[3]].expires_at = now - timedelta(days=1)
                stored[session_ids[4]].token_family_id = stored[session_ids[1]].token_family_id
                stored[session_ids[4]].revoked_at = now
                stored[session_ids[4]].replaced_by_session_id = session_ids[1]

            second_user = await client.post(
                "/api/v1/auth/password/register",
                json={
                    "display_name": "Other User",
                    "username": "other_session_user",
                    "email": "other-session@example.com",
                    "password": PASSWORD,
                },
            )
            assert second_user.status_code == 201
            other_login = await client.post(
                "/api/v1/auth/password/login",
                json={"identifier": "other_session_user", "password": PASSWORD},
            )
            assert other_login.status_code == 200
            other_session_id = decode_access_token(
                app.state.settings, other_login.json()["access_token"]
            )[1]

            event.listen(engine, "before_cursor_execute", count_selects)
            try:
                response = await client.get(
                    "/api/v1/auth/sessions",
                    headers={"Authorization": f"Bearer {tokens[0]}"},
                )
            finally:
                event.remove(engine, "before_cursor_execute", count_selects)

            assert response.status_code == 200, response.text
            assert response.headers["cache-control"] == "no-store"
            assert select_count == 3
            payload = response.json()
            assert [item["id"] for item in payload] == [
                str(session_ids[1]),
                str(session_ids[0]),
            ]
            assert [item["is_current"] for item in payload] == [False, True]
            assert {item["user_agent"] for item in payload} == {
                "Outpost Test Device 0",
                "Outpost Test Device 1",
            }
            assert all(
                set(item)
                == {
                    "id",
                    "created_at",
                    "last_used_at",
                    "expires_at",
                    "user_agent",
                    "ip_address",
                    "is_current",
                }
                for item in payload
            )
            assert str(other_session_id) not in response.text
            for private_name in (
                "refresh_token",
                "refresh_token_hash",
                "token_family_id",
                "replaced_by_session_id",
            ):
                assert private_name not in response.text
            assert (await client.get("/api/v1/auth/sessions")).status_code == 401

    asyncio.run(exercise())
