import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID

import pytest
from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient
from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import UnauthorizedError
from app.modules.auth.models import AuthSession, SecurityEvent
from app.modules.auth.tokens import decode_access_token
from tests.integration.test_password_registration import auth_app as auth_app

pytestmark = pytest.mark.integration
SIGNING_KEY = "test-only-logout-all-key-at-least-32-bytes"
PASSWORD = "long logout all passphrase"


async def _register(client: AsyncClient, username: str) -> None:
    response = await client.post(
        "/api/v1/auth/password/register",
        json={
            "display_name": username,
            "username": username,
            "email": f"{username}@example.com",
            "password": PASSWORD,
        },
    )
    assert response.status_code == 201


async def _login(client: AsyncClient, username: str) -> tuple[str, str]:
    response = await client.post(
        "/api/v1/auth/password/login",
        json={"identifier": username, "password": PASSWORD},
    )
    assert response.status_code == 200
    refresh = client.cookies.get("outpost_refresh")
    assert refresh is not None
    return response.json()["access_token"], refresh


def test_logout_all_revokes_only_the_authenticated_users_sessions(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.modules.auth.sessions import revoke_all_sessions

    app, engine = auth_app
    monkeypatch.setenv("OUTPOST_AUTH_SIGNING_KEY", SIGNING_KEY)
    app.state.settings = Settings(_env_file=None)

    async def exercise() -> tuple[UUID, UUID]:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client, "logout_all_owner")
            credentials = [await _login(client, "logout_all_owner") for _ in range(3)]
            owner_id, current_id = decode_access_token(app.state.settings, credentials[0][0])
            await _register(client, "logout_all_other")
            other_access, _ = await _login(client, "logout_all_other")
            other_id, _ = decode_access_token(app.state.settings, other_access)

            response = await client.post(
                "/api/v1/auth/logout-all",
                headers={"Authorization": f"Bearer {credentials[0][0]}"},
            )
            assert response.status_code == 204, response.text
            assert response.content == b""
            assert response.headers["cache-control"] == "no-store"
            assert "Max-Age=0" in response.headers["set-cookie"]
            for access, refresh in credentials:
                assert (
                    await client.get(
                        "/api/v1/me",
                        headers={"Authorization": f"Bearer {access}"},
                    )
                ).status_code == 401
                async with AsyncClient(
                    transport=ASGITransport(app), base_url="https://testserver"
                ) as refresh_client:
                    refresh_client.cookies.set(
                        "outpost_refresh",
                        refresh,
                        domain="testserver.local",
                        path="/api/v1/auth",
                    )
                    assert (await refresh_client.post("/api/v1/auth/refresh")).status_code == 401
            assert (
                await client.get(
                    "/api/v1/me",
                    headers={"Authorization": f"Bearer {other_access}"},
                )
            ).status_code == 200
            return owner_id, other_id

    owner_id, other_id = asyncio.run(exercise())
    with Session(engine, expire_on_commit=False) as session:
        assert revoke_all_sessions(session, owner_id, current_session_id=None) == 0
    with Session(engine) as session:
        owner_sessions = session.scalars(
            select(AuthSession).where(AuthSession.user_id == owner_id)
        ).all()
        other_sessions = session.scalars(
            select(AuthSession).where(AuthSession.user_id == other_id)
        ).all()
        assert len(owner_sessions) == 3
        assert all(item.revoked_at is not None for item in owner_sessions)
        assert len(other_sessions) == 1 and other_sessions[0].revoked_at is None
        events = session.scalars(
            select(SecurityEvent).where(
                SecurityEvent.user_id == owner_id,
                SecurityEvent.event_type == "authentication.logout_all",
            )
        ).all()
        assert len(events) == 1
        assert events[0].event_data["revoked_count"] == 3


