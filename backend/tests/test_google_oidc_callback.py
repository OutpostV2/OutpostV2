from __future__ import annotations

import time
from base64 import urlsafe_b64encode
from collections.abc import Mapping

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core.errors import UnauthorizedError
from app.modules.auth.google import (
    GOOGLE_DISCOVERY_ENDPOINT,
    GoogleHttpOidcProvider,
    MemoryOAuthStateStore,
    complete_google_callback,
)
from tests.test_google_oauth import google_settings


class FakeJsonHttpClient:
    def __init__(self, responses: Mapping[str, dict[str, object]]) -> None:
        self.responses = responses
        self.posts: list[tuple[str, dict[str, str]]] = []
        self.gets: list[str] = []

    def get_json(self, url: str) -> dict[str, object]:
        self.gets.append(url)
        return self.responses[url]

    def post_form(self, url: str, data: Mapping[str, str]) -> dict[str, object]:
        self.posts.append((url, dict(data)))
        return self.responses[url]


def _unsigned_int(value: int) -> str:
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return urlsafe_b64encode(raw).rstrip(b"=").decode()


def _provider(**claim_overrides: object) -> tuple[GoogleHttpOidcProvider, FakeJsonHttpClient]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = private_key.public_key().public_numbers()
    jwk: dict[str, object] = {
        "kty": "RSA",
        "kid": "test-key",
        "use": "sig",
        "alg": "RS256",
        "n": _unsigned_int(public.n),
        "e": _unsigned_int(public.e),
    }
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": "https://accounts.google.com",
        "aud": "test-client.apps.googleusercontent.com",
        "sub": "google-subject-123",
        "email": "person@example.com",
        "email_verified": True,
        "name": "Example Person",
        "nonce": "expected-nonce",
        "iat": now,
        "exp": now + 300,
    }
    claims.update(claim_overrides)
    token = jwt.encode(claims, private_key, algorithm="RS256", headers={"kid": "test-key"})
    discovery: dict[str, object] = {
        "issuer": "https://accounts.google.com",
        "token_endpoint": "https://oauth2.googleapis.com/token",
        "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
    }
    http = FakeJsonHttpClient(
        {
            GOOGLE_DISCOVERY_ENDPOINT: discovery,
            "https://oauth2.googleapis.com/token": {"id_token": token},
            "https://www.googleapis.com/oauth2/v3/certs": {"keys": [jwk]},
        }
    )
    return GoogleHttpOidcProvider(http), http


def test_google_callback_exchanges_code_and_validates_signed_principal() -> None:
    provider, http = _provider()
    settings = google_settings()
    store = MemoryOAuthStateStore()
    assert store.put("expected-state", "expected-nonce", ttl_seconds=600)

    principal = complete_google_callback(
        settings,
        store,
        provider,
        state="expected-state",
        code="authorization-code",
        issuer="https://accounts.google.com",
    )

    assert principal.subject == "google-subject-123"
    assert principal.email == "person@example.com"
    assert principal.name == "Example Person"
    assert http.gets == [GOOGLE_DISCOVERY_ENDPOINT, "https://www.googleapis.com/oauth2/v3/certs"]
    assert http.posts == [
        (
            "https://oauth2.googleapis.com/token",
            {
                "grant_type": "authorization_code",
                "code": "authorization-code",
                "client_id": "test-client.apps.googleusercontent.com",
                "client_secret": "test-only-google-client-secret",
                "redirect_uri": "https://api.example.com/api/v1/auth/google/callback",
            },
        )
    ]
    assert store.consume("expected-state") is None


@pytest.mark.parametrize(
    ("claim", "value"),
    [
        ("iss", "https://evil.example"),
        ("aud", "another-client"),
        ("nonce", "wrong-nonce"),
        ("exp", 1),
        ("email_verified", False),
        ("sub", ""),
        ("email", "not-an-email"),
    ],
)
def test_google_callback_rejects_invalid_provider_claims(claim: str, value: object) -> None:
    provider, _ = _provider(**{claim: value})
    store = MemoryOAuthStateStore()
    assert store.put("state", "expected-nonce", ttl_seconds=600)

    with pytest.raises(UnauthorizedError, match="Invalid Google authentication response"):
        complete_google_callback(
            google_settings(),
            store,
            provider,
            state="state",
            code="code",
            issuer="https://accounts.google.com",
        )
    assert store.consume("state") is None


def test_google_callback_rejects_bad_issuer_and_replayed_state_before_exchange() -> None:
    provider, http = _provider()
    store = MemoryOAuthStateStore()
    assert store.put("state", "expected-nonce", ttl_seconds=600)

    with pytest.raises(UnauthorizedError, match="Invalid Google authentication response"):
        complete_google_callback(
            google_settings(),
            store,
            provider,
            state="state",
            code="code",
            issuer="https://evil.example",
        )
    assert http.posts == []

    with pytest.raises(UnauthorizedError, match="Invalid Google authentication response"):
        complete_google_callback(
            google_settings(),
            store,
            provider,
            state="state",
            code="code",
            issuer="https://accounts.google.com",
        )
    assert http.posts == []
