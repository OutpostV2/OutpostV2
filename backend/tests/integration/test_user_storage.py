import os
from datetime import datetime
from uuid import UUID

import pytest
from sqlalchemy import create_engine, insert, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import NullPool

from alembic import command
from app.modules.users.models import User, UserStatus
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")
BASELINE_REVISION = "20260918_0001"
USERS_REVISION = "20260918_0002"


@pytest.mark.integration
@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_users_migration_schema_defaults_constraints_and_rollback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert DATABASE_URL is not None

    with temporary_postgresql_database(DATABASE_URL) as database_url:
        monkeypatch.setenv(
            "OUTPOST_DATABASE_URL",
            database_url.render_as_string(hide_password=False),
        )
        config = migration_config()
        command.upgrade(config, USERS_REVISION)

        engine = create_engine(database_url, poolclass=NullPool)
        try:
            inspector = inspect(engine)
            columns = {column["name"]: column for column in inspector.get_columns("users")}
            assert set(columns) == {
                "id",
                "display_name",
                "primary_email",
                "email_verified_at",
                "username",
                "status",
                "created_at",
                "updated_at",
            }
            assert "role" not in columns
            assert inspector.get_pk_constraint("users")["constrained_columns"] == ["id"]
            assert columns["display_name"]["nullable"] is False
            assert columns["primary_email"]["nullable"] is True
            assert columns["email_verified_at"]["nullable"] is True
            assert columns["username"]["nullable"] is True
            assert columns["status"]["nullable"] is False
            assert columns["created_at"]["nullable"] is False
            assert columns["updated_at"]["nullable"] is False
            assert {
                constraint["name"] for constraint in inspector.get_unique_constraints("users")
            } == {"uq_users_username"}

            with engine.connect() as connection:
                enum_values = connection.scalars(
                    text(
                        "SELECT enumlabel FROM pg_enum "
                        "JOIN pg_type ON pg_type.oid = pg_enum.enumtypid "
                        "WHERE pg_type.typname = 'user_status' ORDER BY enumsortorder"
                    )
                ).all()
            assert enum_values == ["active", "suspended", "deleted"]

            with engine.begin() as connection:
                row = connection.execute(
                    insert(User)
                    .values(display_name="Ada Lovelace", username="ada")
                    .returning(User.id, User.status, User.created_at, User.updated_at)
                ).one()
                connection.execute(insert(User).values(display_name="Null Username One"))
                connection.execute(insert(User).values(display_name="Null Username Two"))

            assert isinstance(row.id, UUID)
            assert row.status is UserStatus.ACTIVE
            assert isinstance(row.created_at, datetime)
            assert row.created_at.tzinfo is not None
            assert isinstance(row.updated_at, datetime)
            assert row.updated_at.tzinfo is not None

            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(insert(User).values(display_name="Duplicate", username="ada"))
        finally:
            engine.dispose()

        command.downgrade(config, BASELINE_REVISION)

        engine = create_engine(database_url, poolclass=NullPool)
        try:
            assert inspect(engine).get_table_names() == ["alembic_version"]
            with engine.connect() as connection:
                assert (
                    connection.scalar(
                        text("SELECT count(*) FROM pg_type WHERE typname = 'user_status'")
                    )
                    == 0
                )
                assert connection.scalar(text("SELECT version_num FROM alembic_version")) == (
                    BASELINE_REVISION
                )
        finally:
            engine.dispose()
