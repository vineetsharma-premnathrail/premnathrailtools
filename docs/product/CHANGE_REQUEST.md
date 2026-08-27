# Change Request Document — Premnathrail Portal

> Controls and records requested changes to scope or requirements. Until this document existed, scope changes were recorded only as inline historical flags in `PRODUCT.md` (e.g. the 2026-08-18 Accounts reversal) — see [Scope Document §6](SCOPE_DOCUMENT.md#6-change-control). This document formalizes that process going forward.

## 1. Purpose

Any change to project scope, business requirements, or committed architecture must be logged here before being implemented, so `PROJECT_CHARTER.md`, `SCOPE_DOCUMENT.md`, `BRD.md`, and `PRD.md` don't silently drift out of sync with reality.

## 2. Process

1. **Raise** — anyone (dev, PM, stakeholder) opens a Change Request row below with a clear description and rationale.
2. **Assess** — impact on scope, timeline, risk (cross-reference [Risk Register](RISK_REGISTER.md)), and affected docs.
3. **Decide** — per [Charter §6 Authority](PROJECT_CHARTER.md#6-authority--decision-rights): scope changes need Product Owner/Sponsor sign-off; architectural changes get an ADR.
4. **Apply** — once approved, update `SCOPE_DOCUMENT.md`, `PRODUCT.md`, and any other affected doc in the same change.
5. **Close** — mark the row `Approved & Applied` once all doc updates are done.

## 3. Change Log

| ID | Date | Requested By | Description | Impact | Decision | Status |
|---|---|---|---|---|---|---|
| CR-001 | 2026-08-18 | ⚠️ not recorded (retroactive entry) | Reverse "Accounting/finance module out of scope" — build a full parallel GL/AP/AR ledger for Accounts alongside SAP | Adds a new department module; scoped in `ACCOUNTS_DEPARTMENT_MODULE_PLAN.md` | Approved | Approved & Applied — reflected in `PRODUCT.md`, `SCOPE_DOCUMENT.md` |

*(This is a retroactive backfill of the one scope change found in existing docs. All future scope changes should be logged here at request time, not backfilled.)*

## 4. Template for New Requests

```
| CR-00X | YYYY-MM-DD | <name> | <what's changing and why> | <scope/timeline/risk impact> | Pending | Open |
```

## 5. Escalation

Unresolved requests after 2 weeks should be escalated per [Charter §5 Stakeholders](PROJECT_CHARTER.md#5-stakeholders) — currently Sponsor/PM are unnamed (⚠️), so escalation path itself needs a stakeholder to confirm.

---
*Last updated: 2026-08-27. Add a row here **before** implementing any scope/requirement change — do not backfill except for this initial seed entry.*
