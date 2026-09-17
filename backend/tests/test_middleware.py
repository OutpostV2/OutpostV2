import asyncio
from uuid import UUID

from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient, Response

from app.core.errors import NotFoundError, install_error_handlers
from app.core.middleware import (
    REQUEST_ID_HEADER,
    get_request_id,
    install_request_id_middleware,
)


def create_test_app() -> FastAPI:
    app = FastAPI()
    install_error_handlers(app)
    install_request_id_middleware(app)

    @app.get("/request-id")
    def read_request_id() -> dict[str, str | None]:
        return {"request_id": get_request_id()}

    @app.get("/missing")
    def missing() -> None:
        raise NotFoundError("Resource was not found")

    return app


async def get_response(path: str, request_id: str | None = None) -> Response:
    transport = ASGITransport(app=create_test_app())
    headers = {REQUEST_ID_HEADER: request_id} if request_id is not None else None
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.get(path, headers=headers)


def test_request_id_is_generated_and_available_during_the_request() -> None:
    response = asyncio.run(get_response("/request-id"))

    request_id = response.headers[REQUEST_ID_HEADER]
    assert str(UUID(request_id)) == request_id
    assert response.json() == {"request_id": request_id}
    assert get_request_id() is None


def test_valid_incoming_request_id_is_preserved() -> None:
    request_id = "718d28c7-b397-4a8f-972c-67556619fbe9"

    response = asyncio.run(get_response("/request-id", request_id))

    assert response.headers[REQUEST_ID_HEADER] == request_id
    assert response.json() == {"request_id": request_id}


def test_invalid_incoming_request_id_is_replaced() -> None:
    response = asyncio.run(get_response("/request-id", "not-a-trusted-request-id"))

    generated_request_id = response.headers[REQUEST_ID_HEADER]
    assert generated_request_id != "not-a-trusted-request-id"
    assert str(UUID(generated_request_id)) == generated_request_id


def test_error_response_contains_the_request_id() -> None:
    response = asyncio.run(get_response("/missing"))

    request_id = response.headers[REQUEST_ID_HEADER]
    assert response.status_code == 404
    assert response.json()["error"]["request_id"] == request_id
