"""Create phone identities.

Revision ID: 20260918_0004
Revises: 20260918_0003
Create Date: 2026-09-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260918_0004"
down_revision: str | Sequence[str] | None = "20260918_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create normalized phone identities."""

    op.create_table(
        "phone_identities",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("phone_e164", sa.String(length=32), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_phone_identities_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_phone_identities"),
        sa.UniqueConstraint("phone_e164", name="uq_phone_identities_phone_e164"),
    )
    op.create_index("ix_phone_identities_user_id", "phone_identities", ["user_id"])


def downgrade() -> None:
    """Drop phone identities."""

    op.drop_index("ix_phone_identities_user_id", table_name="phone_identities")
    op.drop_table("phone_identities")
