# Requirement: admin is not an approver; Azure admin is not portal admin

Date: 2026-11-04. Size: L (approvals + permissions, cross-module). Owner decision in chat.

## In the owner's words
- "Azure admin to application admin alag alag baat hai" — being a Global Administrator of the
  Microsoft tenant must no longer make someone a portal admin. Portal admin is given only inside
  the portal (Users › role).
- Admin must not be able to approve anything just because they are admin. Only the people named
  in the workflow (or their delegate / escalation target) decide.
- When an approval is stuck (approver on leave / left), the admin does not approve; the admin
  **reassigns** the pending step to another person, who then decides. Audited.
- Rejected option: moving the Azure Global Admin role between accounts in Azure.

## Core flow position
Cross-cutting control (central approval engine, RBAC) used by every module.

## Decisions taken by the Manager
- No migration / no data change: every Azure admin who ever signed in or was synced already got
  `role = "admin"` stored (auth.py `_refresh_azure_admin`, azure_sync). Nobody is locked out; the
  owner can demote anyone in Users afterwards.
- `is_azure_admin` stays stored (information only), it just grants nothing.
- Mobile app (uncommitted work of another session) is out of scope; the server refuses admin
  decisions anyway, so mobile shows the server's error.
