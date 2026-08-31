# ERP-PremnathRail — CI/CD

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Deployment
**Document:** CI/CD
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the current Continuous Integration and Continuous Deployment (CI/CD) status of ERP-PremnathRail.

It distinguishes between:

* What currently exists
* What is currently manual
* Proposed future automation
* Build and test responsibilities
* Deployment automation requirements

---

# 2. Current CI/CD State

ERP-PremnathRail currently has **no configured CI/CD pipeline**.

There is currently no:

```text
.github/workflows/
.gitlab-ci.yml
azure-pipelines.yml
Jenkinsfile
```

or equivalent CI/CD configuration.

Therefore:

```text
Code
  ↓
Manual Testing
  ↓
Manual Build
  ↓
Manual Docker Image
  ↓
Manual Deployment
```

is the current delivery process.

---

# 3. Current Development Validation

## Backend

Backend tests are executed manually using:

```bash
cd backend
pytest
```

The repository contains:

```text
app/tests/
├── e2e/
├── integration/
└── unit/
```

Additional module-specific test suites may also exist.

---

## Frontend

Frontend linting is currently executed manually:

```bash
cd frontend
npm run lint
```

The project currently does not define a frontend test runner in `package.json`.

Therefore no `npm test` pipeline step currently exists.

---

# 4. Current Security Scanning

The repository references `pip-audit` as the intended mechanism for dependency vulnerability checking.

However, there is currently no CI job executing it.

Therefore:

```text
pip-audit
```

should currently be considered a **manual security-validation step**, not an automated CI control.

---

# 5. Current Docker Process

Docker image creation is currently manual.

The existing process is conceptually:

```text
Source Code
    ↓
docker build
    ↓
Docker Image
    ↓
docker push
    ↓
Container Registry
```

No automated image build or publishing workflow currently exists.

---

# 6. Current Deployment Process

Deployment is currently performed manually.

There is no automated:

* Deployment workflow
* Production approval gate
* Automated image promotion
* Automated rollback pipeline

The deployment procedure is documented separately in **Deployment** and **Docker** documentation.

---

# 7. Recommended CI Pipeline

When CI/CD is introduced, the minimum pipeline should validate both backend and frontend.

```text
                    Git Repository
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
          Backend                 Frontend
              │                       │
         Dependencies              npm ci
              │                       │
          pip-audit                  Lint
              │                       │
           pytest                    Build
              │                       │
              └───────────┬───────────┘
                          ▼
                    CI Validation
```

---

# 8. Recommended GitHub Actions Pipeline

The following is a **future proposal** and does not currently run in the repository.

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

jobs:

  backend:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - run: pip install -r backend/requirements.txt

      - run: pip install pip-audit

      - run: pip-audit -r backend/requirements.txt

      - run: cd backend && pytest -v


  frontend:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - run: cd frontend && npm ci

      - run: cd frontend && npm run lint

      - run: cd frontend && npm run build
```

The exact pipeline should be adjusted as the project's test coverage and deployment architecture evolve.

---

# 9. Runtime Versions for CI

The proposed CI configuration uses:

| Component | CI Version |
| --------- | ---------- |
| Python    | 3.12       |
| Node.js   | 22         |

These versions correspond to the current Docker-based runtime baseline referenced by the project.

The local development environment currently uses Python 3.14.3.

---

# 10. Pull Request Validation

Once CI is introduced, pull requests should pass the required automated validation before being merged.

Recommended validation:

```text
Pull Request
     ↓
Backend Tests
     ↓
Dependency Security Scan
     ↓
Frontend Lint
     ↓
Frontend Build
     ↓
Validation Passed
     ↓
Merge
```

---

# 11. Docker Image Pipeline

A future image pipeline should automate:

```text
Git Commit
    ↓
CI Validation
    ↓
Docker Build
    ↓
Image Test
    ↓
Registry Push
```

Images should preferably use identifiable release tags rather than relying only on:

```text
latest
```

---

# 12. Deployment Pipeline

A future production delivery flow can be:

```text
Developer
    ↓
Git Push
    ↓
Pull Request
    ↓
CI
    ↓
Review / Approval
    ↓
Merge to main
    ↓
Build Docker Image
    ↓
Push Registry
    ↓
