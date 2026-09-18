"""Initial authenticated sessions; refresh rotation belongs to Phase 7."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select, update
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


def _refresh_hash(refresh: str) -> str:
    return hashlib.sha256(refresh.encode()).hexdigest()


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
            refresh_token_hash=_refresh_hash(refresh),
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


def rotate_refresh_session(
    session: Session,
    settings: Settings,
    refresh: str,
    *,
    user_agent: str | None,
    ip_address: str | None,
) -> tuple[str, str]:
    """Consume one refresh token and preserve its row as replay evidence."""
    signing_key(settings)
    replay_detected = False
    result: tuple[str, str] | None = None
    with session.begin():
        refresh_hash = _refresh_hash(refresh)
        user_id = session.scalar(
            select(AuthSession.user_id).where(AuthSession.refresh_token_hash == refresh_hash)
        )
        if user_id is None:
            raise UnauthorizedError("Invalid or expired refresh credential")
        user = session.scalars(
            select(User).where(User.id == user_id).with_for_update()
        ).one_or_none()
        if user is None:
            raise UnauthorizedError("Invalid or expired refresh credential")
        current = session.scalars(
            select(AuthSession)
            .where(AuthSession.refresh_token_hash == refresh_hash)
            .with_for_update()
        ).one_or_none()
        now = datetime.now(UTC)
        if current is None:
            raise UnauthorizedError("Invalid or expired refresh credential")
        if current.replaced_by_session_id is not None:
            session.execute(
                update(AuthSession)
                .where(AuthSession.token_family_id == current.token_family_id)
                .values(revoked_at=now)
            )
            session.add(
                SecurityEvent(
                    user_id=current.user_id,
                    session_id=current.id,
                    event_type="authentication.refresh_replay_detected",
                    user_agent=user_agent,
                    ip_address=ip_address,
                    event_data={"token_family_id": str(current.token_family_id)},
                )
            )
            replay_detected = True
        elif current.revoked_at is not None or current.expires_at <= now:
            raise UnauthorizedError("Invalid or expired refresh credential")
        else:
            if user.status != UserStatus.ACTIVE:
                raise UnauthorizedError("Invalid or expired refresh credential")
            next_refresh = secrets.token_urlsafe(32)
            next_session = AuthSession(
                id=uuid4(),
                user_id=current.user_id,
                token_family_id=current.token_family_id,
                refresh_token_hash=_refresh_hash(next_refresh),
                created_at=now,
                last_used_at=now,
                expires_at=now + timedelta(seconds=REFRESH_SECONDS),
                user_agent=user_agent,
                ip_address=ip_address,
            )
            session.add(next_session)
            session.flush()
            current.last_used_at = now
            current.revoked_at = now
            current.replaced_by_session_id = next_session.id
            session.add(
                SecurityEvent(
                    user_id=current.user_id,
                    session_id=next_session.id,
                    event_type="authentication.refresh_rotated",
                    user_agent=user_agent,
                    ip_address=ip_address,
                    event_data={"previous_session_id": str(current.id)},
                )
            )
            result = (
                issue_access_token(settings, current.user_id, next_session.id),
                next_refresh,
            )
    if replay_detected:
        raise UnauthorizedError("Invalid or expired refresh credential")
    if result is None:
        raise RuntimeError("Refresh rotation completed without a result")
    return result


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


def list_active_sessions(session: Session, user_id: UUID) -> list[AuthSession]:
    """Return usable leaf sessions without exposing token-family history."""
    now = datetime.now(UTC)
    return list(
        session.scalars(
            select(AuthSession)
            .where(
                AuthSession.user_id == user_id,
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > now,
                AuthSession.replaced_by_session_id.is_(None),
            )
            .order_by(
                AuthSession.last_used_at.desc(),
                AuthSession.created_at.desc(),
                AuthSession.id.desc(),
            )
        )
    )


def revoke_current_session(session: Session, auth_session: AuthSession) -> None:
    """Revoke only the authenticated session and commit its audit event atomically."""
    auth_session.revoked_at = datetime.now(UTC)
    session.add(
        SecurityEvent(
            user_id=auth_session.user_id,
            session_id=auth_session.id,
            event_type="authentication.logout",
            event_data={},
        )
    )
    session.commit()
