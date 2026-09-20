"""Passwordless phone OTP issuance, verification, and session creation."""

import logging
import re
from datetime import UTC, datetime

from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import UnauthorizedError
from app.modules.auth.models import OtpChallenge, OtpPurpose
from app.modules.auth.otp import (
    OTP_MAX_ATTEMPTS,
    create_otp_digest,
    generate_otp,
    is_otp_challenge_expired,
    is_otp_resend_available,
    next_otp_attempt_count,
    otp_challenge_expires_at,
    otp_resend_available_at,
    verify_otp_digest,
)
from app.modules.auth.phone_identities import resolve_or_create_phone_user
from app.modules.auth.sessions import issue_authenticated_session
from app.modules.auth.sms import SmsDeliveryError, SmsMessage, SmsProvider
from app.modules.auth.tokens import signing_key

INVALID_OTP_MESSAGE = "Invalid or expired OTP"
_CODE_PATTERN = re.compile(r"^[0-9]{6}$")
_logger = logging.getLogger("outpost.auth.phone_otp")


def _lock_phone(session: Session, phone_e164: str) -> None:
    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:phone_e164, 0))"),
        {"phone_e164": phone_e164},
    )


def request_phone_otp(
    session: Session,
    settings: Settings,
    provider: SmsProvider,
    phone_e164: str,
) -> None:
    """Issue at most one login challenge per resend window for a canonical phone."""
    code: str | None = None
    with session.begin():
        _lock_phone(session, phone_e164)
        now = datetime.now(UTC)
        latest = session.scalars(
            select(OtpChallenge)
            .where(
                OtpChallenge.phone_e164 == phone_e164,
                OtpChallenge.purpose == OtpPurpose.LOGIN,
            )
            .order_by(OtpChallenge.created_at.desc(), OtpChallenge.id.desc())
            .limit(1)
            .with_for_update()
        ).one_or_none()
        if latest is not None and not is_otp_resend_available(
            resend_available_at=latest.resend_available_at,
            now=now,
        ):
            return

        session.execute(
            update(OtpChallenge)
            .where(
                OtpChallenge.phone_e164 == phone_e164,
                OtpChallenge.purpose == OtpPurpose.LOGIN,
                OtpChallenge.consumed_at.is_(None),
            )
            .values(consumed_at=now)
        )
        code = generate_otp()
        session.add(
            OtpChallenge(
                phone_e164=phone_e164,
                purpose=OtpPurpose.LOGIN,
                otp_digest=create_otp_digest(
                    settings,
                    phone_e164=phone_e164,
                    purpose=OtpPurpose.LOGIN,
                    code=code,
                ),
                attempt_count=0,
                created_at=now,
                expires_at=otp_challenge_expires_at(now),
                resend_available_at=otp_resend_available_at(now),
            )
        )

    if code is None:
        return
    try:
        provider.send(
            SmsMessage(
                to=phone_e164,
                text_body=f"Your Outpost login code is {code}. It expires in 5 minutes.",
            )
        )
    except SmsDeliveryError:
        # Preserve a generic public response without logging the phone or code.
        _logger.error("phone_otp.delivery_failed")


def verify_phone_otp(
    session: Session,
    settings: Settings,
    *,
    phone_e164: str,
    code: str,
    user_agent: str | None,
    ip_address: str | None,
) -> tuple[str, str]:
    """Consume one valid challenge and issue its user's session atomically."""
    signing_key(settings)
    if _CODE_PATTERN.fullmatch(code) is None:
        raise UnauthorizedError(INVALID_OTP_MESSAGE)

    rejected = False
    result: tuple[str, str] | None = None
    with session.begin():
        _lock_phone(session, phone_e164)
        challenge = session.scalars(
            select(OtpChallenge)
            .where(
                OtpChallenge.phone_e164 == phone_e164,
                OtpChallenge.purpose == OtpPurpose.LOGIN,
            )
            .order_by(OtpChallenge.created_at.desc(), OtpChallenge.id.desc())
            .limit(1)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).one_or_none()
        now = datetime.now(UTC)
        if (
            challenge is None
            or challenge.consumed_at is not None
            or challenge.attempt_count >= OTP_MAX_ATTEMPTS
            or is_otp_challenge_expired(expires_at=challenge.expires_at, now=now)
        ):
            rejected = True
        elif not verify_otp_digest(
            settings,
            phone_e164=phone_e164,
            purpose=OtpPurpose.LOGIN,
            code=code,
            stored_digest=challenge.otp_digest,
        ):
            challenge.attempt_count = next_otp_attempt_count(challenge.attempt_count)
            rejected = True
        else:
            challenge.consumed_at = now
            user = resolve_or_create_phone_user(session, phone_e164, now)
            result = issue_authenticated_session(
                session,
                settings,
                user,
                "phone_otp",
                user_agent=user_agent,
                ip_address=ip_address,
            )

    if rejected or result is None:
        raise UnauthorizedError(INVALID_OTP_MESSAGE)
    return result
