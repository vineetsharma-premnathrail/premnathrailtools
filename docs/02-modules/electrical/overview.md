# Electrical Module — Overview

**Module:** Electrical
**Backend Location:** `backend/app/modules/electrical/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

The Electrical module tracks electrical work orders raised against a Project — faults, repairs, and other electrical work that needs to be tracked from the moment it is opened through to resolution and closure. It is a comparatively small, focused module: a single work-order entity with an explicit status lifecycle, rather than a full department suite. The core model is `ElectricalWorkOrder` (`backend/app/modules/electrical/models/work_order.py`), with routes in `backend/app/modules/electrical/routes/work_orders.py`, mounted at `/electrical/work-orders`.

---

# 2. Work Orders

An **Electrical Work Order** is always raised against a Project (the same `Project`/machine registry the Service & Commissioning module owns) and carries an auto-generated, human-readable number of the form `EWO-{year}-####`, incrementing within the year. Each work order records:

- **Equipment tag**, **voltage system**, and **fault type** — free-text fields describing what electrical equipment and fault the work order concerns.
- A **description** of the work.
- An optional link back to the ERP Service Request the fault was reported through (`source_service_request_id`) — a work order can originate from a field service visit without the Electrical module needing to import any ERP route or service code; it is referenced purely by ID.
- **Priority** — `low`, `medium`, `high`, or `critical`.
- **Assignment** — who the work order is assigned to (`assigned_to_id`) and who raised it (`raised_by_id`, set automatically to the creating user).
- **Expected completion date**, and, once the work order progresses, **resolved_at** and **closed_at** timestamps plus **resolution notes**.

---

# 3. Status Lifecycle

A work order moves through six states: `open → assigned → in_progress → testing → resolved → closed`.

- Creating a work order always starts it at `open`.
- **Assignment** (`POST /electrical/work-orders/{id}/assign`) sets the assignee and, if the work order is still `open`, automatically advances it to `assigned` — assigning someone to a work order is treated as the same action as moving it out of the unassigned state.
- **Status changes** (`POST /electrical/work-orders/{id}/status`) can move the work order through any of the six statuses, validated against the fixed vocabulary. Reaching `resolved` for the first time stamps `resolved_at`; reaching `closed` for the first time stamps `closed_at`. Resolution notes can be attached at the same time as a status change.
- A general-purpose `PATCH /electrical/work-orders/{id}` allows updating any field directly (with the same priority-vocabulary validation applied), for cases that don't fit the assign/status action routes.

---

# 4. Access Model

Every route in this module requires `require_app_access("electrical")`, with no further granular permission distinction — any user with Electrical module access can create, list, assign, or change the status of any work order. This is the same whole-module-access model used by CRM, Purchase, R&D, and Design, rather than ERP's creator-plus-permission-string approach.

---

# 5. What This Module Does Not Do

- The Electrical module does not currently issue any document storage of its own for electrical drawings or schedules — wiring diagrams, panel layouts, and cable schedules are document types stored through the shared engineering-document table owned by the [Design module](../design/overview.md), not through this module.
- There is no automatic notification tied to work-order assignment or status change beyond whatever generic notification mechanisms the Platform module provides — this module's routes do not currently push a bespoke alert on assignment or resolution.

---

# 6. Related Documentation

- [Design Module Overview](../design/overview.md) — the shared engineering-document table that electrical drawings, wiring diagrams, and cable schedules are stored through.
- [Service & Commissioning Overview](../service-commissioning/overview.md) — the Project registry and Service Request records an Electrical Work Order can be linked back to.
