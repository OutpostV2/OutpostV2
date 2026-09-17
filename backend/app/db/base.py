"""Declarative model base for future Alembic-managed schemas."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for Outpost SQLAlchemy models."""
