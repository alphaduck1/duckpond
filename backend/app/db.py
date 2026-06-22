"""Database engine + session helpers."""
from sqlmodel import SQLModel, create_engine, Session
from .config import get_settings

settings = get_settings()

# pool_pre_ping keeps Cloud SQL connections healthy across Cloud Run idling.
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_recycle=1800,
    echo=False,
)


def init_db() -> None:
    """Create tables if they don't exist. Called on startup."""
    SQLModel.metadata.create_all(engine)


def get_session():
    # expire_on_commit=False so ORM attributes stay populated after commit();
    # otherwise Pydantic v2 .model_dump() reads a cleared __dict__ and serialises
    # required columns as None (3-validation-error 500 on login/persona/etc).
    with Session(engine, expire_on_commit=False) as session:
        yield session
