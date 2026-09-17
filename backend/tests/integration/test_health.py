import asyncio
import os

import pytest
from httpx2 import ASGITransport, AsyncClient

from app.core.config import Settings
from app.db.session import create_engine_from_settings
from app.main import create_app

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")


@pytest.mark.integration
@pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set")
def test_health_and_readiness_against_local_postgresql() -> None:
    assert DATABASE_URL is not None
    settings = Settings(database_url=DATABASE_URL, _env_file=None)
    engine = create_engine_from_settings(settings)
    app = create_app(settings, engine=engine, configure_logs=False)

    async def request_endpoints() -> tuple[int, dict[str, str], int, dict[str, str]]:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            health = await client.get("/health")
            readiness = await client.get("/ready")
        return health.status_code, health.json(), readiness.status_code, readiness.json()

    try:
        health_status, health_payload, readiness_status, readiness_payload = asyncio.run(
            request_endpoints()
        )
    finally:
        engine.dispose()

    assert health_status == 200
    assert health_payload == {"status": "healthy"}
    assert readiness_status == 200
    assert readiness_payload == {"status": "ready"}
