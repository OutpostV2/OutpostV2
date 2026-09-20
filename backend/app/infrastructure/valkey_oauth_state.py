"""Valkey-backed single-use OAuth correlation state."""

from redis import Redis
from redis.exceptions import RedisError

from app.core.errors import ServiceUnavailableError


class ValkeyOAuthStateStore:
    """Store short-lived state/nonce correlations atomically in Valkey."""

    def __init__(self, url: str) -> None:
        self._client: Redis = Redis.from_url(url, decode_responses=True)

    def put(self, state: str, nonce: str, *, ttl_seconds: int) -> bool:
        try:
            return bool(
                self._client.set(
                    self._key(state),
                    nonce,
                    ex=ttl_seconds,
                    nx=True,
                )
            )
        except RedisError as error:
            raise ServiceUnavailableError("Google authentication is unavailable") from error

    def consume(self, state: str) -> str | None:
        try:
            value = self._client.getdel(self._key(state))
        except RedisError as error:
            raise ServiceUnavailableError("Google authentication is unavailable") from error
        return str(value) if value is not None else None

    def close(self) -> None:
        self._client.close()

    @staticmethod
    def _key(state: str) -> str:
        return f"outpost:oauth-state:v1:{state}"
