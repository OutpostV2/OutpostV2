"""FastAPI application factory and operational endpoints."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel
from sqlalchemy import Engine, text
from sqlalchemy.exc import SQLAlchemyError

from app import __version__
from app.core.config import Settings
from app.core.errors import ServiceUnavailableError, install_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import install_request_id_middleware
from app.db.session import create_engine_from_settings


class OperationalStatus(BaseModel):
    """Liveness or readiness status returned to operators."""

    status: Literal["healthy", "ready"]


def create_app(
    settings: Settings,
    *,
    engine: Engine | None = None,
    configure_logs: bool = True,
) -> FastAPI:
    """Build the Outpost API with its verified core infrastructure."""

    if configure_logs:
        configure_logging(settings)

    owns_engine = engine is None
    database_engine = engine or create_engine_from_settings(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        if owns_engine:
            database_engine.dispose()

    app = FastAPI(title="Outpost API", version=__version__, lifespan=lifespan)
    app.state.database_engine = database_engine
    install_error_handlers(app)
    install_request_id_middleware(app)

    @app.get("/health", response_model=OperationalStatus, include_in_schema=False)
    def health() -> OperationalStatus:
        return OperationalStatus(status="healthy")

    @app.get("/ready", response_model=OperationalStatus, include_in_schema=False)
    def readiness() -> OperationalStatus:
        try:
            with database_engine.connect() as connection:
                connection.execute(text("SELECT 1")).scalar_one()
        except SQLAlchemyError as error:
            raise ServiceUnavailableError("Database is unavailable") from error
        return OperationalStatus(status="ready")

    return app
