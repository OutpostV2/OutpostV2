import os

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import NullPool

from alembic import command
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")
BASELINE_REVISION = "20260918_0001"


@pytest.mark.integration
@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_empty_postgresql_database_upgrades_to_baseline_and_downgrades_cleanly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert DATABASE_URL is not None

    with temporary_postgresql_database(DATABASE_URL) as database_url:
        monkeypatch.setenv(
            "OUTPOST_DATABASE_URL",
            database_url.render_as_string(hide_password=False),
        )
        config = migration_config()
        command.upgrade(config, BASELINE_REVISION)

        engine = create_engine(database_url, poolclass=NullPool)
        try:
            assert inspect(engine).get_table_names() == ["alembic_version"]
            with engine.connect() as connection:
                assert connection.scalar(text("SELECT version_num FROM alembic_version")) == (
                    BASELINE_REVISION
                )
        finally:
            engine.dispose()

        command.downgrade(config, "base")

        engine = create_engine(database_url, poolclass=NullPool)
        try:
            assert inspect(engine).get_table_names() == ["alembic_version"]
            with engine.connect() as connection:
                assert connection.scalar(text("SELECT count(*) FROM alembic_version")) == 0
        finally:
            engine.dispose()
