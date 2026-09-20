import logging
import secrets

import pytest

from app.modules.auth import otp


def test_generate_otp_draws_from_complete_six_digit_space(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upper_bounds: list[int] = []

    def draw_lowest(upper_bound: int) -> int:
        upper_bounds.append(upper_bound)
        return 0

    monkeypatch.setattr(secrets, "randbelow", draw_lowest)

    assert otp.generate_otp() == "000000"
    assert upper_bounds == [1_000_000]


def test_generate_otp_includes_highest_six_digit_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(secrets, "randbelow", lambda upper_bound: upper_bound - 1)

    assert otp.generate_otp() == "999999"


def test_generate_otp_emits_no_code_output(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(secrets, "randbelow", lambda _: 123456)

    with caplog.at_level(logging.DEBUG):
        assert otp.generate_otp() == "123456"

    assert caplog.records == []
    assert capsys.readouterr() == ("", "")
