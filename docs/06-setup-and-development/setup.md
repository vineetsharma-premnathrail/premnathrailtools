# ERP-PremnathRail — Setup Guide

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Setup & Development
**Document:** Setup Guide
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the standard procedure for installing and running ERP-PremnathRail in a development environment.

ERP-PremnathRail is a modular monolith consisting of:

* FastAPI backend
* Next.js frontend
* PostgreSQL database
* Microsoft Entra ID authentication
* Microsoft Graph / SharePoint integration
* Microsoft Teams integration

The application currently contains business modules including ERP, CRM, Purchase, P2P, R&D, Design, Electrical, HR, Store, and Vendor.

---

# 2. Prerequisites

The development machine should have:

| Requirement             | Purpose                                     |
| ----------------------- | ------------------------------------------- |
| Python 3.14             | Backend runtime                             |
| PostgreSQL 18           | Application database                        |
| Node.js                 | Frontend runtime                            |
| Git                     | Source control                              |
| Microsoft Azure account | Microsoft authentication configuration      |
| Docker                  | Optional PostgreSQL development environment |

The current local Python environment uses Python 3.14.3.

The frontend currently uses Next.js 16.2.11, React 19.2.4, and TypeScript 5.x.

---

# 3. Database Setup

## 3.1 Local PostgreSQL

Connect to PostgreSQL:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres
```

Create the database:

```sql
CREATE DATABASE premnathrail_portal;
```

Exit:

```sql
\q
```

---

## 3.2 PostgreSQL Using Docker

For development, PostgreSQL can alternatively be started using:

```bash
docker run --name postgres-premnathrail \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=premnathrail_portal \
  -p 5432:5432 \
  -d postgres:18
```

The database name must match the database configured in `DATABASE_URL`.

---

# 4. Microsoft Entra ID Setup

Microsoft Entra ID is the application's identity provider.

The ERP does not maintain an independent username/password authentication system.

## 4.1 Register Application

Open the Microsoft Azure Portal and navigate to:

```text
Microsoft Entra ID
→ App registrations
→ New registration
```

Create an application such as:

```text
Premnathrail Portal Dev
```

Use the organizational-directory account type required by the organization.

---

# 5. Retrieve Microsoft Entra Credentials

From the application registration obtain:

### Application / Client ID

Configure as:

```text
AZURE_CLIENT_ID
```

### Directory / Tenant ID

Configure as:

```text
AZURE_TENANT_ID
```

### Client Secret

Create a client secret under:

```text
Certificates & secrets
→ New client secret
```

Configure its value as:

```text
AZURE_CLIENT_SECRET
```

The client secret must be treated as confidential.

---

# 6. Configure OAuth Redirect URI

Under the application's Web authentication configuration, register:

```text
http://localhost:8000/api/v1/auth/callback
```

This exact path is required because the authentication router is mounted under:

```text
/api/v1
```

with the authentication route:

```text
/auth/callback
```

Therefore the effective callback is:

```text
/api/v1/auth/callback
```

---

# 7. Open the Project

From the repository location:

```powershell
cd D:\Desktop\PremnathrailPortal-Ideal
```

The exact local path may differ between development machines.

---

# 8. Backend Setup

Move into the backend directory:

```powershell
cd backend
```

Create a Python virtual environment:

```powershell
python -m venv venv
```

Activate it:

```powershell
venv\Scripts\activate
```

---

# 9. Install Backend Dependencies

Install the dependencies defined by the project:

```bash
pip install -r requirements.txt
```

---

# 10. Configure Backend Environment

Create:

```text
backend/.env
```

Minimum development configuration:

```env
DATABASE_URL=postgresql+psycopg://postgres:password@localhost:5432/premnathrail_portal

AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
AZURE_TENANT_ID=your-tenant-id

AZURE_REDIRECT_URI=http://localhost:8000/api/v1/auth/callback

DOMAIN_EMAIL=@premnathrail.com

SECRET_KEY=change-this-to-a-random-development-secret

ACCESS_TOKEN_EXPIRE_MINUTES=1440
```

For SharePoint, email, Teams, or other functionality, configure the additional variables documented in **Environment Variables**.

---

# 11. Apply Database Migrations

ERP-PremnathRail uses Alembic for database schema management.

Run:

```bash
cd backend
alembic upgrade head
```

Do not rely on automatic ORM table creation.

---

# 12. Start Backend

Run:

```bash
uvicorn app.main:app --reload
```

The backend will normally be available at:

```text
http://localhost:8000
```

Swagger/OpenAPI documentation:

```text
http://localhost:8000/docs
```

---

# 13. Verify Backend

Run:

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{
  "status": "ok",
  "app": "Premnathrail Portal",
  "version": "1.0.0",
  "environment": "development"
}
```

---

# 14. Verify Through Swagger

Open:

```text
http://localhost:8000/docs
```

Then:

1. Locate `/health`.
2. Select **Try it out**.
3. Select **Execute**.
4. Confirm a successful `200` response.

---

# 15. Run Backend Tests

For the complete test suite, run from `backend/`:

```bash
pytest
```

The repository contains:

```text
app/tests/
├── e2e/
├── integration/
└── unit/
```

Some modules also contain their own tests.

---

# 16. Frontend Setup

Open a second terminal and move to:

