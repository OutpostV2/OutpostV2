"""Phone normalization and verified identity resolution."""

from datetime import datetime

import phonenumbers
from phonenumbers import NumberParseException, PhoneNumberFormat
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.errors import UnauthorizedError
from app.modules.auth.models import PhoneIdentity
from app.modules.users.models import User, UserStatus


def normalize_phone(value: str) -> str:
    """Return a valid international phone number in canonical E.164 format."""
    try:
        parsed = phonenumbers.parse(value.strip(), None)
    except NumberParseException as error:
        raise ValueError("Phone number must be a valid international phone number") from error
    if not phonenumbers.is_valid_number(parsed):
        raise ValueError("Phone number must be a valid international phone number")
    return phonenumbers.format_number(parsed, PhoneNumberFormat.E164)


def resolve_or_create_phone_user(
    session: Session,
    phone_e164: str,
    verified_at: datetime,
) -> User:
    """Resolve or create one active user after verified control of a phone."""
    if verified_at.tzinfo is None or verified_at.utcoffset() is None:
        raise ValueError("Phone verification timestamp must be timezone-aware")
    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:phone_e164, 0))"),
        {"phone_e164": phone_e164},
    )
    identity = session.scalars(
        select(PhoneIdentity).where(PhoneIdentity.phone_e164 == phone_e164).with_for_update()
    ).one_or_none()
    if identity is not None:
        user = session.scalars(
            select(User).where(User.id == identity.user_id).with_for_update()
        ).one()
        if user.status is not UserStatus.ACTIVE:
            raise UnauthorizedError("Invalid or expired OTP")
        if identity.verified_at is None:
            identity.verified_at = verified_at
        return user

    user = User(display_name="Outpost member")
    session.add(user)
    session.flush()
    session.add(
        PhoneIdentity(
            user_id=user.id,
            phone_e164=phone_e164,
            verified_at=verified_at,
        )
    )
    session.flush()
    return user
