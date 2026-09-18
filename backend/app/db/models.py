"""Import registry for every Alembic-managed SQLAlchemy model."""

from app.db.base import Base
from app.modules.users.models import User

__all__ = ["Base", "User"]