```powershell
cd frontend
```

Install dependencies:

```powershell
npm install
```

---

# 17. Frontend Environment

Create the optional file:

```text
frontend/.env.local
```

with:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

The frontend can also use its configured fallback API URL when this variable is not provided.

---

# 18. Start Frontend

Run:

```powershell
npm run dev
```

The frontend normally runs at:

```text
http://localhost:3000
```

---

# 19. Local Full-Stack Architecture

```text
                 Developer Machine
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
   Next.js Frontend            FastAPI Backend
   localhost:3000              localhost:8000
                                      │
                                      ▼
                               PostgreSQL
                               localhost:5432
```

Authentication and external integrations connect through their respective services.

---

# 20. Microsoft Authentication Flow

```text
User
 │
 ▼
ERP-PremnathRail
 │
 ▼
Microsoft Entra ID
 │
 ▼
User Authentication
 │
 ▼
/api/v1/auth/callback
 │
 ▼
ERP Session
```

---

# 21. SharePoint / Microsoft Graph

Document storage functionality requires the appropriate Microsoft Graph and SharePoint configuration.

Relevant environment variables include:

```text
SHAREPOINT_SITE_ID
SHAREPOINT_FOLDER
```

Additional Microsoft credentials must be configured according to the application's authentication and Graph integration configuration.

---

# 22. Microsoft Teams

The application is designed to operate with Microsoft Teams integration.

Teams-related functionality requires appropriate:

* Teams application configuration
* Microsoft Entra configuration
* Application URL
* Teams manifest/configuration
* SSO configuration where applicable

Teams-specific behavior should be validated inside Microsoft Teams.

---

# 23. Common Issue — PostgreSQL

**Symptom:**

```text
could not connect to server
```

Check:

```text
PostgreSQL service
DATABASE_URL
Database name
Username
Password
Port
```

---

# 24. Common Issue — Azure OAuth

**Symptom:**

```text
OAuth not configured
```

Verify:

```text
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
AZURE_TENANT_ID
AZURE_REDIRECT_URI
```

Also confirm that the redirect URI registered in Microsoft Entra ID is exactly:

```text
http://localhost:8000/api/v1/auth/callback
```

---

# 25. Common Issue — Port 8000

**Symptom:**

```text
Address already in use
```

Run the backend on another port:

```bash
uvicorn app.main:app --port 8001 --reload
```

If the backend port changes, update the frontend API configuration accordingly.

---

# 26. Common Issue — Import Error

**Symptom:**

```text
ModuleNotFoundError: No module named 'app'
```

Run Uvicorn from the `backend/` directory:

```bash
cd backend
python -m uvicorn app.main:app --reload
```

---

# 27. Common Issue — CORS

If the frontend cannot communicate with the backend, verify:

```text
ALLOWED_ORIGINS
```

contains:

```text
http://localhost:3000
```

Also verify:

```text
NEXT_PUBLIC_API_URL
```

points to:

```text
http://localhost:8000/api/v1
```

---

# 28. Useful Development Commands

### Start backend

```bash
uvicorn app.main:app --reload
```

### Run all tests

```bash
pytest
```

### Run a specific test

```bash
pytest app/tests/test_auth.py::test_health_endpoint -v
```

### Create migration

```bash
alembic revision --autogenerate -m "Add users table"
```

### Apply migrations

```bash
alembic upgrade head
```

### Start frontend

```bash
npm run dev
```

---

# 29. Development Startup Sequence

```text
1. Start PostgreSQL
        ↓
2. Configure backend/.env
        ↓
3. Activate Python environment
        ↓
4. Install backend dependencies
        ↓
5. Run Alembic migrations
        ↓
6. Start FastAPI
        ↓
7. Verify /health
        ↓
8. Install frontend dependencies
        ↓
9. Configure frontend/.env.local if required
        ↓
10. Start Next.js
        ↓
11. Open ERP-PremnathRail
```

---

# 30. Development Completion Criteria

The development environment is considered operational when:

* PostgreSQL is accessible.
* Alembic migrations complete successfully.
* FastAPI starts successfully.
* `/health` returns `200`.
* Swagger is accessible.
* Microsoft authentication configuration is valid.
* Next.js starts successfully.
* Frontend can communicate with the backend.
* Required external integrations work when configured.
* Backend tests execute successfully.

---

# 31. Setup Change Management

Update this document when:

* Required software changes.
* Installation procedures change.
* Database setup changes.
* Authentication setup changes.
* Frontend setup changes.
* Required environment variables change.
* Migration procedures change.
* Teams/SharePoint setup changes.

---

# 32. Historical Versions

Previous approved versions should be retained.

Example:

```text
v1.0 — Initial setup guide
v1.1 — Development setup update
v1.2 — Authentication/integration update
v2.0 — Major setup architecture change
```

The latest approved version represents the current setup procedure.

---

# 33. Related Documents

* Development Setup
* Configuration
* Environment Variables
* Coding Standards
* Project Structure
* Project Charter
* BRD
* PRD
* Architecture Documentation
* Database Documentation
* Security Documentation
* Microsoft Teams Integration
* SharePoint / Microsoft Graph Integration
* Deployment Documentation

---

# 34. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 35. Document Information

**Document:** Setup Guide
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Setup & Development
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
