"""Authentication persistence models."""

from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PasswordCredential(Base):
    """A user's password verifier; raw passwords are never persisted."""

    __tablename__ = "password_credentials"

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", name="fk_password_credentials_user_id_users", ondelete="CASCADE"),
        primary_key=True,
    )
    password_hash: Mapped[str] = mapped_column(String(512))
    password_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PhoneIdentity(Base):
    """A normalized, uniquely linked phone authentication identity."""

    __tablename__ = "phone_identities"
    __table_args__ = (UniqueConstraint("phone_e164", name="uq_phone_identities_phone_e164"),)

    id: Mapped[UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", name="fk_phone_identities_user_id_users", ondelete="CASCADE"),
        index=True,
    )
    phone_e164: Mapped[str] = mapped_column(String(32))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OAuthIdentity(Base):
    """An external identity keyed by provider and stable provider subject."""

    __tablename__ = "oauth_identities"
    __table_args__ = (
        UniqueConstraint(
            "provider", "provider_subject", name="uq_oauth_identities_provider_subject"
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", name="fk_oauth_identities_user_id_users", ondelete="CASCADE"),
        index=True,
    )
    provider: Mapped[str] = mapped_column(String(64))
    provider_subject: Mapped[str] = mapped_column(String(255))
    provider_email: Mapped[str | None] = mapped_column(String(320))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuthSession(Base):
    """A revocable rotating-refresh session."""

    __tablename__ = "auth_sessions"
    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="ck_auth_sessions_expiry_after_creation"),
        UniqueConstraint("refresh_token_hash", name="uq_auth_sessions_refresh_token_hash"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", name="fk_auth_sessions_user_id_users", ondelete="CASCADE"),
        index=True,
    )
    token_family_id: Mapped[UUID] = mapped_column(Uuid, default=uuid4, index=True)
    refresh_token_hash: Mapped[str] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(512))
    ip_address: Mapped[str | None] = mapped_column(INET)


class OtpPurpose(StrEnum):
    """Supported phone challenge purposes."""

    LOGIN = "login"
    LINK_PHONE = "link_phone"


class OtpChallenge(Base):
    """A short-lived phone challenge protected by a server-held HMAC."""

    __tablename__ = "otp_challenges"
    __table_args__ = (
        CheckConstraint(
            "attempt_count >= 0 AND attempt_count <= 5",
            name="ck_otp_challenges_attempt_count",
        ),
        CheckConstraint("expires_at > created_at", name="ck_otp_challenges_expiry"),
        CheckConstraint(
            "resend_available_at >= created_at", name="ck_otp_challenges_resend_cooldown"
        ),
        Index("ix_otp_challenges_phone_purpose", "phone_e164", "purpose"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    phone_e164: Mapped[str] = mapped_column(String(32))
    purpose: Mapped[OtpPurpose] = mapped_column(
        Enum(
            OtpPurpose,
            name="otp_purpose",
            values_callable=lambda enum_type: [member.value for member in enum_type],
        )
    )
    otp_digest: Mapped[str] = mapped_column(String(128))
    attempt_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    resend_available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
