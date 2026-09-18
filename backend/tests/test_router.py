import asyncio

from httpx2 import ASGITransport, AsyncClient, Response

from app.core.config import Settings
from app.main import create_app

DATABASE_URL = "postgresql+psycopg://outpost:local-password@127.0.0.1:5433/outpost"


async def get_response(path: str) -> Response:
    settings = Settings(database_url=DATABASE_URL, _env_file=None)
    app = create_app(settings, configure_logs=False)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.get(path)


def test_versioned_api_router_is_mounted_at_api_v1() -> None:
    response = asyncio.run(get_response("/api/v1"))

    assert response.status_code == 200
    assert response.json() == {"name": "Outpost API", "version": "v1"}
    assert "X-Request-ID" in response.headers


def test_only_product_api_routes_appear_in_openapi_schema() -> None:
    response = asyncio.run(get_response("/openapi.json"))

    assert response.status_code == 200
    paths = response.json()["paths"]
    assert "/api/v1" in paths
    assert "/health" not in paths
    assert "/ready" not in paths


def test_unknown_api_version_uses_structured_not_found_error() -> None:
    response = asyncio.run(get_response("/api/v2"))

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert response.json()["error"]["request_id"] == response.headers["X-Request-ID"]
