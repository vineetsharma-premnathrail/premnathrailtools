# Vendor Module — Overview

**Module:** Vendor
**Backend Location:** `backend/app/modules/vendor/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

The Vendor module maintains PremnathRail's supplier master data — the single `Vendor` table that both the procurement side of the business (raising POs against a vendor) and the vendor-qualification side of the business (onboarding, certification, Approved Vendor List status) share, rather than each maintaining its own separate vendor record. The model deliberately splits ownership of its own fields between two different concerns within the same table: transactional fields that Purchase writes, and qualification fields that Vendor Development owns and Purchase only reads. Routes live in `backend/app/modules/vendor/routes/vendors.py`, mounted at `/vendors`.

---

# 2. Vendor Record

A `Vendor` carries standard supplier master fields — name, contact person, phone, email, address, GSTIN, payment terms, bank details — plus a **category** (`materials`, `services`, or `both`) and an overall **status** (`active`, `blacklisted`, `under_review`).

Alongside these sit a distinct set of fields explicitly called out in the model as **Vendor Development-owned**: `qualification_status` (`pending`, `qualified`, `disqualified`), an `is_avl` flag marking Approved Vendor List membership, `last_audit_date`, `last_audit_score`, and free-text `remarks`. The comment in the model source is explicit about the intended access pattern here: Purchase is meant to *read* `qualification_status` as a hard gate before PO issuance in a later phase of the procurement workflow, not to write it — qualification is Vendor Development's call to make, procurement's job is only to respect it once made.

---

# 3. Routes

The module exposes standard CRUD over the vendor master:

- **`GET /vendors/meta`** — returns the fixed vocabulary lists (`categories`, `statuses`, `qualification_statuses`) a frontend needs to populate dropdowns.
- **`GET /vendors`** — list, filterable by `search` (name, case-insensitive partial match), `status`, and `qualification_status`, with standard `skip`/`limit` pagination.
- **`POST /vendors`** — create, validating `category` against the fixed vocabulary (`400` on an invalid value).
- **`GET /vendors/{id}`** — fetch a single vendor, `404` if missing.
- **`PATCH /vendors/{id}`** — partial update, validating `category`, `status`, and `qualification_status` against their respective fixed vocabularies wherever any of them is included in the update payload.

---

# 4. Access Model

Every route in this module currently gates on `require_app_access("purchase")` rather than a `vendor`-specific app grant — meaning, as implemented today, access to the vendor master is controlled by Purchase module access rather than by a distinct Vendor Development permission. This reflects the module's current stage: the procurement side of the vendor record (creating vendors, editing contact and category information) is live and in active use by Purchase, while the qualification workflow that would justify a separate Vendor Development-specific access gate is fields-only at this point — the data model has `qualification_status`, `is_avl`, and audit fields ready, but there is no dedicated qualification/audit workflow route yet, so there has been no need to introduce a second, narrower permission gate.

---

# 5. What This Module Does Not Do

- There is no dedicated route yet for a vendor-qualification or vendor-audit workflow — `qualification_status`, `is_avl`, `last_audit_date`, and `last_audit_score` can currently only be changed through the same general-purpose `PATCH /vendors/{id}` used for any other field, not through a purpose-built qualification action.
- The module does not yet enforce the "Purchase reads qualification_status as a hard gate before PO issuance" rule described in the model's own source comments — that gate belongs to the PO-creation step in the [P2P module](../p2p/overview.md) or [Purchase module](../purchase/overview.md), and as of this writing neither module's PO-creation route is documented as enforcing it.

---

# 6. Related Documentation

- [P2P Module Overview](../p2p/overview.md) — the vendor-selection and PO-creation step that ultimately should read this module's `qualification_status`.
- [Purchase Module Overview](../purchase/overview.md) — the SR-linked procurement pipeline that currently uses free-text vendor fields rather than this module's structured vendor master.
