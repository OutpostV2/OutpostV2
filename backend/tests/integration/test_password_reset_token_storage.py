import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, insert, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import NullPool

from alembic import command
from app.modules.auth.models import PasswordResetToken
from app.modules.users.models import User
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")


@pytest.mark.integration
@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_password_reset_tokens_are_hash_only_expiring_and_reversible(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as database_url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", database_url.render_as_string(False))
        config = migration_config()
        command.upgrade(config, "20260918_0009")
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            columns = {c["name"]: c for c in inspect(engine).get_columns("password_reset_tokens")}
            assert set(columns) == {
                "id",
                "user_id",
                "token_hash",
                "created_at",
                "expires_at",
                "consumed_at",
            }
            assert "token" not in columns
            now = datetime.now(UTC)
            with engine.begin() as connection:
                user_id = connection.scalar(
                    insert(User).values(display_name="Reset User").returning(User.id)
                )
                connection.execute(
                    insert(PasswordResetToken).values(
                        user_id=user_id,
                        token_hash="sha256:password-reset-token",
                        expires_at=now + timedelta(hours=1),
                    )
                )
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(
                    insert(PasswordResetToken).values(
                        user_id=user_id,
                        token_hash="sha256:password-reset-token",
                        expires_at=now + timedelta(hours=1),
                    )
                )
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(
                    insert(PasswordResetToken).values(
                        user_id=user_id,
                        token_hash="sha256:already-expired",
                        expires_at=now - timedelta(minutes=1),
                    )
                )
        finally:
            engine.dispose()
        command.downgrade(config, "20260918_0008")
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            assert "password_reset_tokens" not in inspect(engine).get_table_names()
        finally:
            engine.dispose()
