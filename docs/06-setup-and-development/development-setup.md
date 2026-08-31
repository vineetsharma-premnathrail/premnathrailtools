# ERP-PremnathRail — Development Setup

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Setup & Development
**Document:** Development Setup
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the local development setup required to run and maintain ERP-PremnathRail.

It covers:

* Development prerequisites
* Backend setup
* Frontend setup
* Database setup
* Microsoft Entra ID requirements
* Environment configuration
* Database migrations
* Running the application
* Testing
* Common development issues

The application consists of a FastAPI backend and a Next.js frontend.

---

# 2. Development Architecture

```text
Developer Machine
│
├── Backend
│   ├── FastAPI
│   ├── SQLAlchemy
│   ├── Alembic
│   └── PostgreSQL
│
└── Frontend
    ├── Next.js
    ├── React
    └── TypeScript
```

External services include:

```text
Microsoft Entra ID
Microsoft Graph
SharePoint
Microsoft Teams
```

---

# 3. Prerequisites

## 3.1 Python

The current local virtual environment was created using:

```text
Python 3.14.3
```

There is currently no:

```text
pyproject.toml
runtime.txt
.python-version
```

pinning an exact Python version.

Therefore Python 3.14 should be treated as the current working baseline.

---

# 4. Node.js

The frontend uses:

```text
Next.js 16.2.11
React 19.2.4
React DOM 19.2.4
TypeScript 5.x
```

The project currently does not define:

```text
engines
.nvmrc
```

Therefore a specific Node.js version is not currently enforced by repository tooling.

Use a Node.js version compatible with the installed dependency versions.

---

# 5. PostgreSQL

ERP-PremnathRail uses PostgreSQL.

The database must be created before running the backend.

Database configuration is supplied through:

```text
DATABASE_URL
```

The database schema is managed through Alembic migrations.

---

# 6. Microsoft Entra ID

Microsoft Entra ID is required for application authentication.

Required configuration includes:

```text
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
AZURE_TENANT_ID
AZURE_REDIRECT_URI
```

The Microsoft Entra application registration must contain the correct redirect URI.

---

# 7. OAuth Redirect URI

The authentication router is mounted under:

```text
/api/v1
```

and the authentication router itself uses:

```text
/auth
```

Therefore the actual callback endpoint is:

```text
http://localhost:8000/api/v1/auth/callback
```

This exact URL must be registered in Microsoft Entra ID for local development.

---

# 8. Backend Directory

Backend development is performed from:

```text
backend/
```

The backend contains:

```text
app/
requirements.txt
alembic.ini
alembic/
```

---

# 9. Create / Activate Virtual Environment

If a new environment is required:

```powershell
cd backend

python -m venv venv
```

Activate it on Windows:

```powershell
venv\Scripts\Activate.ps1
```

---

# 10. Install Backend Dependencies

Install dependencies using:

```powershell
pip install -r requirements.txt
```

The installed packages must correspond to the versions required by the application.

---

# 11. Backend Environment File

Create:

```text
backend/.env
```

The file contains environment-specific configuration.

The complete configuration reference is maintained separately in:

```text
environment-variables.md
```

For full functionality, configure values for:

* PostgreSQL
* Microsoft Entra ID
* Session security
* SharePoint
* Email
* Application URLs
* CORS
* Trusted hosts

---

# 12. Apply Database Migrations

The application does not automatically create the database schema through:

```python
Base.metadata.create_all()
```

Database schema creation and modification are managed through Alembic.

Run:

```powershell
cd backend
alembic upgrade head
```

---

# 13. Start Backend

Run:

```powershell
uvicorn app.main:app --reload
```

The development backend normally runs on:

```text
http://localhost:8000
```

---

# 14. Backend Health Check

After starting the backend, verify:

```text
/health
```

The expected response contains:

```json
{
  "status": "ok",
  "app": "Premnathrail Portal",
  "version": "1.0.0",
  "environment": "development"
}
```

---

# 15. Backend Testing

Run the complete backend test suite from:

```text
backend/
```

