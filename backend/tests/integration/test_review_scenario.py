"""PostgreSQL-backed review scenario behavior and access checks."""

import asyncio
import os
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient
from sqlalchemy import create_engine

from alembic import command
from app.core.config import Settings
from app.main import create_app
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set"),
]


@pytest.fixture
def review_app(monkeypatch: pytest.MonkeyPatch) -> Iterator[FastAPI]:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", url.render_as_string(False))
        monkeypatch.setenv(
            "OUTPOST_AUTH_SIGNING_KEY", "test-only-signing-key-with-at-least-32-bytes"
        )
        command.upgrade(migration_config(), "head")
        engine = create_engine(url, hide_parameters=True)
        settings = Settings(database_url=url.render_as_string(False), _env_file=None)
        app = create_app(settings, engine=engine, configure_logs=False)
        try:
            yield app
        finally:
            engine.dispose()


def test_review_progress_is_authenticated_persistent_and_user_scoped(review_app: FastAPI) -> None:
    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(review_app), base_url="https://testserver"
        ) as client:
            assert (await client.get("/api/v1/review/overview")).status_code == 401
            tokens = []
            for name, username in (("Mira Student", "mira"), ("Dev Student", "dev")):
                registration = await client.post(
                    "/api/v1/auth/password/register",
                    json={
                        "display_name": name,
                        "username": username,
                        "email": f"{username}@example.edu",
                        "password": "review test passphrase",
                    },
                )
                assert registration.status_code == 201, registration.text
                login = await client.post(
                    "/api/v1/auth/password/login",
                    json={"identifier": username, "password": "review test passphrase"},
                )
                assert login.status_code == 200, login.text
                tokens.append(login.json()["access_token"])

            mira = {"Authorization": f"Bearer {tokens[0]}"}
            dev = {"Authorization": f"Bearer {tokens[1]}"}
            initial = await client.get("/api/v1/review/overview", headers=mira)
            assert initial.status_code == 200, initial.text
            assert initial.headers["Cache-Control"] == "no-store"
            assert initial.json()["scenario"] == "illustrative"
            assert initial.json()["student"]["completed"] == 0
            assert initial.json()["coordinator"] is None

            updated = await client.put(
                "/api/v1/review/progress/goals", json={"completed": True}, headers=mira
            )
            assert updated.status_code == 200, updated.text
            assert updated.json()["student"]["completed"] == 1
            assert updated.json()["coordinator"] is None
            assert (await client.get("/api/v1/review/overview", headers=mira)).json()["student"][
                "completed"
            ] == 1
            assert (await client.get("/api/v1/review/overview", headers=dev)).json()["student"][
                "completed"
            ] == 0
            assert (
                await client.put(
                    "/api/v1/review/progress/unknown", json={"completed": True}, headers=mira
                )
            ).status_code == 404
            assert (await client.delete("/api/v1/review/progress", headers=mira)).status_code == 204
            assert (await client.get("/api/v1/review/overview", headers=mira)).json()["student"][
                "completed"
            ] == 0

    asyncio.run(exercise())


def test_account_types_limit_review_data_and_progress(review_app: FastAPI) -> None:
    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(review_app), base_url="https://testserver"
        ) as client:
            headers = {}
            for role in ("student", "coordinator"):
                response = await client.post(
                    "/api/v1/auth/password/register",
                    json={
                        "display_name": role.title(),
                        "username": role,
                        "email": f"{role}@example.edu",
                        "password": "review test passphrase",
                        "account_type": role,
                    },
                )
                assert response.status_code == 201, response.text
                assert response.json()["account_type"] == role
                login = await client.post(
                    "/api/v1/auth/password/login",
                    json={"identifier": role, "password": "review test passphrase"},
                )
                headers[role] = {"Authorization": f"Bearer {login.json()['access_token']}"}
                me = await client.get("/api/v1/me", headers=headers[role])
                assert me.json()["account_type"] == role

            student = await client.get("/api/v1/review/overview", headers=headers["student"])
            coordinator = await client.get(
                "/api/v1/review/overview", headers=headers["coordinator"]
            )
            assert student.status_code == 200
            assert student.json()["coordinator"] is None
            assert coordinator.status_code == 200
            assert coordinator.json()["coordinator"] is not None
            assert (
                await client.put(
                    "/api/v1/review/progress/goals",
                    json={"completed": True},
                    headers=headers["coordinator"],
                )
            ).status_code == 403
            assert (
                await client.delete("/api/v1/review/progress", headers=headers["coordinator"])
            ).status_code == 403

    asyncio.run(exercise())
