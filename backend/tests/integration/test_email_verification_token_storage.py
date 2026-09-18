import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, insert, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import NullPool

from alembic import command
from app.modules.auth.models import EmailVerificationToken
from app.modules.users.models import User
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")


@pytest.mark.integration
@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_email_verification_tokens_are_protected_single_use_storage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as database_url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", database_url.render_as_string(False))
        config = migration_config()
        command.upgrade(config, "20260918_0008")
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            columns = {
                c["name"]: c for c in inspect(engine).get_columns("email_verification_tokens")
            }
            assert "token_hash" in columns
            assert "token" not in columns
            assert columns["consumed_at"]["nullable"] is True
            now = datetime.now(UTC)
            with engine.begin() as connection:
                user_id = connection.scalar(
                    insert(User).values(display_name="Verify User").returning(User.id)
                )
                connection.execute(
                    insert(EmailVerificationToken).values(
                        user_id=user_id,
                        email="verify@example.com",
                        token_hash="sha256:verification-token",
                        expires_at=now + timedelta(hours=24),
                    )
                )
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(
                    insert(EmailVerificationToken).values(
                        user_id=user_id,
                        email="verify@example.com",
                        token_hash="sha256:verification-token",
                        expires_at=now + timedelta(hours=1),
                    )
                )
        finally:
            engine.dispose()
        command.downgrade(config, "20260918_0007")
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            assert "email_verification_tokens" not in inspect(engine).get_table_names()
        finally:
            engine.dispose()
