"""Provider-neutral outbound email contracts."""

import smtplib
import ssl
from email.message import EmailMessage as MimeEmailMessage
from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr

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


class SmtpEmailProvider:
    """Deliver validated messages through a configured SMTP service."""

    def __init__(
        self,
        *,
        sender: str | EmailStr,
        host: str,
        port: int,
        timeout_seconds: float,
        starttls: bool = False,
        username: str | None = None,
        password: str | SecretStr | None = None,
    ) -> None:
        self._sender = str(sender)
        self._host = host
        self._port = port
        self._timeout_seconds = timeout_seconds
        self._starttls = starttls
        self._username = username
        self._password = (
            password.get_secret_value() if isinstance(password, SecretStr) else password
        )

    def send(self, message: EmailMessage) -> None:
        mime_message = MimeEmailMessage()
        mime_message["From"] = self._sender
        mime_message["To"] = str(message.to)
        mime_message["Subject"] = message.subject
        mime_message.set_content(message.text_body)
        if message.html_body is not None:
            mime_message.add_alternative(message.html_body, subtype="html")

        with smtplib.SMTP(
            host=self._host,
            port=self._port,
            timeout=self._timeout_seconds,
        ) as client:
            if self._starttls:
                client.ehlo()
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
            if self._username is not None and self._password is not None:
                client.login(self._username, self._password)
            client.send_message(mime_message)


def build_email_provider(settings: Settings) -> EmailProvider:
    """Build the configured provider after Settings has enforced environment safety."""
    if settings.email_provider is EmailProviderKind.DEVELOPMENT:
        return DevelopmentEmailProvider()
    if settings.email_provider is EmailProviderKind.DISABLED:
        return DisabledEmailProvider()
    if settings.email_provider is EmailProviderKind.SMTP:
        return SmtpEmailProvider(
            sender=settings.email_from_address,
            host=settings.email_smtp_host,
            port=settings.email_smtp_port,
            timeout_seconds=settings.email_smtp_timeout_seconds,
            starttls=settings.email_smtp_starttls,
            username=settings.email_smtp_username,
            password=settings.email_smtp_password,
        )
    raise ValueError(f"Unsupported email provider: {settings.email_provider}")
