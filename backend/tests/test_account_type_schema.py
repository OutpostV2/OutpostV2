import pytest
from pydantic import ValidationError

from app.modules.auth.schemas import RegistrationInput
from app.modules.users.models import AccountType


def test_registration_account_type_validation() -> None:
    base = {
        "display_name": "Mira",
        "username": "mira",
        "email": "mira@example.edu",
        "password": "a long secure passphrase",
    }
    assert RegistrationInput(**base).account_type == AccountType.STUDENT
    assert (
        RegistrationInput(**(base | {"account_type": "coordinator"})).account_type
        == AccountType.COORDINATOR
    )
    with pytest.raises(ValidationError):
        RegistrationInput(**(base | {"account_type": "admin"}))
