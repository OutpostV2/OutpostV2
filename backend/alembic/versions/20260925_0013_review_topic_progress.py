"""Add isolated review-scenario progress without changing product tenant tables.

Revision ID: 20260925_0013
Revises: 20260918_0012
Create Date: 2026-09-25
"""

import sqlalchemy as sa

from alembic import op

revision = "20260925_0013"
down_revision = "20260918_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_topic_progress",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("topic_key", sa.String(length=64), nullable=False),
        sa.Column(
            "completed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "topic_key"),
    )


def downgrade() -> None:
    op.drop_table("review_topic_progress")
