"""Enforce deterministic case-insensitive password login identifiers."""

import sqlalchemy as sa

from alembic import op

revision = "20260918_0011"
down_revision = "20260918_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Fail on collisions rather than silently merge or rewrite established accounts.
    op.create_index(
        "uq_users_primary_email_lower", "users", [sa.text("lower(primary_email)")], unique=True
    )
    op.create_index("uq_users_username_lower", "users", [sa.text("lower(username)")], unique=True)


def downgrade() -> None:
    op.drop_index("uq_users_username_lower", table_name="users")
    op.drop_index("uq_users_primary_email_lower", table_name="users")
