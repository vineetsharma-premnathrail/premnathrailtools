# Changelog

All notable changes to Premnathrail Portal (Ideal Architecture) are documented here.

Format: [YYYY-MM-DD] Category — Description

---

## [2025-07-24]

### Added
- **Stage 1:** FastAPI skeleton with settings/config
- **Stage 2:** Database layer (SQLAlchemy + PostgreSQL)
  - `backend/app/db/base.py` — SQLAlchemy Base
  - `backend/app/db/session.py` — Engine and SessionLocal
  - `backend/app/modules/main/models/user.py` — User model
- **Stage 3:** Pydantic schemas
  - `backend/app/modules/main/schemas/user.py` — UserCreate, UserUpdate, UserResponse
- **Stage 4:** Repository + Service layers
  - `backend/app/modules/main/repositories/user.py` — Database access
  - `backend/app/modules/main/services/user.py` — Business logic
- **Stage 5&6:** Microsoft SSO Authentication
  - `backend/app/auth/jwt_handler.py` — JWT token creation/verification
  - `backend/app/auth/microsoft.py` — OAuth helpers
  - `backend/app/modules/main/schemas/auth.py` — Auth schemas
  - `backend/app/modules/main/routes/auth.py` — Login endpoints
  - Removed manual CRUD routes (POST create, DELETE)
- **Stage 9:** Pytest testing setup
  - `backend/app/tests/conftest.py` — Test configuration
  - `backend/app/tests/test_auth.py` — Auth tests
  - `backend/app/tests/test_microsoft_oauth.py` — Microsoft OAuth tests (8 comprehensive tests)
- **Debugging & Error Handling:**
  - `backend/app/middleware/error_handler.py` — Global error handling middleware
  - `backend/app/utils/debug.py` — Debugging utilities (print user, request, DB stats)

### Updated
- `backend/app/core/config.py` — Added Azure OAuth + JWT settings
- `backend/app/main.py` — Include auth routes
- `backend/requirements.txt` — Added dependencies (msal, python-jose, httpx)
- `backend/.env` — Added OAuth and JWT configuration

### Documentation
- `README.md` — Project overview, structure, quick start
- `CHANGELOG.md` — All changes tracked here
- `CONTRIBUTING.md` — Development guidelines & workflow
- `CODE_STYLE.md` — Code style and conventions
- `docs/ARCHITECTURE.md` — System design, layer responsibilities, deployment
- `docs/API.md` — All endpoints with examples
- `docs/SETUP.md` — Step-by-step setup instructions
- `docs/TESTING.md` — Testing guidelines & best practices
- `docs/TESTING_MICROSOFT_OAUTH.md` — How to test Microsoft OAuth (mocking, real tests, debugging)
- `docs/TROUBLESHOOTING.md` — **NEW** — Troubleshooting guide with 10+ common issues & solutions
- `docs/RUNBOOK.md` — Operational procedures & basic troubleshooting
- `docs/deployment/DEPLOYMENT.md` — Docker, Kubernetes, production deployment
- `docs/security/SECURITY.md` — Security best practices
- `docs/product/PRODUCT.md` — Product vision & roadmap
- `docs/adr/` — Architecture Decision Records (0001, 0002, template)

### Breaking Changes
- Removed manual user create/delete endpoints (use Microsoft SSO instead)
- Changed from synchronous to manual database setup (no automatic migrations yet)

### Known Issues
- Azure OAuth credentials need to be configured in `.env`
- Database tables created on startup (no migrations yet)
- No API rate limiting implemented yet

---

## Roadmap

### Stage 7 (Next)
- [ ] CRM module (full end-to-end: model → schema → repo → service → route → test)
- [ ] Create, Read, Update, Delete notes/contacts

### Stage 8
- [ ] Frontend basics (plain HTML/JS)
- [ ] Login page
- [ ] Dashboard
- [ ] Call backend APIs

### Stage 9
- [ ] Expand pytest suite
- [ ] Integration tests
- [ ] E2E tests

### Stage 10
- [ ] ERP module
- [ ] RnD module
- [ ] Repeat pattern for both

### Future
- [ ] Alembic migrations
- [ ] Redis caching
- [ ] API rate limiting
- [ ] Logging and monitoring
- [ ] Docker support
- [ ] Production deployment guide
