import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient
from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.modules.auth.models import AuthSession, SecurityEvent
from app.modules.auth.tokens import decode_access_token
from tests.integration.test_password_registration import auth_app as auth_app

pytestmark = pytest.mark.integration
SIGNING_KEY = "test-only-session-revocation-key-at-least-32-bytes"
PASSWORD = "long session revocation passphrase"


async def _login(client: AsyncClient, identifier: str) -> tuple[str, str]:
    response = await client.post(
        "/api/v1/auth/password/login",
        json={"identifier": identifier, "password": PASSWORD},
    )
    assert response.status_code == 200, response.text
    refresh = client.cookies.get("outpost_refresh")
    assert refresh is not None
    return response.json()["access_token"], refresh


def test_session_revocation_is_scoped_idempotent_and_handles_current_session(
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
            registered = await client.post(
                "/api/v1/auth/password/register",
                json={
                    "display_name": "Session Owner",
                    "username": "revoke_owner",
                    "email": "revoke-owner@example.com",
                    "password": PASSWORD,
                },
            )
            assert registered.status_code == 201
            controller_access, controller_refresh = await _login(client, "revoke_owner")
            target_access, target_refresh = await _login(client, "revoke_owner")
            owner_id, controller_id = decode_access_token(app.state.settings, controller_access)
            _, target_id = decode_access_token(app.state.settings, target_access)
            headers = {"Authorization": f"Bearer {controller_access}"}

            client.cookies.clear()
            client.cookies.set(
                "outpost_refresh",
                target_refresh,
                domain="testserver.local",
                path="/api/v1/auth",
            )
            rotated = await client.post("/api/v1/auth/refresh")
            assert rotated.status_code == 200
            successor_access = rotated.json()["access_token"]
            _, successor_id = decode_access_token(app.state.settings, successor_access)
            assert successor_id != target_id

            response = await client.delete(f"/api/v1/auth/sessions/{target_id}", headers=headers)
            assert response.status_code == 204, response.text
            assert response.content == b""
            assert response.headers["cache-control"] == "no-store"
            assert (
                await client.get(
                    "/api/v1/me",
                    headers={"Authorization": f"Bearer {successor_access}"},
                )
            ).status_code == 401
            listed = await client.get("/api/v1/auth/sessions", headers=headers)
            assert successor_id not in {item["id"] for item in listed.json()}

            repeated = await client.delete(f"/api/v1/auth/sessions/{target_id}", headers=headers)
            assert repeated.status_code == 204

            other_registered = await client.post(
                "/api/v1/auth/password/register",
                json={
                    "display_name": "Other Owner",
                    "username": "other_revoke_owner",
                    "email": "other-revoke-owner@example.com",
                    "password": PASSWORD,
                },
            )
            assert other_registered.status_code == 201
            other_access, _ = await _login(client, "other_revoke_owner")
            _, other_id = decode_access_token(app.state.settings, other_access)
            foreign = await client.delete(f"/api/v1/auth/sessions/{other_id}", headers=headers)
            missing = await client.delete(f"/api/v1/auth/sessions/{uuid4()}", headers=headers)
            assert foreign.status_code == missing.status_code == 404
            assert foreign.json()["error"]["message"] == missing.json()["error"]["message"]

            client.cookies.clear()
            client.cookies.set(
                "outpost_refresh",
                controller_refresh,
                domain="testserver.local",
                path="/api/v1/auth",
            )
            current = await client.delete(f"/api/v1/auth/sessions/{controller_id}", headers=headers)
            assert current.status_code == 204
            assert "Max-Age=0" in current.headers["set-cookie"]
            assert client.cookies.get("outpost_refresh") is None
            assert (await client.get("/api/v1/me", headers=headers)).status_code == 401

            with Session(engine) as session:
                events = session.scalars(
                    select(SecurityEvent)
                    .where(
                        SecurityEvent.user_id == owner_id,
                        SecurityEvent.event_type == "authentication.session_revoked",
                    )
                    .order_by(SecurityEvent.occurred_at)
                ).all()
                assert [event.session_id for event in events] == [target_id, controller_id]
                assert [event.event_data["current"] for event in events] == [False, True]

    asyncio.run(exercise())


def test_concurrent_revocation_records_one_event(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.modules.auth import sessions as session_service

    app, engine = auth_app
    monkeypatch.setenv("OUTPOST_AUTH_SIGNING_KEY", SIGNING_KEY)
    app.state.settings = Settings(_env_file=None)

    async def prepare() -> tuple[UUID, UUID]:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            response = await client.post(
                "/api/v1/auth/password/register",
                json={
                    "display_name": "Concurrent Owner",
                    "username": "concurrent_revoke",
                    "email": "concurrent-revoke@example.com",
                    "password": PASSWORD,
                },
            )
            assert response.status_code == 201
            access, _ = await _login(client, "concurrent_revoke")
            user_id, _ = decode_access_token(app.state.settings, access)
            target_access, _ = await _login(client, "concurrent_revoke")
            _, target_id = decode_access_token(app.state.settings, target_access)
            return user_id, target_id

    user_id, target_id = asyncio.run(prepare())
    preloaded = Barrier(2)

    def attempt() -> bool:
        with Session(engine, expire_on_commit=False) as session:
            assert session.get(AuthSession, target_id) is not None
            preloaded.wait(timeout=5)
            return session_service.revoke_owned_session(
                session,
                user_id,
                target_id,
                is_current=False,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(lambda _: attempt(), range(2))) == [False, True]

    with Session(engine) as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(SecurityEvent)
                .where(
                    SecurityEvent.session_id == target_id,
                    SecurityEvent.event_type == "authentication.session_revoked",
                )
            )
            == 1
        )
        target = session.get(AuthSession, target_id)
        assert target is not None
        assert target.revoked_at is not None


def test_session_revocation_rolls_back_if_audit_event_cannot_be_written(
    auth_app: tuple[FastAPI, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.modules.auth.sessions import revoke_owned_session

    app, engine = auth_app
    monkeypatch.setenv("OUTPOST_AUTH_SIGNING_KEY", SIGNING_KEY)
    app.state.settings = Settings(_env_file=None)

    async def prepare() -> tuple[UUID, UUID]:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            response = await client.post(
                "/api/v1/auth/password/register",
                json={
                    "display_name": "Rollback Owner",
                    "username": "rollback_revoke",
                    "email": "rollback-revoke@example.com",
                    "password": PASSWORD,
                },
            )
            assert response.status_code == 201
            access, _ = await _login(client, "rollback_revoke")
            user_id, target_id = decode_access_token(app.state.settings, access)
            return user_id, target_id

    user_id, target_id = asyncio.run(prepare())

    def fail_event(*args: object) -> None:
        raise RuntimeError("injected security event failure")

    event.listen(SecurityEvent, "before_insert", fail_event)
    try:
        with (
            Session(engine, expire_on_commit=False) as session,
            pytest.raises(RuntimeError, match="injected security event"),
        ):
            revoke_owned_session(
                session,
                user_id,
                target_id,
                is_current=True,
            )
    finally:
        event.remove(SecurityEvent, "before_insert", fail_event)

    with Session(engine) as session:
        target = session.get(AuthSession, target_id)
        assert target is not None
        assert target.revoked_at is None
        assert (
            session.scalar(
                select(func.count())
                .select_from(SecurityEvent)
                .where(SecurityEvent.event_type == "authentication.session_revoked")
            )
            == 0
        )
