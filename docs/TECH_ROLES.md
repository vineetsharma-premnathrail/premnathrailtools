# Tech Roles — Premnathrail Portal

## Frontend Developer
- Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Zustand, TanStack Query, Chart.js, Axios.
- Owns: pages/routes, forms, dashboards, API client layer, Microsoft Teams tab integration (`@microsoft/teams-js`).
- Follows: `premnathrail-app-design` and `premnathrail-ui-behavior` structural/UI conventions.

## Backend Developer
- Stack: FastAPI, SQLAlchemy 2.0, Pydantic v2, PostgreSQL (psycopg), Alembic migrations, MSAL (Microsoft auth), APScheduler.
- Owns: modules under `backend/app/modules/*`, REST endpoints, DB schema/migrations, business logic (e.g. R&D calculations with reportlab/python-docx for document generation).

## Product Manager (PM)
- Owns: feature scope, prioritization, module roadmap (CRM, P2P, R&D, etc.), stakeholder alignment, release sign-off.
- Works with BA on requirements, with frontend/backend leads on feasibility and sequencing.

## Business Analyst (BA)
- Owns: requirement gathering and documentation, process mapping (e.g. procurement/P2P, R&D technical offer flow), acceptance criteria, gap analysis between business need and implementation.
- Bridges PM's goals and engineering's implementation details.

## QA / Tester
- Owns: test coverage (unit/integration, e.g. CRM organization tests), manual verification of user flows, regression checks across modules.

## DevOps / Infra
- Owns: `infra/`, `Dockerfile`, `docker-entrypoint.sh`, deployment pipeline, environment config, DB migration rollout.

## UI/UX Designer
- Owns: Figma designs, design system consistency, mockups for new pages/screens before frontend implementation.
