import os

import pytest

from app.core.config import Settings
from app.database import create_database_engine, probe_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")


@pytest.mark.integration
@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_backend_can_query_the_local_postgresql_service() -> None:
    assert DATABASE_URL is not None
    settings = Settings(database_url=DATABASE_URL, _env_file=None)
    engine = create_database_engine(settings)

    try:
        status = probe_database(engine)
    finally:
        engine.dispose()

    assert status.database == "outpost"
    assert status.user == "outpost"
    assert status.version.startswith("17.")
