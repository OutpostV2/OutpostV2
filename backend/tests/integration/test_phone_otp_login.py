import asyncio
import hashlib
import os
import re
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from fastapi import FastAPI
from httpx2 import ASGITransport, AsyncClient
from sqlalchemy import Engine, create_engine, event, func, select
from sqlalchemy.orm import Session

from alembic import command
from app.core.config import Settings
from app.core.errors import UnauthorizedError
from app.main import create_app
from app.modules.auth.models import (
    AuthSession,
    OtpChallenge,
    PhoneIdentity,
    SecurityEvent,
)
from app.modules.auth.phone_login import verify_phone_otp
from app.modules.auth.rate_limits import (
    MemoryFixedWindowRateLimiter,
    OtpRequestRateLimiter,
)
from app.modules.auth.sms import DevelopmentSmsProvider, SmsDeliveryError, SmsMessage
from app.modules.users.models import User
from tests.integration.database import migration_config, temporary_postgresql_database

DATABASE_URL = os.getenv("OUTPOST_TEST_DATABASE_URL")
SIGNING_KEY = "test-only-signing-key-with-at-least-32-bytes"
OTP_KEY = "test-only-otp-hmac-key-with-at-least-32-bytes"
PHONE = "+14155552671"
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(DATABASE_URL is None, reason="OUTPOST_TEST_DATABASE_URL is not set"),
]


