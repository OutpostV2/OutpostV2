from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from redis import Redis

from app.infrastructure.valkey_rate_limits import ValkeyFixedWindowRateLimiter

pytestmark = pytest.mark.integration
VALKEY_URL = "redis://127.0.0.1:6379/0"


def test_valkey_fixed_window_increment_is_atomic_and_expires() -> None:
    key = f"outpost:test:rate-limit:{uuid4().hex}"
    client: Redis = Redis.from_url(VALKEY_URL, decode_responses=True)
    limiter = ValkeyFixedWindowRateLimiter(VALKEY_URL)
    try:
        with ThreadPoolExecutor(max_workers=8) as executor:
            counts = sorted(
                executor.map(lambda _: limiter.increment(key, window_seconds=60), range(8))
            )

        assert counts == list(range(1, 9))
        assert 0 < client.ttl(key) <= 60
    finally:
        client.delete(key)
        client.close()
        limiter.close()
