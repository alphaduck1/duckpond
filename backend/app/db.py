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
    with Session(engine) as session:
        yield session
