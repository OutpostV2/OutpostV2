"""Validated authentication inputs and safe public outputs."""

import re
from datetime import datetime
from typing import Literal
from uuid import UUID

from email_validator import validate_email
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from app.modules.auth.phone_identities import normalize_phone
from app.modules.users.models import AccountType


def normalize_email(value: str) -> str:
    """Validate without network I/O and use case-insensitive account identifiers."""
    return str(
        validate_email(value.strip(), check_deliverability=False, allow_smtputf8=False).normalized
    ).lower()


def normalize_username(value: str) -> str:
    value = value.strip().lower()
    if re.fullmatch(r"[a-z0-9_]{3,64}", value) is None:
        raise ValueError("Username must contain 3–64 ASCII letters, digits, or underscores")
    return value


def validate_password(value: SecretStr) -> SecretStr:
    if not 12 <= len(value.get_secret_value()) <= 1024:
        raise ValueError("Password must contain 12–1024 characters")
    return value


class RegistrationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str = Field(min_length=1, max_length=200)
    username: str
    email: str
    password: SecretStr
    account_type: AccountType = AccountType.STUDENT

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Display name cannot be blank")
        return value

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        return normalize_email(value)

    @field_validator("username")
    @classmethod
    def clean_username(cls, value: str) -> str:
        return normalize_username(value)

    @field_validator("password")
    @classmethod
    def password_policy(cls, value: SecretStr) -> SecretStr:
        return validate_password(value)


class UserOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_name: str
    username: str | None
    primary_email: str | None
    email_verified_at: datetime | None
    account_type: AccountType


class EmailVerificationRequestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        return normalize_email(value)


class ForgotPasswordInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        return normalize_email(value)


class PasswordResetInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: SecretStr = Field(min_length=43, max_length=512)
    password: SecretStr

    @field_validator("password")
    @classmethod
    def password_policy(cls, value: SecretStr) -> SecretStr:
        return validate_password(value)


class EmailVerificationConfirmInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: SecretStr = Field(min_length=43, max_length=512)


class PhoneOtpRequestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    phone: str

    @field_validator("phone")
    @classmethod
    def clean_phone(cls, value: str) -> str:
        return normalize_phone(value)


class PhoneOtpVerifyInput(PhoneOtpRequestInput):
    code: SecretStr = Field(min_length=6, max_length=6)

    @field_validator("code")
    @classmethod
    def valid_code(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().isdigit():
            raise ValueError("Code must contain exactly six digits")
        return value


class LoginInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    identifier: str = Field(min_length=1, max_length=320)
    password: SecretStr = Field(min_length=1, max_length=1024)


class TokenOutput(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int = 900


class SessionOutput(BaseModel):
    id: UUID
    created_at: datetime
    last_used_at: datetime
    expires_at: datetime
    user_agent: str | None
    ip_address: str | None
    is_current: bool
