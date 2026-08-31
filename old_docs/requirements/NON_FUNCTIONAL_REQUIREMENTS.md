# Non-Functional Requirements

See [SRS.md](SRS.md) for system context and [FUNCTIONAL_REQUIREMENTS.md](FUNCTIONAL_REQUIREMENTS.md) for functional scope.

## 1. Security

| ID | Requirement | Evidence |
|---|---|---|
| NFR-SEC-1 | Authentication is Microsoft SSO (Entra ID) only; no local password authentication path exists. | `backend/app/modules/main/routes/auth.py` routes (`/microsoft-login`, `/callback`, `/teams-token`, `/teams-exchange`, `/me`, `/logout`); `User.hashed_password`/`must_change_password` fields are defined but unused by any route. |
| NFR-SEC-2 | Sessions are cookie-based; the frontend calls `GET /auth/me` on load to establish identity, redirecting unauthenticated users to `/login`. | `frontend/src/hooks/useAuth.ts` |
| NFR-SEC-3 | Module-level authorization: a user can only reach a module if it is in their effective `apps` list (`assigned_apps`, or all modules for admins). | `User.get_apps()` (`main/models/user.py`); `useRequireApp()` in `useAuth.ts` |
| NFR-SEC-4 | Fine-grained authorization within ERP is enforced via `erp_permissions` string flags, checked both client-side (`hasErpPermission`, `useRequireErpPermission`) and expected server-side on the corresponding routes. | `frontend/src/hooks/useAuth.ts`; ERP route handlers |
| NFR-SEC-5 | Admin-only surfaces (e.g. the user list) are gated by `role === 'admin'`. | `useRequireAdmin()`; `main/routes/users.py` |
| NFR-SEC-6 | File uploads to SharePoint are restricted by an extension/content-type allowlist, a blocklist of dangerous types (svg/html/js — XSS vectors), and magic-byte signature verification to catch spoofed extensions. | `backend/app/utils/sharepoint.py` (`_verify_magic_bytes`, allow/deny lists) |
| NFR-SEC-7 | File preview is served through short-lived, backend-minted preview URLs rather than exposing direct SharePoint links. | `get_preview_url()` in `sharepoint.py` |
| NFR-SEC-8 | **Gap**: `encrypted_graph_refresh_token` on the `User` model is named as if encrypted, but no encryption is implemented in the code reviewed. This should be verified/fixed or the field renamed to avoid a false sense of security. | `main/models/user.py` |
| NFR-SEC-9 | **Gap**: SR `status`/`priority` are unvalidated free-text strings server-side; there is no backend enum/state-machine guard preventing arbitrary or out-of-sequence values via direct API calls, even though the frontend only offers the canonical set. | `erp/models/service_request.py`, `erp/schemas/service_request.py` |

## 2. Auditability

| ID | Requirement | Evidence |
|---|---|---|
| NFR-AUD-1 | A shared, polymorphic `AuditLog` table records `entity_type`, `entity_id`, `action`, changed field, old/new value, a human-readable summary, and who/when. | `backend/app/modules/main/models/audit_log.py` |
| NFR-AUD-2 | Every module with soft-delete/recycle-bin support (Projects, Service Requests, Organizations, Inquiries, Tenders) exposes a `GET /{id}/audit` endpoint. | route files in `erp/routes/*.py`, `crm/routes/*.py` |
| NFR-AUD-3 | The standalone Purchase Requisition module also exposes `GET /{id}/audit`, despite not having soft-delete. | `p2p/routes/p2p_requests.py` |
| NFR-AUD-4 | **Gap**: the SR-tied Purchase module's audit coverage should be double-checked for parity with the standalone module (both expose `/{pr_id}/audit`, but confirm both write comparably granular entries). | `purchase/routes/purchase_requisitions.py` |

## 3. Data Retention / Soft Delete

