"""Request-scoped authentication database dependencies."""

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session


def database_session(request: Request) -> Iterator[Session]:
    with Session(request.app.state.database_engine, expire_on_commit=False) as session:
        yield session


DatabaseSession = Annotated[Session, Depends(database_session)]
