import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.pool import NullPool

from alembic import command

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")
BACKEND_ROOT = Path(__file__).parents[2]
BASELINE_REVISION = "20260918_0001"


def create_empty_database(admin_url: URL, database_name: str) -> None:
    engine = create_engine(admin_url, isolation_level="AUTOCOMMIT", poolclass=NullPool)
    try:
        with engine.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{database_name}"'))
    finally:
        engine.dispose()


def drop_database(admin_url: URL, database_name: str) -> None:
    engine = create_engine(admin_url, isolation_level="AUTOCOMMIT", poolclass=NullPool)
    try:
        with engine.connect() as connection:
            connection.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :database_name AND pid <> pg_backend_pid()"
                ),
                {"database_name": database_name},
            )
            connection.execute(text(f'DROP DATABASE IF EXISTS "{database_name}"'))
    finally:
        engine.dispose()


@pytest.mark.integration
@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_empty_postgresql_database_upgrades_to_head_and_downgrades_cleanly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert DATABASE_URL is not None
    source_url = make_url(DATABASE_URL)
    admin_url = source_url.set(database="postgres")
    database_name = f"outpost_migration_{uuid4().hex}"
    migration_url = source_url.set(database=database_name)
    rendered_migration_url = migration_url.render_as_string(hide_password=False)
    alembic_config = Config(BACKEND_ROOT / "alembic.ini")

    create_empty_database(admin_url, database_name)
    monkeypatch.setenv("OUTPOST_DATABASE_URL", rendered_migration_url)

    try:
        command.upgrade(alembic_config, "head")

        migrated_engine = create_engine(migration_url, poolclass=NullPool)
        try:
            assert inspect(migrated_engine).get_table_names() == ["alembic_version"]
            with migrated_engine.connect() as connection:
                assert connection.scalar(text("SELECT version_num FROM alembic_version")) == (
                    BASELINE_REVISION
                )
        finally:
            migrated_engine.dispose()

        command.downgrade(alembic_config, "base")

        rolled_back_engine = create_engine(migration_url, poolclass=NullPool)
        try:
            assert inspect(rolled_back_engine).get_table_names() == ["alembic_version"]
            with rolled_back_engine.connect() as connection:
                assert connection.scalar(text("SELECT count(*) FROM alembic_version")) == 0
        finally:
            rolled_back_engine.dispose()
    finally:
        drop_database(admin_url, database_name)
