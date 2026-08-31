# Purchase Module — Overview

**Module:** Purchase (Service-Request-linked)
**Backend Location:** `backend/app/modules/purchase/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

The Purchase module handles one specific, narrower kind of procurement: a Purchase Requisition (PR) that exists *because* an ERP Service Request needed materials that weren't already on hand. It has no creation endpoint of its own — a PR in this module only ever comes into existence through the ERP action `POST /erp/service-requests/{id}/raise-pr`, which converts a Service Request's unlinked materials list into a requisition here. This is the oldest of PremnathRail's two procurement pipelines, and it exists alongside a second, richer one — the [P2P module](../p2p/overview.md) — that any requester can use directly without going through a Service Request at all.

The core model is `PurchaseRequisition` / `PurchaseRequisitionItem`.

---

# 2. Purpose

When a field engineer working a Service Request finds they need a part that isn't in stock, that shortfall needs to become a trackable procurement action rather than an informal request passed along verbally or by chat. Raising a PR from the Service Request's materials list gives the Purchase team a formal, auditable requisition tied directly back to the job that needed it, and gives the requesting engineer visibility into whether and when the part is actually coming.

---

# 3. Access Model

Every route in this module requires `require_app_access("purchase")`, with no granular sub-permission layer beyond that — anyone with Purchase module access can act on any PR in the system, the same coarse-grained model CRM and R&D use. This is deliberately simpler than ERP's creator-plus-permission-string model: because a PR here always originates from an existing Service Request rather than being something an arbitrary user creates and owns, the module doesn't need a per-record ownership check to prevent one requester from tampering with another's request.

---

# 4. Requisition Lifecycle

The lifecycle here is intentionally flat compared to P2P's multi-stage pipeline: **submitted → approved → (received) → closed**, with **rejected** and **cancelled** as off-ramps available from a non-terminal state.

- **Approve** — moves a `submitted` PR to `approved`; `409` on any other starting state.
- **Reject** — moves `submitted` or `approved` to `rejected`, and unlinks the requisition's materials from it so they can be gathered up into a fresh PR rather than being stuck against a dead-end record. An optional reason can be recorded.
- **Cancel** — available from any non-terminal status, with the same material-unlinking behavior as reject, and an optional reason.
- **Close** — only valid once a PR is `received`; `409` otherwise. Closing notifies both the originating Service Request's ERP users and the PR's own creator, so that the loop back to the field is closed as well as the procurement record itself.

Vendor, PO number, PO date, expected delivery date, and free-text notes can all be updated on the requisition while it remains open (`PATCH /purchase/requisitions/{id}`), but this update is blocked with `409` once the PR reaches a closed, rejected, or cancelled state. Individual line items carry their own updatable `remarks` field, and — notably — the response to that update returns the *entire* requisition, not just the changed item, consistent with how nearly every mutation in this module responds with the full `PurchaseRequisitionResponse` rather than a narrower per-action payload.

Each item's `attachments` (a read-only photo/document gallery) ride along automatically on every requisition response. This module has no dedicated upload or delete route for item attachments — a deliberate contrast with P2P, whose `P2PRequestAttachment` model does have first-class upload/delete routes of its own (see Section 5).

---

# 5. Relationship to the P2P Module — and the Open Convergence Question

This module and `p2p` are two independent implementations of a purchase-requisition concept, sharing enough conceptual overlap that reading their route files side by side without this context is genuinely confusing:

- A PR in **this module** only exists because a Service Request needed materials — there is no way to create one directly.
- A request in **P2P** is created directly by any requester with access, entirely independent of any Service Request, and moves through a considerably richer lifecycle (buyer assignment, RFQ, vendor selection, formal PO creation, partial receipt tracking) that this module has no equivalent of. `purchase` has no vendor master and no generated PO document at all — `vendor`, `po_number`, and `po_date` here are free-text fields, not references into the [Vendor module](../vendor/overview.md).

This module is currently missing several capabilities P2P already has: a vendor master, formal PO documents, costing/budget tracking, goods-receipt-note handling, invoice tracking, and a reporting dashboard. These gaps are tracked on paper in the project's planning documents, phased as future work — but the more fundamental open question, recorded explicitly in the project's scope documentation, is whether it is worth building all of that into `purchase` a second time, or whether `purchase` should instead converge onto the `p2p` implementation and become, functionally, just P2P's "raised from a Service Request" entry point. That decision has not yet been made, and both modules should be treated as live, separately-maintained code until it is.

---

# 6. What This Module Does Not Do

- This module does not let a user create a PR outside of the ERP Service Request "raise PR" action — there is no standalone creation route.
- This module does not maintain a vendor master, generate a formal PO document, or track budget/costing — vendor and PO fields here are plain text, unlike P2P's structured vendor-selection and PO-creation steps.
- This module has no dedicated attachment upload/delete route for individual line items — attachments exist only as a read-only field riding along on the requisition.

---

# 7. Related Documentation

- [P2P Module Overview](../p2p/overview.md) — the richer, department-agnostic procurement pipeline this module runs alongside, and the case for functional parity or convergence.
- [Vendor Module Overview](../vendor/overview.md) — the vendor master this module does not yet integrate with.
- [Service & Commissioning Overview](../service-commissioning/overview.md) — where a Purchase Requisition here originates from (raising a PR from a Service Request's materials).