using:

```powershell
pytest
```

This is preferred over running only:

```powershell
pytest app/tests -v
```

because the repository also contains module-local tests.

---

# 16. Backend Test Structure

The test tree includes:

```text
backend/app/tests/
├── e2e/
├── integration/
└── unit/
```

Additional module-level tests exist within modules such as:

```text
crm/
main/
rnd/
```

---

# 17. Frontend Directory

Frontend development is performed from:

```text
frontend/
```

The application is built using:

```text
Next.js
React
TypeScript
```

---

# 18. Install Frontend Dependencies

Run:

```powershell
cd frontend
npm install
```

This installs the dependencies defined in:

```text
frontend/package.json
```

---

# 19. Frontend Environment

An optional local environment file can be created:

```text
frontend/.env.local
```

Example:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

This variable specifies the backend API base URL.

---

# 20. Frontend API Fallback

If:

```text
NEXT_PUBLIC_API_URL
```

is not configured, the frontend falls back to:

```text
http://localhost:8000/api/v1
```

The configuration is read from:

```text
frontend/src/lib/api.ts
```

---

# 21. Start Frontend

Run:

```powershell
npm run dev
```

The development frontend normally runs on:

```text
http://localhost:3000
```

---

# 22. Local Full-Stack Architecture

When running both applications locally:

```text
Browser
│
├── http://localhost:3000
│        ↓
│     Next.js
│
└── http://localhost:8000
         ↓
       FastAPI
         ↓
      PostgreSQL
```

The frontend communicates with the backend using the configured API URL.

---

# 23. CORS Configuration

The backend must allow the frontend development origin.

The default development configuration includes:

```text
http://localhost:3000
http://localhost:5173
http://127.0.0.1:3000
```

If the frontend is served from another origin, update:

```text
ALLOWED_ORIGINS
```

in:

```text
backend/.env
```

---

# 24. Development Styling Convention

Dashboard pages currently use inline React style objects with design tokens.

Design tokens are located at:

```text
frontend/src/lib/theme.ts
```

New dashboard UI should follow the existing convention.

Tailwind CSS is installed but is not the active styling convention for existing dashboard pages.

---

# 25. Production Mode Testing

If production behavior needs to be tested locally:

```text
ENVIRONMENT=production
```

must be configured.

In production mode, `SECRET_KEY` must:

* Exist
* Not be the placeholder `...`
* Contain at least 32 characters

Otherwise the backend refuses to start.

---

# 26. Development vs Production

| Area            | Development               | Production                    |
| --------------- | ------------------------- | ----------------------------- |
| Frontend        | `localhost:3000`          | Deployed application domain   |
| Backend         | `localhost:8000`          | Internal/application backend  |
| Database        | Development PostgreSQL    | Production PostgreSQL         |
| Cookies         | Development configuration | Secure HTTPS cookies          |
| CORS            | Local origins             | Restricted production origins |
| Hosts           | Local hosts               | Production hosts              |
| Secret          | Development secret        | Strong unique secret          |
| Microsoft Entra | Development redirect      | Production redirect           |

---

# 27. Production Frontend Architecture

The production Next.js configuration uses:

```text
output: "standalone"
```

API requests are rewritten through:

```text
/api/:path*
```

to:

```text
http://127.0.0.1:8000/api/:path*
```

The intended architecture is:

```text
Internet
   ↓
Application Domain
   ↓
Next.js
   ↓
127.0.0.1:8000
   ↓
FastAPI
```

The backend is therefore not required to be externally exposed directly.

---

# 28. Database Migration Workflow

When database models change:

```text
Model Change
     ↓
Create Alembic Migration
     ↓
Review Migration
     ↓
Apply Migration
     ↓
Test Application
```

Development databases should be updated using:

```powershell
alembic upgrade head
```

Do not rely on automatic ORM table creation.

---

# 29. Recommended Development Startup Sequence

```text
1. Start PostgreSQL
2. Activate backend environment
3. Configure backend/.env
4. Run Alembic migrations
5. Start FastAPI
6. Verify /health
7. Install frontend dependencies
8. Configure frontend/.env.local if required
9. Start Next.js
10. Open the application
```

