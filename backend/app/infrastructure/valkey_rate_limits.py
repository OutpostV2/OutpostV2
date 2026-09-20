"""Valkey-backed atomic fixed-window rate limiting."""

from typing import Any

from redis import Redis
from redis.exceptions import RedisError

from app.core.errors import ServiceUnavailableError

_INCREMENT_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
"""


class ValkeyFixedWindowRateLimiter:
    """Increment fixed-window counters atomically in Valkey."""

    def __init__(self, url: str) -> None:
        self._client: Redis = Redis.from_url(url, decode_responses=True)

    def increment(self, key: str, *, window_seconds: int) -> int:
        try:
            result: Any = self._client.eval(_INCREMENT_SCRIPT, 1, key, window_seconds)
        except RedisError as error:
            raise ServiceUnavailableError("Rate limiting is unavailable") from error
        return int(result)

    def close(self) -> None:
        self._client.close()
