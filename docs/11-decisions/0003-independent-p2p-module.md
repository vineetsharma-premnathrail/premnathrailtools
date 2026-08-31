# ADR 0003: Build `p2p` (P2P Requests) as a Fully Independent Module Instead of Extending `purchase`

**Status:** Accepted
**Date:** 2026-08-14 (documented retroactively from code already merged)
**Author:** Engineering (documented by AI agent from code inspection)

## Context

The codebase already had a Purchase Requisition (PR) flow under `backend/app/modules/purchase/`, using the `purchase_requisitions` and `purchase_requisition_items` tables.

This flow exists because an ERP Service Request contains materials that need to be purchased. A PR is created through:

`POST /api/v1/service-requests/{sr_id}/raise-pr`

The existing `PurchaseRequisitionItem` is closely tied to `ServiceMaterial`, including its attachment and status-sync behavior.

The business requirement expanded to allow other departments to raise purchase requests without an ERP project or Service Request, such as office supplies, tooling, and non-service capex.

A separate `backend/app/modules/p2p/` module was therefore introduced with its own request, item, and attachment models.

## Decision

Maintain two separate and deliberately decoupled purchase-request modules:

* **`purchase`** — PRs originating from ERP Service Request materials.
* **`p2p`** — standalone purchase requests that any department can initiate directly.

The `purchase` module remains tightly coupled to `erp`, while `p2p` remains independent of both `erp` and `purchase`.

The standalone P2P workflow uses its own items and SharePoint-backed attachments and supports its own procurement lifecycle.

## Rationale

### Option A — Extend `purchase`

Make `service_request_id` nullable and allow the existing Purchase Requisition model to represent both workflows.

**Pros:**

* One PR table
* One API surface

**Cons:**

* The existing model assumes a 1:1 relationship with `ServiceMaterial`.
* Existing attachment and status synchronization logic is ERP-specific.
* Conditional logic would spread throughout routes and response builders.
* The existing ERP-to-Purchase workflow could be affected by the change.

### Option B — Build an Independent `p2p` Module

**Chosen.**

**Pros:**

* Existing ERP → Purchase behavior remains unchanged.
* P2P can evolve its own approval and procurement lifecycle.
* ERP code does not need to understand standalone procurement requests.

**Cons:**

* Some lifecycle logic is duplicated.
* Engineers must understand the distinction between the two purchase-request concepts.

## Consequences

### Positive Consequences

* The existing ERP → Service Request → Materials → PR workflow remains isolated from the new use case.
* P2P can independently implement buyer assignment, quotation requests, vendor selection, PO creation, receipt tracking, and closure.
* Both modules use the shared `app/utils/sharepoint.py` helper for attachment storage.

### Negative Consequences

* Two API surfaces must be maintained:

  * `/api/v1/purchase-requisitions/*`
  * `/api/v1/p2p/*`
* Company-wide purchase reporting currently requires querying two different data sources.
* Similar concepts and lifecycle operations exist in both modules.

## Alternatives Considered

### Option A — Extend `purchase`

Rejected because the existing Purchase Requisition model is structurally tied to ERP Service Request materials.

### Generic Unified Purchase Requisition Model

A single generic model with a nullable polymorphic origin was considered conceptually but was not implemented. It would require a larger migration and architectural change than the solution that actually shipped.

## Related Decisions

* [ADR 0001: Modular Monolith](0001-modular-monolith.md) — follows the same principle of maintaining clear module boundaries and loose coupling.

## When to Revisit

Reconsider this decision if:

1. A company-wide report or dashboard covering all purchase requisitions becomes a concrete requirement.
2. The ERP-origin `purchase` module requires the same approver, buyer, quotation, vendor, and PO workflow currently implemented by `p2p`.
3. The duplication between the two lifecycle implementations becomes a significant maintenance burden.

## References

* `backend/app/modules/purchase/models/purchase_requisition.py`
* `backend/app/modules/p2p/routes/p2p_requests.py`
* `backend/app/modules/erp/routes/service_requests.py`
