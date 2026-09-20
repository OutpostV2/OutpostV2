"""Cryptographically secure phone one-time password generation and verification."""

import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError
from app.modules.auth.models import OtpPurpose

OTP_DIGEST_PREFIX = "hmac-sha256:v1:"
OTP_CHALLENGE_LIFETIME = timedelta(minutes=5)
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_COOLDOWN = timedelta(seconds=60)
_PHONE_PATTERN = re.compile(r"^\+[1-9][0-9]{1,14}$")
_CODE_PATTERN = re.compile(r"^[0-9]{6}$")


def generate_otp() -> str:
    """Return a uniformly generated six-digit decimal code."""
    return f"{secrets.randbelow(1_000_000):06d}"


def otp_challenge_expires_at(created_at: datetime) -> datetime:
    """Return the expiration time for a newly created OTP challenge."""
    _require_aware_timestamp(created_at)
    return created_at + OTP_CHALLENGE_LIFETIME


def is_otp_challenge_expired(*, expires_at: datetime, now: datetime) -> bool:
    """Return whether an OTP challenge has reached its expiration boundary."""
    _require_aware_timestamp(expires_at)
    _require_aware_timestamp(now)
    return now >= expires_at


def otp_resend_available_at(created_at: datetime) -> datetime:
    """Return when another code may be sent for an OTP challenge."""
    _require_aware_timestamp(created_at)
    return created_at + OTP_RESEND_COOLDOWN


def is_otp_resend_available(*, resend_available_at: datetime, now: datetime) -> bool:
    """Return whether the resend cooldown has reached its boundary."""
    _require_aware_timestamp(resend_available_at)
    _require_aware_timestamp(now)
    return now >= resend_available_at


def otp_attempts_remaining(attempt_count: int) -> int:
    """Return how many attempts remain for a valid stored attempt count."""
    _require_valid_attempt_count(attempt_count)
    return OTP_MAX_ATTEMPTS - attempt_count


def next_otp_attempt_count(attempt_count: int) -> int:
    """Advance an attempt count without exceeding the challenge limit."""
    if otp_attempts_remaining(attempt_count) == 0:
        raise ValueError("OTP challenge attempt limit reached")
    return attempt_count + 1


def create_otp_digest(
    settings: Settings,
    *,
    phone_e164: str,
    purpose: OtpPurpose,
    code: str,
) -> str:
    """Create a versioned HMAC digest bound to one OTP challenge context."""
    payload = _challenge_payload(phone_e164=phone_e164, purpose=purpose, code=code)
    digest = hmac.new(_otp_hmac_key(settings), payload, hashlib.sha256).hexdigest()
    return f"{OTP_DIGEST_PREFIX}{digest}"


def verify_otp_digest(
    settings: Settings,
    *,
    phone_e164: str,
    purpose: OtpPurpose,
    code: str,
    stored_digest: str,
) -> bool:
    """Verify an OTP digest with a constant-time comparison."""
    expected_digest = create_otp_digest(
        settings,
        phone_e164=phone_e164,
        purpose=purpose,
        code=code,
    )
    return hmac.compare_digest(expected_digest, stored_digest)


def _otp_hmac_key(settings: Settings) -> bytes:
    if settings.otp_hmac_key is None:
        raise ServiceUnavailableError("Authentication is not configured")
    return settings.otp_hmac_key.get_secret_value().encode("utf-8")


def _challenge_payload(*, phone_e164: str, purpose: OtpPurpose, code: str) -> bytes:
    if _PHONE_PATTERN.fullmatch(phone_e164) is None or _CODE_PATTERN.fullmatch(code) is None:
        raise ValueError("Invalid OTP challenge context")
    return b"\x00".join(
        (
            b"outpost:otp:v1",
            phone_e164.encode("ascii"),
            purpose.value.encode("ascii"),
            code.encode("ascii"),
        )
    )


def _require_valid_attempt_count(attempt_count: int) -> None:
    if not 0 <= attempt_count <= OTP_MAX_ATTEMPTS:
        raise ValueError("Invalid OTP challenge attempt count")


def _require_aware_timestamp(value: datetime) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("OTP challenge timestamps must be timezone-aware")
