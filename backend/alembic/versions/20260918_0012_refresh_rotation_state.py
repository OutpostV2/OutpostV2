"""Preserve refresh-token rotation lineage.

Revision ID: 20260918_0012
Revises: 20260918_0011
Create Date: 2026-09-18
"""

import sqlalchemy as sa

from alembic import op

revision = "20260918_0012"
down_revision = "20260918_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "auth_sessions",
        sa.Column("replaced_by_session_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_auth_sessions_replaced_by_session_id_auth_sessions",
        "auth_sessions",
        "auth_sessions",
        ["replaced_by_session_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_unique_constraint(
        "uq_auth_sessions_replaced_by_session_id",
        "auth_sessions",
        ["replaced_by_session_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_auth_sessions_replaced_by_session_id", "auth_sessions", type_="unique")
    op.drop_constraint(
        "fk_auth_sessions_replaced_by_session_id_auth_sessions",
        "auth_sessions",
        type_="foreignkey",
    )
    op.drop_column("auth_sessions", "replaced_by_session_id")
