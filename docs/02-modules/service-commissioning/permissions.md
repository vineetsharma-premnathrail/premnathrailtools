# Service & Commissioning — Permissions

**Module:** Service & Commissioning
**Backend Location:** `backend/app/modules/erp/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

This document is the authoritative reference for how the Service & Commissioning module gates access to its actions. It is written directly from `backend/app/modules/erp/routes/projects.py` and `backend/app/modules/erp/routes/service_requests.py`, and describes both the permission strings the module checks and the precise ownership rule that governs most of them. As of 29 August 2026, several frontend pages incorrectly implemented this rule — gating a button on ownership alone, or on the permission string alone, rather than on both together — and were corrected this session; §4 records that fix so the correct pattern is not lost again.

Module-level access control (does this user have `erp` in their assigned apps at all?) and the `admin` role bypass are owned by the Platform module and are not repeated here in full — see [Platform → Authorization](../platform/overview.md#4-authorization) and [../../04-security/](../../04-security/). Every route in this module additionally requires `require_app_access("erp")` before any of the checks below are even reached.

---

# 2. The Permission Strings

Eight distinct granular permission strings are checked across this module's two route files:

| Permission | Checked by | Guards |
|---|---|---|
| `project_create` | `create_project` (`POST /erp/projects`) | Registering a new machine. |
| `project_edit` | `update_project` (`PATCH /erp/projects/{id}`), `upload_project_attachments` | Editing a machine's fields; uploading a document attachment to a machine. |
| `project_delete` | `delete_project`, `restore_project`, `delete_project_attachment` | Soft-deleting a machine, restoring it from the recycle bin, and deleting a document attachment from it. |
| `project_view` | *(reserved — not currently checked directly; viewing a machine only requires `erp` module access)* | — |
| `sr_create` | `create_service_request` (`POST /erp/service-requests`) | Raising a new Service Request. |
| `sr_edit` | `_can_edit()`, used by `update_service_request`, attachment upload, and every material endpoint (add/update/receive, material photo upload, raise-PR) | Editing a Service Request's fields, adding/editing/receiving its materials, uploading attachments or material photos to it, and raising a Purchase Requisition from it. |
| `sr_delete` | `_can_delete()`, used by `delete_service_request`, `restore_service_request`, attachment delete, and material/material-photo delete | Deleting or restoring a Service Request, and deleting its attachments, materials, or material photos. |
| `sr_view` | *(reserved — not currently checked directly; viewing a Service Request only requires `erp` module access)* | — |

`project_view` and `sr_view` are included here because they are the permission strings the Users & Roles administration screen offers for this module (matching the pattern of every other granular permission), but neither is currently enforced by a distinct backend check — read access to both machines and Service Requests is gated only by general `erp` module access, not by a separate view permission.

---

# 3. The Ownership Rule

This is the single most important rule in the module, and the one that was misapplied in several places before this session's fix.

**For a non-admin user, holding the permission string alone is not enough.** Almost every write action on a Service Request also requires that the acting user be the record's original creator (`created_by_id == user.id`). This is implemented identically in two small helper functions in `service_requests.py`:

```python
def _can_edit(sr: ServiceRequest, user: User) -> bool:
    if user.role == "admin":
        return True
    return sr.created_by_id == user.id and has_erp_permission(user, "sr_edit")

def _can_delete(sr: ServiceRequest, user: User) -> bool:
    if user.role == "admin":
        return True
    return sr.created_by_id == user.id and has_erp_permission(user, "sr_delete")
```

In words: an admin always passes. Everyone else must satisfy **both** of the following simultaneously — they must be the person who originally created the Service Request, **and** they must hold the matching granular permission string. Neither condition alone is sufficient:

- A user who created the SR but does not hold `sr_edit` cannot edit it.
- A user who holds `sr_edit` but did not create this particular SR cannot edit it either — the permission string grants the *capability* to edit Service Requests in general, not blanket edit rights over every Service Request in the system.

This same `AND` rule — creator **and** permission string — is used consistently for every write path on a Service Request: field edits, delete, restore, attachment upload/delete, and every material sub-endpoint (add, update, delete, receive, photo upload/delete, raise-PR).

The Project (machine) side of the module applies the permission-string check (`project_edit`, `project_delete`, `project_create`) but does **not** apply an equivalent ownership check — any user holding `project_edit`/`project_delete` can edit or delete any machine, regardless of who registered it. This asymmetry is intentional: machines are shared organizational assets with no natural single "owner," whereas a Service Request is a ticket raised by a specific individual.

---

# 4. This Session's Fix (2026-08-29)

Before this fix, several frontend pages under `frontend/src/app/dashboard/erp/` gated their edit/delete buttons on only one half of the backend's actual rule — either checking ownership alone (showing the button to the creator regardless of whether they held the permission string, which the backend would then reject with a 403) or checking the permission string alone (showing the button to anyone with `sr_edit`/`sr_delete`, even for a Service Request they didn't create, which the backend would also reject). Both mismatches produced the same symptom: a button that appeared clickable but failed against the API, or was hidden for a user who should legitimately have seen it.

The fix brought every affected page's button-visibility logic in line with the backend's actual `_can_edit`/`_can_delete` rule — record ownership **and** the matching permission string, evaluated together, with the admin bypass preserved. Any new page added to this module that shows an edit or delete affordance for a Project or Service Request must replicate this same combined check rather than inventing a new one; see [premnathrail-ui-behavior](../../../..) conventions for permission-gated pages.

**Known remaining inconsistency:** `restore_project` (`POST /erp/projects/{id}/restore`) checks only `has_erp_permission(user, "project_delete")` — it does not additionally check ownership, since a machine has no ownership concept (§3). `restore_service_request`, by contrast, is gated through `_can_delete()`, i.e. ownership **and** `sr_delete`. This is a deliberate difference given the two entities' different ownership models, not an oversight — but see `testing.md` for the specific regression test recommended to lock this behavior in place and catch any future accidental drift toward one pattern or the other.

---

# 5. Related Documentation

- [Overview](overview.md)
- [Workflows](workflows.md)
- [Testing](testing.md) — regression coverage for this rule
- [Platform → Authorization](../platform/overview.md#4-authorization)
- [../../04-security/](../../04-security/)
