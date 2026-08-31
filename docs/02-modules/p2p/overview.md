# Purchase-to-Pay (P2P) Module — Overview

**Module:** Purchase-to-Pay (P2P)
**Backend Location:** `backend/app/modules/p2p/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

The P2P module is PremnathRail's department-agnostic procurement pipeline: a purchase requisition system that any user with access to it can raise directly, without that request first needing to originate from an ERP Service Request or any other upstream record. It exists alongside a second, older procurement pathway — the `purchase` module, described in its own [overview](../purchase/overview.md) — and the relationship between the two is deliberate enough, and confusing enough by name alone, that it is worth stating plainly up front: **P2P is the newer, richer, and functionally more complete of the two procurement systems**, and it is not a duplicate of `purchase` so much as a parallel pipeline built to eventually replace or absorb it (see Section 6).

The core model is `P2PRequest` / `P2PRequestItem` / `P2PRequestAttachment`, mounted at `/p2p/requests`.

---

# 2. Purpose

Where `purchase`'s only entry point is an ERP Service Request's materials list, P2P exists to let *any* requester — in any department with access to it — raise a purchase request for anything they need, and to carry that request through a considerably more complete procurement lifecycle than a flat approve/reject/close: buyer assignment, request-for-quotation to vendors, vendor selection, purchase-order creation, and receipt tracking, all the way to close.

---

# 3. Access Model

P2P's authorization is more layered than most modules in the portal, because it deliberately serves two different kinds of user with two different levels of trust:

- **Any requester** — a user with either `p2p` or `purchase` module access (checked by a locally-defined `_requester_or_purchase` dependency) — can create, list, view, and check the audit trail of a request. Creating a request specifically requires the `p2p` app rather than the broader either/or check, a narrower gate than the other requester-facing routes in the same file.
- **The Purchase team** — a user with `purchase` module access — is the only one who can advance a request through its processing lifecycle: approve, reject, cancel, assign a buyer, request quotations, select a vendor, create a PO, update a receipt, or close the request out. This mirrors the Purchase team's role in the sibling `purchase` module: whichever pipeline a requisition sits in, only Purchase can move it forward.
- **View access** is narrower still: purchase-team members can view any request, but an ordinary requester may only view their own. A creator may also cancel their own request even without purchase-team access, since backing out of your own request in flight is a reasonable thing to let anyone do.

---

# 4. Requisition Lifecycle

A P2P request moves through a considerably richer state machine than the SR-linked `purchase` module's flat `submitted → approved → closed`:

**Submit → Approve/Reject → Assign Buyer → Request Quotations (RFQ) → Select Vendor → Create PO → Update Receipt (partial receipts supported) → Close**, with a **Cancel** off-ramp available at multiple points.

- **Approval.** Only a request in the pending-approval state can be approved or rejected; any other state returns `409`, matching the state-machine discipline used consistently across the rest of the portal.
- **Buyer assignment.** Once approved, the Purchase team assigns a specific buyer to own the request through the remaining procurement steps.
- **RFQ.** The assigned buyer requests quotations from vendors against the request's line items.
- **Vendor selection.** A winning vendor is chosen from the quotations received.
- **PO creation.** A purchase order is generated against the selected vendor.
- **Receipt tracking.** Receipts are recorded against the PO, supporting partial receipt — a request does not need everything to arrive in a single delivery before it can progress.
- **Close.** Once fully received (or otherwise resolved), the request is closed out.

Every action route in this lifecycle enforces its own state precondition and returns `409` on an out-of-order call — for example, trying to assign a buyer to a request that hasn't been approved yet — consistent with the state-machine convention used throughout the rest of the codebase.

---

# 5. Attachments

P2P requests support typed, SharePoint-backed attachments (supporting documents, specifications, PO documents), uploaded and deleted through dedicated routes rather than riding passively along with the request payload. This is one of the concrete respects in which P2P is functionally ahead of the `purchase` module: `purchase`'s item attachments have no dedicated upload/delete route of their own, whereas P2P's do. Uploads are subject to the same 503-if-unconfigured, validated-upload discipline described in [Microsoft Graph Integration](../../05-integration/microsoft-graph.md).

---

# 6. Relationship to the `purchase` Module

The existence of two procurement systems with similar names is a known point of confusion, not an intentional long-term design:

| | `purchase` | `p2p` (this module) |
|---|---|---|
| How a request is created | Only via `POST /erp/service-requests/{id}/raise-pr` — no standalone creation route | Directly, by any requester with `p2p` access |
| Lifecycle | Flat: `submitted → approved → (received) → closed`, with `rejected`/`cancelled` off-ramps | Full: buyer assignment → RFQ → vendor selection → PO → receipt (partial supported) → close |
| Vendor master / formal PO document | None — `vendor`, `po_number`, `po_date` are free text | Structured, through vendor selection and PO creation steps |
| Item attachments | Ride along on the requisition response; no dedicated upload/delete route | Dedicated typed-attachment upload/delete routes |

An open question recorded in the project's scope documentation is whether `purchase` should eventually converge onto P2P's implementation rather than continuing to exist as a separate, thinner parallel system — see [Purchase Module Overview](../purchase/overview.md), Section 5, for that discussion from the other module's side.

---

# 7. What This Module Does Not Do

- P2P does not originate requisitions from an ERP Service Request — that is exclusively `purchase`'s entry point. A user who needs to raise a PR against unlinked Service Request materials uses `purchase`, not this module.
- P2P has no vendor-qualification or vendor-onboarding logic of its own — vendor records themselves are owned by the [Vendor module](../vendor/overview.md); P2P only reads and selects against them during vendor selection.

---

# 8. Related Documentation

- [Purchase Module Overview](../purchase/overview.md) — the SR-linked procurement pipeline this module runs alongside, and the open convergence question.
- [Vendor Module Overview](../vendor/overview.md) — the vendor master P2P's vendor-selection step draws from.
- [Microsoft Graph Integration](../../05-integration/microsoft-graph.md) — the SharePoint attachment upload/delete/proxy mechanism used by P2P's attachment routes.