def test_logout_all_serializes_with_refresh_rotation(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.modules.auth.sessions import revoke_all_sessions, rotate_refresh_session

    app, engine = auth_app
    monkeypatch.setenv("OUTPOST_AUTH_SIGNING_KEY", SIGNING_KEY)
    app.state.settings = Settings(_env_file=None)

    async def prepare() -> tuple[UUID, UUID, str]:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client, "logout_all_race")
            access, refresh = await _login(client, "logout_all_race")
            user_id, session_id = decode_access_token(app.state.settings, access)
            return user_id, session_id, refresh

    user_id, session_id, refresh = asyncio.run(prepare())
    start = Barrier(2)

    def rotate() -> bool:
        with Session(engine, expire_on_commit=False) as session:
            start.wait(timeout=5)
            try:
                rotate_refresh_session(
                    session,
                    app.state.settings,
                    refresh,
                    user_agent=None,
                    ip_address=None,
                )
                return True
            except UnauthorizedError:
                return False

    def logout_all() -> int:
        with Session(engine, expire_on_commit=False) as session:
            start.wait(timeout=5)
            return revoke_all_sessions(
                session,
                user_id,
                current_session_id=session_id,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        rotated = executor.submit(rotate)
        revoked = executor.submit(logout_all)
        assert revoked.result(timeout=10) >= 1
        assert isinstance(rotated.result(timeout=10), bool)
    with Session(engine) as session:
        stored = session.scalars(select(AuthSession).where(AuthSession.user_id == user_id)).all()
        assert all(item.revoked_at is not None for item in stored)


def test_logout_all_rolls_back_if_security_event_fails(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.modules.auth.sessions import revoke_all_sessions

    app, engine = auth_app
    monkeypatch.setenv("OUTPOST_AUTH_SIGNING_KEY", SIGNING_KEY)
    app.state.settings = Settings(_env_file=None)

    async def prepare() -> tuple[UUID, UUID]:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client, "logout_all_rollback")
            access, _ = await _login(client, "logout_all_rollback")
            return decode_access_token(app.state.settings, access)

    user_id, session_id = asyncio.run(prepare())

    def fail_event(*args: object) -> None:
        raise RuntimeError("injected logout-all event failure")

    event.listen(SecurityEvent, "before_insert", fail_event)
    try:
        with (
            Session(engine, expire_on_commit=False) as session,
            pytest.raises(RuntimeError, match="injected logout-all"),
        ):
            revoke_all_sessions(session, user_id, current_session_id=session_id)
    finally:
        event.remove(SecurityEvent, "before_insert", fail_event)
    with Session(engine) as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(AuthSession)
                .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
            )
            == 1
        )


def test_logout_all_serializes_with_current_session_logout(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.modules.auth.sessions import revoke_all_sessions, revoke_current_session

    app, engine = auth_app
    monkeypatch.setenv("OUTPOST_AUTH_SIGNING_KEY", SIGNING_KEY)
    app.state.settings = Settings(_env_file=None)

    async def prepare() -> tuple[UUID, UUID]:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client, "logout_all_lock_order")
            access, _ = await _login(client, "logout_all_lock_order")
            await _login(client, "logout_all_lock_order")
            return decode_access_token(app.state.settings, access)

    user_id, current_id = asyncio.run(prepare())
    start = Barrier(2)

    def logout_current() -> bool:
        with Session(engine, expire_on_commit=False) as session:
            current = session.get(AuthSession, current_id)
            assert current is not None
            start.wait(timeout=5)
            return revoke_current_session(session, current)

    def logout_everywhere() -> int:
        with Session(engine, expire_on_commit=False) as session:
            start.wait(timeout=5)
            return revoke_all_sessions(
                session,
                user_id,
                current_session_id=current_id,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        current_result = executor.submit(logout_current)
        all_result = executor.submit(logout_everywhere)
        assert isinstance(current_result.result(timeout=10), bool)
        assert all_result.result(timeout=10) >= 1
    with Session(engine) as session:
        stored = session.scalars(select(AuthSession).where(AuthSession.user_id == user_id)).all()
        assert all(item.revoked_at is not None for item in stored)


def test_current_logout_revokes_successor_created_after_authentication(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.modules.auth.sessions import revoke_current_session, rotate_refresh_session

    app, engine = auth_app
    monkeypatch.setenv("OUTPOST_AUTH_SIGNING_KEY", SIGNING_KEY)
    app.state.settings = Settings(_env_file=None)

    async def prepare() -> tuple[UUID, str]:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            await _register(client, "logout_refresh_race")
            access, refresh = await _login(client, "logout_refresh_race")
            return decode_access_token(app.state.settings, access)[1], refresh

    session_id, refresh = asyncio.run(prepare())
    with Session(engine, expire_on_commit=False) as stale_session:
        authenticated = stale_session.get(AuthSession, session_id)
        assert authenticated is not None
        with Session(engine, expire_on_commit=False) as rotation_session:
            rotate_refresh_session(
                rotation_session,
                app.state.settings,
                refresh,
                user_agent=None,
                ip_address=None,
            )
        assert revoke_current_session(stale_session, authenticated)
    with Session(engine) as session:
        family = session.scalars(select(AuthSession)).all()
        assert len(family) == 2
        assert all(item.revoked_at is not None for item in family)
