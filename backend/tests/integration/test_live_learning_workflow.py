"""An organization-owned roadmap and cohort can carry real student progress."""

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
def learning_app(monkeypatch: pytest.MonkeyPatch) -> Iterator[FastAPI]:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", url.render_as_string(False))
        monkeypatch.setenv(
            "OUTPOST_AUTH_SIGNING_KEY", "test-only-signing-key-with-at-least-32-bytes"
        )
        command.upgrade(migration_config(), "head")
        engine = create_engine(url, hide_parameters=True)
        app = create_app(
            Settings(database_url=url.render_as_string(False), _env_file=None),
            engine=engine,
            configure_logs=False,
        )
        try:
            yield app
        finally:
            engine.dispose()


async def register(client: AsyncClient, name: str, role: str) -> dict[str, str]:
    username = name.lower()
    body = {
        "display_name": name,
        "username": username,
        "email": f"{username}@example.edu",
        "password": "a long review passphrase",
        "account_type": role,
    }
    response = await client.post("/api/v1/auth/password/register", json=body)
    assert response.status_code == 201, response.text
    login = await client.post(
        "/api/v1/auth/password/login",
        json={"identifier": username, "password": body["password"]},
    )
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_live_roadmap_cohort_join_and_progress(learning_app: FastAPI) -> None:
    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(learning_app), base_url="https://testserver"
        ) as client:
            coordinator = await register(client, "Cora", "coordinator")
            student = await register(client, "Mira", "student")
            unassigned = await register(client, "Nia", "student")
            outsider = await register(client, "Other", "coordinator")

            denied = await client.post(
                "/api/v1/organizations", json={"name": "Campus"}, headers=student
            )
            assert denied.status_code == 403
            org = await client.post(
                "/api/v1/organizations", json={"name": "Campus"}, headers=coordinator
            )
            assert org.status_code == 201, org.text
            org_id = org.json()["id"]
            assert org.json()["role"] == "owner"
            assert (
                await client.get(f"/api/v1/organizations/{org_id}/roadmaps", headers=outsider)
            ).status_code == 403

            roadmap = await client.post(
                f"/api/v1/organizations/{org_id}/roadmaps",
                json={
                    "name": "Career readiness",
                    "description": "First-year path",
                    "topics": [
                        {"title": "Set goals", "description": "Choose two roles"},
                        {"title": "Build portfolio", "description": "Show a project"},
                    ],
                },
                headers=coordinator,
            )
            assert roadmap.status_code == 201, roadmap.text
            roadmap_data = roadmap.json()
            assert roadmap_data["version_number"] == 1
            assert len(roadmap_data["topics"]) == 2

            cohort = await client.post(
                f"/api/v1/organizations/{org_id}/cohorts",
                json={"name": "2026 cohort", "roadmap_version_id": roadmap_data["version_id"]},
                headers=coordinator,
            )
            assert cohort.status_code == 201, cohort.text
            cohort_data = cohort.json()
            cohort_id = cohort_data["id"]
            assert cohort_data["invite_code"]
            assert (
                await client.get(f"/api/v1/cohorts/{cohort_id}/progress", headers=outsider)
            ).status_code == 403
            other_org = await client.post(
                "/api/v1/organizations", json={"name": "Other Campus"}, headers=outsider
            )
            assert other_org.status_code == 201
            cross_tenant = await client.post(
                f"/api/v1/organizations/{other_org.json()['id']}/cohorts",
                json={"name": "Wrong roadmap", "roadmap_version_id": roadmap_data["version_id"]},
                headers=outsider,
            )
            assert cross_tenant.status_code == 404
            assert (
                await client.post(
                    "/api/v1/cohorts/join",
                    json={"invite_code": cohort_data["invite_code"]},
                    headers=coordinator,
                )
            ).status_code == 403

            joined = await client.post(
                "/api/v1/cohorts/join",
                json={"invite_code": cohort_data["invite_code"]},
                headers=student,
            )
            assert joined.status_code == 200, joined.text
            assert joined.json()["cohort_id"] == cohort_id
            assert (
                await client.post(
                    "/api/v1/cohorts/join",
                    json={"invite_code": "x" * 32},
                    headers=student,
                )
            ).status_code == 404
            assert (
                await client.post(
                    "/api/v1/cohorts/join",
                    json={"invite_code": cohort_data["invite_code"]},
                    headers=student,
                )
            ).status_code == 200

            mine = await client.get("/api/v1/progress/me", headers=student)
            assert mine.status_code == 200, mine.text
            assert mine.json()[0]["completed"] == 0
            assert mine.json()[0]["total"] == 2
            assert [
                item["name"]
                for item in (await client.get("/api/v1/organizations", headers=student)).json()
            ] == ["Campus"]
            assert (
                await client.get(f"/api/v1/organizations/{org_id}/cohorts", headers=student)
            ).status_code == 403
            topic_id = mine.json()[0]["topics"][0]["id"]
            assert (
                await client.put(
                    f"/api/v1/progress/topics/{topic_id}",
                    json={"completed": True},
                    headers=unassigned,
                )
            ).status_code == 404
            report = await client.get(f"/api/v1/cohorts/{cohort_id}/progress", headers=coordinator)
            assert report.status_code == 200, report.text
            assert report.json()["students"][0]["completed"] == 0

            changed = await client.put(
                f"/api/v1/progress/topics/{topic_id}",
                json={"completed": True},
                headers=student,
            )
            assert changed.status_code == 204, changed.text
            assert (
                await client.put(
                    f"/api/v1/progress/topics/{roadmap_data['topics'][1]['id']}",
                    json={"completed": True},
                    headers=outsider,
                )
            ).status_code == 403
            assert (await client.get("/api/v1/progress/me", headers=student)).json()[0][
                "completed"
            ] == 1
            report = await client.get(f"/api/v1/cohorts/{cohort_id}/progress", headers=coordinator)
            assert report.json()["students"][0]["completed"] == 1
            assert report.json()["topics"][0]["completed"] == 1

            assert (
                await client.put(
                    f"/api/v1/progress/topics/{topic_id}",
                    json={"completed": True},
                    headers=coordinator,
                )
            ).status_code == 403
            assert (
                await client.get(f"/api/v1/cohorts/{cohort_id}/progress", headers=student)
            ).status_code == 403

    asyncio.run(exercise())
