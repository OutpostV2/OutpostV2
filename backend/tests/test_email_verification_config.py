import pytest
from pydantic import ValidationError

from app.core.config import Settings

DATABASE_URL = "postgresql+psycopg://outpost:local-password@127.0.0.1:5433/outpost"


@pytest.mark.parametrize(
    "verification_url",
    (
        "https://user:password@app.example.com/verify-email",
        "https://app.example.com/verify-email?token=preconfigured",
    ),
)
def test_verification_url_rejects_credentials_and_preconfigured_tokens(
    verification_url: str,
) -> None:
    with pytest.raises(ValidationError, match="email verification URL"):
        Settings(
            database_url=DATABASE_URL,
            email_verification_url=verification_url,
            _env_file=None,
        )


def test_production_verification_url_requires_https() -> None:
    with pytest.raises(ValidationError, match="HTTPS email verification URL"):
        Settings(
            env="production",
            database_url=DATABASE_URL,
            email_verification_url="http://app.example.com/verify-email",
            _env_file=None,
        )


@pytest.mark.parametrize(
    "reset_url",
    (
        "https://user:password@app.example.com/reset-password",
        "https://app.example.com/reset-password?token=preconfigured",
    ),
)
def test_password_reset_url_rejects_credentials_and_preconfigured_tokens(
    reset_url: str,
) -> None:
    with pytest.raises(ValidationError, match="password reset URL"):
        Settings(
            database_url=DATABASE_URL,
            password_reset_url=reset_url,
            _env_file=None,
        )


def test_production_password_reset_url_requires_https() -> None:
    with pytest.raises(ValidationError, match="HTTPS password reset URL"):
        Settings(
            env="production",
            database_url=DATABASE_URL,
            email_verification_url="https://app.example.com/verify-email",
            password_reset_url="http://app.example.com/reset-password",
            _env_file=None,
        )
