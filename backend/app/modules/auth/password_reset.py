"""Nondisclosing password-reset token issuance."""

import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta
from html import escape
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.modules.auth.email import EmailDeliveryError, EmailMessage, EmailProvider
from app.modules.auth.models import PasswordCredential, PasswordResetToken
from app.modules.users.models import User, UserStatus

PASSWORD_RESET_TTL = timedelta(hours=1)
_logger = logging.getLogger("outpost.auth.password_reset")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _password_reset_link(settings: Settings, token: str) -> str:
    parts = urlsplit(str(settings.password_reset_url))
    query = urlencode([*parse_qsl(parts.query, keep_blank_values=True), ("token", token)])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def request_password_reset(
    session: Session,
    settings: Settings,
    provider: EmailProvider,
    email: str,
) -> None:
    """Replace outstanding tokens and email a reset link for an eligible account."""
    raw_token: str | None = None
    recipient: str | None = None
    with session.begin():
        user = session.scalars(
            select(User).where(func.lower(User.primary_email) == email).with_for_update()
        ).one_or_none()
        if (
            user is None
            or user.status is not UserStatus.ACTIVE
            or user.primary_email is None
            or session.get(PasswordCredential, user.id) is None
        ):
            return
        now = datetime.now(UTC)
        session.execute(
            update(PasswordResetToken)
            .where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.consumed_at.is_(None),
            )
            .values(consumed_at=now)
        )
        raw_token = secrets.token_urlsafe(32)
        recipient = user.primary_email
        session.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=_token_hash(raw_token),
                created_at=now,
                expires_at=now + PASSWORD_RESET_TTL,
            )
        )

    if raw_token is None or recipient is None:
        return
    link = _password_reset_link(settings, raw_token)
    try:
        provider.send(
            EmailMessage(
                to=recipient,
                subject="Reset your Outpost password",
                text_body=(
                    "Reset your Outpost password by opening this link:\n"
                    f"{link}\n\n"
                    "This link expires in 1 hour and can be used once."
                ),
                html_body=(
                    "<p>Reset your Outpost password by opening this link:</p>"
                    f'<p><a href="{escape(link, quote=True)}">Reset password</a></p>'
                    "<p>This link expires in 1 hour and can be used once.</p>"
                ),
            )
        )
    except EmailDeliveryError:
        _logger.error("password_reset.delivery_failed")
