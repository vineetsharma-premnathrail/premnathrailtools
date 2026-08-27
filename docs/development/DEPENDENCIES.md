# Dependency Documentation — Premnathrail Portal

> Records external libraries, packages, and versions. Generated from `backend/requirements.txt` and `frontend/package.json` as of 2026-08-27 — re-generate rather than hand-edit when dependencies change.

## Backend (`backend/requirements.txt`)

| Package | Version | Purpose |
|---|---|---|
| `fastapi` | 0.115.0 | Web framework |
| `uvicorn[standard]` | 0.30.6 | ASGI server |
| `pydantic` | 2.12.5 | Data validation |
| `pydantic-settings` | 2.7.1 | Settings/env loading (`config.py`) |
| `sqlalchemy` | 2.0.41 | ORM |
| `psycopg[binary]` | >=3.2.10 | PostgreSQL driver |
| `alembic` | 1.18.1 | DB migrations |
| `python-jose[cryptography]` | 3.4.0 | JWT signing/verification |
| `msal` | 1.28.1 | Microsoft auth (Azure AD/Teams) |
| `httpx` | 0.28.1 | HTTP client (Graph API calls) |
| `python-multipart` | 0.0.20 | File upload parsing |
| `apscheduler` | >=3.10,<4 | Scheduled jobs (e.g. follow-up reminders) |
| `jinja2` | 3.1.6 | Templating (R&D report generation) |
| `reportlab` | 4.4.7 | PDF generation |
| `python-docx` | 1.1.2 | DOCX generation (MOM export, R&D reports) |
| `numpy` | >=2.2.6 | R&D calculators — **note**: pinned comment flags no prebuilt wheel for Python 3.14 without a C compiler on this dev machine; watch this on fresh environment setup |

## Frontend (`frontend/package.json`)

### Dependencies
| Package | Version | Purpose |
|---|---|---|
| `next` | 16.2.11 | Framework (App Router) |
| `react` / `react-dom` | 19.2.4 | UI library |
| `@microsoft/teams-js` | ^2.54.0 | Teams SSO integration |
| `@tanstack/react-query` | ^5.101.4 | Server state/data fetching |
| `axios` | ^1.18.1 | HTTP client |
| `chart.js` / `react-chartjs-2` | ^4.5.1 / ^5.3.1 | Charts (reports/dashboards) |
| `js-cookie` | ^3.0.8 | Cookie handling |
| `zustand` | ^5.0.14 | Client state management |

### Dev Dependencies
| Package | Version | Purpose |
|---|---|---|
| `typescript` | ^5 | Type checking |
| `tailwindcss` / `@tailwindcss/postcss` | ^4 | Styling |
| `eslint` / `eslint-config-next` | ^9 / 16.2.11 | Linting |
| `@types/node`, `@types/react`, `@types/react-dom` | ^20 / ^19 | Type definitions |

## Vulnerability Scanning Status

⚠️ **Not automated** — confirmed in [SECURITY.md](../security/SECURITY.md): no CI pipeline exists (`no .github/workflows`), so `pip-audit`/`safety`/`npm audit` are manual, periodic tasks today, not enforced gates. This is the same gap flagged as OWASP A06 in the Threat Model.

## Update Process

1. Bump version in `requirements.txt` / `package.json`
2. Run the full test suite (`pytest app/tests`, plus any frontend tests)
3. Manually run `pip-audit` / `npm audit` since there's no CI gate for this yet
4. Note the change in [CHANGELOG.md](../../CHANGELOG.md)

---
*Last updated: 2026-08-27. Regenerate this table whenever `requirements.txt` or `package.json` changes — don't let it drift from the actual manifest files.*
