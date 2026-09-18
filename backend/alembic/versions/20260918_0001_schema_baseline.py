"""Establish the Alembic schema baseline.

Revision ID: 20260918_0001
Revises:
Create Date: 2026-09-18
"""

from collections.abc import Sequence

revision: str = "20260918_0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Establish migration ownership before application tables exist."""


def downgrade() -> None:
    """Return to the pre-migration baseline."""
