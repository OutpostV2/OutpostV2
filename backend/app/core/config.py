"""Typed runtime configuration for the Outpost backend."""

from enum import StrEnum
from urllib.parse import parse_qsl

from pydantic import (
    AnyHttpUrl,
    EmailStr,
    Field,
    PostgresDsn,
    SecretStr,
    field_validator,
    model_validator,
)
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
    SMTP = "smtp"


class SmsProviderKind(StrEnum):
    """Configured outbound SMS implementation."""

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
    sms_provider: SmsProviderKind = SmsProviderKind.DISABLED
    email_provider: EmailProviderKind = EmailProviderKind.DISABLED
    email_from_address: EmailStr = Field(default="no-reply@outpost.example")
    email_verification_url: AnyHttpUrl = Field(
        default=AnyHttpUrl("http://localhost:5173/verify-email")
    )
    password_reset_url: AnyHttpUrl = Field(
        default=AnyHttpUrl("http://localhost:5173/reset-password")
    )
    email_smtp_host: str = Field(default="127.0.0.1", min_length=1, max_length=253)
    email_smtp_port: int = Field(default=1025, ge=1, le=65_535)
    email_smtp_timeout_seconds: float = Field(default=10.0, gt=0, le=120)
    email_smtp_starttls: bool = False
    email_smtp_username: str | None = Field(default=None, max_length=320)
    email_smtp_password: SecretStr | None = None

    @field_validator("auth_signing_key")
    @classmethod
    def strong_signing_key(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and len(value.get_secret_value().encode("utf-8")) < 32:
            raise ValueError("Authentication signing key requires at least 32 bytes")
        return value

    @field_validator("email_smtp_host")
    @classmethod
    def normalized_smtp_host(cls, value: str) -> str:
        host = value.strip()
        if not host:
            raise ValueError("email_smtp_host must not be blank")
        return host

    @field_validator("email_smtp_username")
    @classmethod
    def normalized_smtp_username(cls, value: str | None) -> str | None:
        if value is None:
            return None
        username = value.strip()
        return username or None

    @field_validator("email_smtp_password")
    @classmethod
    def nonempty_smtp_password(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and not value.get_secret_value():
            raise ValueError("email_smtp_password must not be empty")
        return value

    @field_validator("email_verification_url")
    @classmethod
    def safe_email_verification_url(cls, value: AnyHttpUrl) -> AnyHttpUrl:
        has_token_parameter = any(
            name.lower() == "token" for name, _ in parse_qsl(value.query or "")
        )
        if value.username is not None or value.password is not None or has_token_parameter:
            raise ValueError(
                "The email verification URL cannot contain credentials or a token parameter"
            )
        return value

    @field_validator("password_reset_url")
    @classmethod
    def safe_password_reset_url(cls, value: AnyHttpUrl) -> AnyHttpUrl:
        has_token_parameter = any(
            name.lower() == "token" for name, _ in parse_qsl(value.query or "")
        )
        if value.username is not None or value.password is not None or has_token_parameter:
            raise ValueError(
                "The password reset URL cannot contain credentials or a token parameter"
            )
        return value

    @model_validator(mode="after")
    def environment_safety(self) -> "Settings":
        if self.sms_provider is SmsProviderKind.DEVELOPMENT and self.env not in {
            Environment.DEVELOPMENT,
            Environment.TEST,
        }:
            raise ValueError("The development SMS provider is allowed only in development or test")
        if self.email_provider is EmailProviderKind.DEVELOPMENT and self.env not in {
            Environment.DEVELOPMENT,
            Environment.TEST,
        }:
            raise ValueError(
                "The development email provider is allowed only in development or test"
            )
        if (self.email_smtp_username is None) is not (self.email_smtp_password is None):
            raise ValueError("SMTP username and password must be configured together")
        if self.env in {Environment.STAGING, Environment.PRODUCTION} and (
            self.email_verification_url.scheme != "https"
        ):
            raise ValueError("Staging and production require an HTTPS email verification URL")
        if self.env in {Environment.STAGING, Environment.PRODUCTION} and (
            self.password_reset_url.scheme != "https"
        ):
            raise ValueError("Staging and production require an HTTPS password reset URL")
        return self
