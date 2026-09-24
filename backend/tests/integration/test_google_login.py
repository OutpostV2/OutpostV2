import asyncio
import os
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Lock

import pytest
from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient
from sqlalchemy import Engine, create_engine, func, select
from sqlalchemy.orm import Session

from alembic import command
from app.core.config import Settings
from app.main import create_app
from app.modules.auth.google import GooglePrincipal, MemoryOAuthStateStore
from app.modules.auth.models import AuthSession, OAuthIdentity
from app.modules.auth.rate_limits import MemoryFixedWindowRateLimiter, OtpRequestRateLimiter
from app.modules.users.models import User, UserStatus
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")
SIGNING_KEY = "test-only-signing-key-with-at-least-32-bytes"
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set"),
]


class StubGoogleProvider:
    def __init__(self, principal: GooglePrincipal) -> None:
        self.principal = principal
        self.calls: list[tuple[str, str]] = []
        self._lock = Lock()

    def exchange_code(self, code: str, *, nonce: str, settings: Settings) -> GooglePrincipal:
        del settings
        with self._lock:
            self.calls.append((code, nonce))
        return self.principal


@pytest.fixture
def google_app(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[tuple[FastAPI, Engine, MemoryOAuthStateStore, StubGoogleProvider]]:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", url.render_as_string(False))
        command.upgrade(migration_config(), "head")
        engine = create_engine(url, hide_parameters=True)
        settings = Settings(
            database_url=url.render_as_string(False),
            auth_signing_key=SIGNING_KEY,
            google_client_id="test-client.apps.googleusercontent.com",
            google_client_secret="test-google-secret",
            google_redirect_uri="https://testserver/api/v1/auth/google/callback",
            _env_file=None,
        )
        state_store = MemoryOAuthStateStore()
        provider = StubGoogleProvider(
            GooglePrincipal(
                subject="stable-google-subject",
                email="person@example.com",
                name="Google Person",
            )
        )
        limiter = OtpRequestRateLimiter(MemoryFixedWindowRateLimiter(), settings)
        app = create_app(
            settings,
            engine=engine,
            google_oauth_state_store=state_store,
            google_oidc_provider=provider,
            otp_rate_limiter=limiter,
            configure_logs=False,
        )
        try:
            yield app, engine, state_store, provider
        finally:
            engine.dispose()


def _callback_url(state: str, code: str = "authorization-code") -> str:
    return (
        "/api/v1/auth/google/callback"
        f"?state={state}&code={code}&iss=https%3A%2F%2Faccounts.google.com"
    )


def test_google_callback_creates_identity_reuses_it_and_rejects_replay(
    google_app: tuple[FastAPI, Engine, MemoryOAuthStateStore, StubGoogleProvider],
) -> None:
    app, engine, store, provider = google_app
    assert store.put("first-state", "first-nonce", ttl_seconds=600)

    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            first = await client.get(_callback_url("first-state"))
            assert first.status_code == 200, first.text
            assert first.headers["cache-control"] == "no-store"
            assert "HttpOnly" in first.headers["set-cookie"]
            token = first.json()["access_token"]
            me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
            assert me.status_code == 200
            first_user_id = me.json()["id"]
            assert me.json()["primary_email"] == "person@example.com"

            replay = await client.get(_callback_url("first-state"))
            assert replay.status_code == 401
            assert replay.json()["error"]["message"] == "Invalid Google authentication response"

            assert store.put("second-state", "second-nonce", ttl_seconds=600)
            second = await client.get(_callback_url("second-state", "second-code"))
            assert second.status_code == 200
            second_me = await client.get(
                "/api/v1/me",
                headers={"Authorization": f"Bearer {second.json()['access_token']}"},
            )
            assert second_me.json()["id"] == first_user_id

    asyncio.run(exercise())
    assert provider.calls == [
        ("authorization-code", "first-nonce"),
        ("second-code", "second-nonce"),
    ]
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1
        identity = session.scalars(select(OAuthIdentity)).one()
        assert identity.provider == "google"
        assert identity.provider_subject == "stable-google-subject"
        assert identity.provider_email == "person@example.com"
        assert session.scalar(select(func.count()).select_from(AuthSession)) == 2


def test_google_email_collision_creates_separate_unlinked_user(
    google_app: tuple[FastAPI, Engine, MemoryOAuthStateStore, StubGoogleProvider],
) -> None:
    app, engine, store, _ = google_app
    with Session(engine) as session, session.begin():
        existing = User(display_name="Existing Password User", primary_email="person@example.com")
        session.add(existing)
        session.flush()
        existing_id = existing.id
    assert store.put("collision-state", "nonce", ttl_seconds=600)

    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            response = await client.get(_callback_url("collision-state"))
            assert response.status_code == 200, response.text

    asyncio.run(exercise())
    with Session(engine) as session:
        identity = session.scalars(select(OAuthIdentity)).one()
        assert identity.user_id != existing_id
        google_user = session.get(User, identity.user_id)
        assert google_user is not None
        assert google_user.primary_email is None
        assert session.scalar(select(func.count()).select_from(User)) == 2


def test_google_callback_rejects_suspended_identity_without_new_session(
    google_app: tuple[FastAPI, Engine, MemoryOAuthStateStore, StubGoogleProvider],
) -> None:
    app, engine, store, _ = google_app
    with Session(engine) as session, session.begin():
        user = User(display_name="Suspended", status=UserStatus.SUSPENDED)
        session.add(user)
        session.flush()
        session.add(
            OAuthIdentity(
                user_id=user.id,
                provider="google",
                provider_subject="stable-google-subject",
                provider_email="person@example.com",
            )
        )
    assert store.put("suspended-state", "nonce", ttl_seconds=600)

    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            response = await client.get(_callback_url("suspended-state"))
            assert response.status_code == 401
            assert "set-cookie" not in response.headers

    asyncio.run(exercise())
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(AuthSession)) == 0


def test_concurrent_first_google_logins_create_one_identity(
    google_app: tuple[FastAPI, Engine, MemoryOAuthStateStore, StubGoogleProvider],
) -> None:
    app, engine, store, _ = google_app
    assert store.put("state-one", "nonce-one", ttl_seconds=600)
    assert store.put("state-two", "nonce-two", ttl_seconds=600)
    barrier = Barrier(2)

    def login(item: tuple[str, str]) -> int:
        state, code = item
        barrier.wait()

        async def exercise() -> int:
            async with AsyncClient(
                transport=ASGITransport(app), base_url="https://testserver"
            ) as client:
                return (await client.get(_callback_url(state, code))).status_code

        return asyncio.run(exercise())

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(login, [("state-one", "code-one"), ("state-two", "code-two")]))

    assert statuses == [200, 200]
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1
        assert session.scalar(select(func.count()).select_from(OAuthIdentity)) == 1
        assert session.scalar(select(func.count()).select_from(AuthSession)) == 2
