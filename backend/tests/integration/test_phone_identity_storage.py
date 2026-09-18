import os
from datetime import datetime

import pytest
from sqlalchemy import create_engine, insert, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import NullPool

from alembic import command
from app.modules.auth.models import PhoneIdentity
from app.modules.users.models import User
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")
PREVIOUS_REVISION = "20260918_0003"
REVISION = "20260918_0004"


@pytest.mark.integration
@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_phone_identities_are_unique_owned_and_reversible(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as database_url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", database_url.render_as_string(False))
        config = migration_config()
        command.upgrade(config, REVISION)
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            inspector = inspect(engine)
            columns = {
                column["name"]: column for column in inspector.get_columns("phone_identities")
            }
            assert set(columns) == {"id", "user_id", "phone_e164", "verified_at", "created_at"}
            assert columns["verified_at"]["nullable"] is True
            foreign_key = inspector.get_foreign_keys("phone_identities")[0]
            assert foreign_key["referred_table"] == "users"
            assert foreign_key["options"]["ondelete"] == "CASCADE"
            assert any(
                constraint["column_names"] == ["phone_e164"]
                for constraint in inspector.get_unique_constraints("phone_identities")
            )
            with engine.begin() as connection:
                first = connection.scalar(
                    insert(User).values(display_name="Phone One").returning(User.id)
                )
                second = connection.scalar(
                    insert(User).values(display_name="Phone Two").returning(User.id)
                )
                row = connection.execute(
                    insert(PhoneIdentity)
                    .values(user_id=first, phone_e164="+14155550100")
                    .returning(PhoneIdentity.created_at)
                ).one()
            assert isinstance(row.created_at, datetime)
            assert row.created_at.tzinfo is not None
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(
                    insert(PhoneIdentity).values(user_id=second, phone_e164="+14155550100")
                )
        finally:
            engine.dispose()
        command.downgrade(config, PREVIOUS_REVISION)
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            assert "phone_identities" not in inspect(engine).get_table_names()
            assert "password_credentials" in inspect(engine).get_table_names()
        finally:
            engine.dispose()
