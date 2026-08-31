# ERP-PremnathRail — Docker

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Deployment
**Document:** Docker
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the current Docker architecture and operating procedure for ERP-PremnathRail.

The current repository uses:

* One root `Dockerfile`
* One `docker-entrypoint.sh`
* One final production image
* FastAPI backend
* Next.js frontend
* External PostgreSQL database

There is no `docker-compose.yml` and no separate backend/frontend Dockerfiles.

---

# 2. Docker Architecture

ERP-PremnathRail is packaged as a **single Docker image** containing both the frontend and backend.

```text
                         Docker Image
                              │
                    ┌─────────┴─────────┐
                    │                   │
                    ▼                   ▼
              Next.js :3000       FastAPI :8000
              External port       127.0.0.1 only
                    │                   │
                    └─────────┬─────────┘
                              │
                              ▼
                         PostgreSQL
                           External
```

Only port `3000` is exposed externally.

---

# 3. Docker Files

The repository contains:

```text
Dockerfile
docker-entrypoint.sh
.dockerignore
```

There is currently no:

```text
docker-compose.yml
```

and no separate frontend/backend Dockerfiles.

---

# 4. Multi-Stage Build

The Dockerfile uses multiple build stages.

| Stage              | Base Image         | Purpose                       |
| ------------------ | ------------------ | ----------------------------- |
| `backend-deps`     | `python:3.12-slim` | Install Python dependencies   |
| `frontend-deps`    | `node:22-alpine`   | Install frontend dependencies |
| `frontend-builder` | `node:22-alpine`   | Build Next.js application     |
| `production`       | `python:3.12-slim` | Final runtime image           |

---

# 5. Backend Dependencies

The backend dependency stage installs packages from:

```text
backend/requirements.txt
```

Dependencies are installed into:

```text
/install
```

and subsequently copied into the final production image.

The final image does not reinstall these dependencies.

---

# 6. Frontend Dependencies

The frontend dependency stage uses Node.js 22 and executes:

```bash
npm ci
```

The frontend builder then compiles the application using:

```bash
npm run build
```

The build uses Next.js standalone output.

---

# 7. Production Image

The final image contains the required backend, frontend, and runtime dependencies.

It includes:

```text
curl
ca-certificates
gnupg
libpq5
Node.js 22
Python 3.12
TeX Live
```

The image also creates:

```text
appuser
UID: 10001
```

The application does not run as root.

---

# 8. TeX Live Requirement

The production image contains a full TeX Live installation.

This is required by the current R&D PDF-generation functionality.

The installed components include:

```text
texlive-latex-base
texlive-latex-recommended
texlive-latex-extra
texlive-fonts-recommended
texlive-science
lmodern
```

The image should not be reduced by removing these packages without verifying R&D PDF generation.

---

# 9. Files Copied into Production Image

The final image contains the required application files.

```text
backend/alembic.ini
backend/alembic/
backend/app/

frontend/public/
frontend/.next/standalone/
frontend/.next/static/

docker-entrypoint.sh
```

Backend dependencies are copied from the backend dependency stage.

---

# 10. Build Argument

The Docker build supports:

```text
NEXT_PUBLIC_API_URL
```

Default:

```text
/api/v1
```

The default value uses a same-origin API path.

Normal build:

```bash
docker build -t premnathrail-portal:latest .
```

Custom API value:

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://example.com/api/v1 \
  -t premnathrail-portal:latest .
```

---

# 11. Build-Time vs Runtime Configuration

This distinction is important.

### Build-time

```text
NEXT_PUBLIC_API_URL
```

is baked into the frontend bundle during:

```text
npm run build
```

Changing it requires rebuilding the image.

### Runtime

Backend configuration is supplied when the container starts.

Examples:

```text
DATABASE_URL
SECRET_KEY
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
AZURE_TENANT_ID
```

These are not baked into the Docker image.

---

# 12. Runtime Environment Variables

The application reads configuration from the runtime environment.

Important variables include:

```text
DATABASE_URL
SECRET_KEY
ENVIRONMENT

ALLOWED_ORIGINS
ALLOWED_HOSTS
TRUSTED_PROXIES

AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
AZURE_TENANT_ID
AZURE_REDIRECT_URI
DOMAIN_EMAIL

SECURE_COOKIES
ACCESS_TOKEN_EXPIRE_MINUTES

SHAREPOINT_SITE_ID
SHAREPOINT_FOLDER

SENDER_EMAIL
TEAM_EMAIL
PURCHASE_EMAIL
RND_EMAIL
APP_BASE_URL
```

The complete configuration is maintained in the Environment Variables and Server Configuration documents.

---

# 13. Fixed Container Variables

The image defines several fixed runtime values:

```text
PYTHONUNBUFFERED=1
PYTHONDONTWRITEBYTECODE=1
PORT=3000
HOSTNAME=0.0.0.0
```

---

# 14. Entrypoint

The container starts through:

```text
docker-entrypoint.sh
```

Its responsibilities are:

```text
Database Migration
       ↓
