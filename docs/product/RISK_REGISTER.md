# Risk Register — Premnathrail Portal

> Records project/technical risks and mitigation plans. Seeded from risks already flagged (implicitly or explicitly) across `PRODUCT.md`, `DEPARTMENT_MODULES_ROADMAP.md`, and the codebase. Review and re-score quarterly — see [docs/README.md](../README.md) update cadence.

## Scoring Key

Likelihood / Impact: **L**ow, **M**edium, **H**igh. Score = qualitative combination, not multiplied — used for sort order only.

## Active Risks

| ID | Risk | Category | Likelihood | Impact | Score | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| R-01 | Hardcoded module registry (`AVAILABLE_APPS`) becomes unmanageable as more departments are added | Technical | H | M | High | Move to DB-backed module registry before adding more than 2-3 more departments (flagged in `PRODUCT.md` Roadmap) | ⚠️ unassigned | Open |
| R-02 | Two parallel Purchase Requisition implementations (SR-linked `purchase` vs standalone `p2p`) diverge further instead of converging, doubling maintenance cost | Technical | M | M | Medium | Decide convergence direction — documented as an open question in `PRD.md` §10 | ⚠️ unassigned | Open |
| R-03 | Inquiry → customer PO → `erp_projects` linkage may not be fully wired end-to-end | Technical | M | M | Medium | Trace and confirm before building further CRM/ERP integration on top of this boundary (`DEPARTMENT_MODULES_ROADMAP.md`) | ⚠️ unassigned | Open |
| R-04 | User adoption risk — employees continue using spreadsheets/email instead of the portal | Business | M | H | High | Track adoption % (target 80%, see PRD success metrics); no monitoring mechanism currently implemented | ⚠️ unassigned | Open |
| R-05 | Scope creep — new department modules keep getting planned (10 currently on paper) faster than engineering capacity (~2-3 engineers assumed) absorbs them | Business | H | M | High | Prioritize via Project Plan/Tracker (once created); charter-level sign-off before starting a new department | ⚠️ unassigned | Open |
| R-06 | Performance at scale — no load testing evidence found; NFRs state ~100 concurrent users but this is unverified | Technical | L | H | Medium | Add load testing to Test Plan; verify against `NON_FUNCTIONAL_REQUIREMENTS.md` targets | ⚠️ unassigned | Open |
| R-07 | Legacy data migration risk when onboarding a new department or replacing spreadsheet-based tracking | Business | M | M | Medium | No migration tooling/process documented yet | ⚠️ unassigned | Open |
| R-08 | No formal Change Request process — scope changes are currently recorded as ad hoc inline flags in `PRODUCT.md` | Process | H | L | Medium | Create Change Request Document (tracked as pending in `docs/README.md`) | ⚠️ unassigned | Open |
| R-09 | Soft-delete/recycle-bin pattern relies on consistent per-module implementation — a module that skips it breaks the "no permanent delete" business rule (BR-6) | Technical | L | M | Low | Code review checklist should verify recycle bin on every new destructive endpoint | ⚠️ unassigned | Open |
| R-10 | No dedicated Disaster Recovery Plan (distinct from `INCIDENT_RUNBOOK.md`) — RTO/RPO undefined | Operational | L | H | Medium | Create DR Plan (tracked as pending in `docs/README.md`) | ⚠️ unassigned | Open |

## Closed / Reversed Risks

| ID | Risk | Resolution |
|---|---|---|
| R-00 | Accounts/finance functionality duplicating SAP | **Reversed 2026-08-18** — explicitly scoped and approved as a parallel GL/AP/AR system per `ACCOUNTS_DEPARTMENT_MODULE_PLAN.md`; no longer a risk, now a confirmed roadmap item |

## How to Use This Register

1. **Add a risk** when you notice one during development, review, or planning — don't wait for a formal risk workshop.
2. **Review quarterly** alongside the docs index review (`docs/README.md`).
3. **Escalate High score + unassigned owner** items first — most of this initial seed list has no owner yet, which is itself a gap.

---
*Last updated: 2026-08-27. This is a first-pass seed list derived from documented gaps, not a facilitated risk workshop — treat scores as a starting point for a stakeholder to validate.*
