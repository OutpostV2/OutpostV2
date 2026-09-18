from uuid import uuid4

import pytest
from fastapi import FastAPI
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.core.errors import UnauthorizedError
from app.modules.auth import service
from app.modules.auth.models import PasswordCredential
from app.modules.auth.schemas import RegistrationInput
from app.modules.users.models import User, UserStatus
from tests.integration.test_password_registration import auth_app as auth_app

pytestmark = pytest.mark.integration


def test_login_resolves_email_username_and_hides_failure_reasons(
    auth_app: tuple[FastAPI, Engine],
) -> None:
    assert hasattr(service, "authenticate_password"), "Password verification service is missing"
    _, engine = auth_app
    secret = " exact password spaces "
    with Session(engine, expire_on_commit=False) as session:
        user = service.register_user(
            session,
            RegistrationInput(
                display_name="Login",
                username="login_user",
                email="login@example.com",
                password=secret,
            ),
        )
        user_id = user.id
    for identifier in (" LOGIN_USER ", "LOGIN@EXAMPLE.COM"):
        with Session(engine) as session:
            assert service.authenticate_password(session, identifier, secret).id == user_id
    for identifier, password in (
        ("missing", secret),
        ("login_user", "incorrect password"),
        ("not an identifier", secret),
        ("login_user", secret.strip()),
        ("login_user", "x" * 1025),
    ):
        with Session(engine) as session, pytest.raises(UnauthorizedError) as error:
            service.authenticate_password(session, identifier, password)
        assert str(error.value) == "Invalid credentials"
    for status in (UserStatus.SUSPENDED, UserStatus.DELETED):
        with Session(engine) as session, session.begin():
            stored_user = session.get(User, user_id)
            assert stored_user is not None
            stored_user.status = status
        with (
            Session(engine) as session,
            pytest.raises(UnauthorizedError, match="Invalid credentials"),
        ):
            service.authenticate_password(session, "login_user", secret)


def test_login_rejects_missing_and_corrupt_password_credentials(
    auth_app: tuple[FastAPI, Engine],
) -> None:
    assert hasattr(service, "authenticate_password"), "Password verification service is missing"
    _, engine = auth_app
    user_id = uuid4()
    with Session(engine) as session, session.begin():
        session.add(User(id=user_id, display_name="OAuth only", username="oauth_only"))
    with Session(engine) as session, pytest.raises(UnauthorizedError, match="Invalid credentials"):
        service.authenticate_password(session, "oauth_only", "some long password")
    with Session(engine) as session, session.begin():
        session.add(PasswordCredential(user_id=user_id, password_hash="corrupt-hash"))
    with Session(engine) as session, pytest.raises(UnauthorizedError, match="Invalid credentials"):
        service.authenticate_password(session, "oauth_only", "some long password")
