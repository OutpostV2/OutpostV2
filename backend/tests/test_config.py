from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Environment, LogLevel, Settings

DATABASE_URL = "postgresql+psycopg://outpost:local-password@127.0.0.1:5433/outpost"


def test_settings_load_typed_values_from_an_env_file(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            (
                "OUTPOST_ENV=production",
                "OUTPOST_LOG_LEVEL=WARNING",
                f"OUTPOST_DATABASE_URL={DATABASE_URL}",
            )
        ),
        encoding="utf-8",
    )

    settings = Settings(_env_file=env_file)

    assert settings.env is Environment.PRODUCTION
    assert settings.log_level is LogLevel.WARNING
    assert str(settings.database_url) == DATABASE_URL


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("env", "preview"),
        ("database_url", "sqlite:///outpost.db"),
    ),
)
def test_settings_reject_unsupported_runtime_configuration(field: str, value: str) -> None:
    values = {
        "env": "development",
        "log_level": "INFO",
        "database_url": DATABASE_URL,
    }
    values[field] = value

    with pytest.raises(ValidationError):
        Settings.model_validate(values)
