"""Argon2id hashing using the RFC 9106 low-memory profile."""

from argon2 import PasswordHasher
from argon2.profiles import RFC_9106_LOW_MEMORY

password_hasher = PasswordHasher.from_parameters(RFC_9106_LOW_MEMORY)


def hash_password(password: str) -> str:
    return password_hasher.hash(password)