| ID | Requirement | Evidence |
|---|---|---|
| NFR-RET-1 | `SoftDeleteMixin` (`is_deleted: bool`, `deleted_at: datetime`) is applied to ERP `Project`, `ServiceRequest`, `ServiceMaterial`, and CRM `Activity`, `Document`, `Inquiry`, `Note`, `Organization`, `Tender`. | `backend/app/db/mixins.py`; model files in `erp/models/`, `crm/models/` |
| NFR-RET-2 | Soft-deleted records remain recoverable via a recycle-bin listing and a restore action, for the entities in NFR-RET-1. | `GET /{resource}/recycle-bin/list`, `POST /{resource}/{id}/restore` across `erp`/`crm` routes |
| NFR-RET-3 | **Gap — confirm with team**: `Purchase` (SR-tied) and standalone `PurchaseRequisition`/`P2PRequest` records have no `is_deleted` field and no recycle-bin/restore endpoints. Either deletion is simply not offered for these entities (by design, since financial/procurement records typically shouldn't be deletable), or hard-delete exists elsewhere unaudited — this needs explicit confirmation. | absence of `is_deleted` in `purchase/models/purchase_requisition.py`, `p2p/models/p2p_request.py` |
| NFR-RET-4 | No automatic purge/retention-expiry job was found in the codebase for soft-deleted records — recycle-bin entries appear to persist indefinitely until manually restored or (if implemented elsewhere) purged. This should be confirmed against any compliance/retention policy the company has. | absence of scheduled-purge code in reviewed modules |

## 4. Availability

| ID | Requirement | Evidence / Note |
|---|---|---|
| NFR-AVL-1 | No SLA, uptime target, or redundancy/failover configuration was found in the reviewed backend/infra code. This is an **undocumented gap** — availability targets should be defined by the team rather than assumed. | — |
| NFR-AVL-2 | The system depends on Microsoft Graph API availability for authentication, Teams notifications, and all file attachment operations; an outage of Graph API would degrade or block SSO login and all attachment upload/download/preview. | `main/routes/auth.py`, `utils/sharepoint.py`, `utils/notifications.py` |

## 5. Performance

| ID | Requirement | Evidence / Note |
|---|---|---|
| NFR-PERF-1 | Large file uploads to SharePoint use a chunked/resumable upload session (10MB chunks, up to 2GB) rather than a single request, to avoid timeouts on large attachments. | `upload_file_to_sharepoint()` in `sharepoint.py` |
| NFR-PERF-2 | File downloads for preview are proxied server-side rather than redirecting to Office Online viewers, so files render natively in-app. | `download_file_content()` in `sharepoint.py` |
| NFR-PERF-3 | No explicit response-time targets, load-testing evidence, pagination limits, or caching strategy were found in the reviewed route/service code. This is an **undocumented gap** — if specific performance targets exist, they should be added here explicitly. | — |

## 6. Browser / Client Support

| ID | Requirement | Evidence / Note |
|---|---|---|
| NFR-CLIENT-1 | The frontend is a standard Next.js/React web app; no browser-support matrix, polyfill strategy, or minimum-browser-version documentation was found in the repo. | — |
| NFR-CLIENT-2 | A Teams-specific auth/token-exchange path (`/auth/teams-token`, `/auth/teams-exchange`) confirms the app is also consumed inside a Microsoft Teams tab/app wrapper, not only a standalone browser tab — implying the client must remain compatible with the Teams webview runtime. | `main/routes/auth.py` |
| NFR-CLIENT-3 | **Undocumented gap**: no explicit statement of supported browsers (e.g. "latest 2 versions of Chrome/Edge/Firefox/Safari") was found. Should be clarified with the team if it matters for support decisions. | — |

## 7. Reliability / Idempotency

| ID | Requirement | Evidence |
|---|---|---|
| NFR-REL-1 | SR creation/closure notification emails are guarded by idempotency flags (`created_notification_sent`, `closed_notification_sent`) to avoid duplicate client emails on retries/re-renders. | `erp/models/service_request.py` |
| NFR-REL-2 | An `is_locked`/`locked_by_id` field exists on `ServiceRequest` but is explicitly commented as reserved for a future workflow-lock feature that nothing currently sets — i.e. concurrent-edit protection is **not yet implemented** for SRs. | `erp/models/service_request.py` (in-code comment) |

Related: [SRS.md §5 Constraints](SRS.md), [FUNCTIONAL_REQUIREMENTS.md](FUNCTIONAL_REQUIREMENTS.md).
