import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, delete, insert, inspect, select
from sqlalchemy.pool import NullPool

from alembic import command
from app.modules.auth.models import AuthSession, SecurityEvent
from app.modules.users.models import User
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")


@pytest.mark.integration
@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_security_events_retain_audit_data_after_principal_deletion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as database_url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", database_url.render_as_string(False))
        config = migration_config()
        command.upgrade(config, "20260918_0010")
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            inspector = inspect(engine)
            columns = {c["name"]: c for c in inspector.get_columns("security_events")}
            assert set(columns) == {
                "id",
                "user_id",
                "session_id",
                "event_type",
                "occurred_at",
                "ip_address",
                "user_agent",
                "event_metadata",
            }
            foreign_keys = {
                fk["constrained_columns"][0]: fk
                for fk in inspector.get_foreign_keys("security_events")
            }
            assert foreign_keys["user_id"]["options"]["ondelete"] == "SET NULL"
            assert foreign_keys["session_id"]["options"]["ondelete"] == "SET NULL"
            now = datetime.now(UTC)
            with engine.begin() as connection:
                user_id = connection.scalar(
                    insert(User).values(display_name="Audit User").returning(User.id)
                )
                session_id = connection.scalar(
                    insert(AuthSession)
                    .values(
                        user_id=user_id,
                        token_family_id=uuid4(),
                        refresh_token_hash="sha256:audit-session",
                        expires_at=now + timedelta(days=1),
                    )
                    .returning(AuthSession.id)
                )
                event_id = connection.scalar(
                    insert(SecurityEvent)
                    .values(
                        user_id=user_id,
                        session_id=session_id,
                        event_type="authentication.succeeded",
                        ip_address="203.0.113.8",
                        event_data={"method": "password"},
                    )
                    .returning(SecurityEvent.id)
                )
                connection.execute(delete(User).where(User.id == user_id))
                event = connection.execute(
                    select(SecurityEvent).where(SecurityEvent.id == event_id)
                ).one()
            assert event.user_id is None
            assert event.session_id is None
            assert event.event_type == "authentication.succeeded"
            assert event.event_metadata == {"method": "password"}
            assert event.occurred_at.tzinfo is not None
        finally:
            engine.dispose()
        command.downgrade(config, "20260918_0009")
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            assert "security_events" not in inspect(engine).get_table_names()
        finally:
            engine.dispose()
