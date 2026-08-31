# ADR 0003: Build `p2p` (P2P Requests) as a Fully Independent Module Instead of Extending `purchase`

**Status:** Accepted

**Date:** 2026-08-14 (documented retroactively from code already merged)

**Author:** Engineering (documented by AI agent from code inspection)

## Context

The codebase already had a Purchase Requisition (PR) flow: `backend/app/modules/purchase/`
(tables `purchase_requisitions` / `purchase_requisition_items`). That flow only exists
because an ERP Service Request has materials that need buying — a PR there is always
created via `POST /api/v1/service-requests/{sr_id}/raise-pr`
(`backend/app/modules/erp/routes/service_requests.py`), and each `PurchaseRequisitionItem`
is a thin read-mostly mirror of a `ServiceMaterial` row (same photos/attachments, no
separate upload/delete route on the purchase side — see
`backend/app/modules/purchase/models/purchase_requisition.py`, which contains an explicit
comment: "are intentionally independent apps, see the class docstring below").

The business need then grew: other departments (not just Service) wanted to raise
purchase requisitions for things with no ERP project/service request behind them at all
(e.g. office supplies, tooling, non-service capex). The code shows a second module,
`backend/app/modules/p2p/` (tables `p2p_requests` / `p2p_request_items` /
`p2p_request_attachments`), was built to serve this instead of extending the existing
`purchase` module.

## Decision

We will keep two separate, deliberately decoupled PR modules:

- `purchase` — PRs that always originate from an ERP `ServiceRequest`'s materials.
  Tightly coupled to `erp` by design (imports `Project`/`ServiceRequest` models,
  mirrors status back onto `ServiceMaterial`).
- `p2p` — a standalone P2P request workflow any department can start directly
  against a free-text `project_label`, with its own items and SharePoint-backed
  attachments (`routes/p2p_requests.py`). It imports nothing from `erp` or `purchase`.

## Rationale

- **Option A — Extend `purchase` to accept a nullable `service_request_id`.**
  Pros: one PR table, one API surface. Cons: `PurchaseRequisitionItem` already assumes a
  1:1 mirror of a `ServiceMaterial` (same attachment model, same status-sync code in
  `service_requests.py::raise-pr`); making that optional would push conditional logic
  through nearly every route and response builder in the module, and risk breaking the
  working ERP-to-purchase flow that departments already depend on.
- **Option B — Build a second, independent module (`p2p`).** Chosen.
  Pros: the ERP-coupled flow keeps its simple assumptions untouched; the new flow gets
  its own item/attachment model shaped for a free-text "raised by any department"
  request (approver routing, buyer assignment, quotations, vendor selection, PO
  creation, receipt tracking — see the state machine in
  `backend/app/modules/p2p/routes/p2p_requests.py`). Cons: some
  duplication between the two modules' approve/reject/cancel/close lifecycle code, and
  two similarly-named concepts ("purchase requisition" / "P2P request") a new engineer
  must learn to tell apart.

## Consequences

### Positive Consequences
- The ERP → Service Request → Materials → PR flow keeps working exactly as before; no
  regression risk from bolting on the "any department" case.
- The standalone module can evolve its own approval/procurement lifecycle
  (assign-buyer, request-quotations, select-vendor, create-po, update-receipt, close)
  without touching ERP code at all.
- Attachments in both modules go through the same shared `app/utils/sharepoint.py`
  helper, so storage behavior is consistent even though the data models are separate.

### Negative Consequences
- Two API surfaces and two sets of routes/schemas to maintain for a conceptually
  similar "purchase requisition" idea — `/api/v1/purchase-requisitions/*` (ERP-origin)
  vs `/api/v1/p2p/*` (standalone), which are easy to confuse by name.
- No shared reporting layer across both — a department wanting "all PRs company-wide"
  today has to query two different tables/APIs.

## Alternatives Considered

- **Option A** (extend `purchase`) — not chosen, see Rationale above.
- **Unifying both under a single generic `PurchaseRequisition` model with a nullable
  polymorphic origin** — not evident in the code and not chosen; would need a larger
  migration than what actually shipped.

## Related Decisions

- [ADR 0001: Modular Monolith](0001-modular-monolith.md) — this decision follows the
  same "keep modules loosely coupled" spirit at a finer grain, inside what could have
  been one module.

## When to Revisit

- If a company-wide "all purchase requisitions" report/dashboard becomes a real
  requirement, revisit whether a shared read model or view across both tables is worth
  building instead of maintaining two independent lifecycles.
- If the ERP-origin `purchase` module ever needs its own approver/buyer/quotation
  workflow (currently simpler than `p2p`'s), reconsider merging the
  lifecycle code even if the data models stay separate.

## References

- `backend/app/modules/purchase/models/purchase_requisition.py`
- `backend/app/modules/p2p/routes/p2p_requests.py`
- `backend/app/modules/erp/routes/service_requests.py` (`raise-pr` endpoint)
