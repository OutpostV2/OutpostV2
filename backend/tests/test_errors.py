import asyncio

from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient, Response

from app.core.errors import NotFoundError, install_error_handlers


def create_test_app() -> FastAPI:
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/resources/{resource_id}")
    def read_resource(resource_id: int) -> dict[str, int]:
        if resource_id == 404:
            raise NotFoundError("Resource was not found")
        if resource_id == 500:
            raise RuntimeError("sensitive implementation detail")
        return {"resource_id": resource_id}

    return app


async def get_response(path: str, *, raise_app_exceptions: bool = True) -> Response:
    transport = ASGITransport(
        app=create_test_app(),
        raise_app_exceptions=raise_app_exceptions,
    )
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.get(path)


def test_application_error_uses_the_stable_error_envelope() -> None:
    response = asyncio.run(get_response("/resources/404"))

    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found", "message": "Resource was not found"}}


def test_validation_error_uses_the_stable_error_envelope() -> None:
    response = asyncio.run(get_response("/resources/not-an-integer"))

    assert response.status_code == 422
    payload = response.json()
    assert payload["error"]["code"] == "validation_error"
    assert payload["error"]["message"] == "Request validation failed"
    assert payload["error"]["details"][0]["loc"] == ["path", "resource_id"]


def test_unhandled_error_hides_internal_details() -> None:
    response = asyncio.run(get_response("/resources/500", raise_app_exceptions=False))

    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "internal_error", "message": "Internal server error"}
    }
