from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.pool import NullPool

BACKEND_ROOT = Path(__file__).parents[2]


def migration_config() -> Config:
    return Config(BACKEND_ROOT / "alembic.ini")


@contextmanager
def temporary_postgresql_database(source_database_url: str) -> Iterator[URL]:
    source_url = make_url(source_database_url)
    admin_url = source_url.set(database="postgres")
    database_name = f"outpost_test_{uuid4().hex}"
    database_url = source_url.set(database=database_name)
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT", poolclass=NullPool)

    try:
        with admin_engine.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{database_name}"'))
        yield database_url
    finally:
        with admin_engine.connect() as connection:
            connection.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :database_name AND pid <> pg_backend_pid()"
                ),
                {"database_name": database_name},
            )
            connection.execute(text(f'DROP DATABASE IF EXISTS "{database_name}"'))
        admin_engine.dispose()
