# Premnathrail Portal (Ideal Architecture)

A modern, modular full-stack application for managing CRM, ERP, and R&D tools using FastAPI, PostgreSQL, and Microsoft SSO authentication.

## Project Structure

```
backend/
├── app/
│   ├── core/          # Configuration, settings, security
│   ├── db/            # Database connection, session management
│   ├── auth/          # Authentication (JWT, Microsoft OAuth)
│   ├── middleware/    # HTTP middleware (CORS, security, etc.)
│   ├── modules/       # Feature modules (CRM, ERP, RnD, Main)
│   │   └── main/
│   │       ├── models/      # SQLAlchemy models
│   │       ├── schemas/     # Pydantic request/response schemas
│   │       ├── repositories/ # Database access layer
│   │       ├── services/    # Business logic layer
│   │       └── routes/      # API endpoints
│   ├── tests/         # Unit and integration tests
│   └── main.py        # FastAPI app instance
├── migrations/        # Alembic database migrations
├── requirements.txt   # Python dependencies
└── .env              # Environment variables (local)

frontend/                    # Next.js 16 (App Router) + React 19 + TypeScript
├── public/            # Static files
├── src/
│   ├── app/           # App Router pages, incl. dashboard/{crm,erp,rnd,purchase,purchase-requisition,users}/
│   ├── components/    # Reusable UI components (incl. erp/ subcomponents, Sidebar, notification bell)
│   ├── hooks/         # Custom React hooks (e.g. useAuth.ts — SSO session, per-module & per-permission checks)
│   ├── lib/           # API client (api.ts), design tokens (theme.ts), changelog.ts
│   └── types/         # Shared TypeScript types (index.ts — AppModule, status enums, entity shapes)

docs/                       # Documentation
├── api/API.md              # API documentation
├── architecture/           # ARCHITECTURE.md, FRONTEND_ARCHITECTURE.md
├── setup/                  # SETUP.md and other getting-started guides
├── testing/                # TESTING.md, TESTING_MICROSOFT_OAUTH.md
├── troubleshooting/        # TROUBLESHOOTING.md, FRONTEND_TROUBLESHOOTING.md
├── deployment/             # DEPLOYMENT.md, FRONTEND_DEPLOYMENT.md
├── runbook/RUNBOOK.md      # Operational procedures
├── product/PRODUCT.md
├── security/SECURITY.md
└── adr/                    # Architecture Decision Records
```

## Architecture Pattern: Modular Monolith

Each feature (CRM, ERP, RnD) is organized as a **self-contained module** with:
- **Models** — Database schema
- **Schemas** — Request/response validation
- **Repositories** — Data access (SQL queries)
- **Services** — Business logic
- **Routes** — HTTP endpoints

This separation enables:
- ✅ Clear separation of concerns
- ✅ Easy testing (mock each layer)
- ✅ Team collaboration (different teams can work on different modules)
- ✅ Future migration to microservices (convert module to separate service)

## Quick Start

### Prerequisites
- Python 3.14+
- PostgreSQL 18+
- Node.js 24+

### Backend Setup

1. **Create virtual environment:**
   ```bash
   cd backend
   python -m venv venv
   venv\Scripts\activate  # Windows
   source venv/bin/activate  # macOS/Linux
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure `.env`:**
   ```env
   DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/premnathrail_ideal
   AZURE_CLIENT_ID=your-client-id
   AZURE_CLIENT_SECRET=your-client-secret
   AZURE_TENANT_ID=your-tenant-id
   SECRET_KEY=change-this-in-production
   ```

4. **Run server:**
   ```bash
   uvicorn app.main:app --reload
   ```

   Server runs at: `http://localhost:8000`
   API docs at: `http://localhost:8000/docs`

### Testing

```bash
pytest app/tests -v
```

## Authentication

Uses **Microsoft SSO (Single Sign-On)**:
- Users login via `/auth/microsoft-login`
- Microsoft verifies identity
- App auto-creates/updates user in database
- JWT token issued for API access
- Protected routes check token via `Authorization: Bearer <token>`

## API Endpoints

### Health Check
```
GET /health
```

### Authentication
```
GET /auth/microsoft-login          # Start login flow
GET /auth/callback                  # OAuth callback (auto-handled)
GET /auth/me                        # Get current user (protected)
```

## Database

PostgreSQL with SQLAlchemy ORM.

**Key Models:**
- `User` — Portal users (email, role, Azure profile)

## Technology Stack

**Backend:**
- FastAPI — Web framework
- SQLAlchemy — ORM
- Pydantic — Data validation
- Python-Jose — JWT tokens
- MSAL — Microsoft authentication
- Psycopg — PostgreSQL driver

**Frontend:**
- Next.js 16 (App Router) — routing, server/client components
- React 19 + TypeScript
- A full custom design system (`frontend/src/lib/theme.ts`) — glass-morphism surfaces, brand orange (`#FF7A45`), dark/light-aware tokens
- No plain HTML/JS anywhere — the frontend is already a mature, far-along application, not a future step

## Development Guidelines

### Code Organization
- **Models** — Database schema only (no methods)
- **Repositories** — SQL queries only (no business logic)
- **Services** — Business rules, validation, orchestration
- **Routes** — Request parsing, response formatting, error handling
- **Tests** — One test file per module, focus on business logic

### Comments
- Add comments only for WHY (not WHAT)
- Self-explanatory code is preferred
- Docstrings for public functions

### Commits
- One feature per commit
- Descriptive messages
- Include issue/task reference if applicable

## Next Steps

CRM, ERP, R&D, Purchase, and the standalone Purchase Requisition module are all built and live (backend + Next.js frontend), Alembic migrations are in active use, and OpenAPI docs are served at `/docs` — the items below are genuinely open, not a restatement of already-finished early-stage work. See `docs/product/PRODUCT.md` and `docs/product/DEPARTMENT_MODULES_ROADMAP.md` for the fuller roadmap.

- [ ] New departments not yet built: Design, Electrical, Fluids, Production, Store, Quality, Maintenance, Operations, Project Management, Vendor Development (see `docs/product/DEPARTMENT_MODULES_ROADMAP.md`)
- [ ] Purchase (SR-linked) module: vendor master, formal PO documents, costing/GRN/invoice tracking, reporting dashboard (see `docs/product/PURCHASE_MODULE_PLAN.md`) — or converge onto the standalone `purchase_requisition` module, which already covers much of this
- [ ] Move module access (`AVAILABLE_APPS`) from a hardcoded set to a DB-backed module registry before adding more departments
- [ ] Expand automated test coverage
- [ ] Add rate limiting
- [ ] Production deployment guide

## License

Internal use only

## Authors

Premnathrail Engineering Team
