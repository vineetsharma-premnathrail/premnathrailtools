import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.main import app
from app.db.base import Base
from app.db.session import get_db
from app.middleware.owasp import get_rate_store


@pytest.fixture(autouse=True)
def _reset_rate_store():
    """The OWASP middleware's rate limiter is a module-level singleton shared
    by every test in the session — without resetting it, tests run later in
    the suite start failing with false 429s once earlier tests have used up
    that IP's request budget. Reset before every test instead."""
    store = get_rate_store()
    if hasattr(store, "reset"):
        store.reset()
    yield


# Use in-memory SQLite for testing. StaticPool keeps a single shared
# connection alive so the in-memory database persists across the
# multiple connections FastAPI's threadpool opens during a request,
# instead of each one seeing a fresh empty database.
TEST_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function")
def db():
    """Create test database and tables, then clean up after."""
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def client(db):
    """Override FastAPI dependency to use test database."""
    def override_get_db():
        return db

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()
