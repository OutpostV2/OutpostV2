from collections.abc import Callable

import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.core.errors import RateLimitExceededError, ServiceUnavailableError
from app.main import create_app
from app.modules.auth.rate_limits import (
    OTP_IP_REQUEST_LIMIT,
    OTP_PHONE_REQUEST_LIMIT,
    OTP_RATE_LIMIT_WINDOW_SECONDS,
    MemoryFixedWindowRateLimiter,
    OtpRequestRateLimiter,
)

DATABASE_URL = "postgresql+psycopg://outpost:local-password@127.0.0.1:5433/outpost"


def settings(key: str | None = "k" * 32) -> Settings:
    return Settings(
        database_url=DATABASE_URL,
        otp_hmac_key=None if key is None else SecretStr(key),
        _env_file=None,
    )


def test_memory_fixed_window_limiter_counts_and_resets() -> None:
    now = [100.0]
    limiter = MemoryFixedWindowRateLimiter(clock=lambda: now[0])

    assert limiter.increment("key", window_seconds=60) == 1
    assert limiter.increment("key", window_seconds=60) == 2
    now[0] = 159.999
    assert limiter.increment("key", window_seconds=60) == 3
    now[0] = 160.0
    assert limiter.increment("key", window_seconds=60) == 1


class RecordingLimiter:
    def __init__(self, result: Callable[[str], int] | None = None) -> None:
        self.calls: list[tuple[str, int]] = []
        self.result = result or (lambda _: 1)

    def increment(self, key: str, *, window_seconds: int) -> int:
        self.calls.append((key, window_seconds))
        return self.result(key)

    def close(self) -> None:
        pass


def test_otp_request_limiter_hashes_phone_and_ip_identifiers() -> None:
    backend = RecordingLimiter()
    limiter = OtpRequestRateLimiter(backend, settings())

    limiter.check(phone_e164="+14155552671", ip_address="203.0.113.9")

    assert len(backend.calls) == 2
    keys = [key for key, _ in backend.calls]
    assert keys[0] != keys[1]
    assert all(window == OTP_RATE_LIMIT_WINDOW_SECONDS for _, window in backend.calls)
    assert all("+14155552671" not in key and "203.0.113.9" not in key for key in keys)
    assert all(key.startswith("outpost:otp-request:v1:") for key in keys)


def test_otp_request_limiter_enforces_phone_and_ip_limits() -> None:
    phone_backend = RecordingLimiter(
        lambda key: OTP_PHONE_REQUEST_LIMIT + 1 if ":phone:" in key else 1
    )
    with pytest.raises(RateLimitExceededError, match="Too many OTP requests"):
        OtpRequestRateLimiter(phone_backend, settings()).check(
            phone_e164="+14155552671",
            ip_address="203.0.113.9",
        )
    assert len(phone_backend.calls) == 2

    ip_backend = RecordingLimiter(lambda key: OTP_IP_REQUEST_LIMIT + 1 if ":ip:" in key else 1)
    with pytest.raises(RateLimitExceededError, match="Too many OTP requests"):
        OtpRequestRateLimiter(ip_backend, settings()).check(
            phone_e164="+14155552671",
            ip_address="203.0.113.9",
        )
    assert len(ip_backend.calls) == 2


def test_otp_request_limiter_fails_closed_without_hmac_key() -> None:
    with pytest.raises(ServiceUnavailableError, match="Authentication is not configured"):
        OtpRequestRateLimiter(RecordingLimiter(), settings(None)).check(
            phone_e164="+14155552671",
            ip_address="203.0.113.9",
        )


def test_application_accepts_explicit_otp_rate_limiter() -> None:
    backend = RecordingLimiter()
    limiter = OtpRequestRateLimiter(backend, settings())
    app = create_app(settings(), otp_rate_limiter=limiter, configure_logs=False)

    assert app.state.otp_rate_limiter is limiter
