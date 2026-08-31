# Vendor Development Department Module — Roadmap

## Current state

**Already substantially built** — not as a separate module, but as the qualification half of the `vendors` table created in [[purchase-department]] Phase 1 (`backend/app/modules/vendor/`). That table was deliberately designed with split ownership from day one: Purchase owns the transactional fields (name, contact, GSTIN, category, payment terms), Vendor Development owns `qualification_status`, `is_avl`, `last_audit_date`, `last_audit_score`, `remarks`.

**Do not build a second vendor table.** If Vendor Development gets its own module identity, it should be a distinct frontend view (`/dashboard/vendor-development`) and possibly its own `require_app_access("vendor_development")` permission scoping write access to just the qualification fields — but it reads and writes the same `vendors` rows Purchase already has.

## Phase 1 — Vendor Development Dashboard & Qualification Workflow

- Dedicated view listing vendors by `qualification_status`, with an onboarding checklist (new sub-table `vendor_onboarding_checklist_items`: vendor id, item description, done/not-done, done-by, done-at) and capability/certification records (`vendor_certifications`: vendor id, certification type, issued date, expiry date).
- Audit scheduling: `vendor_audits` (vendor id, scheduled date, auditor, score, findings) — feeds `vendors.last_audit_date`/`last_audit_score` as a denormalized "latest audit" summary, same mirror-field pattern used throughout the codebase.

## Phase 2 — AVL (Approved Vendor List) Workflow

- Formal AVL approval flow (currently just a boolean `is_avl` flag) — who approved it, when, based on which audit. `vendor_avl_approvals`: vendor id, approved-by, approved-at, audit id it was based on.

## Interconnections

| With | Relationship |
|---|---|
| [[purchase-department]] | **Same underlying `vendors` table** — Purchase already enforces a hard gate (PO creation blocked unless `qualification_status == "qualified"`, implemented in `backend/app/modules/p2p/routes/purchase_orders.py`). Vendor Development is the workflow that actually sets that status; don't duplicate the vendor master |

## Cross-cutting

- If a distinct permission scope is wanted, register `"vendor_development"` in `AVAILABLE_APPS` — otherwise this can ship entirely under the existing `"purchase"` permission with just a UI/routing distinction.
- New sub-tables (`vendor_onboarding_checklist_items`, `vendor_certifications`, `vendor_audits`, `vendor_avl_approvals`) all FK to `vendors.id` — pure additive migrations, no changes to the existing `Vendor` model needed beyond what Purchase Phase 1 already added.
