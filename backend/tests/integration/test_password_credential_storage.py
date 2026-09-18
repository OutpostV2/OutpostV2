import os
from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, delete, func, insert, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import NullPool

from alembic import command
from app.modules.auth.models import PasswordCredential
from app.modules.users.models import User
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")
USERS_REVISION = "20260918_0002"
PASSWORD_CREDENTIALS_REVISION = "20260918_0003"


@pytest.mark.integration
@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_password_credentials_are_one_to_one_cascading_and_reversible(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert DATABASE_URL is not None

    with temporary_postgresql_database(DATABASE_URL) as database_url:
        monkeypatch.setenv(
            "OUTPOST_DATABASE_URL",
            database_url.render_as_string(hide_password=False),
        )
        config = migration_config()
        command.upgrade(config, PASSWORD_CREDENTIALS_REVISION)

        engine = create_engine(database_url, poolclass=NullPool)
        try:
            inspector = inspect(engine)
            columns = {
                column["name"]: column for column in inspector.get_columns("password_credentials")
            }
            assert set(columns) == {
                "user_id",
                "password_hash",
                "password_changed_at",
                "created_at",
            }
            assert "password" not in columns
            assert inspector.get_pk_constraint("password_credentials")["constrained_columns"] == [
                "user_id"
            ]
            foreign_key = inspector.get_foreign_keys("password_credentials")[0]
            assert foreign_key["referred_table"] == "users"
            assert foreign_key["constrained_columns"] == ["user_id"]
            assert foreign_key["options"]["ondelete"] == "CASCADE"

            with engine.begin() as connection:
                user_id = connection.scalar(
                    insert(User).values(display_name="Password User").returning(User.id)
                )
                row = connection.execute(
                    insert(PasswordCredential)
                    .values(user_id=user_id, password_hash="$argon2id$test-hash")
                    .returning(
                        PasswordCredential.password_changed_at,
                        PasswordCredential.created_at,
                    )
                ).one()

            assert isinstance(row.password_changed_at, datetime)
            assert row.password_changed_at.tzinfo is not None
            assert isinstance(row.created_at, datetime)
            assert row.created_at.tzinfo is not None

            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(
                    insert(PasswordCredential).values(
                        user_id=user_id,
                        password_hash="$argon2id$duplicate",
                    )
                )

            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(
                    insert(PasswordCredential).values(
                        user_id=uuid4(),
                        password_hash="$argon2id$orphan",
                    )
                )

            with engine.begin() as connection:
                connection.execute(delete(User).where(User.id == user_id))
                assert connection.scalar(select(func.count()).select_from(PasswordCredential)) == 0
        finally:
            engine.dispose()

        command.downgrade(config, USERS_REVISION)

        engine = create_engine(database_url, poolclass=NullPool)
        try:
            assert "password_credentials" not in inspect(engine).get_table_names()
            assert "users" in inspect(engine).get_table_names()
        finally:
            engine.dispose()
