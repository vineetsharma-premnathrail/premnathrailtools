# Documentation Index — Premnathrail Portal

Master map of all standard project documents, against the 50-document checklist. ✅ = exists, ⚠️ = partially covered (see note), ❌ = not created yet.

| # | Document | Status | Location |
|---|---|---|---|
| 1 | Project Charter | ✅ | [product/PROJECT_CHARTER.md](product/PROJECT_CHARTER.md) |
| 2 | Business Requirements Document (BRD) | ✅ | [product/BRD.md](product/BRD.md) |
| 3 | Software Requirements Specification (SRS) | ✅ | [requirements/SRS.md](requirements/SRS.md) |
| 4 | Functional Requirements Document (FRD) | ✅ | [requirements/FUNCTIONAL_REQUIREMENTS.md](requirements/FUNCTIONAL_REQUIREMENTS.md) |
| 5 | Product Requirements Document (PRD) | ✅ | [product/PRD.md](product/PRD.md) |
| 6 | User Stories | ✅ | [requirements/USER_STORIES.md](requirements/USER_STORIES.md) |
| 7 | Use Case Document | ✅ | [requirements/USE_CASES.md](requirements/USE_CASES.md) |
| 8 | User Flow Document | ⚠️ | [ui-ux/USER_FLOWS.md](ui-ux/USER_FLOWS.md) — screen-level flows exist; no cross-journey document |
| 9 | Scope Document | ✅ | [product/SCOPE_DOCUMENT.md](product/SCOPE_DOCUMENT.md) |
| 10 | Software Architecture Document (SAD) | ✅ | [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) |
| 11 | High-Level Design (HLD) | ✅ | [architecture/COMPONENT_DIAGRAM.md](architecture/COMPONENT_DIAGRAM.md), [DATA_FLOW_DIAGRAM.md](architecture/DATA_FLOW_DIAGRAM.md) |
| 12 | Low-Level Design (LLD) | ✅ | [architecture/LLD.md](architecture/LLD.md) |
| 13 | Database Design Document | ✅ | [database/](database/) (SCHEMA, ER_DIAGRAM, RELATIONSHIPS, INDEXES, MIGRATIONS) |
| 14 | API Documentation | ✅ | [api/](api/) (API.md + per-module) |
| 15 | UI/UX Design Specification | ✅ | [ui-ux/SCREEN_SPECIFICATIONS.md](ui-ux/SCREEN_SPECIFICATIONS.md) |
| 16 | Design System Documentation | ✅ | [ui-ux/DESIGN_SYSTEM.md](ui-ux/DESIGN_SYSTEM.md) |
| 17 | Technical Specification | ⚠️ | spread across [architecture/](architecture/) + [development/](development/) — no single consolidated doc |
| 18 | Security Requirements Document | ✅ | [security/SECURITY.md](security/SECURITY.md), [PERMISSION_MATRIX.md](security/PERMISSION_MATRIX.md) |
| 19 | Threat Model | ✅ | [security/THREAT_MODEL.md](security/THREAT_MODEL.md) |
| 20 | Test Plan | ✅ | [testing/TESTING.md](testing/TESTING.md) |
| 21 | Test Cases | ✅ | [testing/TEST_CASES.md](testing/TEST_CASES.md) |
| 22 | Test Reports | ✅ | [testing/TEST_REPORT_2026-08-27.md](testing/TEST_REPORT_2026-08-27.md) |
| 23 | Bug/Issue Reports | ✅ | [testing/BUG_TRACKING.md](testing/BUG_TRACKING.md) |
| 24 | Deployment Documentation | ✅ | [deployment/DEPLOYMENT.md](deployment/DEPLOYMENT.md), [FRONTEND_DEPLOYMENT.md](deployment/FRONTEND_DEPLOYMENT.md) |
| 25 | CI/CD Documentation | ✅ | [deployment/CI_CD.md](deployment/CI_CD.md) |
| 26 | Infrastructure Documentation | ⚠️ | [deployment/SERVER_CONFIGURATION.md](deployment/SERVER_CONFIGURATION.md), [DOCKER.md](deployment/DOCKER.md) — no cloud/network topology doc |
| 27 | Configuration Documentation | ✅ | [development/CONFIGURATION.md](development/CONFIGURATION.md) |
| 28 | Environment Documentation | ✅ | [development/ENVIRONMENT_VARIABLES.md](development/ENVIRONMENT_VARIABLES.md) |
| 29 | Operations Runbook | ✅ | [runbook/RUNBOOK.md](runbook/RUNBOOK.md) |
| 30 | Disaster Recovery Plan | ✅ | [maintenance/DISASTER_RECOVERY_PLAN.md](maintenance/DISASTER_RECOVERY_PLAN.md) |
| 31 | Backup & Recovery Documentation | ✅ | [deployment/BACKUP_RESTORE.md](deployment/BACKUP_RESTORE.md) |
| 32 | Monitoring & Alerting Documentation | ✅ | [runbook/MONITORING_ALERTING.md](runbook/MONITORING_ALERTING.md) |
| 33 | User Manual | ✅ | [user-admin/USER_MANUAL.md](user-admin/USER_MANUAL.md) |
| 34 | Administrator Manual | ✅ | [user-admin/ADMIN_MANUAL.md](user-admin/ADMIN_MANUAL.md) |
| 35 | Installation Guide | ✅ | [setup/SETUP.md](setup/SETUP.md) |
| 36 | Release Notes | ✅ | [user-admin/RELEASE_NOTES.md](user-admin/RELEASE_NOTES.md) |
| 37 | Changelog | ✅ | [maintenance/CHANGELOG.md](maintenance/CHANGELOG.md), root `CHANGELOG.md` |
| 38 | Versioning Documentation | ✅ | [development/VERSIONING.md](development/VERSIONING.md) |
| 39 | Coding Standards | ✅ | [development/CODING_STANDARDS.md](development/CODING_STANDARDS.md) |
| 40 | Contribution Guide | ✅ | root `CONTRIBUTING.md` |
| 41 | README | ✅ | root `README.md` |
| 42 | License Documentation | ⚠️ | one line in root `README.md` ("Internal use only") — no dedicated LICENSE file |
| 43 | Dependency Documentation | ✅ | [development/DEPENDENCIES.md](development/DEPENDENCIES.md) |
| 44 | Decision Log / ADR | ✅ | [adr/](adr/) (0001–0003 + template) |
| 45 | Project Plan | ✅ | [product/PROJECT_PLAN.md](product/PROJECT_PLAN.md) |
| 46 | Project Tracker | ✅ | [product/PROJECT_TRACKER.md](product/PROJECT_TRACKER.md) |
| 47 | Risk Register | ✅ | [product/RISK_REGISTER.md](product/RISK_REGISTER.md) |
| 48 | Change Request Document | ✅ | [product/CHANGE_REQUEST.md](product/CHANGE_REQUEST.md) |
| 49 | Acceptance Criteria | ✅ | [requirements/ACCEPTANCE_CRITERIA.md](requirements/ACCEPTANCE_CRITERIA.md) |
| 50 | Software Maintenance Document | ✅ | [maintenance/MAINTENANCE_PROCEDURES.md](maintenance/MAINTENANCE_PROCEDURES.md) |

## Status Summary

- ✅ Complete: 45
- ⚠️ Partial: 5
- ❌ Missing: 0

All 50 documents now exist in some form. Remaining ⚠️ partial items (not full gaps, just narrower than the ideal scope):

1. **User Flow Document** (#8) — screen-level flows exist, no cross-journey document
2. **Technical Specification** (#17) — spread across architecture/development, no single consolidated doc
3. **Infrastructure Documentation** (#26) — server config + Docker exist, no cloud/network topology doc
4. **License Documentation** (#42) — one line in root README, no dedicated LICENSE file
5. See individual docs' own "Known Gaps"/"Action Items" sections (Threat Model §4, Test Report action items, Risk Register unassigned owners, etc.) for content-level gaps within otherwise-complete documents.

## Update Cadence

- **Per feature/PR**: update `API.md`, `SCHEMA.md`, `CHANGELOG.md`, `RELEASE_NOTES.md` for anything the change touches.
- **Per architectural decision**: add a new ADR under `adr/`.
- **Per scope change**: update `SCOPE_DOCUMENT.md` + `PRODUCT.md` together.
- **Quarterly**: review this index — flag any doc not touched in 3+ months, re-verify ⚠️/❌ rows are still accurate.

---
*Last updated: 2026-08-27.*
