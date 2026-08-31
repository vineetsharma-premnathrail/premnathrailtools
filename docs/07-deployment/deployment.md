# ERP-PremnathRail — Deployment Guide

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Deployment
**Document:** Deployment Guide
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the actual deployment process for ERP-PremnathRail based on the current repository implementation.

The current deployment architecture uses:

* One Docker image
* One application container
* Next.js frontend
* FastAPI backend
* External PostgreSQL database
* External reverse proxy for HTTPS

There is currently no Kubernetes, CDN, load balancer, or separate frontend deployment configured in the repository.

---

# 2. Current Deployment Architecture

The application is packaged into a single Docker image.

```text
                    Internet
                       │
                       ▼
                Reverse Proxy
                 HTTPS / TLS
                       │
                       ▼
              ┌─────────────────┐
              │ Docker Container │
              │                 │
              │ Next.js :3000   │
              │       │         │
              │       ▼         │
              │ FastAPI :8000   │
              │ 127.0.0.1 only  │
              └────────┬────────┘
                       │
                       ▼
                 PostgreSQL
                    External
```

Only port `3000` is exposed from the container. FastAPI listens internally on `127.0.0.1:8000`.

---

# 3. Deployment Components

| Component     | Current Implementation |
| ------------- | ---------------------- |
| Frontend      | Next.js 16             |
| Backend       | FastAPI                |
| Database      | PostgreSQL             |
| Container     | Docker                 |
| Frontend Port | 3000                   |
| Backend Port  | 8000 internal          |
| TLS           | External reverse proxy |
| Database      | External               |
| CI/CD         | Manual                 |
| Kubernetes    | Not configured         |
| CDN           | Not configured         |
| Load Balancer | Not configured         |

---

# 4. Prerequisites

The deployment environment requires:

* Docker
* Reachable PostgreSQL database
* Required environment variables
* Microsoft Entra ID configuration
* SharePoint configuration where required
* Reverse proxy for HTTPS when internet-facing

The repository does not provision the PostgreSQL database automatically.

---

# 5. Build Docker Image

From the project root:

```bash
docker build -t premnathrail-portal:latest .
```

This creates the application image.

The Docker build contains both frontend and backend components.

---

# 6. Frontend Build Configuration

The frontend uses:

```text
NEXT_PUBLIC_API_URL
```

The packaged deployment defaults this value to:

```text
/api/v1
```

This allows the browser to communicate through the same origin while Next.js proxies API requests to the internal FastAPI backend.

---

# 7. Run Production Container

Example:

```bash
docker run -d \
  --name premnathrail-portal \
  -p 80:3000 \
  -e DATABASE_URL="postgresql+psycopg://user:password@db-host:5432/premnathrail_portal" \
  -e SECRET_KEY="<32+ character random secret>" \
  -e ENVIRONMENT=production \
  -e ALLOWED_ORIGINS="https://portal.premnathrail.com" \
  -e ALLOWED_HOSTS="portal.premnathrail.com" \
  -e TRUSTED_PROXIES="<reverse-proxy-ip>" \
  -e AZURE_CLIENT_ID="..." \
  -e AZURE_CLIENT_SECRET="..." \
  -e AZURE_TENANT_ID="..." \
  -e AZURE_REDIRECT_URI="https://portal.premnathrail.com/api/v1/auth/callback" \
  premnathrail-portal:latest
```

The actual production values must be supplied through the organization's approved secret/configuration mechanism.

---

# 8. Database Migration on Startup

The container entrypoint automatically executes:

```bash
alembic upgrade head
```

before starting FastAPI.

Therefore database migrations currently run automatically whenever the container starts.

If the backend process fails, the entrypoint terminates the container rather than leaving the frontend operating against an unavailable API.

---

# 9. Database Deployment

The database is external to the application container.

Configure:

```text
DATABASE_URL
```

to point to the production PostgreSQL instance.

Example:

```text
postgresql+psycopg://user:password@db-host:5432/premnathrail_portal
```

The database itself must be provisioned separately.

---

# 10. Production Secret Requirement

When:

```text
ENVIRONMENT=production
```

is enabled, `SECRET_KEY` must be:

* Set
* Non-placeholder
* At least 32 characters

Otherwise the application refuses to start.

---

# 11. DNS and HTTPS

The application container serves HTTP.

TLS termination is handled externally.

Recommended structure:

```text
Internet
   ↓
HTTPS
   ↓
Reverse Proxy
   ↓
Docker :3000
```

The reverse proxy must be configured with the appropriate host and forwarded-header configuration.

Relevant application settings include:

```text
ALLOWED_HOSTS
TRUSTED_PROXIES
```

---

# 12. Monitoring and Logging

There is currently no external monitoring or centralized log stack configured.

The current deployment provides:

* Uvicorn access logs
* Uvicorn error logs
* OWASP-tagged security logs

Security-related middleware generates structured events using tags such as:

```text
[A01]
[A02]
...
[A10]
```

---

# 13. Frontend Deployment

The frontend is not deployed independently.

It is built as part of the root Dockerfile and included in the final application image.

The production server runs:

```bash
node /app/frontend/server.js
```

The frontend uses Next.js standalone output.

---

# 14. Frontend Production Stack

Current frontend dependencies include:

```text
Next.js 16.2.11
React 19.2.4
React DOM 19.2.4
TypeScript 5.x
ESLint 9.x
Tailwind CSS 4.x
TanStack React Query 5.x
Zustand 5.x
Axios 1.x
Microsoft Teams SDK
Chart.js
```

---

# 15. Frontend Commands

Available frontend commands include:

```bash
npm run dev
```

Local development.

```bash
npm run build
```

Production build.

```bash
npm run start
```

Serve a production build without Docker.

```bash
npm run lint
```

Run ESLint.

---

# 16. API Routing in Production

The packaged deployment uses:

```text
Browser
   ↓
Next.js
   ↓
/api/*
   ↓
FastAPI 127.0.0.1:8000
```

The frontend therefore communicates with the backend through the same application origin.

This avoids the need for cross-origin frontend/backend communication in the packaged deployment.

---

# 17. CORS

CORS is primarily relevant when:

```text
Frontend
   ≠
Backend
```

and they are served from different origins.

In the current packaged single-container deployment, the frontend and backend communicate through the same origin.

CORS remains relevant for:

* Local development
* Future split frontend/backend deployment

---

# 18. Microsoft Teams Deployment

The application supports Microsoft Teams embedding.

The packaged application therefore needs to maintain compatibility with the Teams integration configuration.

Teams-specific authentication and application configuration must be validated after deployment.

---

# 19. Deployment Checklist

Before production deployment:

```text
[ ] Docker build succeeds.

[ ] Backend tests pass.

[ ] Frontend build succeeds.

[ ] Frontend lint succeeds.

[ ] Required environment variables are configured.

[ ] SECRET_KEY is a real 32+ character secret.

[ ] ALLOWED_ORIGINS is correct.

[ ] ALLOWED_HOSTS is correct.

[ ] TRUSTED_PROXIES is correct.

[ ] PostgreSQL is reachable.

[ ] Database migrations apply successfully.

[ ] HTTPS reverse proxy is configured.

[ ] Microsoft Entra configuration is correct.

[ ] SharePoint configuration is correct where required.

[ ] Recent database backup exists.

[ ] Rollback plan is understood.
```

The repository's deployment checklist explicitly includes successful Docker build, backend tests, frontend build/lint, environment configuration, database connectivity, HTTPS, backup, and rollback preparation.

---

# 20. Deployment Flow

```text
Source Code
     ↓
Run Tests
     ↓
Build Docker Image
     ↓
Verify Image
     ↓
Push/Transfer Image
     ↓
Stop Previous Container
     ↓
Start New Container
     ↓
Alembic Migration
     ↓
Application Startup
     ↓
Health Verification
     ↓
Production Release
```

---

# 21. Rollback

There is currently no Kubernetes or other deployment orchestrator performing automated rolling updates.

Rollback is therefore manual.

Example:

```bash
docker stop premnathrail-portal

docker run -d \
  --name premnathrail-portal \
  ... \
  premnathrail-portal:<previous-tag>
```

---

# 22. Database Rollback Warning

Application rollback does **not** automatically roll back database migrations.

For example:

```text
Application v2
      ↓
Database Migration
      ↓
Application v2 fails
      ↓
Rollback to Application v1
```

The database may still contain the schema introduced by the newer migration.

Therefore, the recovery decision may require:

```text
Alembic downgrade
```

or:

```text
Database restore
```

depending on the migration and recovery situation.

---

# 23. Container Troubleshooting

View container logs:

```bash
docker logs premnathrail-portal
```

Open a shell inside the container:

```bash
docker exec -it premnathrail-portal sh
```

---

# 24. Database Connectivity Troubleshooting

Where appropriate, verify PostgreSQL connectivity using:

```bash
psql "$DATABASE_URL"
```

---

# 25. Current Deployment Limitations

The current repository does not contain:

* Kubernetes configuration
* Docker Compose configuration
* Separate frontend Dockerfile
* Separate backend Dockerfile
* CDN configuration
* Vercel configuration
* S3/CDN frontend deployment
* External log aggregation
* Prometheus/Grafana configuration
* Automated deployment pipeline

These should not be treated as current infrastructure.

---

# 26. Future Deployment Evolution

The deployment architecture may evolve as organizational requirements grow.

Potential future architecture:

```text
                 Internet
                    │
                    ▼
             Load Balancer
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
      App Instance        App Instance
          │                   │
          └─────────┬─────────┘
                    ▼
               PostgreSQL
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
       Backups            Monitoring
```

Any future architecture should be documented only after it is actually approved and implemented.

---

# 27. Deployment Change Management

Update this document when:

* Container architecture changes.
* Hosting infrastructure changes.
* Database architecture changes.
* HTTPS/reverse-proxy configuration changes.
* Deployment automation is introduced.
* CI/CD is introduced.
* Monitoring is introduced.
* Frontend/backend deployment is separated.
* Kubernetes or another orchestrator is introduced.

---

# 28. Historical Versions

Previous approved versions should be retained.

Example:

```text
v1.0 — Initial single-container deployment
v1.1 — Deployment configuration update
v1.2 — CI/CD deployment introduced
v2.0 — Infrastructure architecture change
```

---

# 29. Related Documents

* Docker
* CI/CD
* Backup & Restore
* Server Configuration
* Environment Variables
* Development Setup
* Security Documentation
* Database Migrations
* Microsoft Teams Integration
* SharePoint / Microsoft Graph Integration

---

# 30. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 31. Document Information

**Document:** Deployment Guide
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Deployment
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
