"""Create canonical users.

Revision ID: 20260918_0002
Revises: 20260918_0001
Create Date: 2026-09-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260918_0002"
down_revision: str | Sequence[str] | None = "20260918_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

USER_STATUS_VALUES = ("active", "suspended", "deleted")


def upgrade() -> None:
    """Create the canonical user table and lifecycle enum."""

    user_status = postgresql.ENUM(
        *USER_STATUS_VALUES,
        name="user_status",
        create_type=False,
    )
    user_status.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("primary_email", sa.String(length=320), nullable=True),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("username", sa.String(length=64), nullable=True),
        sa.Column(
            "status",
            user_status,
            server_default=sa.text("'active'"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("username", name="uq_users_username"),
    )


def downgrade() -> None:
    """Drop canonical users and their lifecycle enum."""

    op.drop_table("users")
    postgresql.ENUM(*USER_STATUS_VALUES, name="user_status").drop(
        op.get_bind(),
        checkfirst=True,
    )
