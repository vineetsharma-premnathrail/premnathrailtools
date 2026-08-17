# Docker

There is exactly **one** Dockerfile in this repo, at the repo root
(`Dockerfile`), plus one entrypoint script (`docker-entrypoint.sh`).
There is no `docker-compose.yml` and no separate backend/frontend
Dockerfiles — everything below is a straight read of those two files.

## Image overview

Multi-stage build producing a single image that runs both the FastAPI
backend and the Next.js frontend. Only the frontend's port (3000) is
exposed; the backend binds to `127.0.0.1:8000` inside the container and
is never reachable from outside it directly.

### Stages

| Stage | Base | Purpose |
|---|---|---|
| `backend-deps` | `python:3.12-slim` | Installs `backend/requirements.txt` into an isolated prefix (`--prefix=/install`), plus `libpq5` |
| `frontend-deps` | `node:22-alpine` | `npm ci` for the frontend |
| `frontend-builder` | `node:22-alpine` | Copies frontend source + deps, runs `npm run build` (standalone Next.js output) |
| `production` | `python:3.12-slim` | Final runtime image — combines the installed Python packages, backend source, and built frontend |

### What's installed in the final `production` stage

- `curl`, `ca-certificates`, `gnupg`, `libpq5`
- A full **TeX Live** install (`texlive-latex-base`, `texlive-latex-recommended`,
  `texlive-latex-extra`, `texlive-fonts-recommended`, `texlive-science`,
  `lmodern`) — needed because the backend's R&D module
  (`backend/app/modules/rnd`) generates PDF reports via
  `reportlab`/`jinja2`/LaTeX-style templates
- **Node.js 22** (installed via the NodeSource setup script), so the
  final image can run the built Next.js standalone server
- A non-root user `appuser` (uid 10001) — the container does **not**
  run as root

This makes the final image large (Python + Node + full TeX Live), which
is expected and intentional given the PDF-generation requirement — don't
"optimize" it away without checking the R&D module's PDF export still
works.

### What's copied into the final stage

```
backend/alembic.ini, backend/alembic/, backend/app/   ← from source, not from a build stage
frontend/public/                                       ← from frontend-builder
frontend/.next/standalone/  → ./frontend                ← from frontend-builder
frontend/.next/static/      → ./frontend/.next/static   ← from frontend-builder
docker-entrypoint.sh        → /usr/local/bin/            ← chmod +x, chown to appuser
```

Backend Python dependencies come from `backend-deps`'s `/install` prefix
copied to `/usr/local` — not reinstalled in the final stage.

## Build args

| Arg | Default | Effect |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `/api/v1` | Baked into the client JS bundle at `npm run build` time. Default is a same-origin relative path, relying on the frontend's own `/api/*` rewrite to reach the internal backend — so no build arg is required for the normal single-container deployment. |

```bash
docker build -t premnathrail-portal:latest .
# only needed if you want a non-default API base path/origin:
docker build --build-arg NEXT_PUBLIC_API_URL=https://example.com/api/v1 -t premnathrail-portal:latest .
```

## Runtime environment variables

Set at `docker run` time (read by the Python app via
`backend/app/core/config.py`, `pydantic-settings`, from real process env
— not baked into the image):

- `DATABASE_URL`, `SECRET_KEY`, `ENVIRONMENT`
- `ALLOWED_ORIGINS`, `ALLOWED_HOSTS`, `TRUSTED_PROXIES`
- `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_REDIRECT_URI`, `DOMAIN_EMAIL`
- `SECURE_COOKIES`, `ACCESS_TOKEN_EXPIRE_MINUTES`
- `SHAREPOINT_SITE_ID`, `SHAREPOINT_FOLDER`
- `SENDER_EMAIL`, `TEAM_EMAIL`, `PURCHASE_EMAIL`, `APP_BASE_URL`

Fixed by the image itself (`ENV` in the Dockerfile, not overridable
without a rebuild in any meaningful way): `PYTHONUNBUFFERED=1`,
`PYTHONDONTWRITEBYTECODE=1`, `PORT=3000`, `HOSTNAME=0.0.0.0`.

Full meaning of each app setting is in
[SERVER_CONFIGURATION.md](SERVER_CONFIGURATION.md).

## Entrypoint behavior (`docker-entrypoint.sh`)

Runs as PID management for two processes inside one container:

1. `cd backend && alembic upgrade head` — **migrations run automatically
   on every container start**, before the backend even starts listening.
2. Starts `uvicorn app.main:app --host 127.0.0.1 --port 8000` in the
   background (backend, internal only).
3. Sets a trap: if the backend process dies for any reason, the
   entrypoint kills the whole container rather than leaving a frontend
   running against a dead API.
4. `exec`s the image's `CMD` in the foreground — `node
   /app/frontend/server.js` (the Next.js standalone server), which is
   what actually serves traffic on port 3000.

Because of step 1, there is no separate manual "apply migrations" step
in a normal deploy — it happens on container start. For manual/offline
migration runs (e.g. against a copy of the DB), see
[RUNBOOK.md](../runbook/RUNBOOK.md).

## Running

```bash
docker build -t premnathrail-portal:latest .
docker run -d --name premnathrail-portal -p 80:3000 \
  -e DATABASE_URL="postgresql+psycopg://user:pass@host:5432/premnathrail" \
  -e SECRET_KEY="<32+ chars>" \
  -e ENVIRONMENT=production \
  premnathrail-portal:latest
```

## Things confirmed absent

- No `docker-compose.yml` anywhere in the repo
- No separate backend-only or frontend-only Dockerfile
- A `.dockerignore` exists at the repo root and keeps local artifacts
  (`node_modules`, `.next`, `venv`, etc.) out of the build context —
  check it before adding new top-level directories

---

**See also:** [DEPLOYMENT.md](DEPLOYMENT.md) for the full deploy flow,
[SERVER_CONFIGURATION.md](SERVER_CONFIGURATION.md) for what each env var
controls.
