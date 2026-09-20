"""Cryptographically secure phone one-time password generation and verification."""

import hashlib
import hmac
import re
import secrets

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError
from app.modules.auth.models import OtpPurpose

OTP_DIGEST_PREFIX = "hmac-sha256:v1:"
_PHONE_PATTERN = re.compile(r"^\+[1-9][0-9]{1,14}$")
_CODE_PATTERN = re.compile(r"^[0-9]{6}$")


def generate_otp() -> str:
    """Return a uniformly generated six-digit decimal code."""
    return f"{secrets.randbelow(1_000_000):06d}"


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
