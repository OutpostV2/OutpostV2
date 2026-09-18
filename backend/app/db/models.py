"""Import registry for every Alembic-managed SQLAlchemy model."""

from app.db.base import Base
from app.modules.auth.models import (
    AuthSession,
    EmailVerificationToken,
    OAuthIdentity,
    OtpChallenge,
    PasswordCredential,
    PasswordResetToken,
    PhoneIdentity,
    SecurityEvent,
)
from app.modules.users.models import User

__all__ = [
    "AuthSession",
    "EmailVerificationToken",
    "Base",
    "OAuthIdentity",
    "OtpChallenge",
    "PasswordResetToken",
    "PasswordCredential",
    "PhoneIdentity",
    "SecurityEvent",
    "User",
]
