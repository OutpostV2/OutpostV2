import pytest

from app.modules.auth.phone_identities import normalize_phone


@pytest.mark.parametrize(
    ("value", "expected"),
    (
        ("+1 (415) 555-2671", "+14155552671"),
        (" +44 20 8366 1177 ", "+442083661177"),
    ),
)
def test_normalize_phone_returns_canonical_e164(value: str, expected: str) -> None:
    assert normalize_phone(value) == expected


@pytest.mark.parametrize(
    "value",
    ("4155552671", "", "+0123456789", "+1415555267x", "+999999999999999"),
)
def test_normalize_phone_rejects_noninternational_or_invalid_numbers(value: str) -> None:
    with pytest.raises(ValueError, match="valid international phone number"):
        normalize_phone(value)
