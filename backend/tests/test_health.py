import asyncio

from httpx2 import ASGITransport, AsyncClient, Response

from app.core.config import Settings
from app.db.session import create_engine_from_settings
from app.main import create_app

UNAVAILABLE_DATABASE_URL = (
    "postgresql+psycopg://outpost:local-password@127.0.0.1:1/outpost?connect_timeout=1"
)


async def get_response(path: str) -> Response:
    settings = Settings(database_url=UNAVAILABLE_DATABASE_URL, _env_file=None)
    engine = create_engine_from_settings(settings)
    app = create_app(settings, engine=engine, configure_logs=False)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get(path)
    finally:
        engine.dispose()


def test_health_reports_liveness_without_database_access() -> None:
    response = asyncio.run(get_response("/health"))

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_readiness_returns_structured_failure_when_database_is_unavailable() -> None:
    response = asyncio.run(get_response("/ready"))

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "not_ready"
    assert response.json()["error"]["message"] == "Database is unavailable"
    assert response.json()["error"]["request_id"] == response.headers["X-Request-ID"]
