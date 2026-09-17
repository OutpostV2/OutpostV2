from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Settings

DATABASE_URL = "postgresql+psycopg://outpost:local-password@127.0.0.1:5433/outpost"


def test_database_settings_load_the_postgresql_url_from_an_env_file(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(f"OUTPOST_DATABASE_URL={DATABASE_URL}\n", encoding="utf-8")

    settings = Settings(_env_file=env_file)

    assert str(settings.database_url) == DATABASE_URL


def test_database_settings_reject_non_postgresql_urls() -> None:
    with pytest.raises(ValidationError):
        Settings(database_url="sqlite:///outpost.db", _env_file=None)
