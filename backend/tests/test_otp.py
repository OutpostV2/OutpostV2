import hmac
import logging
import secrets
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import SecretStr, ValidationError

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError
from app.modules.auth import otp
from app.modules.auth.models import OtpPurpose

DATABASE_URL = "postgresql+psycopg://outpost:local-password@127.0.0.1:5433/outpost"
OTP_HMAC_KEY = "k" * 32


def otp_settings(key: str | None = OTP_HMAC_KEY) -> Settings:
    return Settings(
        database_url=DATABASE_URL,
        otp_hmac_key=None if key is None else SecretStr(key),
        _env_file=None,
    )


def test_generate_otp_draws_from_complete_six_digit_space(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upper_bounds: list[int] = []

    def draw_lowest(upper_bound: int) -> int:
        upper_bounds.append(upper_bound)
        return 0

    monkeypatch.setattr(secrets, "randbelow", draw_lowest)

    assert otp.generate_otp() == "000000"
    assert upper_bounds == [1_000_000]


def test_generate_otp_includes_highest_six_digit_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(secrets, "randbelow", lambda upper_bound: upper_bound - 1)

    assert otp.generate_otp() == "999999"


def test_generate_otp_emits_no_code_output(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(secrets, "randbelow", lambda _: 123456)

    with caplog.at_level(logging.DEBUG):
        assert otp.generate_otp() == "123456"

    assert caplog.records == []
    assert capsys.readouterr() == ("", "")


def test_create_otp_digest_uses_versioned_context_bound_hmac_without_output(
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    with caplog.at_level(logging.DEBUG):
        digest = otp.create_otp_digest(
            otp_settings(),
            phone_e164="+14155552671",
            purpose=OtpPurpose.LOGIN,
            code="001234",
        )

    assert digest == (
        "hmac-sha256:v1:b0543ebb7337b9e90f4568dcf8c2a289a2324b4b0555aa5f00a644de4dae1f72"
    )
    assert "001234" not in digest
    assert OTP_HMAC_KEY not in digest
    assert caplog.records == []
    assert capsys.readouterr() == ("", "")


@pytest.mark.parametrize(
    ("phone_e164", "purpose", "code"),
    (
        ("+14155552672", OtpPurpose.LOGIN, "001234"),
        ("+14155552671", OtpPurpose.LINK_PHONE, "001234"),
        ("+14155552671", OtpPurpose.LOGIN, "001235"),
    ),
)
def test_otp_digest_cannot_be_reused_in_another_challenge_context(
    phone_e164: str,
    purpose: OtpPurpose,
    code: str,
) -> None:
    settings = otp_settings()
    stored_digest = otp.create_otp_digest(
        settings,
        phone_e164="+14155552671",
        purpose=OtpPurpose.LOGIN,
        code="001234",
    )

    assert not otp.verify_otp_digest(
        settings,
        phone_e164=phone_e164,
        purpose=purpose,
        code=code,
        stored_digest=stored_digest,
    )


def test_verify_otp_digest_uses_constant_time_comparison(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = otp_settings()
    stored_digest = otp.create_otp_digest(
        settings,
        phone_e164="+14155552671",
        purpose=OtpPurpose.LOGIN,
        code="001234",
    )
    compared: list[tuple[str, str]] = []
    original_compare_digest = hmac.compare_digest

    def tracked_compare_digest(candidate: str, stored: str) -> bool:
        compared.append((candidate, stored))
        return original_compare_digest(candidate, stored)

    monkeypatch.setattr(hmac, "compare_digest", tracked_compare_digest)

    assert otp.verify_otp_digest(
        settings,
        phone_e164="+14155552671",
        purpose=OtpPurpose.LOGIN,
        code="001234",
        stored_digest=stored_digest,
    )
    assert compared == [(stored_digest, stored_digest)]


def test_verify_otp_digest_rejects_malformed_stored_value() -> None:
    assert not otp.verify_otp_digest(
        otp_settings(),
        phone_e164="+14155552671",
        purpose=OtpPurpose.LOGIN,
        code="001234",
        stored_digest="not-a-versioned-digest",
    )


@pytest.mark.parametrize(
    ("phone_e164", "code"),
    (
        ("14155552671", "001234"),
        ("+0123456789", "001234"),
        ("+1234567890123456", "001234"),
        ("+14155552671", "12345"),
        ("+14155552671", "1234567"),
        ("+14155552671", "12A456"),
    ),
)
def test_create_otp_digest_rejects_invalid_challenge_context(
    phone_e164: str,
    code: str,
) -> None:
    with pytest.raises(ValueError, match="Invalid OTP challenge context"):
        otp.create_otp_digest(
            otp_settings(),
            phone_e164=phone_e164,
            purpose=OtpPurpose.LOGIN,
            code=code,
        )


def test_otp_digest_fails_closed_without_a_configured_secret() -> None:
    with pytest.raises(ServiceUnavailableError, match="Authentication is not configured"):
        otp.create_otp_digest(
            otp_settings(None),
            phone_e164="+14155552671",
            purpose=OtpPurpose.LOGIN,
            code="001234",
        )


def test_short_otp_hmac_key_is_rejected() -> None:
    with pytest.raises(ValidationError, match="OTP HMAC key requires at least 32 bytes"):
        otp_settings("too-short")


def test_otp_challenge_expiration_is_exactly_five_minutes() -> None:
    created_at = datetime(2026, 9, 20, 12, 0, tzinfo=UTC)

    assert timedelta(minutes=5) == otp.OTP_CHALLENGE_LIFETIME
    assert otp.otp_challenge_expires_at(created_at) == datetime(2026, 9, 20, 12, 5, tzinfo=UTC)


@pytest.mark.parametrize(
    ("offset", "expected"),
    (
        (timedelta(microseconds=-1), False),
        (timedelta(0), True),
        (timedelta(microseconds=1), True),
    ),
)
def test_otp_challenge_expiration_boundary(
    offset: timedelta,
    expected: bool,
) -> None:
    expires_at = datetime(2026, 9, 20, 12, 5, tzinfo=UTC)

    assert otp.is_otp_challenge_expired(expires_at=expires_at, now=expires_at + offset) is expected


def test_otp_challenge_expiration_requires_timezone_aware_timestamps() -> None:
    aware = datetime(2026, 9, 20, 12, 0, tzinfo=UTC)
    naive = datetime(2026, 9, 20, 12, 0)

    with pytest.raises(ValueError, match="OTP challenge timestamps must be timezone-aware"):
        otp.otp_challenge_expires_at(naive)
    with pytest.raises(ValueError, match="OTP challenge timestamps must be timezone-aware"):
        otp.is_otp_challenge_expired(expires_at=naive, now=aware)
    with pytest.raises(ValueError, match="OTP challenge timestamps must be timezone-aware"):
        otp.is_otp_challenge_expired(expires_at=aware, now=naive)
