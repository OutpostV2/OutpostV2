"""Password authentication HTTP API."""

from fastapi import APIRouter, Response

from app.modules.auth.dependencies import DatabaseSession
from app.modules.auth.schemas import RegistrationInput, UserOutput
from app.modules.auth.service import register_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/password/register", response_model=UserOutput, status_code=201)
def register(data: RegistrationInput, session: DatabaseSession, response: Response) -> UserOutput:
    response.headers["Cache-Control"] = "no-store"
    return UserOutput.model_validate(register_user(session, data))
