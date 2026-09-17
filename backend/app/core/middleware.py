"""Request-scoped middleware shared by the Outpost API."""

import logging
from contextvars import ContextVar
from time import perf_counter
from uuid import UUID, uuid4

from fastapi import FastAPI
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"
_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
_request_logger = logging.getLogger("outpost.request")


def get_request_id() -> str | None:
    """Return the request ID bound to the current request context."""

    return _request_id.get()


def _select_request_id(candidate: str | None) -> str:
    if candidate is not None:
        try:
            return str(UUID(candidate))
        except ValueError:
            pass
    return str(uuid4())


class RequestIdMiddleware:
    """Bind one trusted UUID request ID and echo it on the response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _select_request_id(Headers(scope=scope).get(REQUEST_ID_HEADER))
        scope.setdefault("state", {})["request_id"] = request_id
        token = _request_id.set(request_id)
        started_at = perf_counter()
        status_code = 500

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            _request_logger.info(
                "request.completed",
                extra={
                    "duration_ms": round((perf_counter() - started_at) * 1000, 3),
                    "method": scope["method"],
                    "path": scope["path"],
                    "status_code": status_code,
                },
            )
            _request_id.reset(token)


def install_request_id_middleware(app: FastAPI) -> None:
    """Install request ID handling on a FastAPI application."""

    app.add_middleware(RequestIdMiddleware)