@pytest.fixture
def phone_otp_app(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[tuple[FastAPI, Engine, DevelopmentSmsProvider, Settings]]:
    assert DATABASE_URL is not None
    with temporary_postgresql_database(DATABASE_URL) as url:
        monkeypatch.setenv("OUTPOST_DATABASE_URL", url.render_as_string(False))
        command.upgrade(migration_config(), "head")
        engine = create_engine(url, hide_parameters=True)
        provider = DevelopmentSmsProvider()
        settings = Settings(
            database_url=url.render_as_string(False),
            auth_signing_key=SIGNING_KEY,
            otp_hmac_key=OTP_KEY,
            sms_provider="development",
            _env_file=None,
        )
        limiter = OtpRequestRateLimiter(MemoryFixedWindowRateLimiter(), settings)
        app = create_app(
            settings,
            engine=engine,
            sms_provider=provider,
            otp_rate_limiter=limiter,
            configure_logs=False,
        )
        try:
            yield app, engine, provider, settings
        finally:
            engine.dispose()


def _code(provider: DevelopmentSmsProvider) -> str:
    match = re.search(r"\b(\d{6})\b", provider.outbox[-1].text_body)
    assert match is not None
    return match.group(1)


def test_phone_otp_request_and_verification_issue_one_secure_session(
    phone_otp_app: tuple[FastAPI, Engine, DevelopmentSmsProvider, Settings],
) -> None:
    app, engine, provider, _ = phone_otp_app

    async def exercise() -> str:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            first = await client.post(
                "/api/v1/auth/phone/request",
                json={"phone": "+1 (415) 555-2671"},
            )
            assert first.status_code == 202, first.text
            assert first.content == b""
            assert first.headers["cache-control"] == "no-store"
            assert len(provider.outbox) == 1
            assert provider.outbox[0].to == PHONE
            code = _code(provider)

            for _ in range(4):
                cooldown = await client.post("/api/v1/auth/phone/request", json={"phone": PHONE})
                assert cooldown.status_code == 202
                assert cooldown.content == first.content
            limited = await client.post("/api/v1/auth/phone/request", json={"phone": PHONE})
            assert limited.status_code == 429
            assert limited.json()["error"]["code"] == "rate_limited"
            assert len(provider.outbox) == 1

            verified = await client.post(
                "/api/v1/auth/phone/verify",
                json={"phone": PHONE, "code": code},
            )
            assert verified.status_code == 200, verified.text
            assert verified.headers["cache-control"] == "no-store"
            assert verified.headers["pragma"] == "no-cache"
            assert verified.json()["token_type"] == "bearer"
            assert verified.json()["expires_in"] == 900
            assert "refresh_token" not in verified.json()
            cookie = verified.headers["set-cookie"]
            assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=strict" in cookie
            assert "Path=/api/v1/auth" in cookie
            refresh = client.cookies.get("outpost_refresh")
            assert refresh is not None

            me = await client.get(
                "/api/v1/me",
                headers={"Authorization": "Bearer " + verified.json()["access_token"]},
            )
            assert me.status_code == 200
            assert me.json()["primary_email"] is None

            reused = await client.post(
                "/api/v1/auth/phone/verify",
                json={"phone": PHONE, "code": code},
            )
            assert reused.status_code == 401
            assert reused.json()["error"]["message"] == "Invalid or expired OTP"
            assert code not in reused.text
            return refresh

    refresh = asyncio.run(exercise())
    with Session(engine) as session:
        challenge = session.scalars(select(OtpChallenge)).one()
        user = session.scalars(select(User)).one()
        identity = session.scalars(select(PhoneIdentity)).one()
        auth_session = session.scalars(select(AuthSession)).one()
        event = session.scalars(
            select(SecurityEvent).where(SecurityEvent.event_type == "authentication.succeeded")
        ).one()
        assert challenge.consumed_at is not None
        assert challenge.attempt_count == 0
        assert challenge.otp_digest != _code(provider)
        assert _code(provider) not in challenge.otp_digest
        assert challenge.expires_at - challenge.created_at == timedelta(minutes=5)
        assert challenge.resend_available_at - challenge.created_at == timedelta(seconds=60)
        assert identity.user_id == user.id
        assert identity.phone_e164 == PHONE
        assert identity.verified_at == challenge.consumed_at
        assert auth_session.user_id == user.id
        assert auth_session.refresh_token_hash == hashlib.sha256(refresh.encode()).hexdigest()
        assert event.user_id == user.id
        assert event.session_id == auth_session.id
        assert event.event_data == {"method": "phone_otp"}


def test_wrong_phone_otp_attempts_persist_and_lock_challenge(
    phone_otp_app: tuple[FastAPI, Engine, DevelopmentSmsProvider, Settings],
) -> None:
    app, engine, provider, _ = phone_otp_app

    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            assert (
                await client.post("/api/v1/auth/phone/request", json={"phone": PHONE})
            ).status_code == 202
            expired_code = _code(provider)
            with Session(engine) as session, session.begin():
                expired = session.scalars(select(OtpChallenge)).one()
                expired.created_at = datetime.now(UTC) - timedelta(minutes=10)
                expired.expires_at = datetime.now(UTC) - timedelta(minutes=5)
                expired.resend_available_at = expired.created_at + timedelta(seconds=60)
            expired_response = await client.post(
                "/api/v1/auth/phone/verify",
                json={"phone": PHONE, "code": expired_code},
            )
            assert expired_response.status_code == 401
            assert expired_response.json()["error"]["message"] == "Invalid or expired OTP"

            replacement = await client.post("/api/v1/auth/phone/request", json={"phone": PHONE})
            assert replacement.status_code == 202
            assert len(provider.outbox) == 2
            correct = _code(provider)
            wrong = "000000" if correct != "000000" else "999999"
            for attempt in range(1, 6):
                response = await client.post(
                    "/api/v1/auth/phone/verify",
                    json={"phone": PHONE, "code": wrong},
                )
                assert response.status_code == 401
                assert response.json()["error"]["message"] == "Invalid or expired OTP"
                with Session(engine) as session:
                    latest = session.scalars(
                        select(OtpChallenge).order_by(OtpChallenge.created_at.desc()).limit(1)
                    ).one()
                    assert latest.attempt_count == attempt

            locked = await client.post(
                "/api/v1/auth/phone/verify",
                json={"phone": PHONE, "code": correct},
            )
            assert locked.status_code == 401
            assert locked.json()["error"]["message"] == "Invalid or expired OTP"

    asyncio.run(exercise())
    with Session(engine) as session:
        challenges = list(session.scalars(select(OtpChallenge).order_by(OtpChallenge.created_at)))
        assert len(challenges) == 2
        assert challenges[0].consumed_at is not None
        challenge = challenges[1]
        assert challenge.attempt_count == 5
        assert challenge.consumed_at is None
        assert session.scalar(select(func.count()).select_from(User)) == 0
        assert session.scalar(select(func.count()).select_from(AuthSession)) == 0


class FailingSmsProvider:
    def send(self, message: SmsMessage) -> None:
        del message
        raise SmsDeliveryError("injected delivery failure")


def test_phone_otp_request_hides_sms_delivery_failure(
    phone_otp_app: tuple[FastAPI, Engine, DevelopmentSmsProvider, Settings],
    caplog: pytest.LogCaptureFixture,
) -> None:
    app, engine, provider, _ = phone_otp_app
    app.state.sms_provider = FailingSmsProvider()

    async def exercise() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            response = await client.post("/api/v1/auth/phone/request", json={"phone": PHONE})
            assert response.status_code == 202
            assert response.content == b""
            assert response.headers["cache-control"] == "no-store"

    asyncio.run(exercise())
    assert provider.outbox == ()
    assert len(caplog.records) == 1
    assert caplog.records[0].getMessage() == "phone_otp.delivery_failed"
    assert PHONE not in caplog.text
    with Session(engine) as session:
        challenge = session.scalars(select(OtpChallenge)).one()
        assert challenge.phone_e164 == PHONE
        assert challenge.consumed_at is None


def test_concurrent_phone_otp_verification_consumes_challenge_once(
    phone_otp_app: tuple[FastAPI, Engine, DevelopmentSmsProvider, Settings],
) -> None:
    app, engine, provider, settings = phone_otp_app

    async def issue() -> None:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="https://testserver"
        ) as client:
            response = await client.post("/api/v1/auth/phone/request", json={"phone": PHONE})
            assert response.status_code == 202

    asyncio.run(issue())
    code = _code(provider)

    def fail_event(*args: object) -> None:
        raise RuntimeError("injected phone authentication event failure")

    event.listen(SecurityEvent, "before_insert", fail_event)
    try:
        with (
            Session(engine) as session,
            pytest.raises(RuntimeError, match="injected phone authentication event"),
        ):
            verify_phone_otp(
                session,
                settings,
                phone_e164=PHONE,
                code=code,
                user_agent="rollback-test",
                ip_address="203.0.113.9",
            )
    finally:
        event.remove(SecurityEvent, "before_insert", fail_event)

    with Session(engine) as session:
        assert session.scalars(select(OtpChallenge)).one().consumed_at is None
        assert session.scalar(select(func.count()).select_from(User)) == 0
        assert session.scalar(select(func.count()).select_from(PhoneIdentity)) == 0
        assert session.scalar(select(func.count()).select_from(AuthSession)) == 0

    barrier = Barrier(2)

    def consume(_: int) -> bool:
        barrier.wait()
        try:
            with Session(engine, expire_on_commit=False) as session:
                verify_phone_otp(
                    session,
                    settings,
                    phone_e164=PHONE,
                    code=code,
                    user_agent="concurrency-test",
                    ip_address="203.0.113.10",
                )
            return True
        except UnauthorizedError:
            return False

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(consume, range(2)))

    assert sorted(results) == [False, True]
    with Session(engine) as session:
        assert session.scalars(select(OtpChallenge)).one().consumed_at is not None
        assert session.scalar(select(func.count()).select_from(User)) == 1
        assert session.scalar(select(func.count()).select_from(PhoneIdentity)) == 1
        assert session.scalar(select(func.count()).select_from(AuthSession)) == 1
        assert session.scalar(select(func.count()).select_from(SecurityEvent)) == 1
