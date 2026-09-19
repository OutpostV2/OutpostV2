"""Password authentication HTTP API."""

from contextlib import suppress
from ipaddress import ip_address
from uuid import UUID

from fastapi import APIRouter, Request, Response

from app.core.errors import UnauthorizedError
from app.modules.auth.dependencies import (
    AuthSettings,
    CurrentAuth,
    DatabaseSession,
    OutboundEmail,
)
from app.modules.auth.email_verification import (
    confirm_email_verification,
    request_email_verification,
)
from app.modules.auth.password_reset import request_password_reset, reset_password
from app.modules.auth.schemas import (
    EmailVerificationConfirmInput,
    EmailVerificationRequestInput,
    ForgotPasswordInput,
    LoginInput,
    PasswordResetInput,
    RegistrationInput,
    SessionOutput,
    TokenOutput,
    UserOutput,
)
from app.modules.auth.service import register_user
from app.modules.auth.sessions import (
    COOKIE_PATH,
    REFRESH_COOKIE,
    REFRESH_SECONDS,
    list_active_sessions,
    password_login,
    revoke_all_sessions,
    revoke_current_session,
    revoke_owned_session,
    rotate_refresh_session,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_ip(request: Request) -> str | None:
    if request.client is not None:
        with suppress(ValueError):
            return str(ip_address(request.client.host))
    return None


def _set_refresh_cookie(response: Response, refresh: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        refresh,
        max_age=REFRESH_SECONDS,
        path=COOKIE_PATH,
        secure=True,
        httponly=True,
        samesite="strict",
    )


@router.post("/password/register", response_model=UserOutput, status_code=201)
def register(data: RegistrationInput, session: DatabaseSession, response: Response) -> UserOutput:
    response.headers["Cache-Control"] = "no-store"
    return UserOutput.model_validate(register_user(session, data))


@router.post("/email-verification/request", status_code=202)
def request_verification(
    data: EmailVerificationRequestInput,
    session: DatabaseSession,
    settings: AuthSettings,
    provider: OutboundEmail,
) -> Response:
    request_email_verification(session, settings, provider, data.email)
    return Response(status_code=202, headers={"Cache-Control": "no-store"})


@router.post("/email-verification/confirm", status_code=204)
def confirm_verification(
    data: EmailVerificationConfirmInput,
    session: DatabaseSession,
) -> Response:
    confirm_email_verification(session, data.token.get_secret_value())
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.post("/password/forgot", status_code=202)
def forgot_password(
    data: ForgotPasswordInput,
    session: DatabaseSession,
    settings: AuthSettings,
    provider: OutboundEmail,
) -> Response:
    request_password_reset(session, settings, provider, data.email)
    return Response(status_code=202, headers={"Cache-Control": "no-store"})


@router.post("/password/reset", status_code=204)
def consume_password_reset(
    data: PasswordResetInput,
    session: DatabaseSession,
) -> Response:
    reset_password(
        session,
        data.token.get_secret_value(),
        data.password.get_secret_value(),
    )
    response = Response(status_code=204, headers={"Cache-Control": "no-store"})
    response.delete_cookie(
        REFRESH_COOKIE,
        path=COOKIE_PATH,
        secure=True,
        httponly=True,
        samesite="strict",
    )
    return response


@router.post("/password/login", response_model=TokenOutput)
def login(
    data: LoginInput,
    session: DatabaseSession,
    settings: AuthSettings,
    request: Request,
    response: Response,
) -> TokenOutput:
    access, refresh = password_login(
        session,
        settings,
        data,
        user_agent=request.headers.get("user-agent", "")[:512] or None,
        ip_address=_client_ip(request),
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    _set_refresh_cookie(response, refresh)
    return TokenOutput(access_token=access)


@router.post("/refresh", response_model=TokenOutput)
def refresh(
    session: DatabaseSession,
    settings: AuthSettings,
    request: Request,
    response: Response,
) -> TokenOutput:
    refresh_token = request.cookies.get(REFRESH_COOKIE)
    if not refresh_token:
        raise UnauthorizedError("Invalid or expired refresh credential")
    access, next_refresh = rotate_refresh_session(
        session,
        settings,
        refresh_token,
        user_agent=request.headers.get("user-agent", "")[:512] or None,
        ip_address=_client_ip(request),
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    _set_refresh_cookie(response, next_refresh)
    return TokenOutput(access_token=access)


@router.get("/sessions", response_model=list[SessionOutput])
def sessions(
    auth: CurrentAuth,
    session: DatabaseSession,
    response: Response,
) -> list[SessionOutput]:
    response.headers["Cache-Control"] = "no-store"
    current_session = auth[1]
    return [
        SessionOutput(
            id=item.id,
            created_at=item.created_at,
            last_used_at=item.last_used_at,
            expires_at=item.expires_at,
            user_agent=item.user_agent,
            ip_address=str(item.ip_address) if item.ip_address is not None else None,
            is_current=item.id == current_session.id,
        )
        for item in list_active_sessions(session, auth[0].id)
    ]


@router.delete("/sessions/{session_id}", status_code=204)
def revoke_session(
    session_id: UUID,
    auth: CurrentAuth,
    session: DatabaseSession,
) -> Response:
    is_current = session_id == auth[1].id
    revoke_owned_session(
        session,
        auth[0].id,
        session_id,
        is_current=is_current,
    )
    response = Response(status_code=204, headers={"Cache-Control": "no-store"})
    if is_current:
        response.delete_cookie(
            REFRESH_COOKIE,
            path=COOKIE_PATH,
            secure=True,
            httponly=True,
            samesite="strict",
        )
    return response


@router.post("/logout-all", status_code=204)
def logout_all(auth: CurrentAuth, session: DatabaseSession) -> Response:
    revoke_all_sessions(
        session,
        auth[0].id,
        current_session_id=auth[1].id,
    )
    response = Response(status_code=204, headers={"Cache-Control": "no-store"})
    response.delete_cookie(
        REFRESH_COOKIE,
        path=COOKIE_PATH,
        secure=True,
        httponly=True,
        samesite="strict",
    )
    return response


user_router = APIRouter(tags=["users"])


@user_router.get("/me", response_model=UserOutput)
def me(auth: CurrentAuth, response: Response) -> UserOutput:
    response.headers["Cache-Control"] = "no-store"
    return UserOutput.model_validate(auth[0])


@router.post("/logout", status_code=204)
def logout(auth: CurrentAuth, session: DatabaseSession) -> Response:
    revoke_current_session(session, auth[1])
    response = Response(status_code=204, headers={"Cache-Control": "no-store"})
    response.delete_cookie(
        REFRESH_COOKIE,
        path=COOKIE_PATH,
        secure=True,
        httponly=True,
        samesite="strict",
    )
    return response
