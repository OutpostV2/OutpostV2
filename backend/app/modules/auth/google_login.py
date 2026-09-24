"""Google identity resolution and Outpost session issuance."""

from datetime import UTC, datetime

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import UnauthorizedError
from app.modules.auth.google import (
    GoogleOidcProvider,
    GooglePrincipal,
    OAuthStateStore,
    complete_google_callback,
)
from app.modules.auth.models import OAuthIdentity
from app.modules.auth.sessions import issue_authenticated_session
from app.modules.auth.tokens import signing_key
from app.modules.users.models import User, UserStatus

GOOGLE_PROVIDER = "google"
INVALID_GOOGLE_RESPONSE = "Invalid Google authentication response"


def resolve_or_create_google_user(
    session: Session,
    principal: GooglePrincipal,
    *,
    now: datetime,
) -> User:
    """Resolve only by stable subject, or create one distinct Google-backed user."""
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("Google authentication timestamp must be timezone-aware")
    identity_key = f"{GOOGLE_PROVIDER}:{principal.subject}"
    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:identity_key, 0))"),
        {"identity_key": identity_key},
    )
    identity = session.scalars(
        select(OAuthIdentity)
        .where(
            OAuthIdentity.provider == GOOGLE_PROVIDER,
            OAuthIdentity.provider_subject == principal.subject,
        )
        .with_for_update()
    ).one_or_none()
    if identity is not None:
        user = session.scalars(
            select(User).where(User.id == identity.user_id).with_for_update()
        ).one()
        if user.status is not UserStatus.ACTIVE:
            raise UnauthorizedError(INVALID_GOOGLE_RESPONSE)
        identity.provider_email = principal.email
        return user

    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:email_key, 0))"),
        {"email_key": f"email:{principal.email}"},
    )
    email_owner = session.scalar(
        select(User.id).where(func.lower(User.primary_email) == principal.email)
    )
    can_seed_email = email_owner is None
    user = User(
        display_name=(principal.name or "Outpost member")[:200],
        primary_email=principal.email if can_seed_email else None,
        email_verified_at=now if can_seed_email else None,
    )
    session.add(user)
    session.flush()
    session.add(
        OAuthIdentity(
            user_id=user.id,
            provider=GOOGLE_PROVIDER,
            provider_subject=principal.subject,
            provider_email=principal.email,
        )
    )
    session.flush()
    return user


def google_login(
    session: Session,
    settings: Settings,
    state_store: OAuthStateStore,
    provider: GoogleOidcProvider,
    *,
    state: str,
    code: str,
    issuer: str,
    user_agent: str | None,
    ip_address: str | None,
) -> tuple[str, str]:
    """Verify one Google callback and atomically issue its local session."""
    signing_key(settings)
    principal = complete_google_callback(
        settings,
        state_store,
        provider,
        state=state,
        code=code,
        issuer=issuer,
    )
    with session.begin():
        user = resolve_or_create_google_user(session, principal, now=datetime.now(UTC))
        return issue_authenticated_session(
            session,
            settings,
            user,
            "google_oidc",
            user_agent=user_agent,
            ip_address=ip_address,
        )