---

# 30. Authentication Development

Authentication requires:

```text
Microsoft Entra ID
      ↓
OAuth
      ↓
ERP Callback
      ↓
ERP Session
```

The local redirect URI must exactly match the value registered in Microsoft Entra ID.

---

# 31. SharePoint Development

SharePoint functionality additionally requires:

```text
SHAREPOINT_SITE_ID
SHAREPOINT_FOLDER
```

and valid Microsoft Graph application credentials.

Without these settings, SharePoint-dependent functionality cannot be exercised correctly.

---

# 32. Email Development

Email functionality requires:

```text
SENDER_EMAIL
TEAM_EMAIL
PURCHASE_EMAIL
RND_EMAIL
```

and valid Microsoft Graph application credentials.

---

# 33. Teams Development

Teams-specific functionality requires:

* Teams application configuration
* Microsoft Entra configuration
* Correct application domain
* Teams manifest
* Teams SSO configuration
* Appropriate CSP `frame-ancestors` configuration

Teams functionality should be tested in an actual Teams environment when validating Teams-specific behavior.

---

# 34. Common Issue — Backend Cannot Start

Check:

```text
Python environment
requirements.txt
backend/.env
DATABASE_URL
SECRET_KEY
```

Then review the backend startup error.

---

# 35. Common Issue — PostgreSQL Connection Error

Verify:

```text
DATABASE_URL
PostgreSQL service
Database name
Username
Password
Port
```

Then run:

```powershell
alembic upgrade head
```

to confirm that the application can connect to the database.

---

# 36. Common Issue — Azure Authentication Failure

Verify:

```text
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
AZURE_TENANT_ID
AZURE_REDIRECT_URI
```

Also verify that the redirect URI registered in Microsoft Entra ID exactly matches:

```text
http://localhost:8000/api/v1/auth/callback
```

---

# 37. Common Issue — Frontend Cannot Reach Backend

Verify:

```text
NEXT_PUBLIC_API_URL
```

and:

```text
ALLOWED_ORIGINS
```

The development frontend normally uses:

```text
http://localhost:3000
```

and the backend API normally uses:

```text
http://localhost:8000/api/v1
```

---

# 38. Common Issue — Port Already in Use

If port `8000` is occupied, the backend cannot start on its default port.

If port `3000` is occupied, Next.js may select another development port.

Ensure the frontend API URL and backend CORS configuration correspond to the actual ports being used.

---

# 39. Common Issue — `ModuleNotFoundError`

If Python reports:

```text
ModuleNotFoundError: No module named 'app'
```

ensure the command is executed from:

```text
backend/
```

For example:

```powershell
cd backend
uvicorn app.main:app --reload
```

---

# 40. Development Documentation

The following documents should be consulted during development:

```text
configuration.md
environment-variables.md
coding-standards.md
project-structure.md
```

Architecture and database information is maintained under:

```text
docs/01-architecture/
docs/03-database/
```

---

# 41. Development Change Rules

Update this document when:

* Required development prerequisites change.
* Backend startup procedure changes.
* Frontend startup procedure changes.
* Database migration workflow changes.
* Authentication setup changes.
* Local environment configuration changes.
* Development testing workflow changes.
* New mandatory development dependencies are introduced.

---

# 42. Historical Versions

Previous approved versions should be retained.

Example:

```text
v1.0
Initial development setup

v1.1
Minor setup changes

v1.2
Additional development dependency

v2.0
Major development architecture change
```

The current version represents the active development process.

---

# 43. Related Documents

* Configuration
* Environment Variables
* Coding Standards
* Project Structure
* Project Charter
* BRD
* PRD
* HLD
* LLD
* Microsoft Graph Integration
* SharePoint Document Storage
* Microsoft Teams Integration
* Deployment Documentation
* Database Documentation

---

# 44. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 45. Document Information

**Document:** Development Setup
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Setup & Development
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
