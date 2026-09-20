"""Provider-neutral outbound SMS contracts."""

from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

from app.core.config import Settings, SmsProviderKind


class SmsMessage(BaseModel):
    """Validated message content accepted by every SMS provider."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    to: str = Field(pattern=r"^\+[1-9]\d{1,14}$", min_length=3, max_length=16)
    text_body: str = Field(min_length=1, max_length=1600)


class SmsDeliveryError(RuntimeError):
    """A provider could not accept an outbound SMS message."""


@runtime_checkable
class SmsProvider(Protocol):
    """Outbound SMS boundary used by authentication services."""

    def send(self, message: SmsMessage) -> None:
        """Deliver a validated message without exposing its contents."""


class DevelopmentSmsProvider:
    """Non-networked provider that retains messages without logging their contents."""

    def __init__(self) -> None:
        self._outbox: list[SmsMessage] = []

    @property
    def outbox(self) -> tuple[SmsMessage, ...]:
        return tuple(self._outbox)

    def send(self, message: SmsMessage) -> None:
        self._outbox.append(message)


class DisabledSmsProvider:
    """Fail-closed provider used until an outbound adapter is configured."""

    def send(self, message: SmsMessage) -> None:
        del message
        raise SmsDeliveryError("Outbound SMS is disabled")


def build_sms_provider(settings: Settings) -> SmsProvider:
    """Build the configured provider from validated settings."""
    if settings.sms_provider is SmsProviderKind.DEVELOPMENT:
        return DevelopmentSmsProvider()
    if settings.sms_provider is SmsProviderKind.DISABLED:
        return DisabledSmsProvider()
    raise ValueError(f"Unsupported SMS provider: {settings.sms_provider}")
