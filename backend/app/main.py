"""FastAPI application factory and operational endpoints."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel
from sqlalchemy import Engine, text
from sqlalchemy.exc import SQLAlchemyError

from app import __version__
from app.api.v1.router import router as api_v1_router
from app.core.config import Settings
from app.core.errors import ServiceUnavailableError, install_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import install_request_id_middleware
from app.db.session import create_engine_from_settings
from app.infrastructure.valkey_oauth_state import ValkeyOAuthStateStore
from app.infrastructure.valkey_rate_limits import ValkeyFixedWindowRateLimiter
from app.modules.auth.email import EmailProvider, build_email_provider
from app.modules.auth.google import GoogleHttpOidcProvider, GoogleOidcProvider, OAuthStateStore
from app.modules.auth.rate_limits import OtpRequestRateLimiter
from app.modules.auth.sms import SmsProvider, build_sms_provider


class OperationalStatus(BaseModel):
    """Liveness or readiness status returned to operators."""

    status: Literal["healthy", "ready"]


def create_app(
    settings: Settings | None = None,
    *,
    engine: Engine | None = None,
    email_provider: EmailProvider | None = None,
    sms_provider: SmsProvider | None = None,
    otp_rate_limiter: OtpRequestRateLimiter | None = None,
    google_oauth_state_store: OAuthStateStore | None = None,
    google_oidc_provider: GoogleOidcProvider | None = None,
    configure_logs: bool = True,
) -> FastAPI:
    """Build the Outpost API with its verified core infrastructure."""

    application_settings = settings or Settings()
    if configure_logs:
        configure_logging(application_settings)

    owns_engine = engine is None
    database_engine = engine or create_engine_from_settings(application_settings)
    owns_otp_rate_limiter = otp_rate_limiter is None
    application_otp_rate_limiter = otp_rate_limiter or OtpRequestRateLimiter(
        ValkeyFixedWindowRateLimiter(str(application_settings.valkey_url)),
        application_settings,
    )
    owns_google_oauth_state_store = google_oauth_state_store is None
    application_google_oauth_state_store = google_oauth_state_store or ValkeyOAuthStateStore(
        str(application_settings.valkey_url)
    )
    application_google_oidc_provider = google_oidc_provider or GoogleHttpOidcProvider()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        if owns_otp_rate_limiter:
            application_otp_rate_limiter.close()
        if owns_google_oauth_state_store:
            application_google_oauth_state_store.close()
        if owns_engine:
            database_engine.dispose()

    app = FastAPI(title="Outpost API", version=__version__, lifespan=lifespan)
    app.state.database_engine = database_engine
    app.state.settings = application_settings
    app.state.otp_rate_limiter = application_otp_rate_limiter
    app.state.google_oauth_state_store = application_google_oauth_state_store
    app.state.google_oidc_provider = application_google_oidc_provider
    app.state.email_provider = (
        email_provider if email_provider is not None else build_email_provider(application_settings)
    )
    app.state.sms_provider = (
        sms_provider if sms_provider is not None else build_sms_provider(application_settings)
    )
    install_error_handlers(app)
    install_request_id_middleware(app)
    app.include_router(api_v1_router)

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
