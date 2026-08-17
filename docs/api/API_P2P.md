# API — P2P Module (`app/modules/p2p`)

**See [API_PURCHASE.md](./API_PURCHASE.md) for the full distinction from the `purchase`
module** — short version: this module is a self-service PR system any requester can use
directly (not derived from an ERP Service Request), with its own buyer-assignment →
vendor-quotation → PO → receipt lifecycle. Model: `P2PRequest` / `P2PRequestItem` /
`P2PRequestAttachment`. Mounted at `/p2p/requests`.

## Auth model (mixed — three different dependencies used across this file)

- `_requester_or_purchase` (local to `routes/p2p_requests.py`): passes if the caller has
  `"p2p"` **or** `"purchase"` in `get_apps()` (or is admin). Used for
  routes any requester needs (create, list, get, get meta, get audit) — per-route logic
  then narrows visibility (see `_check_view_access` below).
- `require_app_access("p2p")`: used only on `POST` (create) —
  **Note:** this means creating a PR needs the `p2p` app specifically,
  not just `_requester_or_purchase`'s broader either/or — worth flagging since it's a
  stricter gate than most of the file's other "requester" routes.
- `require_app_access("purchase")`: used on every processing action (approve, reject,
  cancel, assign-buyer, request-quotations, select-vendor, create-po, update-receipt,
  close, delete attachment) — i.e. only the Purchase team can advance a PR through its
  lifecycle, matching the "purchase" module's role in the other PR system too.

`_check_view_access(pr, user)`: purchase-team members can view any PR; everyone else may
only view their own (`pr.requested_by_id == user.id`), else `403`.

## Routes — 16 total, all relative to `/api/v1`

```
GET    /p2p/requests/meta                    Categories/requirement-types/statuses lookup.
                                                                 _requester_or_purchase.
POST   /p2p/requests                          Create. require_app_access("p2p").
                                                                 400 on invalid item data.
GET    /p2p/requests                          List — own PRs for requesters, all for purchase
                                                                 team. _requester_or_purchase.
GET    /p2p/requests/{id}                     404 if missing; 403 if not own PR and not
                                                                 purchase team (_check_view_access).
GET    /p2p/requests/{id}/audit
PATCH  /p2p/requests/{id}                     _requester_or_purchase. 400/409 on invalid state.
POST   /p2p/requests/{id}/approve             require_app_access("purchase"). 409 if not
                                                                 pending-approval.
POST   /p2p/requests/{id}/reject               require_app_access("purchase"). 409 otherwise.
POST   /p2p/requests/{id}/cancel               _requester_or_purchase (creator may cancel their
                                                                 own too). 403/409 as applicable.
POST   /p2p/requests/{id}/assign-buyer         require_app_access("purchase"). 409 if wrong state.
POST   /p2p/requests/{id}/request-quotations   require_app_access("purchase"). 409 if wrong state.
POST   /p2p/requests/{id}/select-vendor        require_app_access("purchase"). 409 if wrong state.
POST   /p2p/requests/{id}/create-po            require_app_access("purchase"). 409 if wrong state.
POST   /p2p/requests/{id}/update-receipt       require_app_access("purchase"). 409 if wrong state.
POST   /p2p/requests/{id}/close                require_app_access("purchase"). 409 if wrong state.
POST   /p2p/requests/{id}/attachments          multipart — SharePoint-backed. 503 if unconfigured.
                                                                 400 on bad doc_type/file. 403 per view rules.
DELETE /p2p/requests/{id}/attachments/{attachment_id}   require_app_access("purchase"). 404 if
                                                                 attachment missing.
```

Schemas: `P2PRequestResponse`, `P2PRequestCreate`, `P2PRequestUpdate`,
`P2PRequestActionPayload`, `P2PRequestAssignBuyerPayload`, `P2PRequestQuotationPayload`,
`P2PRequestSelectVendorPayload`, `P2PRequestCreatePOPayload`, `P2PRequestReceivePayload`,
`P2PRequestAttachmentResponse`. PR numbers are generated via
`app/modules/p2p/service.py:generate_p2p_number`.

Status transitions return `409` on any out-of-order call (grepped extensively across
this file — nearly every action route has a `409` guard), consistent with the rest of
the codebase's state-machine convention.

---

**Module endpoint count: 16.**
