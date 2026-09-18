"""Create security events.

Revision ID: 20260918_0010
Revises: 20260918_0009
Create Date: 2026-09-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260918_0010"
down_revision: str | Sequence[str] | None = "20260918_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "security_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column(
            "occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("ip_address", postgresql.INET(), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column(
            "event_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["auth_sessions.id"],
            name="fk_security_events_session_id_auth_sessions",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_security_events_user_id_users", ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_security_events"),
    )
    op.create_index("ix_security_events_session_id", "security_events", ["session_id"])
    op.create_index(
        "ix_security_events_type_occurred_at", "security_events", ["event_type", "occurred_at"]
    )
    op.create_index(
        "ix_security_events_user_occurred_at", "security_events", ["user_id", "occurred_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_security_events_user_occurred_at", table_name="security_events")
    op.drop_index("ix_security_events_type_occurred_at", table_name="security_events")
    op.drop_index("ix_security_events_session_id", table_name="security_events")
    op.drop_table("security_events")
