# ERP-PremnathRail — Project Structure

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Setup & Development
**Document:** Project Structure
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the repository structure of ERP-PremnathRail.

It is the structural reference for developers working on:

* Backend
* Frontend
* Business modules
* Shared services
* Tests
* Database migrations
* Documentation

The document should be updated when a new top-level directory or business module is introduced.

---

# 2. Repository Architecture

```text id="r9k2mf"
PremnathrailPortal-Ideal/
│
├── backend/
│
├── frontend/
│
└── docs/
```

The repository is divided into three primary areas:

| Directory   | Responsibility                              |
| ----------- | ------------------------------------------- |
| `backend/`  | FastAPI application and database migrations |
| `frontend/` | Next.js / React application                 |
| `docs/`     | Project and technical documentation         |

---

# 3. Backend Structure

```text id="h2k7qp"
backend/
│
├── alembic/
│   └── versions/
│
├── app/
│   ├── auth/
│   ├── common/
│   │   ├── exceptions/
│   │   └── pagination/
│   │
│   ├── core/
│   ├── db/
│   ├── middleware/
│   │
│   ├── modules/
│   │   ├── crm/
│   │   ├── design/
│   │   ├── electrical/
│   │   ├── erp/
│   │   ├── hr/
│   │   ├── item/
│   │   ├── main/
│   │   ├── p2p/
│   │   ├── purchase/
│   │   ├── rnd/
│   │   ├── service/
│   │   ├── store/
│   │   └── vendor/
│   │
│   ├── services/
│   ├── static/
│   ├── tasks/
│   ├── tests/
│   ├── utils/
│   │
│   └── main.py
│
├── venv/
└── requirements.txt
```

---

# 4. Backend Top-Level Directories

## `alembic/`

Database schema migration environment.

All database schema changes should be managed through Alembic migrations.

The application does not rely on:

```python id="9b2fqa"
Base.metadata.create_all()
```

for production schema management.

---

## `app/auth/`

Contains authentication-related functionality.

Primary responsibility:

```text id="0n2t9x"
Microsoft Entra ID
OAuth
Sessions
JWT/authentication logic
```

Authentication is separate from application-level authorization.

---

## `app/common/`

Contains small cross-module utilities that are not specific to one business domain.

Current areas include:

```text id="x7v3pm"
exceptions/
pagination/
```

---

## `app/core/`

Contains application-wide infrastructure.

Examples:

```text id="b7h2n1"
config.py
permissions.py
database/session configuration
```

Responsibilities include:

* Application configuration
* Database dependency
* Permission dependencies
* Core application behavior

---

## `app/db/`

Contains database foundations.

Includes:

```text id="9x3j2a"
Base
TimestampMixin
SoftDeleteMixin
```

Business models inherit shared database behavior from these definitions.

---

## `app/middleware/`

Contains request-level cross-cutting functionality.

Current areas include:

```text id="f1r8sm"
api_key.py
owasp.py
error_handler.py
rate_store.py
```

Responsibilities include:

* API-key authentication
* Security middleware
* Error handling
* Rate-limit storage

---

# 5. Business Modules

Business modules are located under:

```text id="3v9qcw"
backend/app/modules/
```

Current modules:

| Module       | Primary Responsibility               |
| ------------ | ------------------------------------ |
| `crm`        | Customer relationship management     |
| `design`     | Design department                    |
| `electrical` | Electrical department                |
| `erp`        | Projects and service requests        |
| `hr`         | Human resources                      |
| `item`       | Central item master                  |
| `main`       | Platform-level functionality         |
| `p2p`        | Standalone purchase-request workflow |
| `purchase`   | Purchase requisitions                |
| `rnd`        | Engineering calculation tools        |
| `store`      | Store and inventory                  |
| `vendor`     | Vendor management                    |
| `service`    | Empty scaffold                       |

---

# 6. CRM Module

```text id="q5s8mj"
modules/crm/
├── models/
├── schemas/
├── routes/
├── api/
├── reports/
├── repositories/
├── services/
└── tests/
```

CRM follows the layered module structure.

It contains functionality related to:

