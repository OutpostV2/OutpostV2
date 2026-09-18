"""Transactional password account operations."""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ConflictError
from app.modules.auth.models import PasswordCredential
from app.modules.auth.passwords import hash_password
from app.modules.auth.schemas import RegistrationInput
from app.modules.users.models import User


def register_user(session: Session, data: RegistrationInput) -> User:
    """Commit the user and password credential together or preserve neither."""
    password_hash = hash_password(data.password.get_secret_value())
    try:
        with session.begin():
            user = User(
                display_name=data.display_name,
                username=data.username,
                primary_email=data.email,
            )
            session.add(user)
            session.flush()
            session.add(PasswordCredential(user_id=user.id, password_hash=password_hash))
        return user
    except IntegrityError as error:
        # Only expected uniqueness conflicts become a public conflict response.
        if getattr(error.orig, "sqlstate", None) == "23505":
            raise ConflictError("Registration cannot be completed with these identifiers") from None
        raise
