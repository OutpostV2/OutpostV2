from datetime import UTC, datetime
from uuid import uuid4

import jwt
import pytest
from pydantic import SecretStr, ValidationError

from app.core.config import Settings
from app.core.errors import UnauthorizedError
from app.modules.auth.tokens import decode_access_token, issue_access_token

KEY = "test-only-access-key-with-at-least-32-bytes" * 2


def settings() -> Settings:
    return Settings(
        database_url="postgresql+psycopg://test:test@localhost/test",
        auth_signing_key=SecretStr(KEY),
        _env_file=None,
    )


def test_access_round_trip_and_short_lifetime() -> None:
    user_id, session_id = uuid4(), uuid4()
    token = issue_access_token(settings(), user_id, session_id)
    assert decode_access_token(settings(), token) == (user_id, session_id)
    claims = jwt.decode(token, KEY, algorithms=["HS256"], audience="outpost-api")
    assert claims["exp"] - claims["iat"] == 900
    assert claims["type"] == "access"


@pytest.mark.parametrize(
    "change",
    [
        {"exp": 1},
        {"nbf": 9999999999},
        {"iat": 9999999999},
        {"aud": "other"},
        {"iss": "other"},
        {"type": "refresh"},
        {"sub": "bad-uuid"},
        {"sid": "bad-uuid"},
        {"exp": "9999999999"},
        {"exp": 9999999999},
    ],
)
def test_rejects_invalid_signed_claims(change: dict[str, object]) -> None:
    now = int(datetime.now(UTC).timestamp())
    claims = {
        "sub": str(uuid4()),
        "sid": str(uuid4()),
        "jti": str(uuid4()),
        "iss": "outpost",
        "aud": "outpost-api",
        "type": "access",
        "iat": now,
        "nbf": now,
        "exp": now + 900,
    }
    token = jwt.encode(claims | change, KEY, algorithm="HS256")
    with pytest.raises(UnauthorizedError):
        decode_access_token(settings(), token)


@pytest.mark.parametrize(
    "missing", ["exp", "iat", "nbf", "iss", "aud", "sub", "sid", "jti", "type"]
)
def test_requires_every_access_claim(missing: str) -> None:
    token = issue_access_token(settings(), uuid4(), uuid4())
    claims = jwt.decode(token, KEY, algorithms=["HS256"], audience="outpost-api")
    del claims[missing]
    with pytest.raises(UnauthorizedError):
        decode_access_token(settings(), jwt.encode(claims, KEY, algorithm="HS256"))


def test_rejects_wrong_key_algorithm_and_tampering() -> None:
    token = issue_access_token(settings(), uuid4(), uuid4())
    claims = jwt.decode(token, KEY, algorithms=["HS256"], audience="outpost-api")
    for invalid in (
        jwt.encode(claims, "different-test-signing-key-of-32-bytes", algorithm="HS256"),
        jwt.encode(claims, KEY, algorithm="HS384"),
        token + "tampered",
    ):
        with pytest.raises(UnauthorizedError):
            decode_access_token(settings(), invalid)


def test_short_signing_key_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(
            database_url="postgresql+psycopg://test:test@localhost/test",
            auth_signing_key=SecretStr("too-short"),
            _env_file=None,
        )
