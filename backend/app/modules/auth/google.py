"""Google OpenID Connect authorization and verified callback handling."""

from __future__ import annotations

import json
import secrets
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol, cast, runtime_checkable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import jwt
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from jwt.algorithms import RSAAlgorithm
from pydantic import EmailStr, TypeAdapter, ValidationError

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError, UnauthorizedError

GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_DISCOVERY_ENDPOINT = "https://accounts.google.com/.well-known/openid-configuration"
GOOGLE_ISSUERS = frozenset({"accounts.google.com", "https://accounts.google.com"})
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs"
OAUTH_CORRELATION_TTL_SECONDS = 10 * 60
_HTTP_TIMEOUT_SECONDS = 10.0
_MAX_STATE_GENERATION_ATTEMPTS = 3
_EMAIL_ADAPTER = TypeAdapter(EmailStr)
_INVALID_RESPONSE = "Invalid Google authentication response"


@runtime_checkable
class OAuthStateStore(Protocol):
    """Short-lived, atomic state-to-nonce correlation boundary."""

    def put(self, state: str, nonce: str, *, ttl_seconds: int) -> bool:
        """Store a correlation only if its state does not already exist."""

    def consume(self, state: str) -> str | None:
        """Atomically remove a state and return its nonce once."""

    def close(self) -> None:
        """Release backend resources."""


class JsonHttpClient(Protocol):
    """Small HTTP boundary used by the Google provider adapter."""

    def get_json(self, url: str) -> dict[str, object]: ...

    def post_form(self, url: str, data: Mapping[str, str]) -> dict[str, object]: ...


class GoogleOidcProvider(Protocol):
    """Provider-neutral boundary for exchanging and validating an OAuth code."""

    def exchange_code(self, code: str, *, nonce: str, settings: Settings) -> GooglePrincipal: ...


@dataclass(frozen=True, slots=True)
class GooglePrincipal:
    """Claims accepted only after signature and protocol validation."""

    subject: str
    email: str
    name: str | None


