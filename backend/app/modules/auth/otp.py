"""Cryptographically secure phone one-time password generation."""

import secrets


def generate_otp() -> str:
    """Return a uniformly generated six-digit decimal code."""
    return f"{secrets.randbelow(1_000_000):06d}"
