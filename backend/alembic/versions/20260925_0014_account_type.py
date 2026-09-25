"""Store an account type for dashboard access.

Revision ID: 20260925_0014
Revises: 20260925_0013
Create Date: 2026-09-25
"""

import sqlalchemy as sa

from alembic import op

revision = "20260925_0014"
down_revision = "20260925_0013"
branch_labels = None
depends_on = None

account_type_enum = sa.Enum("student", "coordinator", name="account_type")


def upgrade() -> None:
    account_type_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "users",
        sa.Column(
            "account_type",
            account_type_enum,
            nullable=False,
            server_default=sa.text("'student'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "account_type")
    account_type_enum.drop(op.get_bind(), checkfirst=True)
