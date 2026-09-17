import asyncio
import json
import logging
from io import StringIO

from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient

from app.core.config import LogLevel, Settings
from app.core.logging import JsonFormatter, configure_logging
from app.core.middleware import REQUEST_ID_HEADER, install_request_id_middleware

DATABASE_URL = "postgresql+psycopg://outpost:local-password@127.0.0.1:5433/outpost"


def test_json_formatter_emits_stable_fields_and_structured_extras() -> None:
    record = logging.LogRecord(
        name="outpost.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="operation.completed",
        args=(),
        exc_info=None,
    )
    record.organization_id = "org-123"

    payload = json.loads(JsonFormatter().format(record))

    assert payload["level"] == "INFO"
    assert payload["logger"] == "outpost.test"
    assert payload["message"] == "operation.completed"
    assert payload["organization_id"] == "org-123"
    assert payload["timestamp"].endswith("+00:00")


def test_configure_logging_applies_the_configured_level() -> None:
    root_logger = logging.getLogger()
    original_handlers = root_logger.handlers[:]
    original_level = root_logger.level
    settings = Settings(
        database_url=DATABASE_URL,
        log_level=LogLevel.DEBUG,
        _env_file=None,
    )

    try:
        configure_logging(settings)

        assert root_logger.level == logging.DEBUG
        assert len(root_logger.handlers) == 1
        assert isinstance(root_logger.handlers[0].formatter, JsonFormatter)
    finally:
        root_logger.handlers = original_handlers
        root_logger.setLevel(original_level)


async def request_logged_endpoint(request_id: str) -> tuple[str, str]:
    app = FastAPI()
    install_request_id_middleware(app)

    @app.get("/logged")
    def logged() -> dict[str, bool]:
        return {"ok": True}

    stream = StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    request_logger = logging.getLogger("outpost.request")
    original_handlers = request_logger.handlers[:]
    original_level = request_logger.level
    original_propagate = request_logger.propagate
    request_logger.handlers = [handler]
    request_logger.setLevel(logging.INFO)
    request_logger.propagate = False

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.get("/logged", headers={REQUEST_ID_HEADER: request_id})
        return response.headers[REQUEST_ID_HEADER], stream.getvalue()
    finally:
        request_logger.handlers = original_handlers
        request_logger.setLevel(original_level)
        request_logger.propagate = original_propagate


def test_request_completion_log_contains_request_context() -> None:
    request_id = "718d28c7-b397-4a8f-972c-67556619fbe9"

    response_request_id, output = asyncio.run(request_logged_endpoint(request_id))
    payload = json.loads(output)

    assert response_request_id == request_id
    assert payload["message"] == "request.completed"
    assert payload["request_id"] == request_id
    assert payload["method"] == "GET"
    assert payload["path"] == "/logged"
    assert payload["status_code"] == 200
    assert payload["duration_ms"] >= 0
