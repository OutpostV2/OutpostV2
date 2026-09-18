"""Password authentication HTTP API."""

from contextlib import suppress
from ipaddress import ip_address

from fastapi import APIRouter, Request, Response

from app.modules.auth.dependencies import AuthSettings, CurrentAuth, DatabaseSession
from app.modules.auth.schemas import LoginInput, RegistrationInput, TokenOutput, UserOutput
from app.modules.auth.service import register_user
from app.modules.auth.sessions import COOKIE_PATH, REFRESH_COOKIE, REFRESH_SECONDS, password_login

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/password/register", response_model=UserOutput, status_code=201)
def register(data: RegistrationInput, session: DatabaseSession, response: Response) -> UserOutput:
    response.headers["Cache-Control"] = "no-store"
    return UserOutput.model_validate(register_user(session, data))


@router.post("/password/login", response_model=TokenOutput)
def login(
    data: LoginInput,
    session: DatabaseSession,
    settings: AuthSettings,
    request: Request,
    response: Response,
) -> TokenOutput:
    client_ip: str | None = None
    if request.client is not None:
        with suppress(ValueError):
            client_ip = str(ip_address(request.client.host))
    access, refresh = password_login(
        session,
        settings,
        data,
        user_agent=request.headers.get("user-agent", "")[:512] or None,
        ip_address=client_ip,
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    response.set_cookie(
        REFRESH_COOKIE,
        refresh,
        max_age=REFRESH_SECONDS,
        path=COOKIE_PATH,
        secure=True,
        httponly=True,
        samesite="strict",
    )
    return TokenOutput(access_token=access)


user_router = APIRouter(tags=["users"])


@user_router.get("/me", response_model=UserOutput)
def me(auth: CurrentAuth, response: Response) -> UserOutput:
    response.headers["Cache-Control"] = "no-store"
    return UserOutput.model_validate(auth[0])
