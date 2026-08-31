# Premnathrail Portal — Ideal Architecture

A modern, modular full-stack application for managing CRM, ERP, and R&D tools using FastAPI, PostgreSQL, and Microsoft SSO authentication.

## Project Structure

```text
backend/
├── app/
│   ├── core/              # Configuration, settings, security
│   ├── db/                # Database connection and session management
│   ├── auth/              # Authentication (JWT, Microsoft OAuth)
│   ├── middleware/        # HTTP middleware (CORS, security, etc.)
│   ├── modules/           # Feature modules (CRM, ERP, R&D, Main)
│   │   └── main/
│   │       ├── models/          # SQLAlchemy models
│   │       ├── schemas/         # Pydantic request/response schemas
│   │       ├── repositories/    # Database access layer
│   │       ├── services/        # Business logic layer
│   │       └── routes/           # API endpoints
│   ├── tests/             # Unit and integration tests
│   └── main.py            # FastAPI application instance
├── migrations/            # Alembic database migrations
├── requirements.txt       # Python dependencies
└── .env                   # Local environment variables

frontend/
├── public/                # Static files
├── src/
│   ├── app/               # Next.js App Router pages
│   │   └── dashboard/
│   │       ├── crm/
│   │       ├── erp/
│   │       ├── rnd/
│   │       ├── purchase/
│   │       ├── purchase-requisition/
│   │       └── users/
│   ├── components/        # Reusable UI components
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # API client, theme, changelog
│   └── types/             # Shared TypeScript types

docs/
├── application-programming-interface/
├── architecture/
├── setup/
├── testing/
├── troubleshooting/
├── deployment/
├── runbook/
├── product/
├── security/
└── architecture-decision-records/
```

## Architecture Pattern: Modular Monolith

Each feature is organized as a self-contained module with:

* **Models** — Database schema
* **Schemas** — Request/response validation
* **Repositories** — Data access
* **Services** — Business logic
* **Routes** — HTTP endpoints

This provides:

* Clear separation of concerns
* Easier testing
* Independent team ownership
* A potential path toward future microservice extraction

## Quick Start

### Prerequisites

* Python 3.14+
* PostgreSQL 18+
* Node.js 24+

### Backend Setup

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
```

Configure `backend/.env`:

```env
DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/premnathrail_ideal
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
AZURE_TENANT_ID=your-tenant-id
SECRET_KEY=change-this-in-production
```

Run the backend:

```bash
uvicorn app.main:app --reload
```

Backend:

```text
http://localhost:8000
```

API documentation:

```text
http://localhost:8000/docs
```

### Testing

```bash
pytest app/tests -v
```

## Authentication

The application uses Microsoft SSO:

1. User starts Microsoft login.
2. Microsoft verifies the user's identity.
3. The application creates or updates the user.
4. A JWT is issued for API access.
5. Protected routes validate the Bearer token.

```text
Authorization: Bearer <token>
```

### Authentication Endpoints

```text
GET /auth/microsoft-login
GET /auth/callback
GET /auth/me
```

## API

### Health Check

```text
GET /health
```

## Database

PostgreSQL is used with SQLAlchemy ORM.

Key model:

```text
User
├── email
├── role
└── Azure profile information
```

Database schema changes are managed through Alembic migrations.

## Technology Stack

### Backend

* FastAPI
* SQLAlchemy
* Pydantic
* Python-Jose
* MSAL
* Psycopg
* PostgreSQL
* Alembic

### Frontend

* Next.js 16 App Router
* React 19
* TypeScript
* Custom design system
* Zustand
* Axios

The frontend uses `frontend/src/lib/theme.ts` for design tokens, including glass-morphism surfaces and light/dark-aware styling.

## Development Guidelines

### Code Organization

* **Models** — Database schema only
* **Repositories** — Database access only
* **Services** — Business rules and orchestration
* **Routes** — Request/response handling
* **Tests** — Business and integration behavior

### Comments

* Comments should explain **why**, not **what**.
* Prefer self-explanatory code.
* Use docstrings for public functions.

### Commits

* One feature per commit.
* Use descriptive commit messages.
* Include an issue/task reference where applicable.

## Current Project Direction

The portal has already progressed beyond the initial foundation. CRM, ERP, R&D, Purchase, P2P, HR, Design, Electrical, Store, and Vendor functionality exist in the current codebase.

The documentation and architecture should therefore describe the **actual implemented system**, not fictional future-stage scaffolding.

Current priorities include:

* Expanding department modules where required
* Expanding automated test coverage
* Continuing security hardening
* Improving deployment and operational maturity
* Maintaining the modular architecture as the application grows

## License

Internal use only.

## Authors

Premnathrail Engineering Team