* Organizations
* Contacts
* Inquiries
* Tenders
* Quotations
* Activities
* Related CRM records

---

# 7. ERP Module

```text id="e3k6wp"
modules/erp/
├── models/
├── schemas/
└── routes/
```

ERP currently follows a flat structure.

The module does not currently contain:

```text id="t2m8cz"
service.py
```

Business logic currently exists within its route implementation.

Major ERP functionality includes:

* Projects
* Service Requests
* Service Materials
* Project attachments

---

# 8. Purchase Module

The Purchase module manages purchase requisitions generated from ERP Service Request material requirements.

It uses:

```text id="h9q2xr"
models/
schemas/
routes/
service.py
reports/
```

---

# 9. P2P Module

P2P provides an independent purchase-request workflow.

It is separate from the Purchase module.

Typical structure:

```text id="y3w7sn"
models/
schemas/
routes/
service.py
```

---

# 10. R&D Module

The R&D module contains engineering calculation functionality.

Its structure follows the layered pattern and includes:

```text id="f7k2xa"
models/
schemas/
routes/
api/
repositories/
services/
tests/
tools/
```

---

# 11. Main Module

The `main` module contains platform-level application functionality.

Examples include:

```text id="w2k8qm"
Users
Authentication
API Keys
Notifications
Feedback
Audit Logs
```

It follows the layered module structure.

---

# 12. Other Department Modules

The repository also contains:

```text id="v7q3hn"
design/
electrical/
hr/
item/
store/
vendor/
```

These represent department/business domains within ERP-PremnathRail.

Their internal structure should follow the conventions established for the specific module.

---

# 13. Service Module Scaffold

The following module exists:

```text id="j5x8qa"
modules/service/
```

It currently contains an empty scaffold:

```text id="n7c4zp"
api/
models/
repositories/
schemas/
services/
tests/
```

It is not currently a functioning business module and is not imported into `main.py`.

New functionality should not automatically be added here without confirming the intended purpose of this scaffold.

---

# 14. Shared Backend Services

```text id="q2v6tm"
app/services/
```

contains application-wide services that are not owned by one specific business module.

These may support functionality such as:

* Notifications
* Email
* Cross-module operations

---

# 15. Shared Utilities

```text id="m8k4yf"
app/utils/
```

contains reusable application utilities.

Examples include:

```text id="s4c9xb"
notifications.py
sharepoint.py
templates/
```

These utilities can be used across multiple business modules.

---

# 16. Static Files

```text id="v3n7ps"
app/static/
```

contains publicly served static files.

The static route is deliberately handled separately from normal authenticated application routes.

---

# 17. Background Tasks

```text id="a6q1zr"
app/tasks/
```

contains background or scheduled task definitions.

Examples include:

* Activity follow-up reminders
* Scheduled application operations

---

# 18. Backend Tests

Repository-wide tests are located at:

```text id="j3w5kc"
app/tests/
├── e2e/
├── integration/
└── unit/
```

Additional module-level tests may exist within individual modules.

---

# 19. Frontend Structure

```text id="d5q7mw"
frontend/
│
├── src/
│   ├── app/
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   ├── store/
│   ├── styles/
│   ├── types/
│   └── utils/
│
├── next.config.ts
├── tailwind.config.js
└── package.json
```

---

# 20. Frontend App Router

The primary route tree is:

```text id="n4f8qp"
frontend/src/app/
```

It contains:

```text id="m1s7dz"
login/
dashboard/
auth/teams-success/
legal/
```

The folder structure maps to Next.js application routes.

---

# 21. Dashboard Structure

The authenticated application is under:

```text id="x9c2wa"
app/dashboard/
```

Module-specific interfaces are organized using module boundaries such as:

```text id="b7p5xr"
crm/
erp/
purchase/
p2p/
rnd/
users/
```

The frontend module structure generally mirrors the backend business boundaries.

---

# 22. Components

Reusable UI components are stored under:

```text id="k8w2mc"
frontend/src/components/
```

Components are organized by module where appropriate.

Examples:

```text id="r6y4qa"
crm/
erp/
purchase/
rnd/
legal/
```

Shared components such as the application sidebar are kept outside individual module directories.

