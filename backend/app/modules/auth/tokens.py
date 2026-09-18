"""Short-lived access credentials with fixed verification policy."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError, UnauthorizedError

ACCESS_SECONDS = 900
ISSUER = "outpost"
AUDIENCE = "outpost-api"


def signing_key(settings: Settings) -> str:
    if settings.auth_signing_key is None:
        raise ServiceUnavailableError("Authentication is not configured")
    return settings.auth_signing_key.get_secret_value()


def issue_access_token(settings: Settings, user_id: UUID, session_id: UUID) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user_id),
            "sid": str(session_id),
            "jti": str(uuid4()),
            "iss": ISSUER,
            "aud": AUDIENCE,
            "type": "access",
            "iat": now,
            "nbf": now,
            "exp": now + timedelta(seconds=ACCESS_SECONDS),
        },
        signing_key(settings),
        algorithm="HS256",
    )


def decode_access_token(settings: Settings, token: str) -> tuple[UUID, UUID]:
    key = signing_key(settings)
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=["HS256"],
            issuer=ISSUER,
            audience=AUDIENCE,
            options={"require": ["exp", "iat", "nbf", "iss", "aud", "sub", "sid", "jti", "type"]},
        )
        if claims["type"] != "access":
            raise ValueError("Wrong token type")
        if any(type(claims[name]) is not int for name in ("iat", "nbf", "exp")):
            raise ValueError("Invalid timestamps")
        if not 0 < claims["exp"] - claims["iat"] <= ACCESS_SECONDS:
            raise ValueError("Invalid lifetime")
        return UUID(claims["sub"]), UUID(claims["sid"])
    except (jwt.InvalidTokenError, ValueError, TypeError, AttributeError):
        raise UnauthorizedError("Invalid or expired access credential") from None
