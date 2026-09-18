"""Request-scoped authentication database dependencies."""

from collections.abc import Iterator
from typing import Annotated, cast

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import UnauthorizedError
from app.modules.auth.models import AuthSession
from app.modules.auth.sessions import authenticated_session
from app.modules.users.models import User


def database_session(request: Request) -> Iterator[Session]:
    with Session(request.app.state.database_engine, expire_on_commit=False) as session:
        yield session


DatabaseSession = Annotated[Session, Depends(database_session)]


def auth_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


AuthSettings = Annotated[Settings, Depends(auth_settings)]
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
