import asyncio
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from httpx2 import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError
from app.main import create_app
from app.modules.auth.google import (
    GOOGLE_AUTHORIZATION_ENDPOINT,
    OAUTH_CORRELATION_TTL_SECONDS,
    MemoryOAuthStateStore,
    begin_google_authorization,
)
from app.modules.auth.rate_limits import MemoryFixedWindowRateLimiter, OtpRequestRateLimiter

DATABASE_URL = "postgresql+psycopg://outpost:local-password@127.0.0.1:5433/outpost"


def google_settings(**overrides: object) -> Settings:
    values: dict[str, Any] = {
        "database_url": DATABASE_URL,
        "google_client_id": "test-client.apps.googleusercontent.com",
        "google_client_secret": "test-only-google-client-secret",
        "google_redirect_uri": "https://api.example.com/api/v1/auth/google/callback",
        "_env_file": None,
    }
    values.update(overrides)
    return Settings(**values)


def test_google_authorization_uses_single_use_state_and_nonce() -> None:
    now = [100.0]
    store = MemoryOAuthStateStore(clock=lambda: now[0])

    authorization_url = begin_google_authorization(google_settings(), store)

    parsed = urlparse(authorization_url)
    query = parse_qs(parsed.query)
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == GOOGLE_AUTHORIZATION_ENDPOINT
    assert query["client_id"] == ["test-client.apps.googleusercontent.com"]
    assert query["redirect_uri"] == ["https://api.example.com/api/v1/auth/google/callback"]
    assert query["response_type"] == ["code"]
    assert query["scope"] == ["openid email profile"]
    assert len(query["state"][0]) >= 43
    assert len(query["nonce"][0]) >= 43
    assert query["state"][0] != query["nonce"][0]
    assert store.consume(query["state"][0]) == query["nonce"][0]
    assert store.consume(query["state"][0]) is None

    second_url = begin_google_authorization(google_settings(), store)
    second_query = parse_qs(urlparse(second_url).query)
    assert second_query["state"] != query["state"]
    assert second_query["nonce"] != query["nonce"]


def test_memory_google_state_expires_at_exact_ttl() -> None:
    now = [100.0]
    store = MemoryOAuthStateStore(clock=lambda: now[0])
    assert store.put("state", "nonce", ttl_seconds=OAUTH_CORRELATION_TTL_SECONDS)
    now[0] += OAUTH_CORRELATION_TTL_SECONDS - 0.001
    assert store.consume("state") == "nonce"

    assert store.put("expired", "nonce", ttl_seconds=OAUTH_CORRELATION_TTL_SECONDS)
    now[0] += OAUTH_CORRELATION_TTL_SECONDS
    assert store.consume("expired") is None


def test_google_authorization_fails_closed_without_configuration() -> None:
    settings = Settings(database_url=DATABASE_URL, _env_file=None)
    with pytest.raises(ServiceUnavailableError, match="Google authentication is not configured"):
        begin_google_authorization(settings, MemoryOAuthStateStore())


def test_google_redirect_uri_requires_https_outside_local_environments() -> None:
    with pytest.raises(ValidationError, match="HTTPS Google redirect URI"):
        google_settings(
            env="production",
            email_verification_url="https://app.example.com/verify-email",
            password_reset_url="https://app.example.com/reset-password",
            google_redirect_uri="http://api.example.com/api/v1/auth/google/callback",
        )


def test_google_authorization_endpoint_returns_no_store_redirect() -> None:
    settings = google_settings()
    store = MemoryOAuthStateStore()
    limiter = OtpRequestRateLimiter(MemoryFixedWindowRateLimiter(), settings)
    app = create_app(
        settings,
        google_oauth_state_store=store,
        otp_rate_limiter=limiter,
        configure_logs=False,
    )

    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(app),
            base_url="https://testserver",
            follow_redirects=False,
        ) as client:
            response = await client.get("/api/v1/auth/google/authorize")
            assert response.status_code == 302
            assert response.headers["cache-control"] == "no-store"
            query = parse_qs(urlparse(response.headers["location"]).query)
            assert store.consume(query["state"][0]) == query["nonce"][0]

    asyncio.run(exercise())
