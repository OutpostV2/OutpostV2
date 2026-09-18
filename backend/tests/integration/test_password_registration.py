import asyncio
import os
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient
from sqlalchemy import Engine, create_engine, func, select
from sqlalchemy.orm import Session

from alembic import command
from app.core.config import Settings
from app.main import create_app
from app.modules.auth.models import PasswordCredential
from app.modules.users.models import User
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set"),
]


@pytest.fixture
def auth_app(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[FastAPI, Engine]]:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", url.render_as_string(False))
        command.upgrade(migration_config(), "head")
        engine = create_engine(url, hide_parameters=True)
        settings = Settings(database_url=url.render_as_string(False), _env_file=None)
        app = create_app(settings, engine=engine, configure_logs=False)
        try:
            yield app, engine
        finally:
            engine.dispose()


def test_registration_normalizes_and_persists_only_argon2_hash(
    auth_app: tuple[FastAPI, Engine],
) -> None:
    app, engine = auth_app

    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            response = await client.post(
                "/api/v1/auth/password/register",
                json={
                    "display_name": " Alice ",
                    "username": " Alice_1 ",
                    "email": " Alice@Example.com ",
                    "password": "a long simple passphrase",
                },
            )
        assert response.status_code == 201, response.text
        assert response.json()["username"] == "alice_1"
        assert "password" not in response.text
        assert "argon2" not in response.text

    asyncio.run(exercise())
    with Session(engine) as session:
        user = session.scalars(select(User)).one()
        credential = session.scalars(select(PasswordCredential)).one()
        assert user.primary_email == "alice@example.com"
        assert user.display_name == "Alice"
        assert credential.user_id == user.id
        assert credential.password_hash.startswith("$argon2id$")
        from argon2 import PasswordHasher

        assert PasswordHasher().verify(credential.password_hash, "a long simple passphrase")


def test_registration_rejects_duplicates_and_never_echoes_secrets(
    auth_app: tuple[FastAPI, Engine],
) -> None:
    app, engine = auth_app

    async def exercise() -> None:
        body = {
            "display_name": "Alice",
            "username": "alice",
            "email": "alice@example.com",
            "password": "a long simple passphrase",
        }
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            assert (
                await client.post("/api/v1/auth/password/register", json=body)
            ).status_code == 201
            for changes in (
                {"username": "other", "email": "ALICE@EXAMPLE.COM"},
                {"username": "ALICE", "email": "other@example.com"},
            ):
                response = await client.post("/api/v1/auth/password/register", json=body | changes)
                assert response.status_code == 409
            for secret in ("shortsecret", "x" * 1025):
                response = await client.post(
                    "/api/v1/auth/password/register", json=body | {"password": secret}
                )
                assert response.status_code == 422
                assert secret not in response.text
                assert "input" not in response.text
            response = await client.post(
                "/api/v1/auth/password/register", json=body | {"email": "bad"}
            )
            assert response.status_code == 422

    asyncio.run(exercise())
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1
        assert session.scalar(select(func.count()).select_from(PasswordCredential)) == 1


def test_registration_rolls_back_when_credential_write_fails(
    auth_app: tuple[FastAPI, Engine],
) -> None:
    from sqlalchemy import event

    from app.modules.auth.schemas import RegistrationInput
    from app.modules.auth.service import register_user

    _, engine = auth_app

    def fail_credential(*args: object) -> None:
        raise RuntimeError("injected credential write failure")

    data = RegistrationInput(
        display_name="Atomic",
        username="atomic",
        email="atomic@example.com",
        password="unmodified passphrase",
    )
    event.listen(PasswordCredential, "before_insert", fail_credential)
    try:
        with (
            Session(engine, expire_on_commit=False) as session,
            pytest.raises(RuntimeError, match="injected credential"),
        ):
            register_user(session, data)
    finally:
        event.remove(PasswordCredential, "before_insert", fail_credential)
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 0


def test_concurrent_registration_cannot_duplicate_an_email(
    auth_app: tuple[FastAPI, Engine],
) -> None:
    from concurrent.futures import ThreadPoolExecutor

    from app.core.errors import ConflictError
    from app.modules.auth.schemas import RegistrationInput
    from app.modules.auth.service import register_user

    _, engine = auth_app

    def attempt(number: int) -> bool:
        with Session(engine, expire_on_commit=False) as session:
            try:
                register_user(
                    session,
                    RegistrationInput(
                        display_name="Race",
                        username=f"race_{number}",
                        email="race@example.com",
                        password="long concurrent passphrase",
                    ),
                )
                return True
            except ConflictError:
                return False

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(attempt, (1, 2))) == [False, True]
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1
        assert session.scalar(select(func.count()).select_from(PasswordCredential)) == 1


def test_login_identifier_migration_rolls_back(auth_app: tuple[FastAPI, Engine]) -> None:
    from sqlalchemy import inspect

    _, engine = auth_app
    assert "uq_users_primary_email_lower" in {
        index["name"] for index in inspect(engine).get_indexes("users")
    }
    command.downgrade(migration_config(), "20260918_0010")
    assert "uq_users_primary_email_lower" not in {
        index["name"] for index in inspect(engine).get_indexes("users")
    }
    command.upgrade(migration_config(), "head")
