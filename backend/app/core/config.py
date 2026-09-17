"""Typed runtime configuration for the Outpost backend."""

from enum import StrEnum

from pydantic import PostgresDsn
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
