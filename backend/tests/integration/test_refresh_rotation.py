import asyncio
import hashlib
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient
from sqlalchemy import Engine, create_engine, event, func, inspect, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from alembic import command
from app.core.config import Settings
from app.core.errors import UnauthorizedError
from app.modules.auth.models import AuthSession, SecurityEvent
from tests.integration.database import migration_config, temporary_postgresql_database
from tests.integration.test_password_registration import auth_app as auth_app

pytestmark = pytest.mark.integration
SIGNING_KEY = "test-only-refresh-signing-key-at-least-32-bytes"
PASSWORD = "long refresh test passphrase"
DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")


async def _register_and_login(client: AsyncClient) -> tuple[str, str]:
    response = await client.post(
        "/api/v1/auth/password/register",
        json={
            "display_name": "Refresh User",
            "username": "refresh_user",
            "email": "refresh@example.com",
            "password": PASSWORD,
        },
    )
    assert response.status_code == 201, response.text
    response = await client.post(
        "/api/v1/auth/password/login",
        json={"identifier": "refresh_user", "password": PASSWORD},
    )
    assert response.status_code == 200, response.text
    refresh = client.cookies.get("outpost_refresh")
    assert refresh is not None
    return response.json()["access_token"], refresh


def test_refresh_rotates_cookie_and_replay_revokes_the_token_family(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, engine = auth_app
    monkeypatch.setenv("OUTPOST_AUTH_SIGNING_KEY", SIGNING_KEY)
    app.state.settings = Settings(_env_file=None)

    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            old_access, old_refresh = await _register_and_login(client)
            response = await client.post("/api/v1/auth/refresh")
            assert response.status_code == 200, response.text
            assert response.headers["cache-control"] == "no-store"
            new_access = response.json()["access_token"]
            new_refresh = client.cookies.get("outpost_refresh")
            assert new_refresh is not None and new_refresh != old_refresh
            assert old_refresh not in response.text and new_refresh not in response.text
            cookie = response.headers["set-cookie"]
            assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=strict" in cookie
            old_me = await client.get(
                "/api/v1/me", headers={"Authorization": f"Bearer {old_access}"}
            )
            assert old_me.status_code == 401
            new_me = await client.get(
                "/api/v1/me", headers={"Authorization": f"Bearer {new_access}"}
            )
            assert new_me.status_code == 200

            async with AsyncClient(
                transport=ASGITransport(app), base_url="https://testserver"
            ) as replay_client:
                replay_client.cookies.set(
                    "outpost_refresh", old_refresh, domain="testserver.local", path="/api/v1/auth"
                )
                replay = await replay_client.post("/api/v1/auth/refresh")
                assert replay.status_code == 401
                assert replay.json()["error"]["message"] == (
                    "Invalid or expired refresh credential"
                )
                replay_client.cookies.clear()
                missing = await replay_client.post("/api/v1/auth/refresh")
                assert missing.status_code == 401
                replay_client.cookies.set(
                    "outpost_refresh",
                    "unknown-refresh-token",
                    domain="testserver.local",
                    path="/api/v1/auth",
                )
                unknown = await replay_client.post("/api/v1/auth/refresh")
                assert unknown.status_code == 401
                assert unknown.json()["error"]["message"] == (
                    "Invalid or expired refresh credential"
                )
            revoked_me = await client.get(
                "/api/v1/me", headers={"Authorization": f"Bearer {new_access}"}
            )
            assert revoked_me.status_code == 401

        with Session(engine) as session:
            sessions = session.scalars(select(AuthSession).order_by(AuthSession.created_at)).all()
            assert len(sessions) == 2
            assert (
                sessions[0].refresh_token_hash == hashlib.sha256(old_refresh.encode()).hexdigest()
            )
            assert (
                sessions[1].refresh_token_hash == hashlib.sha256(new_refresh.encode()).hexdigest()
            )
            assert sessions[0].token_family_id == sessions[1].token_family_id
            assert sessions[0].replaced_by_session_id == sessions[1].id
            assert all(item.revoked_at is not None for item in sessions)
            events = session.scalars(select(SecurityEvent)).all()
            assert sum(item.event_type == "authentication.refresh_rotated" for item in events) == 1
            replay_events = [
                item
                for item in events
                if item.event_type == "authentication.refresh_replay_detected"
            ]
            assert len(replay_events) == 1

    asyncio.run(exercise())


def test_concurrent_refresh_allows_one_rotation_then_revokes_replayed_family(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.modules.auth import sessions as session_service

    app, engine = auth_app
    monkeypatch.setenv("OUTPOST_AUTH_SIGNING_KEY", SIGNING_KEY)
    app.state.settings = Settings(_env_file=None)

    async def login() -> str:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            _, refresh = await _register_and_login(client)
            return refresh

    refresh = asyncio.run(login())

    def attempt() -> bool:
        with Session(engine, expire_on_commit=False) as session:
            try:
                session_service.rotate_refresh_session(
                    session,
                    app.state.settings,
                    refresh,
                    user_agent="concurrent-test",
                    ip_address="203.0.113.8",
                )
                return True
            except UnauthorizedError:
                return False

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(lambda _: attempt(), range(2))) == [False, True]

    with Session(engine) as session:
        stored = session.scalars(select(AuthSession)).all()
        assert len(stored) == 2
        assert all(item.revoked_at is not None for item in stored)
        assert (
            session.scalar(
                select(func.count())
                .select_from(SecurityEvent)
                .where(SecurityEvent.event_type == "authentication.refresh_replay_detected")
            )
            == 1
        )


def test_ancestor_replay_cannot_miss_a_concurrently_created_descendant(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.modules.auth.sessions import rotate_refresh_session

    app, engine = auth_app
    monkeypatch.setenv("OUTPOST_AUTH_SIGNING_KEY", SIGNING_KEY)
    app.state.settings = Settings(_env_file=None)

    async def login() -> str:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            _, refresh = await _register_and_login(client)
            return refresh

    ancestor = asyncio.run(login())
    with Session(engine, expire_on_commit=False) as session:
        _, descendant = rotate_refresh_session(
            session,
            app.state.settings,
            ancestor,
            user_agent="lineage-test",
            ip_address="203.0.113.9",
        )

    successor_write_reached = threading.Event()
    allow_successor_write = threading.Event()

    def pause_successor(*args: object) -> None:
        successor_write_reached.set()
        if not allow_successor_write.wait(timeout=5):
            raise RuntimeError("timed out coordinating refresh race")

    def attempt(refresh: str) -> tuple[str, str] | None:
        with Session(engine, expire_on_commit=False) as session:
            try:
                return rotate_refresh_session(
                    session,
                    app.state.settings,
                    refresh,
                    user_agent="lineage-race",
                    ip_address="203.0.113.10",
                )
            except UnauthorizedError:
                return None

    event.listen(AuthSession, "before_insert", pause_successor)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            successor_future = executor.submit(attempt, descendant)
            assert successor_write_reached.wait(timeout=5)
            replay_future = executor.submit(attempt, ancestor)
            time.sleep(0.25)
            allow_successor_write.set()
            successor_result = successor_future.result(timeout=5)
            replay_result = replay_future.result(timeout=5)
    finally:
        allow_successor_write.set()
        event.remove(AuthSession, "before_insert", pause_successor)

    assert successor_result is not None
    assert replay_result is None
    with Session(engine) as session:
        stored = session.scalars(select(AuthSession)).all()
        assert len(stored) == 3
        assert all(item.revoked_at is not None for item in stored)


def test_refresh_rotation_rolls_back_if_successor_session_cannot_be_written(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.modules.auth.sessions import rotate_refresh_session

    app, engine = auth_app
    monkeypatch.setenv("OUTPOST_AUTH_SIGNING_KEY", SIGNING_KEY)
    app.state.settings = Settings(_env_file=None)

    async def login() -> str:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            _, refresh = await _register_and_login(client)
            return refresh

    refresh = asyncio.run(login())

    def fail_successor(*args: object) -> None:
        raise RuntimeError("injected successor write failure")

    event.listen(AuthSession, "before_insert", fail_successor)
    try:
        with (
            Session(engine, expire_on_commit=False) as session,
            pytest.raises(RuntimeError, match="injected successor"),
        ):
            rotate_refresh_session(
                session,
                app.state.settings,
                refresh,
                user_agent=None,
                ip_address=None,
            )
    finally:
        event.remove(AuthSession, "before_insert", fail_successor)

    with Session(engine) as session:
        stored = session.scalars(select(AuthSession)).one()
        assert stored.revoked_at is None
        assert stored.replaced_by_session_id is None
        assert (
            session.scalar(
                select(func.count())
                .select_from(SecurityEvent)
                .where(SecurityEvent.event_type == "authentication.refresh_rotated")
            )
            == 0
        )


@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_refresh_rotation_migration_upgrades_and_rolls_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as database_url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", database_url.render_as_string(False))
        config = migration_config()
        command.upgrade(config, "20260918_0012")
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            inspector = inspect(engine)
            columns = {column["name"] for column in inspector.get_columns("auth_sessions")}
            assert "replaced_by_session_id" in columns
            foreign_keys = {item["name"] for item in inspector.get_foreign_keys("auth_sessions")}
            assert "fk_auth_sessions_replaced_by_session_id_auth_sessions" in foreign_keys
            unique_constraints = {
                item["name"] for item in inspector.get_unique_constraints("auth_sessions")
            }
            assert "uq_auth_sessions_replaced_by_session_id" in unique_constraints
        finally:
            engine.dispose()

        command.downgrade(config, "20260918_0011")
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            columns = {column["name"] for column in inspect(engine).get_columns("auth_sessions")}
            assert "replaced_by_session_id" not in columns
        finally:
            engine.dispose()
