"""Create OTP challenges.

Revision ID: 20260918_0007
Revises: 20260918_0006
Create Date: 2026-09-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260918_0007"
down_revision: str | Sequence[str] | None = "20260918_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OTP_PURPOSE_VALUES = ("login", "link_phone")


def upgrade() -> None:
    purpose = postgresql.ENUM(*OTP_PURPOSE_VALUES, name="otp_purpose", create_type=False)
    purpose.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "otp_challenges",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("phone_e164", sa.String(length=32), nullable=False),
        sa.Column("purpose", purpose, nullable=False),
        sa.Column("otp_digest", sa.String(length=128), nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resend_available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "attempt_count >= 0 AND attempt_count <= 5", name="ck_otp_challenges_attempt_count"
        ),
        sa.CheckConstraint("expires_at > created_at", name="ck_otp_challenges_expiry"),
        sa.CheckConstraint(
            "resend_available_at >= created_at", name="ck_otp_challenges_resend_cooldown"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_otp_challenges"),
    )
    op.create_index("ix_otp_challenges_expires_at", "otp_challenges", ["expires_at"])
    op.create_index("ix_otp_challenges_phone_purpose", "otp_challenges", ["phone_e164", "purpose"])


def downgrade() -> None:
    op.drop_index("ix_otp_challenges_phone_purpose", table_name="otp_challenges")
    op.drop_index("ix_otp_challenges_expires_at", table_name="otp_challenges")
    op.drop_table("otp_challenges")
    postgresql.ENUM(*OTP_PURPOSE_VALUES, name="otp_purpose").drop(op.get_bind(), checkfirst=True)
