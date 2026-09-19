"""Secure email-verification issuance and confirmation."""

import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta
from html import escape
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import BadRequestError
from app.modules.auth.email import EmailDeliveryError, EmailMessage, EmailProvider
from app.modules.auth.models import EmailVerificationToken, SecurityEvent
from app.modules.users.models import User, UserStatus

VERIFICATION_TTL = timedelta(hours=24)
INVALID_VERIFICATION_MESSAGE = "Invalid or expired email verification token"
_logger = logging.getLogger("outpost.auth.email_verification")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _verification_link(settings: Settings, token: str) -> str:
    parts = urlsplit(str(settings.email_verification_url))
    query = urlencode([*parse_qsl(parts.query, keep_blank_values=True), ("token", token)])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def request_email_verification(
    session: Session,
    settings: Settings,
    provider: EmailProvider,
    email: str,
) -> None:
    """Replace outstanding tokens and send a verification link for an eligible user."""
    raw_token: str | None = None
    with session.begin():
        user = session.scalars(
            select(User).where(func.lower(User.primary_email) == email).with_for_update()
        ).one_or_none()
        if (
            user is None
            or user.status is not UserStatus.ACTIVE
            or user.email_verified_at is not None
            or user.primary_email is None
        ):
            return
        now = datetime.now(UTC)
        session.execute(
            update(EmailVerificationToken)
            .where(
                EmailVerificationToken.user_id == user.id,
                EmailVerificationToken.consumed_at.is_(None),
            )
            .values(consumed_at=now)
        )
        raw_token = secrets.token_urlsafe(32)
        session.add(
            EmailVerificationToken(
                user_id=user.id,
                email=user.primary_email,
                token_hash=_token_hash(raw_token),
                created_at=now,
                expires_at=now + VERIFICATION_TTL,
            )
        )

    if raw_token is None:
        return
    link = _verification_link(settings, raw_token)
    try:
        provider.send(
            EmailMessage(
                to=email,
                subject="Verify your Outpost email",
                text_body=(
                    "Verify your Outpost email by opening this link:\n"
                    f"{link}\n\n"
                    "This link expires in 24 hours and can be used once."
                ),
                html_body=(
                    "<p>Verify your Outpost email by opening this link:</p>"
                    f'<p><a href="{escape(link, quote=True)}">Verify email</a></p>'
                    "<p>This link expires in 24 hours and can be used once.</p>"
                ),
            )
        )
    except EmailDeliveryError:
        # Keep the public response indistinguishable and avoid logging addresses or tokens.
        _logger.error("email_verification.delivery_failed")


def confirm_email_verification(session: Session, raw_token: str) -> None:
    """Consume one valid token and verify its matching email atomically."""
    token_hash = _token_hash(raw_token)
    with session.begin():
        user_id = session.scalar(
            select(EmailVerificationToken.user_id).where(
                EmailVerificationToken.token_hash == token_hash
            )
        )
        if user_id is None:
            raise BadRequestError(INVALID_VERIFICATION_MESSAGE)
        user = session.scalars(select(User).where(User.id == user_id).with_for_update()).one()
        stored = session.scalars(
            select(EmailVerificationToken)
            .where(EmailVerificationToken.token_hash == token_hash)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).one()
        now = datetime.now(UTC)
        if (
            stored.consumed_at is not None
            or stored.expires_at <= now
            or user.status is not UserStatus.ACTIVE
            or user.email_verified_at is not None
            or user.primary_email != stored.email
        ):
            raise BadRequestError(INVALID_VERIFICATION_MESSAGE)
        stored.consumed_at = now
        user.email_verified_at = now
        session.add(
            SecurityEvent(
                user_id=user.id,
                event_type="authentication.email_verified",
                event_data={"method": "email_link"},
            )
        )