class MemoryOAuthStateStore:
    """Thread-safe state store for tests and explicit local use."""

    def __init__(self, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._values: dict[str, tuple[str, float]] = {}
        self._lock = threading.Lock()

    def put(self, state: str, nonce: str, *, ttl_seconds: int) -> bool:
        if ttl_seconds <= 0:
            raise ValueError("OAuth state TTL must be positive")
        now = self._clock()
        with self._lock:
            current = self._values.get(state)
            if current is not None and current[1] > now:
                return False
            self._values[state] = (nonce, now + ttl_seconds)
            return True

    def consume(self, state: str) -> str | None:
        now = self._clock()
        with self._lock:
            current = self._values.pop(state, None)
        if current is None or current[1] <= now:
            return None
        return current[0]

    def close(self) -> None:
        with self._lock:
            self._values.clear()


class UrlLibJsonHttpClient:
    """Bounded JSON HTTPS client for OIDC discovery, token exchange, and JWKS."""

    def get_json(self, url: str) -> dict[str, object]:
        return self._request(Request(url, headers={"Accept": "application/json"}))

    def post_form(self, url: str, data: Mapping[str, str]) -> dict[str, object]:
        request = Request(
            url,
            data=urlencode(data).encode(),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            method="POST",
        )
        return self._request(request)

    @staticmethod
    def _request(request: Request) -> dict[str, object]:
        try:
            with urlopen(request, timeout=_HTTP_TIMEOUT_SECONDS) as response:  # noqa: S310
                payload = json.load(response)
        except (HTTPError, URLError, OSError, TimeoutError, json.JSONDecodeError) as error:
            raise ServiceUnavailableError("Google authentication is unavailable") from error
        if not isinstance(payload, dict):
            raise ServiceUnavailableError("Google authentication is unavailable")
        return cast(dict[str, object], payload)


class GoogleHttpOidcProvider:
    """Exchange a Google authorization code and validate its signed ID token."""

    def __init__(self, http: JsonHttpClient | None = None) -> None:
        self._http = http or UrlLibJsonHttpClient()

    def exchange_code(self, code: str, *, nonce: str, settings: Settings) -> GooglePrincipal:
        if (
            settings.google_client_id is None
            or settings.google_client_secret is None
            or settings.google_redirect_uri is None
        ):
            raise ServiceUnavailableError("Google authentication is not configured")

        try:
            discovery = self._http.get_json(GOOGLE_DISCOVERY_ENDPOINT)
            self._validate_discovery(discovery)
            token_response = self._http.post_form(
                GOOGLE_TOKEN_ENDPOINT,
                {
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret.get_secret_value(),
                    "redirect_uri": str(settings.google_redirect_uri),
                },
            )
            id_token = token_response.get("id_token")
            if not isinstance(id_token, str) or not id_token:
                raise ValueError("missing ID token")
            jwks = self._http.get_json(GOOGLE_JWKS_ENDPOINT)
            return self._validate_id_token(id_token, jwks, nonce, settings.google_client_id)
        except ServiceUnavailableError:
            raise
        except (KeyError, TypeError, ValueError, ValidationError, jwt.PyJWTError) as error:
            raise UnauthorizedError(_INVALID_RESPONSE) from error

    @staticmethod
    def _validate_discovery(discovery: Mapping[str, object]) -> None:
        if (
            discovery.get("issuer") != "https://accounts.google.com"
            or discovery.get("token_endpoint") != GOOGLE_TOKEN_ENDPOINT
            or discovery.get("jwks_uri") != GOOGLE_JWKS_ENDPOINT
        ):
            raise ValueError("unexpected Google discovery metadata")

    @staticmethod
    def _validate_id_token(
        id_token: str,
        jwks: Mapping[str, object],
        expected_nonce: str,
        client_id: str,
    ) -> GooglePrincipal:
        header = jwt.get_unverified_header(id_token)
        if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str):
            raise ValueError("unsupported ID token header")
        keys = jwks.get("keys")
        if not isinstance(keys, list):
            raise ValueError("invalid JWKS")
        matching = [
            key for key in keys if isinstance(key, dict) and key.get("kid") == header["kid"]
        ]
        if len(matching) != 1:
            raise ValueError("signing key not found")
        public_key = cast(RSAPublicKey, RSAAlgorithm.from_jwk(matching[0]))
        claims = jwt.decode(
            id_token,
            public_key,
            algorithms=["RS256"],
            audience=client_id,
            issuer=list(GOOGLE_ISSUERS),
            options={"require": ["iss", "aud", "exp", "iat", "sub", "nonce", "email"]},
        )
        nonce = claims.get("nonce")
        if not isinstance(nonce, str) or not secrets.compare_digest(nonce, expected_nonce):
            raise ValueError("nonce mismatch")
        audience = claims.get("aud")
        authorized_party = claims.get("azp")
        if authorized_party is not None and authorized_party != client_id:
            raise ValueError("authorized party mismatch")
        if isinstance(audience, list) and len(audience) > 1 and authorized_party != client_id:
            raise ValueError("authorized party required")
        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject or len(subject) > 255:
            raise ValueError("invalid subject")
        if claims.get("email_verified") is not True:
            raise ValueError("email is not verified")
        email_value = claims.get("email")
        if not isinstance(email_value, str):
            raise ValueError("invalid email")
        email = str(_EMAIL_ADAPTER.validate_python(email_value)).lower()
        name_value = claims.get("name")
        name = (
            name_value.strip()[:255] if isinstance(name_value, str) and name_value.strip() else None
        )
        return GooglePrincipal(subject=subject, email=email, name=name)


def begin_google_authorization(settings: Settings, store: OAuthStateStore) -> str:
    """Persist one state/nonce pair and return Google's authorization URL."""
    if settings.google_client_id is None or settings.google_redirect_uri is None:
        raise ServiceUnavailableError("Google authentication is not configured")

    for _ in range(_MAX_STATE_GENERATION_ATTEMPTS):
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        if store.put(state, nonce, ttl_seconds=OAUTH_CORRELATION_TTL_SECONDS):
            break
    else:
        raise ServiceUnavailableError("Google authentication is unavailable")

    query = urlencode(
        {
            "client_id": settings.google_client_id,
            "redirect_uri": str(settings.google_redirect_uri),
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
        }
    )
    return f"{GOOGLE_AUTHORIZATION_ENDPOINT}?{query}"


def complete_google_callback(
    settings: Settings,
    store: OAuthStateStore,
    provider: GoogleOidcProvider,
    *,
    state: str,
    code: str,
    issuer: str,
) -> GooglePrincipal:
    """Consume callback correlation and return only a verified Google principal."""
    nonce = store.consume(state)
    if nonce is None or issuer not in GOOGLE_ISSUERS or not code:
        raise UnauthorizedError(_INVALID_RESPONSE)
    return provider.exchange_code(code, nonce=nonce, settings=settings)
