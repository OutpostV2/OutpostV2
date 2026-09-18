import os

import pytest
from sqlalchemy import create_engine, insert, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import NullPool

from alembic import command
from app.modules.auth.models import OAuthIdentity
from app.modules.users.models import User
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")


@pytest.mark.integration
@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_oauth_identity_uses_stable_subject_and_is_reversible(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as database_url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", database_url.render_as_string(False))
        config = migration_config()
        command.upgrade(config, "20260918_0005")
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            inspector = inspect(engine)
            columns = {c["name"]: c for c in inspector.get_columns("oauth_identities")}
            assert set(columns) == {
                "id",
                "user_id",
                "provider",
                "provider_subject",
                "provider_email",
                "created_at",
            }
            assert columns["provider_email"]["nullable"] is True
            assert any(
                set(item["column_names"]) == {"provider", "provider_subject"}
                for item in inspector.get_unique_constraints("oauth_identities")
            )
            with engine.begin() as connection:
                user_id = connection.scalar(
                    insert(User).values(display_name="OAuth User").returning(User.id)
                )
                connection.execute(
                    insert(OAuthIdentity).values(
                        user_id=user_id,
                        provider="google",
                        provider_subject="stable-subject",
                        provider_email="first@example.com",
                    )
                )
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(
                    insert(OAuthIdentity).values(
                        user_id=user_id,
                        provider="google",
                        provider_subject="stable-subject",
                        provider_email="changed@example.com",
                    )
                )
        finally:
            engine.dispose()
        command.downgrade(config, "20260918_0004")
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            assert "oauth_identities" not in inspect(engine).get_table_names()
        finally:
            engine.dispose()
