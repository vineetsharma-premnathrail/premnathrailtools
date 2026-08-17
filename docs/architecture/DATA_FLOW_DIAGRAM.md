# Data Flow Diagrams

Representative end-to-end flows, grounded in the actual route code referenced under each
diagram. See [ARCHITECTURE.md](ARCHITECTURE.md) for module structure and
[../api/API.md](../api/API.md) for the full endpoint reference.

## 1. Login via Microsoft SSO

Code: `backend/app/modules/main/routes/auth.py`, `frontend/src/store/authStore.ts`.

```mermaid
sequenceDiagram
    actor User
    participant FE as Next.js Frontend
    participant BE as FastAPI (/api/v1/auth)
    participant Entra as Microsoft Entra ID

    User->>FE: Click "Sign in with Microsoft"
    FE->>BE: GET /auth/microsoft-login
    BE->>Entra: 302 redirect to login.microsoftonline.com
    User->>Entra: Authenticate (Microsoft credentials)
    Entra->>BE: 302 redirect to /auth/callback?code=...
    BE->>Entra: Exchange code for tokens (server-side)
    Entra-->>BE: id_token / access_token
    BE->>BE: Validate DOMAIN_EMAIL, upsert User row,\nissue app JWT (SECRET_KEY, ACCESS_TOKEN_EXPIRE_MINUTES)
    BE-->>FE: 302 redirect + Set-Cookie: session_token=<jwt>\n(httponly, SameSite per SECURE_COOKIES)
    FE->>FE: authStore reads auth state via a\n/me-style call, not from the cookie directly
    FE->>User: Redirect into dashboard
```

## 2. Creating a Standalone Purchase Requisition (with SharePoint attachment)

Code: `backend/app/modules/p2p/routes/p2p_requests.py`,
`backend/app/utils/sharepoint.py`, `frontend/src/lib/api.ts` (`prRequestApi`).

```mermaid
sequenceDiagram
    actor User
    participant FE as Next.js Frontend
    participant BE as FastAPI (/api/v1/p2p)
    participant DB as PostgreSQL
    participant Graph as Microsoft Graph / SharePoint

    User->>FE: Fill PR form (project_label, items, priority, reason)
    FE->>BE: POST /p2p (cookie session_token)
    BE->>BE: require_app_access("p2p")
    BE->>DB: INSERT pr_requests + pr_request_items
    DB-->>BE: P2PRequest row (id)
    BE-->>FE: 200 P2PRequestResponse

    User->>FE: Attach photo/quote file
    FE->>BE: POST /p2p/{pr_id}/attachments (multipart)
    BE->>Graph: upload_file_to_sharepoint(SHAREPOINT_SITE_ID, folder, file)
    Graph-->>BE: SharePoint item path/URL
    BE->>DB: INSERT p2p_request_attachments (sharepoint_path/url)
    BE-->>FE: 200 list[P2PRequestAttachmentResponse]

    Note over BE,DB: Approver routing, assign-buyer, request-quotations,\nselect-vendor, create-po, update-receipt, close\nare separate POST /p2p/{pr_id}/<action> calls\nthat each update p2p_requests.status.
```

## 3. Raising a Purchase Requisition from a Service Request's Materials

Code: `backend/app/modules/erp/routes/service_requests.py` (`raise-pr` handler),
`backend/app/modules/purchase/models/purchase_requisition.py`.

```mermaid
sequenceDiagram
    actor User
    participant FE as Next.js Frontend
    participant BE as FastAPI (/api/v1/service-requests)
    participant DB as PostgreSQL

    User->>FE: Open Service Request, review needed materials
    FE->>BE: POST /service-requests/{sr_id}/raise-pr
    BE->>DB: SELECT ServiceRequest + its ServiceMaterial rows
    BE->>DB: INSERT purchase_requisitions row (status=pending)
    BE->>DB: INSERT purchase_requisition_items,\none per ServiceMaterial (mirrors name/qty/photos, no copy of files)
    DB-->>BE: PurchaseRequisition row
    BE-->>FE: 201 PurchaseRequisitionResponse

    Note over BE,DB: purchase_requisition_items link back to the source\nServiceMaterial row, so a later photo upload on the SR side\nshows up on the PR item automatically — no sync step,\nand the purchase module exposes no separate\nupload/delete route for these attachments.

    User->>FE: Purchase team approves/rejects/cancels/closes PR
    FE->>BE: POST /purchase-requisitions/{pr_id}/approve|reject|cancel|close
    BE->>DB: UPDATE purchase_requisitions.status\n(+ mirrors status back onto linked ServiceMaterial rows)
```
