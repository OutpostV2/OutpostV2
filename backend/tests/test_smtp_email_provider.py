import smtplib
import ssl
from email.message import EmailMessage as MimeEmailMessage
from types import TracebackType
from typing import Any

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.modules.auth.email import (
    EmailDeliveryError,
    EmailMessage,
    SmtpEmailProvider,
    build_email_provider,
)

DATABASE_URL = "postgresql+psycopg://outpost:local-password@127.0.0.1:5433/outpost"


class RecordingSmtp:
    instances: list["RecordingSmtp"] = []

    def __init__(self, *, host: str, port: int, timeout: float) -> None:
        self.host = host
        self.port = port
        self.timeout = timeout
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.message: MimeEmailMessage | None = None
        self.tls_context: ssl.SSLContext | None = None
        self.__class__.instances.append(self)

    def __enter__(self) -> "RecordingSmtp":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback

    def ehlo(self) -> None:
        self.calls.append(("ehlo", ()))

    def starttls(self, *, context: ssl.SSLContext | None = None) -> None:
        self.tls_context = context
        self.calls.append(("starttls", ()))

    def login(self, username: str, password: str) -> None:
        self.calls.append(("login", (username, password)))

    def send_message(self, message: MimeEmailMessage) -> None:
        self.calls.append(("send_message", ()))
        self.message = message


@pytest.fixture(autouse=True)
def recording_smtp(monkeypatch: pytest.MonkeyPatch) -> None:
    RecordingSmtp.instances.clear()
    monkeypatch.setattr(smtplib, "SMTP", RecordingSmtp)


def test_smtp_provider_sends_plain_and_html_message() -> None:
    provider = SmtpEmailProvider(
        sender="no-reply@example.com",
        host="127.0.0.1",
        port=1025,
        timeout_seconds=7.5,
    )

    provider.send(
        EmailMessage(
            to="person@example.com",
            subject="Verify your Outpost email",
            text_body="Use the verification link.",
            html_body="<p>Use the verification link.</p>",
        )
    )

    client = RecordingSmtp.instances[0]
    assert (client.host, client.port, client.timeout) == ("127.0.0.1", 1025, 7.5)
    assert client.calls == [("send_message", ())]
    assert client.message is not None
    assert client.message["From"] == "no-reply@example.com"
    assert client.message["To"] == "person@example.com"
    assert client.message["Subject"] == "Verify your Outpost email"
    plain_body = client.message.get_body(preferencelist=("plain",))
    html_body = client.message.get_body(preferencelist=("html",))
    assert plain_body is not None
    assert html_body is not None
    assert plain_body.get_content().strip() == "Use the verification link."
    assert html_body.get_content().strip() == "<p>Use the verification link.</p>"


def test_smtp_provider_negotiates_starttls_before_authentication() -> None:
    provider = SmtpEmailProvider(
        sender="no-reply@example.com",
        host="smtp.example.com",
        port=587,
        timeout_seconds=10,
        starttls=True,
        username="outpost",
        password="smtp-secret",
    )

    provider.send(EmailMessage(to="person@example.com", subject="Subject", text_body="Body"))

    assert RecordingSmtp.instances[0].calls == [
        ("ehlo", ()),
        ("starttls", ()),
        ("ehlo", ()),
        ("login", ("outpost", "smtp-secret")),
        ("send_message", ()),
    ]
    assert isinstance(RecordingSmtp.instances[0].tls_context, ssl.SSLContext)


def test_smtp_provider_normalizes_transport_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_connection(*args: object, **kwargs: object) -> None:
        del args, kwargs
        raise OSError("provider detail for person@example.com")

    monkeypatch.setattr(smtplib, "SMTP", fail_connection)
    provider = SmtpEmailProvider(
        sender="no-reply@example.com",
        host="smtp.example.com",
        port=587,
        timeout_seconds=10,
    )

    with pytest.raises(EmailDeliveryError) as captured:
        provider.send(EmailMessage(to="person@example.com", subject="Subject", text_body="Body"))

    assert str(captured.value) == "Outbound email delivery failed"
    assert "person@example.com" not in str(captured.value)


def test_factory_builds_smtp_provider_from_validated_settings() -> None:
    settings = Settings(
        database_url=DATABASE_URL,
        email_provider="smtp",
        email_from_address="no-reply@example.com",
        email_smtp_host="mailpit",
        email_smtp_port=1025,
        email_smtp_timeout_seconds=4,
        _env_file=None,
    )

    provider = build_email_provider(settings)
    provider.send(EmailMessage(to="person@example.com", subject="Subject", text_body="Body"))

    assert isinstance(provider, SmtpEmailProvider)
    client = RecordingSmtp.instances[0]
    assert (client.host, client.port, client.timeout) == ("mailpit", 1025, 4)


@pytest.mark.parametrize(
    ("overrides", "expected_message"),
    (
        ({"email_smtp_host": "   "}, "email_smtp_host"),
        ({"email_smtp_port": 0}, "email_smtp_port"),
        ({"email_smtp_timeout_seconds": 0}, "email_smtp_timeout_seconds"),
        ({"email_smtp_username": "outpost"}, "SMTP username and password"),
        ({"email_smtp_password": "smtp-secret"}, "SMTP username and password"),
    ),
)
def test_smtp_configuration_rejects_unsafe_values(
    overrides: dict[str, object], expected_message: str
) -> None:
    with pytest.raises(ValidationError, match=expected_message):
        Settings.model_validate(
            {"database_url": DATABASE_URL, "email_provider": "smtp", **overrides}
        )
