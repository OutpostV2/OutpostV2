"""Alembic runtime configuration backed by Outpost settings."""

from alembic import context
from app.core.config import Settings
from app.db.models import Base
from app.db.session import create_engine_from_settings

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Render migration SQL without opening a database connection."""

    settings = Settings()
    context.configure(
        url=str(settings.database_url),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations through the canonical Outpost database engine."""

    engine = create_engine_from_settings(Settings())
    try:
        with engine.connect() as connection:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                compare_type=True,
            )

            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
