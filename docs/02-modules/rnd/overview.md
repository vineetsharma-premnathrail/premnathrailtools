# R&D Module — Overview

**Module:** R&D (Research & Development)
**Backend Location:** `backend/app/modules/rnd/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

The R&D module gives PremnathRail's engineering team a set of purpose-built calculation tools directly inside the portal, instead of scattered spreadsheets each engineer maintains independently. Seven engineering calculators cover the recurring computations R&D performs when sizing or validating a design — braking, hydraulic systems, load distribution, Qmax, spline sizing, tractive effort, and vehicle performance — and every calculation can be exported as a formal PDF or Word report and saved to a shared, searchable history rather than existing only as a one-off screen result.

All routes in this module require `require_app_access("rnd")`. For the calculation-tool routes, this is applied once at the parent router level rather than repeated on every individual route.

---

# 2. The Seven Calculation Tools

Each tool is its own self-contained sub-router mounted under `/rnd/tools/<tool>`, with its own request/response schemas defined in `app/modules/rnd/tools/<tool>/schemas.py`. The seven tools are:

1. **Braking** — braking-system calculations.
2. **Hydraulic** — hydraulic-system calculations.
3. **Load Distribution** — load-distribution calculations.
4. **Qmax** — Qmax calculations.
5. **Spline** — spline-sizing calculations.
6. **Tractive Effort** — tractive-effort calculations.
7. **Vehicle Performance** — vehicle-performance calculations.

A point worth calling out explicitly for anyone integrating against these tools: the route naming across the seven is **not uniform**. Only Braking follows the pattern `braking_calculate` / `braking_report_pdf` / `braking_download_docx`. The other six each have their own shape — most use a plain `/calculate` plus either `/download-report` or, for Hydraulic, an additional `/hydraulic_report_pdf`; Spline is the most distinct, with three separately-named routes (`/calculate`, `/report`, `/docx`) plus a bare `GET /` for the tool's own metadata. This inconsistency is historical rather than intentional, and anyone building a new caller against one of these tools should read that specific tool's own `api.py` and `schemas.py` rather than assuming the pattern from a sibling tool.

Every tool supports generating a formal report of its calculation as a PDF, and most also support a Word (`.docx`) download, so an engineer can attach a properly formatted calculation report to a tender submission, a design review, or a customer deliverable without manually reformatting the raw numbers.

---

# 3. Calculation History

Every calculation-save action snapshots the specific tool's full input and output through a shared `_snapshot_tool_calculation()` helper, so a saved history entry carries enough detail to fully reconstruct what was run and what it produced — not merely the final numeric result. This matters for an engineering tool in particular: being able to go back to a calculation from months earlier and see exactly what inputs produced it is what makes the history usable as a real record rather than a disposable scratchpad.

History routes (`routes/history.py`, mounted at `/rnd/history`):

- **Save** a named calculation result for the calling user.
- **List** the caller's own saved calculations.
- **View detail** of a specific saved calculation — `404` if it doesn't exist, `403` if the caller is neither its owner nor an admin.
- **Rename** a saved calculation (registered under both `PATCH` and `PUT`, routing to the same handler).
- **Delete** a saved calculation, with the same owner-or-admin restriction as viewing detail.
- **Admin-wide views** — a full list of every user's saved calculations, and the distinct set of users who have saved any, both admin-only, giving an R&D lead visibility across the whole team's calculation history rather than only their own.

---

# 4. Access Model

Access to the module as a whole is a single gate — `require_app_access("rnd")` — with no granular sub-permission list, matching CRM and Purchase's whole-module-access approach rather than ERP's per-record permission strings. Within calculation history specifically, viewing, renaming, or deleting a saved calculation is further restricted to that calculation's own owner, or an admin — the one place in this module where a per-record ownership check exists alongside the module-level gate.

---

# 5. What This Module Does Not Do

- R&D's calculators are computation and reporting tools; they do not themselves feed results back into a CRM Inquiry's Costing stage or a Design module document automatically — any such hand-off currently happens outside the system (an engineer manually attaches an exported report where it's needed).
- The module does not maintain a shared parts, materials, or specification library — each calculator's inputs are supplied directly by the engineer running it, not looked up from a catalog.

---

# 6. Related Documentation

- [Design Module Overview](../design/overview.md) — the sibling engineering-document module that stores drawings and specifications, as distinct from R&D's calculation tools.
- [Platform Module](../platform/overview.md) — the shared authentication and module-access model R&D's single-gate authorization is built on.