Start FastAPI
       ↓
Monitor Backend
       ↓
Start Next.js
```

---

# 15. Automatic Database Migration

At container startup:

```bash
cd /app/backend
alembic upgrade head
```

is executed automatically.

Therefore a normal deployment does not require a separate manual migration command.

---

# 16. Backend Startup

The entrypoint starts:

```bash
uvicorn app.main:app \
  --host 127.0.0.1 \
  --port 8000
```

FastAPI therefore remains internal to the container.

The backend is not directly exposed to the internet.

---

# 17. Backend Failure Handling

The entrypoint monitors the backend process.

If the FastAPI process terminates, the entrypoint terminates the container.

This prevents the frontend from remaining available while its backend API is unavailable.

---

# 18. Frontend Startup

The final foreground process is:

```bash
node /app/frontend/server.js
```

This is the Next.js standalone server.

It listens on:

```text
0.0.0.0:3000
```

---

# 19. Running the Container

Build:

```bash
docker build -t premnathrail-portal:latest .
```

Run:

```bash
docker run -d \
  --name premnathrail-portal \
  -p 80:3000 \
  -e DATABASE_URL="postgresql+psycopg://user:pass@host:5432/premnathrail_portal" \
  -e SECRET_KEY="<32+ chars>" \
  -e ENVIRONMENT=production \
  premnathrail-portal:latest
```

---

# 20. Container Networking

Current networking:

```text
Internet
   │
   ▼
Reverse Proxy
   │
   ▼
Host Port 80
   │
   ▼
Container Port 3000
   │
   ▼
Next.js
   │
   ▼
127.0.0.1:8000
   │
   ▼
FastAPI
```

PostgreSQL remains external to the container.

---

# 21. Docker Security

The production container runs as:

```text
appuser
UID 10001
```

It does not run the application as root.

Sensitive configuration should be supplied at runtime through an approved secret-management mechanism.

---

# 22. Production Secret Requirement

When:

```text
ENVIRONMENT=production
```

is used, `SECRET_KEY` must be:

* Real
* Random
* At least 32 characters
* Not the placeholder value

The application refuses to start when this requirement is violated.

---

# 23. Docker Ignore

The repository contains:

```text
.dockerignore
```

It excludes local development artifacts such as:

```text
node_modules
.next
venv
```

from the Docker build context.

The file should be reviewed whenever new large or environment-specific directories are introduced.

---

# 24. Docker Image Lifecycle

Recommended current lifecycle:

```text
Source Code
     ↓
Docker Build
     ↓
Image Validation
     ↓
Image Tag
     ↓
Registry / Deployment
     ↓
Container Start
     ↓
Database Migration
     ↓
Application Running
```

The current repository does not automate this lifecycle through CI/CD.

---

# 25. Image Tagging

The current documentation uses:

```text
premnathrail-portal:latest
```

For controlled production releases, versioned tags can be introduced:

```text
premnathrail-portal:1.0.0
premnathrail-portal:1.1.0
```

This enables a specific previous image to be identified during rollback.

---

# 26. Docker Troubleshooting

List running containers:

```bash
docker ps
```

View application logs:

```bash
docker logs premnathrail-portal
```

Open a shell:

```bash
docker exec -it premnathrail-portal sh
```

Check the container:

```bash
docker inspect premnathrail-portal
```

---

# 27. Database Troubleshooting

From the appropriate environment, test PostgreSQL connectivity:

```bash
psql "$DATABASE_URL"
```

If migration fails during startup, inspect:

```bash
docker logs premnathrail-portal
```

and verify the database connection and migration state.

---

# 28. Deployment and Rollback Relationship

Docker provides the application image used by the deployment process.

Rollback can use a previously built image:

```bash
docker stop premnathrail-portal
```

followed by starting the previous image version.

However, reverting the Docker image does not automatically revert database migrations.

Database recovery must therefore be considered separately.

---

# 29. Current Docker Limitations

The current repository does not provide:

* Docker Compose
* Kubernetes manifests
* Separate frontend container
* Separate backend container
* Container orchestration
* Automated image publishing
* Automated deployment
* Automated rollback

These are future capabilities rather than current infrastructure.

---

# 30. Docker Change Management

Update this document when:

* Dockerfile architecture changes.
* Build stages change.
* Runtime dependencies change.
* Container ports change.
* Entrypoint behavior changes.
* Frontend/backend packaging changes.
* Docker Compose is introduced.
* Container orchestration is introduced.
* Image publishing becomes automated.

---

# 31. Historical Versions

Previous approved versions should be retained.

Example:

```text
v1.0 — Initial single-image Docker architecture
v1.1 — Runtime configuration update
v1.2 — CI/CD image publishing
v2.0 — Container architecture change
```

---

# 32. Related Documents

* Deployment Guide
* CI/CD
* Backup & Restore
* Server Configuration
* Environment Variables
* Development Setup
* Project Structure
* Coding Standards
* Security Documentation
* Database Migrations

---

# 33. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 34. Document Information

**Document:** Docker
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Deployment
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
