# API — Purchase Module (`app/modules/purchase`)

**Distinction from `p2p` (see [API_P2P.md](./API_P2P.md)):**
these are two separate modules with confusingly similar names.

- **`purchase`** (this file) processes Purchase Requisitions that are **raised from an
  ERP Service Request** (`POST /erp/service-requests/{id}/raise-pr` — see API_ERP.md).
  It has no creation endpoint of its own; a PR here only ever comes into existence via
  that ERP action. Model: `PurchaseRequisition` / `PurchaseRequisitionItem`. Its
  lifecycle is a flat `submitted → approved → (received) → closed`, with
  `rejected`/`cancelled` off-ramps.
- **`p2p`** is a second, independent PR system that **any requester
  raises directly** (not derived from a Service Request), with its own richer workflow:
  buyer assignment, vendor quotation, PO creation, partial receipts. Model: `P2PRequest` /
  `P2PRequestItem`. Mounted at `/p2p/requests`, tagged "P2P"
  — genuinely a different, parallel procurement pipeline, not a duplicate
  of `purchase`.

Do not conflate the two when reading `Depends(require_app_access(...))`: routes in
*this* module gate on `require_app_access("purchase")`; the other module's routes gate
on a mix of `"p2p"` and `"purchase"` (see that file).

All routes here require `require_app_access("purchase")` — no granular sub-permissions
(anyone with Purchase module access can act on any PR, mirroring CRM/RnD). Paths below
are relative to `/api/v1`.

## Purchase Requisitions (`routes/purchase_requisitions.py`, prefix `/purchase/requisitions`) — 9 routes

```
GET    /purchase/requisitions                  List (filters: status, project_id, service_request_id,
                                                search on pr_number)
GET    /purchase/requisitions/{id}             404 if missing
GET    /purchase/requisitions/{id}/audit
PATCH  /purchase/requisitions/{id}             Update vendor/po_number/po_date/expected_delivery_date/notes.
                                                409 if the PR is closed/rejected/cancelled.
PATCH  /purchase/requisitions/{id}/items/{item_id}   Update an item's remarks. Body: { remarks? }.
                                                Returns the full PurchaseRequisitionResponse, not just the item.
POST   /purchase/requisitions/{id}/approve     submitted -> approved. 409 otherwise.
POST   /purchase/requisitions/{id}/reject      submitted|approved -> rejected; unlinks its materials so they
                                                can be raised into a fresh PR. Body: { reason? }. 409 otherwise.
POST   /purchase/requisitions/{id}/cancel      Any non-terminal status -> cancelled; same unlink behavior.
                                                Body: { reason? }.
POST   /purchase/requisitions/{id}/close       received -> closed only; 409 otherwise. Notifies the SR's ERP
                                                users + creator.
```
Schema: `PurchaseRequisitionResponse` (returned by nearly every mutation above, not just
GETs). Each item's `attachments` (read-only) ride along on every PR response — there is
no dedicated upload/delete route for item attachments in this module (unlike
`p2p`'s `P2PRequestAttachment` routes, which do have one — see that file).

---

**Module endpoint count: 9.**
