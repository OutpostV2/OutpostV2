"""Google OpenID Connect authorization and correlation state."""

import secrets
import threading
import time
from collections.abc import Callable
from typing import Protocol, runtime_checkable
from urllib.parse import urlencode

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError

GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
OAUTH_CORRELATION_TTL_SECONDS = 10 * 60
_MAX_STATE_GENERATION_ATTEMPTS = 3


@runtime_checkable
class OAuthStateStore(Protocol):
    """Short-lived, atomic state-to-nonce correlation boundary."""

    def put(self, state: str, nonce: str, *, ttl_seconds: int) -> bool:
        """Store a correlation only if its state does not already exist."""

    def consume(self, state: str) -> str | None:
        """Atomically remove a state and return its nonce once."""

    def close(self) -> None:
        """Release backend resources."""


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