Deployment Approval
    ↓
Production Deployment
    ↓
Health Check
    ↓
Release
```

---

# 13. Production Deployment Protection

Production deployment should not automatically occur simply because code has been pushed.

A controlled production process should include an approval mechanism appropriate to the organization's deployment policy.

The final production-release authority remains with the project's approved governance structure.

---

# 14. Rollback

A future CI/CD system should support rollback using a previously validated application image.

Conceptually:

```text
Current Release
      ↓
Problem Detected
      ↓
Select Previous Release
      ↓
Deploy Previous Image
      ↓
Health Check
      ↓
Rollback Complete
```

Database rollback must be handled separately because application-image rollback and database-schema rollback are not automatically equivalent.

---

# 15. Database Migration in CI/CD

Database migrations should not be automatically generated during deployment.

The expected process is:

```text
Developer
   ↓
Model Change
   ↓
Alembic Migration
   ↓
Migration Review
   ↓
CI Validation
   ↓
Approved Deployment
   ↓
Migration Execution
```

Database backup requirements are documented separately in **Backup & Restore**.

---

# 16. Environment Separation

CI/CD should distinguish between:

```text
Development
Testing
Staging
Production
```

Production secrets must not be stored directly in source code or committed configuration files.

---

# 17. Secrets

CI/CD credentials should be maintained using the selected CI/CD platform's secure secret-management mechanism.

Sensitive values include, where applicable:

```text
DATABASE_URL
SECRET_KEY
AZURE_CLIENT_SECRET
SharePoint credentials
Registry credentials
Deployment credentials
```

These values must not be exposed in build logs.

---

# 18. Current vs Future State

| Capability              | Current State  | Future State                   |
| ----------------------- | -------------- | ------------------------------ |
| CI pipeline             | Manual         | Automated                      |
| Backend tests           | Manual         | Automated                      |
| Frontend lint           | Manual         | Automated                      |
| Frontend tests          | Not configured | Add when test framework exists |
| `pip-audit`             | Manual         | Automated                      |
| Docker build            | Manual         | Automated                      |
| Image push              | Manual         | Automated                      |
| Deployment              | Manual         | Automated/controlled           |
| Production approval     | Manual         | CI/CD approval gate            |
| Rollback                | Manual         | Release-based rollback         |
| Deployment verification | Manual         | Automated health checks        |

---

# 19. Current Confirmed Gaps

The following are currently absent:

* `.github/workflows/`
* GitHub Actions workflow
* GitLab CI configuration
* Azure Pipelines configuration
* Jenkins configuration
* Automated dependency scanning
* Automated Docker image publishing
* Automated deployment
* Automated rollback pipeline

---

# 20. CI/CD Introduction Strategy

CI/CD should be introduced progressively.

### Phase 1 — CI

```text
Backend Tests
+
Frontend Lint
+
Frontend Build
```

### Phase 2 — Security

```text
Dependency Scanning
+
Security Validation
```

### Phase 3 — Containerization

```text
Automated Docker Build
+
Image Validation
+
Registry Push
```

### Phase 4 — Deployment

```text
Staging Deployment
+
Health Checks
+
Approval
+
Production Deployment
```

### Phase 5 — Operations

```text
Monitoring
+
Rollback
+
Release Tracking
+
Deployment Audit
```

No fixed implementation date is defined because CI/CD adoption depends on project maturity, infrastructure, and team capacity.

---

# 21. CI/CD Change Management

Update this document when:

* A CI platform is selected.
* A pipeline is introduced.
* Build requirements change.
* Testing requirements change.
* Security scanning changes.
* Docker publishing becomes automated.
* Deployment becomes automated.
* Release or rollback procedures change.

---

# 22. Historical Versions

Previous approved versions should be retained.

Example:

```text
v1.0 — Current manual CI/CD state
v1.1 — Initial CI pipeline
v1.2 — Security scanning added
v1.3 — Docker publishing added
v2.0 — Automated deployment introduced
```

---

# 23. Related Documents

* Deployment
* Docker
* Backup & Restore
* Server Configuration
* Development Setup
* Coding Standards
* Environment Variables
* Security Documentation
* Release Management

---

# 24. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 25. Document Information

**Document:** CI/CD
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Deployment
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
