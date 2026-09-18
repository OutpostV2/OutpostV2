"""Initial authenticated sessions; refresh rotation belongs to Phase 7."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import UnauthorizedError
from app.modules.auth.models import AuthSession, SecurityEvent
from app.modules.auth.schemas import LoginInput
from app.modules.auth.service import authenticate_password
from app.modules.auth.tokens import decode_access_token, issue_access_token, signing_key
from app.modules.users.models import User, UserStatus

REFRESH_SECONDS = 30 * 24 * 60 * 60
REFRESH_COOKIE = "outpost_refresh"
COOKIE_PATH = "/api/v1/auth"


def password_login(
    session: Session,
    settings: Settings,
    data: LoginInput,
    *,
    user_agent: str | None,
    ip_address: str | None,
) -> tuple[str, str]:
    """Commit credential verification and the initial session before returning secrets."""
    signing_key(settings)
    with session.begin():
        user = authenticate_password(session, data.identifier, data.password.get_secret_value())
        now = datetime.now(UTC)
        refresh = secrets.token_urlsafe(32)
        auth_session = AuthSession(
            id=uuid4(),
            user_id=user.id,
            token_family_id=uuid4(),
            refresh_token_hash=hashlib.sha256(refresh.encode()).hexdigest(),
            created_at=now,
            last_used_at=now,
            expires_at=now + timedelta(seconds=REFRESH_SECONDS),
            user_agent=user_agent,
            ip_address=ip_address,
        )
        session.add(auth_session)
        session.flush()
        session.add(
            SecurityEvent(
                user_id=user.id,
                session_id=auth_session.id,
                event_type="authentication.succeeded",
                event_data={"method": "password"},
            )
        )
        access = issue_access_token(settings, user.id, auth_session.id)
    return access, refresh


def authenticated_session(
    session: Session,
    settings: Settings,
    access_token: str,
) -> tuple[User, AuthSession]:
    user_id, session_id = decode_access_token(settings, access_token)
    auth_session = session.get(AuthSession, session_id)
    user = session.get(User, user_id)
    if (
        auth_session is None
        or user is None
        or auth_session.user_id != user_id
        or auth_session.revoked_at is not None
        or auth_session.expires_at <= datetime.now(UTC)
        or user.status != UserStatus.ACTIVE
    ):
        raise UnauthorizedError("Invalid or expired access credential")
    return user, auth_session
