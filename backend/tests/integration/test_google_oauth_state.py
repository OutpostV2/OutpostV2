import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from redis import Redis

from app.infrastructure.valkey_oauth_state import ValkeyOAuthStateStore
from app.modules.auth.google import OAUTH_CORRELATION_TTL_SECONDS

VALKEY_URL = os.getenv("OUTPOST_TEST_VALKEY_URL")
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(VALKEY_URL is None, reason="OUTPOST_TEST_VALKEY_URL is not set"),
]


def test_valkey_oauth_state_is_atomic_single_use_and_expires() -> None:
    assert VALKEY_URL is not None
    state = uuid4().hex
    key = f"outpost:oauth-state:v1:{state}"
    store = ValkeyOAuthStateStore(VALKEY_URL)
    client: Redis = Redis.from_url(VALKEY_URL, decode_responses=True)
    try:
        assert store.put(state, "expected-nonce", ttl_seconds=OAUTH_CORRELATION_TTL_SECONDS)
        assert not store.put(state, "replacement", ttl_seconds=OAUTH_CORRELATION_TTL_SECONDS)
        ttl = client.ttl(key)
        assert 0 < ttl <= OAUTH_CORRELATION_TTL_SECONDS

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: store.consume(state), range(2)))
        assert sorted(results, key=lambda item: item is None) == ["expected-nonce", None]
        assert client.exists(key) == 0
    finally:
        client.delete(key)
        client.close()
        store.close()
