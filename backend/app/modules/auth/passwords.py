"""Argon2id hashing using the RFC 9106 low-memory profile."""

import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from argon2.profiles import RFC_9106_LOW_MEMORY

password_hasher = PasswordHasher.from_parameters(RFC_9106_LOW_MEMORY)


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


# A valid random verifier ensures missing users still execute Argon2 verification.
DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))


def verify_password(encoded: str, password: str) -> bool:
    try:
        return password_hasher.verify(encoded, password)
    except (VerificationError, InvalidHashError):
        return False
