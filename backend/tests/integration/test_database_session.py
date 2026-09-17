import os

import pytest
from sqlalchemy import text

from app.core.config import Settings
from app.db.session import create_engine_from_settings, create_session_factory, session_scope

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")


@pytest.mark.integration
@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_session_scope_commits_success_and_rolls_back_failure() -> None:
    assert DATABASE_URL is not None
    settings = Settings(database_url=DATABASE_URL, _env_file=None)
    engine = create_engine_from_settings(settings)
    session_factory = create_session_factory(engine)

    try:
        with session_scope(session_factory) as session:
            session.execute(
                text(
                    "CREATE TEMP TABLE outpost_session_probe (value integer) "
                    "ON COMMIT PRESERVE ROWS"
                )
            )
            session.execute(text("INSERT INTO outpost_session_probe VALUES (1)"))

        with session_scope(session_factory) as session:
            assert session.scalar(text("SELECT count(*) FROM outpost_session_probe")) == 1

        with (
            pytest.raises(RuntimeError, match="force rollback"),
            session_scope(session_factory) as session,
        ):
            session.execute(text("INSERT INTO outpost_session_probe VALUES (2)"))
            raise RuntimeError("force rollback")

        with session_scope(session_factory) as session:
            assert session.scalar(text("SELECT count(*) FROM outpost_session_probe")) == 1
    finally:
        with engine.begin() as connection:
            connection.execute(text("DROP TABLE IF EXISTS outpost_session_probe"))
        engine.dispose()
