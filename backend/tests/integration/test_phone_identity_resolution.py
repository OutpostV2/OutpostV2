import os
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest
from sqlalchemy import Engine, create_engine, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from alembic import command
from app.core.errors import UnauthorizedError
from app.modules.auth.models import PhoneIdentity
from app.modules.auth.phone_identities import resolve_or_create_phone_user
from app.modules.users.models import User, UserStatus
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")
pytestmark = pytest.mark.integration


@pytest.fixture
def phone_engine(monkeypatch: pytest.MonkeyPatch) -> Iterator[Engine]:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as database_url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", database_url.render_as_string(False))
        command.upgrade(migration_config(), "head")
        engine = create_engine(database_url, poolclass=NullPool)
        try:
            yield engine
        finally:
            engine.dispose()


@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_phone_identity_resolution_creates_then_reuses_verified_identity(
    phone_engine: Engine,
) -> None:
    first_verified_at = datetime(2026, 9, 20, 12, 0, tzinfo=UTC)
    with Session(phone_engine, expire_on_commit=False) as session, session.begin():
        first = resolve_or_create_phone_user(session, "+14155552671", first_verified_at)
        first_id = first.id

    with Session(phone_engine, expire_on_commit=False) as session, session.begin():
        second = resolve_or_create_phone_user(
            session,
            "+14155552671",
            datetime(2026, 9, 20, 12, 5, tzinfo=UTC),
        )
        assert second.id == first_id

    with Session(phone_engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1
        identity = session.scalars(select(PhoneIdentity)).one()
        assert identity.user_id == first_id
        assert identity.phone_e164 == "+14155552671"
        assert identity.verified_at == first_verified_at


@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_phone_identity_resolution_rejects_inactive_user(phone_engine: Engine) -> None:
    verified_at = datetime(2026, 9, 20, 12, 0, tzinfo=UTC)
    with Session(phone_engine, expire_on_commit=False) as session, session.begin():
        user = resolve_or_create_phone_user(session, "+14155552671", verified_at)
        user.status = UserStatus.SUSPENDED

    with (
        Session(phone_engine) as session,
        pytest.raises(UnauthorizedError, match="Invalid or expired OTP"),
        session.begin(),
    ):
        resolve_or_create_phone_user(session, "+14155552671", verified_at)


@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_phone_identity_resolution_serializes_concurrent_creation(phone_engine: Engine) -> None:
    verified_at = datetime(2026, 9, 20, 12, 0, tzinfo=UTC)

    def resolve(_: int) -> object:
        with Session(phone_engine, expire_on_commit=False) as session, session.begin():
            return resolve_or_create_phone_user(session, "+14155552671", verified_at).id

    with ThreadPoolExecutor(max_workers=2) as executor:
        user_ids = list(executor.map(resolve, range(2)))

    assert user_ids[0] == user_ids[1]
    with Session(phone_engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1
        assert session.scalar(select(func.count()).select_from(PhoneIdentity)) == 1
