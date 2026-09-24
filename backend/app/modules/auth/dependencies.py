"""Request-scoped authentication database dependencies."""

from collections.abc import Iterator
from typing import Annotated, cast

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import UnauthorizedError
from app.modules.auth.email import EmailProvider
from app.modules.auth.google import GoogleOidcProvider, OAuthStateStore
from app.modules.auth.models import AuthSession
from app.modules.auth.rate_limits import OtpRequestRateLimiter
from app.modules.auth.sessions import authenticated_session
from app.modules.auth.sms import SmsProvider
from app.modules.users.models import User


def database_session(request: Request) -> Iterator[Session]:
    with Session(request.app.state.database_engine, expire_on_commit=False) as session:
        yield session


DatabaseSession = Annotated[Session, Depends(database_session)]


def auth_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


AuthSettings = Annotated[Settings, Depends(auth_settings)]


def email_provider(request: Request) -> EmailProvider:
    return cast(EmailProvider, request.app.state.email_provider)


OutboundEmail = Annotated[EmailProvider, Depends(email_provider)]


def sms_provider(request: Request) -> SmsProvider:
    return cast(SmsProvider, request.app.state.sms_provider)


OutboundSms = Annotated[SmsProvider, Depends(sms_provider)]


def otp_rate_limiter(request: Request) -> OtpRequestRateLimiter:
    return cast(OtpRequestRateLimiter, request.app.state.otp_rate_limiter)


OtpRateLimits = Annotated[OtpRequestRateLimiter, Depends(otp_rate_limiter)]


def google_oauth_state_store(request: Request) -> OAuthStateStore:
    return cast(OAuthStateStore, request.app.state.google_oauth_state_store)


GoogleOAuthStates = Annotated[OAuthStateStore, Depends(google_oauth_state_store)]


def google_oidc_provider(request: Request) -> GoogleOidcProvider:
    return cast(GoogleOidcProvider, request.app.state.google_oidc_provider)


GoogleOidc = Annotated[GoogleOidcProvider, Depends(google_oidc_provider)]
_bearer = HTTPBearer(auto_error=False)


def current_auth(
    session: DatabaseSession,
    settings: AuthSettings,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> tuple[User, AuthSession]:
    if credentials is None:
        raise UnauthorizedError("Authentication required")
    return authenticated_session(session, settings, credentials.credentials)


CurrentAuth = Annotated[tuple[User, AuthSession], Depends(current_auth)]
