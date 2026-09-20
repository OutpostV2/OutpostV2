"""Provider-neutral OTP request rate-limit policy."""

import hashlib
import hmac
import threading
import time
from collections.abc import Callable
from typing import Protocol, runtime_checkable

from app.core.config import Settings
from app.core.errors import RateLimitExceededError, ServiceUnavailableError

OTP_PHONE_REQUEST_LIMIT = 5
OTP_IP_REQUEST_LIMIT = 20
OTP_RATE_LIMIT_WINDOW_SECONDS = 15 * 60


@runtime_checkable
class FixedWindowRateLimiter(Protocol):
    """Atomic counter boundary for distributed or local rate limiting."""

    def increment(self, key: str, *, window_seconds: int) -> int:
        """Increment a window counter and return its new value."""

    def close(self) -> None:
        """Release backend resources."""


class MemoryFixedWindowRateLimiter:
    """Thread-safe fixed-window limiter for tests and explicit local use."""

    def __init__(self, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._windows: dict[str, tuple[float, int]] = {}
        self._lock = threading.Lock()

    def increment(self, key: str, *, window_seconds: int) -> int:
        now = self._clock()
        with self._lock:
            started_at, count = self._windows.get(key, (now, 0))
            if now - started_at >= window_seconds:
                started_at, count = now, 0
            count += 1
            self._windows[key] = (started_at, count)
            return count

    def close(self) -> None:
        self._windows.clear()


class OtpRequestRateLimiter:
    """Apply phone and client-IP limits without exposing raw identifiers."""

    def __init__(self, backend: FixedWindowRateLimiter, settings: Settings) -> None:
        self._backend = backend
        self._settings = settings

    def check(self, *, phone_e164: str, ip_address: str) -> None:
        phone_count = self._backend.increment(
            self._key("phone", phone_e164),
            window_seconds=OTP_RATE_LIMIT_WINDOW_SECONDS,
        )
        ip_count = self._backend.increment(
            self._key("ip", ip_address),
            window_seconds=OTP_RATE_LIMIT_WINDOW_SECONDS,
        )
        if phone_count > OTP_PHONE_REQUEST_LIMIT or ip_count > OTP_IP_REQUEST_LIMIT:
            raise RateLimitExceededError("Too many OTP requests")

    def close(self) -> None:
        self._backend.close()

    def _key(self, scope: str, identifier: str) -> str:
        secret = self._settings.otp_hmac_key
        if secret is None:
            raise ServiceUnavailableError("Authentication is not configured")
        digest = hmac.new(
            secret.get_secret_value().encode("utf-8"),
            b"outpost:otp-request:v1\x00" + scope.encode("ascii") + b"\x00" + identifier.encode(),
            hashlib.sha256,
        ).hexdigest()
        return f"outpost:otp-request:v1:{scope}:{digest}"
