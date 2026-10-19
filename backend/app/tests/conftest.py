import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from fastapi.testclient import TestClient

from app.main import app
from app.db.base import Base
from app.db.session import get_db
from app.middleware.owasp import get_rate_store
from app.core.permission_registry import expand_grant_sources, expand_grants, legacy_access, standard_module_grants
from app.modules.main.models.user import User


def _legacy_effective_permissions(self) -> set[str]:
    """Test shim: most fixtures build users the pre-roles way
    (`assigned_apps=[...]`, optional opt-in matrix grants, `erp_permissions`).
    Translate that exactly as the c4e8a1f3b7d2 roles migration does, so the
    whole suite keeps asserting that access is unchanged after it. Users
    built without `assigned_apps` get the real roles + deny-by-default
    behaviour (test_roles_permissions.py)."""
    if not (self.assigned_apps or []):
        # Real behaviour: each role (and the extra grants) expands on its own —
        # features inherit per role (permission_registry.expand_grants).
        return expand_grant_sources(list(self.granular_permissions or []), *self.role_grant_lists())
    keep, standard = legacy_access(self.assigned_apps, self.erp_permissions, self.granular_permissions)
    apps = set(self.assigned_apps)
    other = [g for g in (self.granular_permissions or []) if g.split(":", 1)[0] not in apps]
    eff = expand_grants(keep + other + self.role_grants())
    for mk in standard:
        eff |= standard_module_grants(mk)
    return eff


User.effective_permissions = property(_legacy_effective_permissions)

# The suite predates DEFAULT_DATA_SCOPE="assigned" and builds users without role
# data scopes; keep their organization-wide reads. test_default_data_scope.py
# covers the production default.
from app.core.config import settings as _settings  # noqa: E402
_settings.DEFAULT_DATA_SCOPE = "organization"


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


# Postgres-only JSONB columns (e.g. departments.additional_head_user_ids)
# otherwise make create_all() fail on SQLite before any test runs.
@compiles(JSONB, "sqlite")
def _compile_jsonb_for_sqlite(type_, compiler, **kw):
    return "JSON"


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
