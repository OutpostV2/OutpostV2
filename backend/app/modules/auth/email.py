"""Provider-neutral outbound email contracts."""

from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.config import EmailProviderKind, Settings


class EmailMessage(BaseModel):
    """Validated message content accepted by every email provider."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    to: EmailStr
    subject: str = Field(min_length=1, max_length=200)
    text_body: str = Field(min_length=1, max_length=100_000)
    html_body: str | None = Field(default=None, min_length=1, max_length=200_000)


@runtime_checkable
class EmailProvider(Protocol):
    """Outbound email boundary used by application services."""

    def send(self, message: EmailMessage) -> None:
        """Deliver or safely capture one validated message."""


class DevelopmentEmailProvider:
    """Non-networked provider that retains messages without logging their contents."""

    def __init__(self) -> None:
        self._outbox: list[EmailMessage] = []

    @property
    def outbox(self) -> tuple[EmailMessage, ...]:
        return tuple(self._outbox)

    def send(self, message: EmailMessage) -> None:
        self._outbox.append(message)


class DisabledEmailProvider:
    """Fail-closed provider used until an outbound adapter is configured."""

    def send(self, message: EmailMessage) -> None:
        del message
        raise RuntimeError("Outbound email is disabled")


def build_email_provider(settings: Settings) -> EmailProvider:
    """Build the configured provider after Settings has enforced environment safety."""
    if settings.email_provider is EmailProviderKind.DEVELOPMENT:
        return DevelopmentEmailProvider()
    if settings.email_provider is EmailProviderKind.DISABLED:
        return DisabledEmailProvider()
    raise ValueError(f"Unsupported email provider: {settings.email_provider}")
