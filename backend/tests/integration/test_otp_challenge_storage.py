import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, insert, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import NullPool

from alembic import command
from app.modules.auth.models import OtpChallenge, OtpPurpose
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")


@pytest.mark.integration
@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_otp_challenges_store_only_digest_and_enforce_limits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as database_url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", database_url.render_as_string(False))
        config = migration_config()
        command.upgrade(config, "20260918_0007")
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            columns = {c["name"]: c for c in inspect(engine).get_columns("otp_challenges")}
            assert "otp_digest" in columns
            assert {"otp", "code"} & set(columns) == set()
            assert columns["consumed_at"]["nullable"] is True
            now = datetime.now(UTC)
            with engine.begin() as connection:
                connection.execute(
                    insert(OtpChallenge).values(
                        phone_e164="+14155550101",
                        purpose=OtpPurpose.LOGIN,
                        otp_digest="hmac-sha256:test-digest",
                        expires_at=now + timedelta(minutes=5),
                        resend_available_at=now + timedelta(seconds=45),
                    )
                )
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(
                    insert(OtpChallenge).values(
                        phone_e164="+14155550101",
                        purpose=OtpPurpose.LOGIN,
                        otp_digest="hmac-sha256:too-many",
                        attempt_count=6,
                        expires_at=now + timedelta(minutes=5),
                        resend_available_at=now + timedelta(seconds=45),
                    )
                )
        finally:
            engine.dispose()
        command.downgrade(config, "20260918_0006")
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            assert "otp_challenges" not in inspect(engine).get_table_names()
            with engine.connect() as connection:
                assert (
                    connection.scalar(
                        text("SELECT count(*) FROM pg_type WHERE typname = 'otp_purpose'")
                    )
                    == 0
                )
        finally:
            engine.dispose()
