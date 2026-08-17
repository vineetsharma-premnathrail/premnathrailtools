# Development Setup

This is the up-to-date local dev guide. It supersedes/corrects the frontend section of [../setup/SETUP.md](../setup/SETUP.md) (which described an early plain-HTML prototype) — read that file for the database and Azure OAuth registration steps, which are still accurate, and read this file for backend version corrections and the real frontend setup.

## Prerequisites

- **Python** — the checked-in local venv (`backend/venv/pyvenv.cfg`) was built against **Python 3.14.3**. `../setup/SETUP.md` says "Python 3.14+", which is consistent with this. There's no `pyproject.toml`/`runtime.txt`/`.python-version` pinning an exact minimum, so treat 3.14 as the working baseline rather than a hard-enforced floor.
- **Node.js** — `frontend/package.json` has **no `"engines"` field** and there's no `.nvmrc`, so no version is actually enforced by tooling. `../setup/SETUP.md`'s "Node.js 24+" claim is not contradicted by anything in the repo, but also isn't verifiable from the repo itself — use whatever current LTS/Current Node version you have that supports Next.js 16 (the app depends on `next@16.2.11`, `react@19.2.4`, `react-dom@19.2.4`, `typescript@^5`).
- **PostgreSQL** — see `../setup/SETUP.md` Step 1 (unchanged, still accurate).
- **Microsoft Azure account** — see `../setup/SETUP.md` Step 2 for OAuth app registration. One correction: the redirect URI must match where the auth router is actually mounted. `backend/app/modules/main/routes/auth.py` declares `APIRouter(prefix="/auth")` and `backend/app/main.py` mounts it with `app.include_router(auth_routes.router, prefix="/api/v1")`, so the real callback path is `http://localhost:8000/api/v1/auth/callback` — register exactly that in Azure (this has been corrected in `../setup/SETUP.md` as well).

## Backend setup

Follow `../setup/SETUP.md` Steps 1–5 (create venv, `pip install -r requirements.txt`, `.env`, `uvicorn app.main:app --reload`, health check, `pytest`), with these corrections layered on top:

1. **`.env` completeness** — the SETUP.md template only lists DB/Azure/JWT vars. In practice `backend/app/core/config.py` defines many more fields that other code paths depend on (SharePoint uploads, email notifications, CORS/host allow-lists). See the full list in [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) — copy that block into `backend/.env` instead of the shorter one in SETUP.md if you plan to exercise attachment uploads, email notifications, or run with `ENVIRONMENT=production`.
2. **Health check response** — `/health` actually returns four keys, not two:
   ```json
   {"status": "ok", "app": "Premnathrail Portal", "version": "1.0.0", "environment": "development"}
   ```
3. **`SECRET_KEY` in production** — if you ever set `ENVIRONMENT=production` locally to test prod behavior, `SECRET_KEY` must be a real 32+ character value (not the placeholder `"..."`) or the app refuses to start — see [CONFIGURATION.md](./CONFIGURATION.md).
4. **Schema is Alembic-managed** — `backend/app/main.py` no longer calls `Base.metadata.create_all()`. After creating the database, run migrations instead of relying on ORM auto-create:
   ```bash
   cd backend
   alembic upgrade head
   ```
5. **Tests** — the real test tree is larger than SETUP.md's 4-test example: `backend/app/tests/{e2e,integration,unit}/` plus per-module `tests/` directories inside `crm`, `main`, and `rnd`. `pytest app/tests -v` from `backend/` still works but only covers the top-level suite; run `pytest` from `backend/` with no path filter to pick up module-local test suites too.

## Frontend setup (replaces SETUP.md Step 6)

The frontend is a real Next.js 16 / React 19 / TypeScript app under `frontend/src/`, not a static HTML page.

```powershell
cd frontend
npm install
```

Create `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```
This is optional for local dev — `frontend/src/lib/api.ts` falls back to exactly that value if the variable is unset:
```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'
```

Run the dev server:
```powershell
npm run dev
```
This starts Next.js on `http://localhost:3000` (the port CORS/`ALLOWED_ORIGINS` in the backend `.env` already expects by default).

In production, `frontend/next.config.ts` uses `output: "standalone"` and rewrites `/api/:path*` to `http://127.0.0.1:8000/api/:path*`, on the assumption that frontend and backend are deployed together behind one origin with the backend bound to loopback only. Locally, with `NEXT_PUBLIC_API_URL` pointing directly at `http://localhost:8000/api/v1`, that rewrite path isn't exercised — both work, just be aware they're two different code paths to the same backend.

### Styling convention for new frontend code

Tailwind is installed (`frontend/tailwind.config.js`) but dashboard pages don't use Tailwind classes — they use inline `style={{...}}` objects sourced from design tokens in `frontend/src/lib/theme.ts`. Match this convention for new dashboard UI; see [CODING_STANDARDS.md](./CODING_STANDARDS.md) for the exact pattern and token names.

## Common issues

See `../setup/SETUP.md`'s "Common Issues" section (PostgreSQL connection errors, Azure OAuth misconfiguration, port conflicts, `ModuleNotFoundError: No module named 'app'`) — those are unchanged and still accurate. One addition:

- **Frontend can't reach the backend / CORS errors** — check `ALLOWED_ORIGINS` in `backend/.env` includes whatever origin `npm run dev` actually serves from (default `http://localhost:3000`), and confirm `NEXT_PUBLIC_API_URL` in `frontend/.env.local` points at the backend's real base URL including the `/api/v1` suffix.

## Cross-references

- [../setup/SETUP.md](../setup/SETUP.md) — database + Azure OAuth registration steps (still current)
- [CONFIGURATION.md](./CONFIGURATION.md) / [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) — full settings reference
- [CODING_STANDARDS.md](./CODING_STANDARDS.md) — conventions to follow once the app is running
- [../architecture/](../architecture/), [../database/](../database/) — system design and schema detail
