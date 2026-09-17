"""Minimal PostgreSQL connection foundation for local infrastructure verification."""

from dataclasses import dataclass

from sqlalchemy import Engine, create_engine, text

from app.core.config import Settings


@dataclass(frozen=True, slots=True)
class DatabaseStatus:
    """Identity returned by the PostgreSQL connection probe."""

    database: str
    user: str
    version: str


def create_database_engine(settings: Settings) -> Engine:
    """Create a SQLAlchemy engine for the configured PostgreSQL service."""

    return create_engine(str(settings.database_url), pool_pre_ping=True)


def probe_database(engine: Engine) -> DatabaseStatus:
    """Open a connection and return the identity of the PostgreSQL server."""

    statement = text("SELECT current_database(), current_user, current_setting('server_version')")
    with engine.connect() as connection:
        database, user, version = connection.execute(statement).one()

    return DatabaseStatus(database=str(database), user=str(user), version=str(version))


def main() -> None:
    """Run the PostgreSQL probe using the local backend environment."""

    settings = Settings()
    engine = create_database_engine(settings)
    try:
        status = probe_database(engine)
    finally:
        engine.dispose()

    print(f"database={status.database} user={status.user} version={status.version}")


if __name__ == "__main__":
    main()
