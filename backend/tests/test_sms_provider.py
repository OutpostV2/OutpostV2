import pytest
from pydantic import ValidationError

from app.core.config import Settings, SmsProviderKind
from app.db.session import create_engine_from_settings
from app.main import create_app
from app.modules.auth.sms import (
    DevelopmentSmsProvider,
    DisabledSmsProvider,
    SmsDeliveryError,
    SmsMessage,
    SmsProvider,
    build_sms_provider,
)

DATABASE_URL = "postgresql+psycopg://outpost:local-password@127.0.0.1:5433/outpost"


def test_development_sms_provider_captures_messages_without_output(
    capsys: pytest.CaptureFixture[str],
) -> None:
    provider = DevelopmentSmsProvider()
    message = SmsMessage(to="+14155552671", text_body="Your Outpost code is 123456.")

    provider.send(message)

    assert provider.outbox == (message,)
    assert isinstance(provider, SmsProvider)
    assert capsys.readouterr() == ("", "")


def test_sms_message_accepts_only_e164_destinations_and_bounded_text() -> None:
    message = SmsMessage(to="+14155552671", text_body="Your Outpost code is 123456.")

    assert message.to == "+14155552671"
    assert message.text_body == "Your Outpost code is 123456."
    for invalid_phone in (
        "14155552671",
        "+0123456789",
        "+1415 555 2671",
        "+1415555267x",
        "+1234567890123456",
    ):
        with pytest.raises(ValidationError):
            SmsMessage(to=invalid_phone, text_body="Message")
    for invalid_text in ("", "x" * 1601):
        with pytest.raises(ValidationError):
            SmsMessage(to="+14155552671", text_body=invalid_text)


def test_disabled_sms_provider_fails_closed_without_exposing_message() -> None:
    provider = DisabledSmsProvider()
    message = SmsMessage(to="+14155552671", text_body="Secret value 123456")

    with pytest.raises(SmsDeliveryError) as captured:
        provider.send(message)

    assert isinstance(provider, SmsProvider)
    assert str(captured.value) == "Outbound SMS is disabled"
    assert message.to not in str(captured.value)
    assert message.text_body not in str(captured.value)


def test_sms_provider_factory_defaults_to_disabled() -> None:
    settings = Settings(database_url=DATABASE_URL, _env_file=None)

    provider = build_sms_provider(settings)

    assert settings.sms_provider is SmsProviderKind.DISABLED
    assert isinstance(provider, DisabledSmsProvider)


def test_sms_provider_factory_uses_validated_development_configuration() -> None:
    settings = Settings(
        database_url=DATABASE_URL,
        sms_provider="development",
        _env_file=None,
    )

    provider = build_sms_provider(settings)

    assert settings.sms_provider is SmsProviderKind.DEVELOPMENT
    assert isinstance(provider, DevelopmentSmsProvider)


@pytest.mark.parametrize("environment", ("staging", "production"))
def test_development_sms_provider_is_rejected_outside_safe_environments(
    environment: str,
) -> None:
    with pytest.raises(ValidationError, match="development SMS provider"):
        Settings(
            env=environment,
            database_url=DATABASE_URL,
            sms_provider="development",
            _env_file=None,
        )


def test_sms_provider_configuration_rejects_unknown_adapter() -> None:
    with pytest.raises(ValidationError, match="sms_provider"):
        Settings(database_url=DATABASE_URL, sms_provider="vendor-sdk", _env_file=None)


class RecordingSmsProvider:
    def __init__(self) -> None:
        self.messages: list[SmsMessage] = []

    def send(self, message: SmsMessage) -> None:
        self.messages.append(message)


def test_application_injects_configured_or_explicit_sms_provider() -> None:
    settings = Settings(database_url=DATABASE_URL, _env_file=None)
    engine = create_engine_from_settings(settings)
    override = RecordingSmsProvider()
    try:
        configured_app = create_app(settings, engine=engine, configure_logs=False)
        overridden_app = create_app(
            settings,
            engine=engine,
            sms_provider=override,
            configure_logs=False,
        )

        assert isinstance(configured_app.state.sms_provider, DisabledSmsProvider)
        assert overridden_app.state.sms_provider is override
        assert isinstance(override, SmsProvider)
    finally:
        engine.dispose()