---

# 23. Hooks

Custom React hooks are stored under:

```text id="x4p9zn"
frontend/src/hooks/
```

Examples include authentication and reusable application-state logic.

---

# 24. Frontend Library

Shared frontend infrastructure is stored under:

```text id="b3r7kx"
frontend/src/lib/
```

Important files include:

```text id="f2v8qm"
api.ts
theme.ts
```

`api.ts` contains the API client.

`theme.ts` contains application design tokens.

---

# 25. Frontend State

Global client-side state is maintained under:

```text id="z6q1pv"
frontend/src/store/
```

The current application uses Zustand.

Example:

```text id="c8m4yr"
authStore.ts
```

---

# 26. Frontend Styles

Global CSS is stored under:

```text id="u7s2nd"
frontend/src/styles/
```

Dashboard styling follows the established project styling conventions documented in Coding Standards.

---

# 27. Frontend Types

Shared TypeScript types are stored under:

```text id="p4x8wj"
frontend/src/types/
```

These types represent shared application data structures and API responses where applicable.

---

# 28. Frontend Utilities

Frontend-only helper functions are stored under:

```text id="m6z3qc"
frontend/src/utils/
```

These utilities should remain frontend-specific.

---

# 29. Next.js Configuration

The primary Next.js configuration is:

```text id="q8v5ym"
frontend/next.config.ts
```

It controls areas such as:

* Standalone output
* React strict mode
* API rewrites
* Content Security Policy
* Teams iframe embedding
* Image behavior

---

# 30. Tailwind Configuration

The repository contains:

```text id="w3k7sa"
frontend/tailwind.config.js
```

Tailwind is installed but is not the active styling convention for existing dashboard pages.

The active dashboard convention is documented in **Coding Standards**.

---

# 31. Dependency Configuration

Backend dependencies are defined in:

```text id="r2n6cv"
backend/requirements.txt
```

Frontend dependencies are defined in:

```text id="f8q3mw"
frontend/package.json
```

---

# 32. Module Boundary Principle

Each business module should own its business functionality.

Conceptually:

```text id="j8m4xr"
Module
 ├── Models
 ├── Schemas
 ├── Routes
 ├── Services
 └── Tests
```

Shared functionality should be placed in appropriate application-level locations rather than duplicated across modules.

---

# 33. Adding a New Business Module

When introducing a new module:

```text id="q5v7nb"
1. Define the business responsibility.
2. Create the module package.
3. Define its database models.
4. Define schemas.
5. Define routes.
6. Add services/repositories when required.
7. Add tests.
8. Register required routers.
9. Update documentation.
```

---

# 34. Adding a New Frontend Module

A new frontend module should normally include:

```text id="r8c2zm"
app/dashboard/<module>/
components/<module>/
types/
```

Additional hooks, stores, or utilities should only be introduced when required by the module.

---

# 35. Structural Consistency

The repository currently contains both flat and layered module structures.

This is an accepted characteristic of the current implementation.

New code should follow the structure of the module being modified rather than introducing unnecessary structural changes.

---

# 36. Structural Changes

A structural change should include:

* Code changes
* Relevant tests
* Documentation updates
* Router registration where required
* Database migration where required
* Configuration changes where required

---

# 37. Project Structure Update Rule

This document must be updated when:

* A new top-level backend directory is introduced.
* A new business module is introduced.
* A frontend architectural directory is introduced.
* A module changes its structural architecture.
* A major shared service is introduced.
* Repository architecture changes significantly.

Minor file additions do not require updating this document.

---

# 38. Historical Versions

Previous approved versions should be retained.

Example:

```text id="v4c8qs"
v1.0
Initial repository structure

v1.1
New module added

v1.2
Frontend structure updated

v2.0
Major repository architecture change
```

The current version represents the active repository structure.

---

# 39. Related Documents

* Coding Standards
* Development Setup
* Configuration
* Environment Variables
* Project Charter
* BRD
* PRD
* Software Architecture
* HLD
* LLD
* Database Documentation
* Security Documentation
* Module Documentation

---

# 40. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 41. Document Information

**Document:** Project Structure
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Setup & Development
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
