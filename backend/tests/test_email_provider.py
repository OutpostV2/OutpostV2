import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.modules.auth.email import (
    DevelopmentEmailProvider,
    EmailMessage,
    EmailProvider,
    build_email_provider,
)

DATABASE_URL = "postgresql+psycopg://outpost:local-password@127.0.0.1:5433/outpost"


def test_development_email_provider_captures_validated_messages_without_output(
    capsys: pytest.CaptureFixture[str],
) -> None:
    provider = DevelopmentEmailProvider()
    message = EmailMessage(
        to="person@example.com",
        subject="Verify your Outpost email",
        text_body="Use the one-time verification link.",
        html_body="<p>Use the one-time verification link.</p>",
    )

    provider.send(message)

    assert isinstance(provider, EmailProvider)
    assert provider.outbox == (message,)
    assert capsys.readouterr() == ("", "")
    with pytest.raises(ValidationError):
        EmailMessage(to="invalid", subject="Subject", text_body="Body")
    with pytest.raises(ValidationError):
        EmailMessage(to="person@example.com", subject="", text_body="Body")


def test_email_provider_factory_uses_validated_development_configuration() -> None:
    settings = Settings(
        database_url=DATABASE_URL,
        email_provider="development",
        email_from_address="no-reply@example.com",
        _env_file=None,
    )

    provider = build_email_provider(settings)

    assert isinstance(provider, DevelopmentEmailProvider)
    assert settings.email_from_address == "no-reply@example.com"


@pytest.mark.parametrize("environment", ("staging", "production"))
def test_development_email_provider_is_rejected_outside_safe_environments(
    environment: str,
) -> None:
    with pytest.raises(ValidationError, match="development email provider"):
        Settings(
            env=environment,
            database_url=DATABASE_URL,
            email_provider="development",
            email_from_address="no-reply@example.com",
            _env_file=None,
        )


def test_email_configuration_rejects_invalid_sender() -> None:
    with pytest.raises(ValidationError):
        Settings(
            database_url=DATABASE_URL,
            email_from_address="invalid",
            _env_file=None,
        )
