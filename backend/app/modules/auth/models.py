"""Authentication persistence models."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, func
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
