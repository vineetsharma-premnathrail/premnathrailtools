# Project Structure

This supersedes the root `README.md`'s directory tree, which describes an early plain-HTML prototype and is stale. Verified directly against the current tree under `backend/app/` and `frontend/src/`.

## Top-level repo layout

```
PremnathrailPortal-Ideal/
├── backend/          FastAPI application, Alembic migrations, Python venv
├── frontend/          Next.js 16 / React 19 application
└── docs/              Documentation (this folder: docs/development/)
```

## `backend/`

```
backend/
├── alembic/                 Alembic migration environment + versions/
├── app/
│   ├── auth/                 Azure AD / Microsoft login + session/JWT auth logic
│   ├── common/
│   │   ├── exceptions/       Shared exception types
│   │   └── pagination/       Shared pagination helpers
│   ├── core/                 config.py (Settings), permissions.py (require_app_access), db session setup
│   ├── db/                   Base declarative class, mixins (TimestampMixin, SoftDeleteMixin)
│   ├── middleware/            api_key.py, owasp.py, error_handler.py, rate_store.py
│   ├── modules/
│   │   ├── crm/               models, schemas, routes, api/, reports/, repositories/, services/, tests/
│   │   ├── erp/               models, schemas, routes (flat layout, no service.py)
│   │   ├── main/              users, auth, api keys, notifications, feedback, audit log; layered layout
│   │   ├── purchase/           PRs generated from ERP Service Request material lines; + service.py, reports/
│   │   ├── p2p/  standalone PR workflow, independent of purchase/; + service.py
│   │   ├── rnd/                engineering calculation tools; layered layout + tools/
│   │   └── service/            EMPTY scaffold (api/, models/, repositories/, schemas/, services/, tests/ all empty) — not imported in main.py, not a functioning module
│   ├── services/               cross-module services (e.g. notifications/email helpers used app-wide)
│   ├── static/                 Public static file mount (/static, exempted from auth middleware)
│   ├── tasks/                  Background/scheduled task definitions (e.g. activity follow-up reminders)
│   ├── tests/                  Top-level e2e/, integration/, unit/ test suites
│   ├── utils/                   Shared utilities (notifications.py, sharepoint.py, templates/)
│   └── main.py                  FastAPI app instance, middleware wiring, router mounting, startup/shutdown
├── venv/                       Local Python virtualenv (Python 3.14.3 per venv/pyvenv.cfg)
└── requirements.txt
```

Purpose of each top-level backend folder:
- **`alembic/`** — schema is Alembic-managed; `app/main.py` explicitly no longer calls `create_all()`. All schema changes must go through a migration in `alembic/versions/`.
- **`app/auth/`** — Azure AD OAuth login flow and session/JWT issuance, separate from per-request access-control (`app/core/permissions.py`).
- **`app/common/`** — small cross-cutting helpers (exceptions, pagination) shared by multiple modules, not tied to one business domain.
- **`app/core/`** — application-wide configuration (`config.py`), DB session dependency (`get_db`), and permission dependencies (`permissions.py`).
- **`app/db/`** — the declarative `Base` and reusable mixins (`TimestampMixin`, `SoftDeleteMixin`) that models inherit from.
- **`app/middleware/`** — request-level cross-cutting concerns: OWASP-style security checks and logging (`owasp.py`), external API-key auth (`api_key.py`), global exception formatting (`error_handler.py`), rate-limit storage (`rate_store.py`).
- **`app/modules/`** — one subpackage per business domain; see [MODULE_DOCUMENTATION.md](./MODULE_DOCUMENTATION.md) for what each contains and its key invariants.
- **`app/services/`**, **`app/utils/`** — shared logic not specific to one module (SharePoint upload helper, notification/email sending).
- **`app/static/`** — files served directly, deliberately excluded from the auth pre-check in `owasp.py`.
- **`app/tasks/`** — scheduled jobs run by the APScheduler instance started in `main.py`.
- **`app/tests/`** — repo-wide test suite, distinct from the smaller per-module `tests/` directories inside `crm`, `main`, and `rnd`.

## `frontend/`

```
frontend/
├── src/
│   ├── app/                        Next.js App Router pages
│   │   ├── auth/teams-success/       Post-auth redirect target for Teams-embedded login
│   │   ├── dashboard/                 Authenticated app shell
│   │   │   ├── crm/, erp/, purchase/, p2p/, rnd/, users/   one folder per module's UI
│   │   ├── legal/permissions/, privacy-policy/, terms-of-use/    static legal pages
│   │   └── login/                    Login page
│   ├── components/                   Reusable UI components, grouped by module (crm/, erp/, legal/, purchase/, rnd/) plus shared ones (e.g. Sidebar.tsx)
│   ├── hooks/                         Custom hooks (e.g. useAuth.ts)
│   ├── lib/                           api.ts (axios client + interceptors), theme.ts (design tokens)
│   ├── store/                         Zustand stores (authStore.ts)
│   ├── styles/                        Global CSS
│   ├── types/                         Shared TypeScript types (index.ts)
│   └── utils/                         Frontend-only utility functions
├── next.config.ts                     Standalone output, CSP frame-ancestors for Teams embedding, /api/* rewrite to backend
├── tailwind.config.js                  Present but not used by dashboard pages — see CODING_STANDARDS.md
└── package.json                        next 16.2.11, react/react-dom 19.2.4, typescript ^5; no "engines" field
```

Purpose of each top-level frontend folder:
- **`app/`** — Next.js App Router route tree; folder nesting = URL path. `dashboard/<module>/` mirrors backend module boundaries.
- **`components/`** — presentational and form components, organized by the same module boundaries as `app/dashboard/`.
- **`hooks/`** — reusable stateful logic (auth check, data fetching helpers) shared across pages.
- **`lib/`** — the axios client (`api.ts`, includes 401-handling interceptor — see [ERROR_HANDLING.md](./ERROR_HANDLING.md)) and the design-token module (`theme.ts` — see [CODING_STANDARDS.md](./CODING_STANDARDS.md)).
- **`store/`** — Zustand global state, primarily authentication (`authStore.ts`).
- **`types/`** — shared TypeScript interfaces mirroring backend response schemas.

## Cross-references

- Module-by-module business logic: [MODULE_DOCUMENTATION.md](./MODULE_DOCUMENTATION.md)
- System architecture diagrams: [../architecture/](../architecture/)
- Database schema details: [../database/](../database/)
