"""Transactional password account operations."""

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, UnauthorizedError
from app.modules.auth.models import PasswordCredential
from app.modules.auth.passwords import (
    DUMMY_PASSWORD_HASH,
    hash_password,
    password_hasher,
    verify_password,
)
from app.modules.auth.schemas import RegistrationInput, normalize_email, normalize_username
from app.modules.users.models import User, UserStatus


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


def authenticate_password(session: Session, identifier: str, password: str) -> User:
    """Verify credentials without disclosing account existence or lifecycle state."""
    try:
        normalized = (
            normalize_email(identifier) if "@" in identifier else normalize_username(identifier)
        )
    except ValueError:
        normalized = ""
    column = User.primary_email if "@" in identifier else User.username
    user = session.scalar(select(User).where(func.lower(column) == normalized).with_for_update())
    credential = session.get(PasswordCredential, user.id) if user is not None else None
    encoded = credential.password_hash if credential is not None else DUMMY_PASSWORD_HASH
    # Bound expensive work for oversized input without truncating an accepted password.
    candidate = password if 1 <= len(password) <= 1024 else ""
    valid = verify_password(encoded, candidate)
    if not valid or user is None or credential is None or user.status != UserStatus.ACTIVE:
        raise UnauthorizedError("Invalid credentials")
    if password_hasher.check_needs_rehash(encoded):
        credential.password_hash = hash_password(password)
        session.flush()
    return user
