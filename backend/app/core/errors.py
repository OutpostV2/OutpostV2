"""Stable application error taxonomy and FastAPI response handlers."""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel


class ErrorPayload(BaseModel):
    """Machine-readable and human-readable API error information."""

    code: str
    message: str
    details: list[dict[str, Any]] | None = None


class ErrorResponse(BaseModel):
    """Stable top-level API error envelope."""

    error: ErrorPayload


class AppError(Exception):
    """Base class for expected application failures."""

    status_code = 400
    code = "application_error"

    def __init__(self, message: str, *, details: list[dict[str, Any]] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


class BadRequestError(AppError):
    """The request is syntactically valid but cannot be accepted."""

    status_code = 400
    code = "bad_request"


class UnauthorizedError(AppError):
    """Authentication is required or invalid."""

    status_code = 401
    code = "unauthorized"


class ForbiddenError(AppError):
    """The authenticated caller is not allowed to perform the action."""

    status_code = 403
    code = "forbidden"


class NotFoundError(AppError):
    """The requested resource does not exist or is not visible."""

    status_code = 404
    code = "not_found"


class ConflictError(AppError):
    """The request conflicts with current resource state."""

    status_code = 409
    code = "conflict"


def _response(
    status_code: int,
    code: str,
    message: str,
    *,
    details: list[dict[str, Any]] | None = None,
) -> JSONResponse:
    payload = ErrorResponse(error=ErrorPayload(code=code, message=message, details=details))
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(payload.model_dump(exclude_none=True)),
    )


async def app_error_handler(request: Request, error: AppError) -> JSONResponse:
    """Serialize an expected application failure."""

    del request
    return _response(error.status_code, error.code, error.message, details=error.details)


async def validation_error_handler(request: Request, error: RequestValidationError) -> JSONResponse:
    """Serialize request validation failures without echoing request bodies."""

    del request
    return _response(
        422,
        "validation_error",
        "Request validation failed",
        details=[dict(detail) for detail in error.errors()],
    )


async def unhandled_error_handler(request: Request, error: Exception) -> JSONResponse:
    """Return a safe response for unexpected failures."""

    del request, error
    return _response(500, "internal_error", "Internal server error")


async def _dispatch_app_error(request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, AppError):
        raise TypeError("AppError handler received an incompatible exception")
    return await app_error_handler(request, error)


async def _dispatch_validation_error(request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, RequestValidationError):
        raise TypeError("Validation handler received an incompatible exception")
    return await validation_error_handler(request, error)


def install_error_handlers(app: FastAPI) -> None:
    """Install the Outpost error contract on a FastAPI application."""

    app.add_exception_handler(AppError, _dispatch_app_error)
    app.add_exception_handler(RequestValidationError, _dispatch_validation_error)
    app.add_exception_handler(Exception, unhandled_error_handler)
