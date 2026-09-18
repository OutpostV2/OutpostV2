import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, insert, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import NullPool

from alembic import command
from app.modules.auth.models import AuthSession
from app.modules.users.models import User
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")


@pytest.mark.integration
@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_sessions_store_only_refresh_hash_and_enforce_lifecycle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as database_url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", database_url.render_as_string(False))
        config = migration_config()
        command.upgrade(config, "20260918_0006")
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            inspector = inspect(engine)
            columns = {c["name"]: c for c in inspector.get_columns("auth_sessions")}
            assert "refresh_token_hash" in columns
            assert "refresh_token" not in columns
            assert str(columns["ip_address"]["type"]) == "INET"
            assert {"user_id", "token_family_id", "expires_at"} <= {
                column
                for index in inspector.get_indexes("auth_sessions")
                for column in index["column_names"]
            }
            now = datetime.now(UTC)
            with engine.begin() as connection:
                user_id = connection.scalar(
                    insert(User).values(display_name="Session User").returning(User.id)
                )
                connection.execute(
                    insert(AuthSession).values(
                        user_id=user_id,
                        token_family_id=uuid4(),
                        refresh_token_hash="sha256:test-refresh-hash",
                        expires_at=now + timedelta(days=30),
                        ip_address="203.0.113.7",
                    )
                )
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(
                    insert(AuthSession).values(
                        user_id=user_id,
                        token_family_id=uuid4(),
                        refresh_token_hash="sha256:test-refresh-hash",
                        expires_at=now + timedelta(days=1),
                    )
                )
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(
                    insert(AuthSession).values(
                        user_id=user_id,
                        token_family_id=uuid4(),
                        refresh_token_hash="sha256:expired",
                        expires_at=now - timedelta(days=1),
                    )
                )
        finally:
            engine.dispose()
        command.downgrade(config, "20260918_0005")
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            assert "auth_sessions" not in inspect(engine).get_table_names()
        finally:
            engine.dispose()
