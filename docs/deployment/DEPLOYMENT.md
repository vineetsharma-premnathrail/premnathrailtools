# Deployment Guide

How Premnathrail Portal is actually built and deployed, based on the
repo's real `Dockerfile` and entrypoint — not a hypothetical target
platform. There is no Kubernetes, no CDN, and no load balancer in this
repo; if you introduce one, update this doc to match.

## Architecture (as it actually exists)

The whole application ships as **one Docker image** containing both the
FastAPI backend and the built Next.js frontend. Only the frontend process
is exposed:

```
┌───────────────────────────────────────────────┐
│ Single container                               │
│                                                 │
│  Node (Next.js standalone server)  :3000  ◄──── EXPOSE 3000 (only port out)
│         │  proxies /api/* to backend           │
│         ▼                                      │
│  uvicorn (FastAPI)  127.0.0.1:8000              │  ← internal only, not exposed
│                                                 │
└───────────────────────────────────────────────┘
                    │
                    ▼
          PostgreSQL (external, via DATABASE_URL)
```

There is no docker-compose file and no separate Dockerfiles for
frontend/backend — see [DOCKER.md](DOCKER.md) for the single root
`Dockerfile` and `docker-entrypoint.sh` in full detail.

## Prerequisites

- Docker (to build/run the image)
- A reachable PostgreSQL database (any host — managed or self-run; this
  repo does not assume RDS/Cloud SQL/etc.)
- Values for the environment variables below (Azure AD app registration,
  SharePoint site, etc.)
- A reverse proxy in front of the container for TLS termination if
  exposed to the internet (the container itself serves plain HTTP on
  port 3000) — see [SERVER_CONFIGURATION.md](SERVER_CONFIGURATION.md)

## Step 1: Build the image

```bash
docker build -t premnathrail-portal:latest .
```

Build args (all optional, baked into the client bundle at build time
since they're `NEXT_PUBLIC_*`):

- `NEXT_PUBLIC_API_URL` — defaults to `/api/v1` (same-origin relative
  path; works out of the box because the frontend proxies `/api/*` to
  the co-located backend, so no build arg is normally needed)

See [DOCKER.md](DOCKER.md) for what each build stage does and why.

## Step 2: Run the container

```bash
docker run -d \
  --name premnathrail-portal \
  -p 80:3000 \
  -e DATABASE_URL="postgresql+psycopg://user:password@db-host:5432/premnathrail" \
  -e SECRET_KEY="<32+ char random secret>" \
  -e ENVIRONMENT=production \
  -e ALLOWED_ORIGINS="https://portal.premnathrail.com" \
  -e ALLOWED_HOSTS="portal.premnathrail.com" \
  -e TRUSTED_PROXIES="<reverse-proxy-ip>" \
  -e AZURE_CLIENT_ID="..." \
  -e AZURE_CLIENT_SECRET="..." \
  -e AZURE_TENANT_ID="..." \
  -e AZURE_REDIRECT_URI="https://portal.premnathrail.com/auth/callback" \
  premnathrail-portal:latest
```

The full list of settings the app reads is in
`backend/app/core/config.py`; see [SERVER_CONFIGURATION.md](SERVER_CONFIGURATION.md)
for what each one means and which are security-relevant.

On startup, `docker-entrypoint.sh` automatically runs `alembic upgrade
head` against `DATABASE_URL` **before** starting uvicorn — migrations are
applied on every container start, not as a separate manual step. If the
backend process dies, the entrypoint intentionally kills the whole
container rather than leaving the frontend running with a dead API.

## Step 3: Database

Point `DATABASE_URL` at a reachable Postgres instance. There is no
database-provisioning automation in this repo — create the database and
role yourself, then let the entrypoint's `alembic upgrade head` create
the schema on first boot. For manual migration runs, see
[RUNBOOK.md](../runbook/RUNBOOK.md).

`environment=production` (via `ENVIRONMENT` env var, mapped to
`Settings.environment`) makes the app **refuse to start** if `SECRET_KEY`
is unset, the placeholder value, or under 32 characters — this is
enforced in code (`Settings._reject_placeholder_secret_in_production`),
not just documentation.

## Step 4: DNS & HTTPS

The container serves plain HTTP on port 3000 only — TLS termination and
DNS are entirely external to this repo. Put a reverse proxy (Nginx,
Traefik, Coolify, etc.) in front of it; see
[SERVER_CONFIGURATION.md](SERVER_CONFIGURATION.md) for the reverse-proxy
headers the app expects (`TRUSTED_PROXIES`, `ALLOWED_HOSTS`) and why they
matter for security, not just routing.

## Step 5: Monitoring & Logging

There is no external log aggregation or metrics stack (no ELK, no
Prometheus/Grafana) configured in this repo. What exists today:

- Uvicorn's own access/error logs on stdout
- `OWASPMiddleware` (`backend/app/middleware/owasp.py`) emits structured,
  OWASP-tagged log lines (`[A01]`…`[A10]`) for security-relevant events
  — see [RUNBOOK.md](../runbook/RUNBOOK.md#monitoring--logging) for how
  to read them

If you add a real log/metrics stack, point it at the container's stdout
and update this section.

## Deployment checklist

- [ ] `docker build` succeeds
- [ ] Backend tests pass (`pytest app/tests`, see [RUNBOOK.md](../runbook/RUNBOOK.md))
- [ ] Frontend builds (`npm run build`) and lints (`npm run lint`)
- [ ] All required env vars set (see [SERVER_CONFIGURATION.md](SERVER_CONFIGURATION.md))
- [ ] `SECRET_KEY` is a real 32+ char secret, not the `"..."` placeholder
- [ ] `ALLOWED_ORIGINS` / `ALLOWED_HOSTS` / `TRUSTED_PROXIES` set correctly for production
- [ ] Database reachable and migrations apply cleanly
- [ ] Reverse proxy in front with HTTPS
- [ ] A recent backup exists — see [BACKUP_RESTORE.md](BACKUP_RESTORE.md)
- [ ] Rollback plan understood (see below)

## Rollback

There is no orchestrator (no Kubernetes) doing rolling updates here.
Rollback is manual:

```bash
docker stop premnathrail-portal
docker run -d --name premnathrail-portal ... premnathrail-portal:<previous-tag>
```

Because migrations run automatically on container start, rolling back the
image does **not** roll back the database schema. If the failed
deployment included a migration, you must decide whether to
`alembic downgrade` or restore from backup (see
[BACKUP_RESTORE.md](BACKUP_RESTORE.md)) — rolling back the image alone
can leave the old code pointed at a newer schema.

## Troubleshooting

See [RUNBOOK.md](../runbook/RUNBOOK.md) for day-to-day operational
troubleshooting (OAuth, permissions, OWASP 400/429s, etc.). Container-level
issues:

```bash
docker logs premnathrail-portal
docker exec -it premnathrail-portal sh
```

Database connectivity:

```bash
# from inside or near the container's network
psql "$DATABASE_URL"
```

---

**Next:** [DOCKER.md](DOCKER.md) for the image build in detail, or
[RUNBOOK.md](../runbook/RUNBOOK.md) for operational procedures.
