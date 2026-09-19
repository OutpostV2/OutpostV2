"""Typed runtime configuration for the Outpost backend."""

from enum import StrEnum

from pydantic import EmailStr, Field, PostgresDsn, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(StrEnum):
    """Supported application environments."""

    DEVELOPMENT = "development"
    TEST = "test"
    STAGING = "staging"
    PRODUCTION = "production"


class LogLevel(StrEnum):
    """Supported application log levels."""

    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class EmailProviderKind(StrEnum):
    """Configured outbound email implementation."""

    DISABLED = "disabled"
    DEVELOPMENT = "development"


class Settings(BaseSettings):
    """Outpost settings loaded from environment variables or a local env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="OUTPOST_",
        extra="ignore",
    )

    env: Environment = Environment.DEVELOPMENT
    log_level: LogLevel = LogLevel.INFO
    database_url: PostgresDsn

    auth_signing_key: SecretStr | None = None
    email_provider: EmailProviderKind = EmailProviderKind.DISABLED
    email_from_address: EmailStr = Field(default="no-reply@outpost.example")

    @field_validator("auth_signing_key")
    @classmethod
    def strong_signing_key(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and len(value.get_secret_value().encode("utf-8")) < 32:
            raise ValueError("Authentication signing key requires at least 32 bytes")
        return value

    @model_validator(mode="after")
    def development_email_is_local_only(self) -> "Settings":
        if self.email_provider is EmailProviderKind.DEVELOPMENT and self.env not in {
            Environment.DEVELOPMENT,
            Environment.TEST,
        }:
            raise ValueError(
                "The development email provider is allowed only in development or test"
            )
        return self
