# Engineering BOM Module — Plan

**Module:** Engineering BOM (RRV master BOM)
**Backend Location:** `backend/app/modules/engineering/` (to be created). The BOM *tables* stay in `backend/app/modules/design/` (see §2.2).
**Frontend Location:** `frontend/src/app/dashboard/engineering/` (empty scaffold folders already exist: `bom`, `calculations`, `change-requests`, `drawings`, `projects`, `reports` — see §8 for which to keep)
**Spec:** `docs/MODULE_DETAILED_PLAN.md` §9 (module), §34 (settings), §10–12 (discipline re-scope), §16 (Item Master), §17 (Production), §24 (integration)
**Prepared by:** Vineet Sharma
**Date:** 06 October 2026
**Status:** Draft. The open questions in §16 have recommended defaults, so Phase 1 can start without waiting for them; answers only change defaults.

---

# 1. Purpose

Premnath Rail makes one product, the RRV (rule R1). Today four teams each keep a parts list for it in a different place and in a different shape: Design's BOM register, the Electrical job's BOM lines, the Hydraulic module's BOMs (which point at its own component catalog, not the Item Master), and nothing yet for Pneumatic. Production then builds its own BOM by hand. Nobody can answer, from the system, the questions a manufacturer asks every week:

1. **What exactly goes into RRV model X (or customer project Y), at which revision?** One structure, all four disciplines, frozen and signed.
2. **If I change part Z, which RRVs, assemblies and open builds are affected?** Where-used across all disciplines.
3. **To build N vehicles, what must I buy, and what do I have to order *now* because it takes months?** Shortage and long-lead lists.
4. **Is Production building to the current design?** The released engineering BOM pushed into a Production BOM, with a diff when it changes.
5. **Roughly what does the material in one RRV cost?** A cost roll-up for management (not a GL posting, D5).

The core design decision is that **there is exactly one BOM engine and one set of BOM tables** (`design_bom*`, built today by the Design session), and the Engineering module is the **cross-discipline layer on top of it**: it assembles the RRV master structure, enforces the "all disciplines released or N/A" freeze gate, and hands the frozen result to Production, Store and Procurement. Engineering stores almost nothing of its own: settings, N/A waivers, push and shortage records. This follows rule R6 (one Item Master, one register).

> **ERP standard / why — EBOM vs MBOM.** Every ERP separates the **Engineering BOM** (the *as-designed* structure: what the product is made of, organised by how engineers think — by discipline and assembly, released and revision-controlled by Engineering) from the **Manufacturing BOM** (the *as-built* structure: how the shop builds it — phantom assemblies flattened, consumables and scrap added, linked to routing and work orders, owned by Production). They are deliberately different documents. Engineering BOM = this module (data in `design_bom*`); Manufacturing BOM = `production_boms` (already built). The "Create Production BOM" push in §5.5 is the controlled hand-over between them.

---

# 2. What already exists, and how Engineering BOM relates to it

## 2.1 Inventory of existing BOMs

| Existing | Where | Shape | Relationship to Engineering BOM |
|---|---|---|---|
| **Design BOM** (new, uncommitted, built 06-Oct-2026) | `design/models/bom.py`, `design/bom_service.py`, `design/routes/boms.py`, `design/whereused.py`, `dashboard/design/boms/**` | `DesignBom` header per **product item** (`product_item_id` → Item Master) with optional `pm_project_id` / `erp_project_id`; `DesignBomRevision` R0, R1… with draft → in_review → in_approval → released → superseded, four-eyes (author ≠ checker ≠ approver), revision only under an **open ECN** listing the BOM (`_validate_ecn_link`); `DesignBomLine` = Item Master item **or** a new-item request (`new_item_name`), qty, UOM, drawing + frozen drawing revision, `make_buy`. Release blocked while any line lacks an active item or a released drawing (`line_blockers`). Single-level per assembly, multi-level by **explosion** through sub-assemblies' released BOMs (`_explode`). Where-used by item and drawing. Release broadcasts to Store, P2P, Production. | **This is the engine.** Engineering reuses all of it and extends it (§4.1). The RRV master BOM *is* a `DesignBom` whose product item is the RRV model. |
| **Electrical BOM** | `electrical/models/bom.py` (`electrical_bom_items`) | Flat lines per **electrical job** (one job ≈ one vehicle, `erp_project_id`); `store_item_id` **nullable**; free-text description/make/part no.; no revision, no release — `selection_status` proposed/selected/approved; procurement status and `p2p_request_id` on the same row. | **Migrated into** `design_bom*` with `discipline = electrical` (§12.1). Electrical's BOM tab becomes a view/editor over the shared engine. Table goes read-only, then retired (§25 migration rule). |
| **Hydraulic / Pneumatic BOM** | `hydraulic/models/bom.py` (`hyd_boms`, `hyd_bom_items`) | Per hydraulic **system**; revision letter A, B…; draft → released → obsolete; lines point at **`hyd_components`** (own catalog, `component_id` NOT NULL), not the Item Master; `tag_number` per line (P1, V3, CYL2). | **Migrated into** `design_bom*` with `discipline = hydraulic | pneumatic` after `hyd_components` are mapped to Item Master items (§12.2). `tag_number` is kept (new line column). |
| **Production BOM** | `production/models/bom.py`, `production/routes/boms.py` | One BOM + routing per product item; `version` 1, 2…; draft → active → obsolete; one active per product; lines = Store items + `scrap_percent`; operations with workstation and hours. Single-level; Planning explodes through sub-assembly BOMs (`make_bom_id`). | **Push target** (§5.5). Engineering creates *draft* Production BOMs (new version if one exists) with a diff against the active one. Production still adds routing and activates — Production owns the MBOM. No Production table changes. |
| **Item Master** | `store/models/item.py` | `store_items`; code generated as `<TYPE>-<CAT>-<NNNN>` (`store/service.generate_item_code`, e.g. `MT-HYD-0001`); the plan's v3 import uses `CCC-SSS-NNNN`. `standard_cost`, `moving_average_cost`, make/part no. No lead-time field. | Every BOM line references `store_items.id`. Engineering **never parses item codes**, so the code-format question (Q9) doesn't block it. |
| **ECR / ECN** | `design/models/change_request.py`, `design/models/change_notice.py` | ECR (change board) → ECN with `effectivity_type` (immediate/date/serial/next_order/project), stock/WIP disposition, affected documents **and affected BOMs** (`design_change_notice_boms` → `design_boms.id`), department acknowledgements. | Reused unchanged. Because the master BOM is a `design_bom`, "revision on ECN only after freeze" (§9 rule 4) already works. This is the single strongest reason not to build separate tables (§2.2). |
| **P2P new-PR prefill** | `dashboard/p2p/new/page.tsx` (`?prefill=session` reads `sessionStorage['p2p_new_prefill'] = {items, remarks}`); Production Planning already deep-links a single-line PR (`dashboard/production/planning/page.tsx`, `prLink`) | Pure UI pre-fill; the requester reviews and submits. | "Raise PR for shortage" uses the **multi-line session prefill** (§5.6). No second purchase path. |
| **Stock & open POs** | `production/service.available_qty` (on-hand − reserved), `store_stock_reservations`, `p2p_purchase_order_items` (`part_code`, `quantity`; **no `store_item_id`**), `p2p_goods_receipt_items.accepted_quantity` | — | Inputs to the shortage check (§5.6). PO lines are matched by `part_code = item_code` until P2P adds `store_item_id` (P2P plan §14 rule 5). |
| **RRV model** | Nowhere as a master. `production_rrv_builds.rrv_model` and `electrical_jobs.rrv_model` are free text; `erp_projects.model_name` is free text per machine. | — | **The RRV model becomes an Item Master item** (a finished-good item). The master BOM's `product_item_id` points at it. See Q2. |

## 2.2 Key decision: new module, or extend `design_boms`?

**Recommendation: both, split by responsibility — extend `design_boms` as the single BOM store and engine, and build `engineering` as a thin new module (own app key, nav, routes, a few small tables) that owns only the cross-discipline RRV layer. Do not create `engineering_bom_lines` or any second BOM table.**

Evidence:

1. **The Design BOM already implements most of §9.** Item-Master-only lines with a new-item request path (§9 rule 1) — `line_blockers`; maker → checker → approver release (§9 rule 2) — `check_bom_review` / `check_bom_approve`; revision under ECN with the previous revision superseded (§9 rule 4) — `_validate_ecn_link`, `previous.status = "superseded"`; drawing ref + revision snapshot (§9 rule 3) — `snapshot_drawing_revisions`; where-used (§9 reports) — `design/whereused.py`; multi-level explosion — `_explode`. Rebuilding these in a second table set would duplicate about 1,100 lines of rules that were just written and tested (`test_design_phases.py`).
2. **The ECN can only point at `design_boms`.** `DesignChangeNoticeBom.bom_id` is a foreign key to `design_boms.id`. A separate `engineering_boms` table would need a second ECN link table, a second "BOM revision started/released under ECN" event path, and a second implementation check. The freeze → ECN → new revision rule would then exist twice.
3. **Where-used must span disciplines to be useful.** A relay can be in the electrical BOM, and a hose clamp in both hydraulic and mechanical BOMs. With one line table, `where_used_item()` answers across all disciplines for free. With per-discipline tables, it becomes a union query that has to be maintained forever.
4. **Electrical and Hydraulic BOMs are not worth keeping as structures.** Electrical lines can be free text (`store_item_id` nullable) and are mixed with procurement state. Hydraulic lines point at a separate catalog (`component_id` → `hyd_components`). Both violate R6, and both lack four-eyes release and ECN control. "Referencing and rolling them up" would mean rolling up data that isn't release-controlled, which defeats the freeze.
5. **But the RRV layer is not a Design job.** The shortage check, "Raise PR", push to Production, cost roll-up and long-lead list are *planning* functions. They are used by Production planners, Store and Purchase, who should not need the Design app or a Design team role. The master plan (§1, §9) and the empty `dashboard/engineering` folder both expect a separate module. And the freeze gate ("all four disciplines released or N/A") belongs to no single discipline.

| | **A. New `engineering` tables that reference/roll up Design + Electrical + Hydraulic BOMs** | **B. Extend `design_boms` only (an "Engineering BOM" tab inside Design)** | **C. Recommended: extend `design_boms` + thin `engineering` module** |
|---|---|---|---|
| BOM rules (release, four-eyes, ECN, blockers) | Duplicated or wrapped | One copy | One copy |
| ECN covers master BOM | Needs second link table | Yes | Yes |
| Where-used across disciplines | Union of 3–4 sources | Yes | Yes |
| Electrical/Hydraulic data quality | Inherits nullable items, `hyd_components` | Forced onto Item Master | Forced onto Item Master |
| Planners/Store/Purchase access | Own app key | Need Design app | Own app key (`engineering`) |
| Changes to Design's in-flight files | None | Many (UI, nav, routes) | Small, listed in §14 |
| Cost | Highest (4th BOM model, sync jobs) | Lowest, but wrong audience | Medium |

**Exactly what is reused (no copies):** tables `design_boms`, `design_bom_revisions`, `design_bom_lines`, `design_change_notices` + `design_change_notice_boms` + `design_ecn_acknowledgements`, `design_item_approved_makes`; functions in `design/bom_service.py` (`check_bom_*`, `allowed_bom_actions`, `line_blockers`, `snapshot_drawing_revisions`, `released_bom_revision`, `bom_display_status`), `design/whereused.py` (`where_used_item`, `where_used_document`), `_explode` and `_build_lines` from `design/routes/boms.py` (moved into `bom_service.py` as public `explode()` / `build_lines()`, §14); `design/access.next_number`; the frontend `dashboard/design/boms/BomLinesEditor.tsx` (moved to `components/bom/BomLinesEditor.tsx`); `production/service.available_qty`; `production/routes/boms.py` create/new-version logic (called as a service, not over HTTP); `main/services/managed_documents.register()` for the Word document; `utils/notifications.notify_user` / `broadcast_notification`.

**What Engineering owns:** the `engineering` app key and nav; the master-BOM workflow (sections, N/A waivers, freeze readiness); shortage runs; production push records; reports; settings. Five small tables (§4.2).

> **ERP standard / why — one BOM per assembly, reused everywhere.** SAP, Oracle and Odoo all store a BOM *per parent item*, single level, and get the multi-level tree by exploding through child items that have their own BOM. A sub-assembly (e.g. "Rail gear assembly") is designed once and used in many RRV models. Its BOM is revised once, and where-used tells you every RRV it affects. A per-RRV copy of the whole tree, which is what option A drifts toward, makes every change a multi-place edit. The Design BOM already follows the standard; Engineering keeps it that way.

---

# 3. Users and roles

The module is gated by a new app key, `engineering` (label "Engineering BOM"). **Authoring discipline BOMs does not require the `engineering` app.** Each discipline authors in its home module, against the shared engine (§7.1), with discipline-aware authority (§3.1).

| Role | Typical person | What they do |
|---|---|---|
| **Discipline author** | Mechanical designer (Design team), Electrical engineer, Hydraulic/Pneumatic engineer | Creates and edits the discipline BOM (the "system" BOM for E/H/P, assembly BOMs for mechanical). Raises new-item requests. Submits for check. |
| **Discipline checker** | Another engineer of the same discipline | Checks lines against the drawing. Passes or returns. Must not be the author (locked, §34 / §35 "checker ≠ maker"). |
| **Discipline approver (head)** | Design head / Electrical head / Hydraulic head | Releases the discipline BOM. Must not be the author or the checker. (E/H/P *drawings* are released by the discipline head or a user the head assigns — decided 2026-10-07, §3.1.) |
| **Engineering BOM coordinator** | Design head by default, or a named Engineering coordinator | Owns the RRV master BOM. Adds the section lines, records N/A for a discipline with a reason, submits the master for freeze. |
| **Freeze approver** | Design head (default; setting) | Approves the master revision (= freeze). This is a technical release. **Partners are not in the BOM path.** The Partner level (D1) applies to commercial/PO approvals, not to engineering releases (Q5). |
| **Planner** | Production planner, Store in-charge, Purchase | Read-only on BOMs. Runs shortage checks, raises PRs from shortages, and (Production only) pushes a frozen master to a draft Production BOM. |
| **Viewer** | Quality, Service, management | Reads released/frozen BOMs, where-used, reports. |

## 3.1 Discipline authority (how the shared engine decides who may act)

`bom_service.py` today asks "is this user on the Design team?" (`require_team`, `is_team`, Design `head` for approval). That becomes a single resolver, `bom_authority(db, user, discipline, action)`:

| Discipline | Author / checker | Approver (release) |
|---|---|---|
| `mechanical`, `structural` (and any Design discipline) | Design team member (`design_team_members`, unchanged behaviour) | Design team role `head` |
| `electrical` | `require_tab_action("electrical", "bom", "create" / "edit")` | `electrical:bom:approve` |
| `hydraulic` | `require_tab_action("hydraulic", "bom", …)` (already used by `hydraulic/routes/boms.py`) | `hydraulic:bom:approve` |
| `pneumatic` | `hydraulic` app with the `pneumatic` subtab (the §12 alias) | `hydraulic:pneumatic_bom:approve` |
| `rrv_master` (`bom_kind`, §4.1) | `engineering:rrv_boms:create` / `edit` | `engineering:rrv_boms:approve` |

Four-eyes stays locked for all disciplines. Admin stand-in follows the Design setting "Allow admin stand-in".

**Drawing release authority — DECIDED (2026-10-07).** E/H/P *drawings* (schematics, wiring diagrams, hydraulic/pneumatic circuits) live in the Design register and are released there by the **discipline department head (Electrical / Hydraulic / Pneumatic) or a user the head assigns**. Design keeps numbering, revisions and ECN. This is enforced by a discipline-aware `doc_authority(db, user, discipline, action)` in the Design module, the drawing-side twin of `bom_authority` (see `electrical/rescope-plan.md` §7.3 and `hydraulic/rescope-plan.md` §13 #1). It amends D6 ("only the Design head releases") for the three disciplines; mechanical/structural drawings stay with the Design head. The head-assigned delegate is recorded (who assigned, when) and revocable by the head; four-eyes (releaser ≠ author) still applies. Whether the same head-assigned delegate may also approve the discipline **BOM** (the "Approver (release)" column above) was not part of this decision — the BOM approver stays as in the table until the owner says otherwise.

Permission registry entry (`MODULES["engineering"]`), with subtabs matching `EngineeringNav.tsx` one-to-one:
`dashboard`, `rrv_boms`, `boms` (all-discipline register), `where_used`, `shortage`, `production_push`, `reports`, `settings`, used with the standard actions. `electrical` gains a `bom` subtab. `hydraulic` gains `pneumatic_bom`. These two registry edits are flagged in §14.

---

# 4. Data model

All new tables use `TimestampMixin`. Every model is registered in `core/audit_registry.py` via `register_audited(...)`, with child lines using `parent_attr`. Statuses, kinds and disciplines are **coded tuples in model files** (no metadata customization, D8).

## 4.1 Changes to the shared BOM tables (`design_bom*`, Phase 1)

These are additive, nullable or defaulted columns. They are safe for the existing Design data, and existing Design screens keep working.

**`design_boms`**

| New field | Notes |
|---|---|
| `discipline` | `mechanical` (default for existing rows), `electrical`, `hydraulic`, `pneumatic`, `structural`, `general`. Same tuple as `design_documents.discipline`. Drives authority (§3.1) and the section a BOM belongs to. |
| `bom_kind` | `assembly` (default: a normal make item's BOM), `system` (a discipline *system* BOM on an RRV, e.g. "RRV-X Electrical System". It is a **phantom**: not stocked, flattened when pushed to Production), `rrv_master` (the RRV master BOM). |
| `rrv_model_item_id` | Denormalized for `system` BOMs: which RRV model's master they serve. Used for filters only; the structural link is the master's line. |
| `legacy_source` | e.g. `electrical_job:57`, `hyd_bom:HBOM-0012/B`. Set by the data migration (§12) for traceability. |

Numbering: `rrv_master` BOMs use `EBOM-RRV-NNNN` (§34 setting, no year, because a model's master lives for years). All others keep `BOM-YYYY-NNNN`. Revisions stay **R0, R1…** for all BOMs (the same `revision_label()` as drawings). §9's "Rev A" is not used, so there is one revision style app-wide (Q6).

**`design_bom_revisions`**

| New field | Notes |
|---|---|
| `na_disciplines` | JSON list, `rrv_master` only: disciplines declared not applicable for this revision. The reason goes in `engineering_section_waivers` (§4.2). |
| `quantity_basis` | Default 1. "Quantities are per 1 RRV". It exists so the shortage check and push never guess. |
| `frozen_tree` | JSON, set at release of `rrv_master` revisions: the exploded tree (bom ids, revision ids, items, quantities) at freeze time. Used by the child-revised flag, compare and push (§5.4). |

**`design_bom_lines`** (fields required by §9 rule 3 that the Design BOM doesn't yet carry)

| New field | Notes |
|---|---|
| `tag_number` | Position/tag on the drawing: relay `K1`, valve `V3`, `CYL2`. Uppercased. Unique within a revision when set. Migrated from `hyd_bom_items.tag_number`. |
| `make`, `part_number` | The make/part no. chosen for this line. **Must be one of the item's approved makes** (`design_item_approved_makes`) when the item has any. Defaults from the Item Master `make` / `manufacturer_part_number`. §34 default mandatory fields: make + part no. for `buy` lines. |
| `long_lead` | Boolean. Manual flag in Phase 1. From Phase 2 it is **derived**: true if the item's lead time ≥ the threshold (45 days), and the manual flag can only add to that, never clear it. |
| `discipline` | Defaults to the parent BOM's discipline. Only differs on `rrv_master` lines, where it tells you which **section** the line is in. |
| `reference_designators` | Optional free text for multi-quantity tags (`K1–K4`). Used for printing only. |

`make_buy` already exists. The §34 setting "Make/Buy default by item category" fills it on line creation: Electrical = `buy`, locked for `discipline = electrical` (rule R3).

> **ERP standard / why — make/buy is a line decision, not an item property.** The same item can be bought for one product and made for another. Standard ERPs keep a default on the item (procurement type) and allow an override per BOM line. Make lines must have their own BOM (they explode). Buy lines are leaves (they become purchase demand). That is why the shortage check (§5.6) only looks at buy leaves, and why the push (§5.5) only creates Production BOMs for make nodes.

## 4.2 New Engineering tables

**`EngineeringSectionWaiver`** (`engineering_section_waivers`): one row per discipline declared N/A on a master revision.

| Field | Notes |
|---|---|
| `master_revision_id` | FK `design_bom_revisions.id` (must be an `rrv_master` revision) |
| `discipline` | `electrical`, `hydraulic` or `pneumatic` (mechanical can never be N/A) |
| `reason` | Required. Example: "Model RRV-4W-TW has no pneumatic system — brakes are hydraulic." |
| `declared_by_id`, `declared_at` | |

Unique (`master_revision_id`, `discipline`). It is copied forward when a new master revision starts, and can be removed in the draft.

**`EngineeringProductionPush`** (`engineering_production_pushes`), number `EPP-YYYY-NNNN`: one push of a frozen master revision into Production.

| Field | Notes |
|---|---|
| `push_number`, `master_bom_id`, `master_revision_id` | |
| `status` | `previewed` → `created` (draft Production BOMs exist) → `activated` (Production activated all of them) / `discarded` |
| `pushed_by_id`, `pushed_at`, `remarks` | |
| `ecn_id` | The ECN that caused this push (when the master revision came from one). Used to show effectivity. |

Child **`EngineeringProductionPushLine`**: `push_id`, `design_bom_id`, `design_bom_revision_id`, `product_item_id`, `production_bom_id` (the draft created), `previous_production_bom_id` (the active one it will replace, nullable), `diff_summary` (JSON: added / removed / qty_changed counts). The full line diff is recomputed on read, never stored stale.

**`EngineeringShortageRun`** (`engineering_shortage_runs`), number `ESR-YYYY-NNNN`: a snapshot of one shortage check.

| Field | Notes |
|---|---|
| `run_number`, `master_bom_id`, `master_revision_id`, `rrv_quantity` | "For 3 RRVs" |
| `pm_project_id`, `erp_project_id` | Optional context. Used in PR remarks and for reservation matching. |
| `location_id` | Null = all locations |
| `include_open_po`, `include_open_pr`, `include_others_reserved` | Copied from settings at run time, so the numbers can be explained later |
| `run_by_id`, `run_at` | |

Child **`EngineeringShortageLine`**: `run_id`, `store_item_id`, `gross_qty`, `available_qty`, `open_po_qty`, `open_pr_qty`, `shortage_qty`, `uom`, `long_lead`, `lead_time_days`, `paths` (JSON: where in the tree it came from), `pr_number` (filled when a PR is linked, §5.6).

**`EngineeringSetting`** (`engineering_settings`): the standard `<module>_settings` table (§27: `key` unique, `value` JSONB, `updated_by_id`). Only the keys the code reads are listed in §9.

Phase 3 only: **`EngineeringCostSnapshot`** (`engineering_cost_snapshots`). It freezes the cost roll-up for a master revision on demand (`cost_basis`, `total`, per-section totals, `lines` JSON), so management can compare the cost of R2 and R3 later.

## 4.3 Changes to other modules' tables

| Table | Change | Phase | Owner session |
|---|---|---|---|
| `electrical_jobs` | Add `design_bom_id` (nullable FK → the electrical `system` BOM this vehicle's package builds to) | 1 | Electrical re-scope |
| `hyd_systems` | Add `design_bom_id` (same idea) | 1 | Hydraulic re-scope |
| `hyd_components` | `store_item_id` already exists. The migration fills it (§12.2). | 1 | Hydraulic re-scope |
| `store_items` | Add `lead_time_days` (nullable int). It drives the long-lead list. | 2 | Store |
| `p2p_request_items`, `p2p_purchase_order_items` | Add `store_item_id` (nullable FK). Until it exists, Engineering matches on `part_code = item_code`. | 2 (P2P plan §14 rule 5) | P2P |
| `production_boms` | **None.** The link lives in `engineering_production_push_lines`. | — | — |

---

# 5. Workflows

## 5.1 The RRV structure

```
RRV model item  "RRV-8W Tower Wagon"            ← Item Master, finished good
 └─ EBOM-RRV-0001  (bom_kind = rrv_master, discipline = mechanical)   R0, R1…
     ├─ [mechanical] Chassis assembly          make → BOM-2026-0041 (assembly)
     ├─ [mechanical] Rail gear assembly        make → BOM-2026-0042 (assembly) → sub-assemblies…
     ├─ [mechanical] Cabin, hardware kit…      make / buy
     ├─ [electrical] RRV-8W Electrical System  make (phantom) → BOM-2026-0050 (system, electrical)
     ├─ [hydraulic]  RRV-8W Hydraulic System   make (phantom) → BOM-2026-0051 (system, hydraulic)
     └─ [pneumatic]  RRV-8W Pneumatic System   make (phantom) → BOM-2026-0052 (system, pneumatic)  — or N/A waiver
```

- The master lists the **top-level** mechanical assemblies directly, plus **one line per E/H/P system**. Each system line points at a phantom item ("<model> Electrical System"). That item's BOM is authored and released by the discipline.
- A customer-specific variant is a second master with `pm_project_id` set, created by **"Copy to project"** from the model master (Phase 3). Explosion in a project context prefers that project's BOMs. (Today `_explode` sorts *generic first*, and that gets fixed in Phase 1, §14.)

> **ERP standard / why — phantom assemblies.** A phantom is an assembly that exists on the drawing and in the EBOM (so the electrical team owns "the electrical system" as one released unit) but is never stocked or built as a separate work order. Its components are consumed directly by the parent. This matches rule R4 exactly: electrical work happens *on the RRV*, so there is no electrical work order. The phantom gives Electrical ownership without inventing a fake production step.

## 5.2 Discipline BOM release (unchanged engine, new authority)

`draft` → `in_review` → `in_approval` → `released` → `superseded` (the existing `DESIGN_BOM_REVISION_STATUSES`), with `recall` and `return` as today. Release blockers from `line_blockers()`, plus:

- `buy` lines missing `make` / `part_number` when the §34 mandatory-fields setting requires them. Error: "Line 30 (MT-ELE-0112 Relay 24 V) has no make — pick one of its approved makes (Schneider, Omron) or ask Design to add one."
- `electrical` BOM with any `make` line (R3). Error: "Line 50 is marked Make, but electrical items are always bought out (rule R3). Change it to Buy, or move the line to the mechanical BOM if it's a fabricated bracket."
- Duplicate `tag_number` in the revision.

On release, the existing broadcast (Store, P2P, Production) stays. **New:** if the BOM is a `system` BOM used by a master that is `draft` or awaiting freeze, the master coordinator is notified that a section is now released.

## 5.3 Master BOM freeze (= release of the `rrv_master` revision)

```
Coordinator creates EBOM-RRV-0001 R0 (RRV model item, section lines)
   │  Sections panel shows, per discipline: Not started · Draft · In review · Released · N/A
   │  (derived live from the system BOM's state — nothing to keep in sync)
   ▼
Coordinator: Submit for freeze  ──► checker ──► Freeze approver approves
   │  BLOCKED unless, for each of mechanical / electrical / hydraulic / pneumatic:
   │    • the section has ≥1 line and every `make` line in it explodes to a RELEASED BOM, or
   │    • the discipline is waived (engineering_section_waivers, reason required; mechanical never)
   │  and every line in the full explosion passes line_blockers()
   ▼
Frozen (status released) → previous master revision superseded
   → notify Production planners ("ready to push"), Store + Purchase ("ready for shortage check")
```

- "Frozen" is a UI word. In the database it is `status = released` on an `rrv_master` revision. No new status is added.
- The freeze blocker message lists every problem, in the same format as `line_blockers`. Example: "EBOM-RRV-0001 R0 can't be frozen yet: Electrical — BOM-2026-0050 is In review (with checker A. Kumar). Pneumatic — no system line and not marked N/A. Mechanical — Line 20 (Rail gear assembly) explodes to BOM-2026-0042, which has no released revision."
- A frozen master explodes to **released** child revisions only. Child BOMs revised later don't silently change the frozen master. See §5.4.

> **ERP standard / why — freeze.** A freeze (SAP calls it a "released for production" status, Windchill "Released") is the point after which the BOM is a contract between Engineering and the rest of the company. Purchase orders long-lead items against it, and Production plans against it. After the freeze, nothing changes without a formal change (ECN), so everybody downstream can see *what* changed and *from when*.

## 5.4 Revision after freeze (ECN only), effectivity

- §34 "BOM revision only through ECN after freeze" is **on and locked** for `rrv_master` and `system` BOMs. `check_bom_new_revision` requires an open ECN listing the BOM. That already happens through `_validate_ecn_link` when an ECN id is passed; for these two kinds it becomes mandatory.
- When a child BOM (e.g. electrical system) gets a new released revision, every frozen master whose explosion includes it is marked **"Child revised — master revision needed"**. This is a derived flag, computed by comparing the child revision ids captured at freeze with the current released ones. It shows on the dashboard. The coordinator raises the master's next revision under the **same ECN** (the ECN must list the master as an affected BOM; Phase 2 adds "add parent masters to this ECN" as one click from the ECN impact list).
- To capture the child revisions at freeze, the master's frozen explosion is stored as `frozen_tree` JSON on `design_bom_revisions` (§4.1). Phase 1 adds the column. It also makes "compare R1 vs R2" exact.
- **Effectivity** comes from the ECN (`effectivity_type`: immediate / date / serial / next_order / project) and is shown on the push screen (§5.5). Production decides which open RRV builds move to the new Production BOM version. Work orders already exploded keep their own material lines (existing Production rule).

> **ERP standard / why — effectivity.** A new revision doesn't make old vehicles wrong. Effectivity says from *which* date, serial number or order the new revision applies, and disposition (also on the ECN) says what happens to stock and WIP built to the old one. Together they stop the classic failure: a design change silently orphaning parts already bought.

## 5.5 Push to Production ("Create Production BOM", with diff)

Manual by default (§34 "Auto-create Production BOM on freeze" = off).

1. A Production planner opens the frozen master → **Production** tab → **Preview push**. The service walks `frozen_tree` and produces one MBOM candidate **per `make` node that is not a phantom**:
   - the RRV model item (top), with phantom `system` BOMs **flattened** into it (their children's quantities are multiplied up), so the electrical/hydraulic/pneumatic items become direct components of the RRV main assembly, consumed at stages 5–7 of the RRV Build;
   - each mechanical make assembly (chassis, rail gear…) as its own candidate.
2. For each candidate, the diff is computed against that item's **active** Production BOM (if any): added lines, removed lines, quantity changes, and lines whose `scrap_percent` Production had set (these are kept and shown). If there is no active BOM, the label is "new".
3. **Create drafts.** For each candidate with differences, the service creates a draft Production BOM. It is version 1, or the next version through the same logic as `POST /production/boms/{id}/new-version`, so the routing and scrap from the active version are **copied forward**. Candidates with no difference are skipped and reported as "unchanged". An `EngineeringProductionPush` is recorded.
4. Production reviews, adjusts routing and scrap, and **activates** through its own endpoint and permission (`production:bom:approve`). When every draft in a push is activated, the push becomes `activated`. Production's own rule (one active BOM per item, WOs keep their exploded lines) does the rest.

Rules:
- Pushing a superseded master is blocked: "R1 of EBOM-RRV-0001 is superseded by R2 — push R2."
- A second push of the same revision while drafts from the first are still unactivated is blocked, with a link to the open push.
- The push never edits an active Production BOM.

## 5.6 Shortage check → "Raise PR for shortage"

Input: a frozen master (or any released BOM), number of RRVs N, an optional project and location.

```
gross    = Σ over buy leaves of the explosion: total_qty × N   (aggregated per item, UOM-checked)
available= on_hand − reserved            (production.service.available_qty; if "include reserved
                                          stock of other projects" = off, the project's own reservations
                                          are added back so they count as available to it)
open_po  = Σ PO line qty − Σ GRN accepted qty, for POs in issued / acknowledged / partially_fulfilled,
           matched by store_item_id, or part_code = item_code until P2P adds it      (setting: on)
open_pr  = Σ PR line qty on PRs not rejected/cancelled/converted, same matching      (always on —
           this stops the same shortage being PR'd twice)
shortage = max(0, gross − available − open_po − open_pr)
```

- The run is saved as `ESR-YYYY-NNNN`, so the numbers can be explained later. "Why does it say 4?" — the run shows each term.
- **Raise PR**: the user ticks shortage lines → the page writes `sessionStorage['p2p_new_prefill'] = {items: [{item_name, part_code: item_code, make, unit, quantity, category}], remarks: "Shortage for EBOM-RRV-0001 R2 × 3 RRV (ESR-2026-0007)…"}` and opens `/dashboard/p2p/new?prefill=session`. This is the existing multi-line prefill. The requester reviews and submits in P2P, and P2P's approval chain applies unchanged.
- PR back-link: the shortage line stores `pr_number` by matching on the next run (open PR qty now covers it), and through an explicit "Link PR" action (same pattern as `electrical/routes/bom.py` `link-pr`). No P2P table change is needed in Phase 2.
- Long-lead lines are sorted first, with a "Buy now" badge.

> **ERP standard / why — net requirements and long-lead.** This is a one-level MRP netting: gross requirement − on-hand − scheduled receipts (open POs) = net requirement. Full MRP also time-phases demand. That isn't needed while RRVs are built in small batches, so it is out of scope. **Long-lead items** (bogies, hydraulic pumps, special cables) are the reason engineering BOMs get frozen in stages in real companies. Purchase must order them from the *first* released BOM, not after the full freeze, which is why the long-lead list (§6) works on released discipline BOMs even when the master isn't frozen yet.

## 5.7 New item requests

Unchanged from Design: a line with only `new_item_name` / `new_item_spec` broadcasts `design_new_item_request` to Store, and blocks release until Store creates the code and the line is linked. Engineering adds a cross-discipline **"Pending item codes"** list on its dashboard (all disciplines), because during migration (§12) there will be hundreds.

---

# 6. Reports and dashboard

| Report | Definition |
|---|---|
| **Master BOM (indented)** | Frozen explosion: level, path, item code, description, qty per RRV, total qty, UOM, make, part no., tag, drawing + rev, make/buy, long-lead, section. Excel export, and the **Word document of record** (D4, §7). |
| **Compare revisions** | Any two revisions of one BOM (or of two masters): added / removed / qty / make / part / drawing-rev changes, at the exploded (flattened per item) level and at the structural level. Uses `frozen_tree`. |
| **Where-used** | `where_used_item()` across all disciplines, with the RRV masters reached through the tree ("used in EBOM-RRV-0001 R2 via BOM-2026-0050 R1"). |
| **Long-lead list** | Buy leaves where `long_lead` is set, per master or across all released masters, with stock and open PO. |
| **Cost roll-up** | Σ qty × unit cost per line, per section and total. Cost basis setting: **last PO rate** (latest `p2p_purchase_order_items.unit_price` for the item) → fallback `moving_average_cost` → `standard_cost` → "no cost" (counted and listed, never shown as zero). Management report only, not GL (D5). |
| **Discipline status** | Per master: section states, days in current state, pending item codes, open ECNs. |

The dashboard (`/dashboard/engineering`) shows:
- Masters by state (draft / awaiting freeze / frozen / child revised)
- Sections blocking freeze
- Pending item codes
- Open shortage runs with unraised shortages
- Pushes awaiting Production activation
- Long-lead items with no PO

---

# 7. API design

## 7.1 One write path for BOMs

All BOM create/edit/submit/review/approve stays on **`/design/boms`** (one router, one set of rules). Its router dependency widens from `require_app_access("design")` to `require_any_app_access("design", "engineering", "electrical", "hydraulic")`, and every action calls `bom_authority()` (§3.1). The Electrical and Hydraulic BOM tabs embed the shared `BomLinesEditor` against it with `discipline` preset. A second BOM write router is **not** created.

New query params on `GET /design/boms`: `discipline`, `bom_kind`, `rrv_model_item_id`. New fields on line payloads: `tag_number`, `make`, `part_number`, `long_lead`, `discipline`.

## 7.2 Engineering routers

All routers are prefixed `/engineering/...`, tagged `["Engineering"]`, and included in `main.py` with the `/api/v1` prefix. Access uses `require_tab_access` / `require_tab_action("engineering", <subtab>, <action>)`.

| Router file | Endpoints |
|---|---|
| `routes/masters.py` | `GET /engineering/masters` (list `rrv_master` BOMs with section states) · `POST /engineering/masters` (creates the `design_bom` with `bom_kind=rrv_master` + R0 + one line per E/H/P system, auto-creating the phantom system items through Store's item service if missing, behind a confirm) · `GET /{bom_id}` (header, sections panel, freeze readiness with every blocker, child-revised flag) · `PUT /{bom_id}/revisions/{rev_id}/waivers` (N/A per discipline + reason) · `GET /{bom_id}/freeze-check` · `POST /{bom_id}/copy-to-project` (Phase 3) |
| `routes/explosion.py` | `GET /engineering/boms/{bom_id}/explosion?revision_id=&project_id=` (calls `bom_service.explode`) · `GET /engineering/compare?from_revision_id=&to_revision_id=&level=flat|tree` · `GET /engineering/where-used?item_id=` |
| `routes/production_push.py` | `POST /engineering/masters/{bom_id}/push/preview` (no writes; candidates + diffs) · `POST /engineering/masters/{bom_id}/push` (create drafts) · `GET /engineering/pushes`, `GET /engineering/pushes/{id}` · `POST /engineering/pushes/{id}/discard` (deletes still-draft Production BOMs it created) |
| `routes/shortage.py` | `POST /engineering/shortage-runs` (compute + save) · `GET /engineering/shortage-runs`, `GET /{id}` · `POST /{id}/lines/{line_id}/link-pr` |
| `routes/reports.py` | `GET /engineering/reports/long-lead`, `/cost-rollup?revision_id=&basis=`, `/discipline-status`, Excel exports |
| `routes/documents.py` | Managed Word document for the master BOM through the shared `/documents` routes: `register(DocumentAdapter(entity_type="engineering_master_bom", …))` with a `.docx` builder (`engineering/reports/master_bom_docx.py`, using `utils/docx_letterhead.py`). PDF is the secondary download (D4). |
| `routes/dashboard.py`, `routes/lookups.py`, `routes/settings.py` | Aggregates; disciplines / kinds / cost bases; settings per the §27 pattern |

Errors follow the real-error-messages rule. Every 409 names the record, the state, and what to do next (examples in §5).

---

# 8. Frontend

The frontend follows the Production module as the template. The existing scaffold folders are handled as follows. `bom` becomes `rrv-boms`; `reports` is kept; **`calculations`, `change-requests`, `drawings` and `projects` are deleted**, because they duplicate R&D calculators, Design ECR/ECN, the Design register and PM, and all four are empty.

| Route | Page |
|---|---|
| `engineering/page.tsx` | Dashboard (§6) |
| `engineering/rrv-boms/` `page`, `new`, `[id]` | Master list (model, project, revision, state, section chips). The detail page has tabs: **Structure** (section lines + editor while draft) · **Sections** (state per discipline, N/A waivers, freeze readiness) · **Explosion** (indented tree, expand/collapse) · **Compare** · **Shortage** · **Production** (push preview, diff, push history) · **Where-used** · **History** (events, ECNs) |
| `engineering/boms/page.tsx` | All-discipline BOM register (filters: discipline, kind, model, state). Rows open the Design BOM detail for mechanical, or the discipline module's BOM tab. |
| `engineering/where-used/page.tsx` | Item picker → where-used tree |
| `engineering/shortage/page.tsx`, `[id]` | Runs list; run detail with "Raise PR for selected" and "Link PR" |
| `engineering/reports/page.tsx` | Long-lead, cost roll-up, compare, discipline status, with export |
| `engineering/settings/page.tsx` | §9 settings (last nav tab) |

Components in `frontend/src/components/engineering/`:
- `EngineeringNav.tsx` is copied and adapted from `ProductionNav`. It has a `TABS` array with `subtabKey`, `filterTabsByAccess`, `NotificationBell` and `TourButton`.
- `SectionStatusPanel.tsx`, `BomExplosionTree.tsx`, `BomDiffTable.tsx` (also used by the push preview), `ShortageTable.tsx` and `FreezeBlockersBanner.tsx`.
- `BomLinesEditor.tsx` moves from `dashboard/design/boms/` to `components/bom/`, gains tag/make/part/long-lead columns, and is used by Design, Electrical, Hydraulic and Engineering.

UI rules that apply to every page:
- The nav renders above the header.
- The "← Back" button uses the secondary pill style at the top-right of the header row.
- Use `ConfirmDialog` / `PromptDialog` and never browser dialogs. For example, N/A reasons, discard push and freeze confirmation go through these.
- Error banners show the backend's real message, including the full blocker list.
- Pickers follow `premnathrail-ui-behavior`. The item picker is the shared searchable Item Master select, and the make picker is limited to approved makes.

---

# 9. Settings (§34, only what Phase 1–3 code reads)

| Key | Type | Default | Read by |
|---|---|---|---|
| `sections_enabled` | multi_select | mechanical, electrical, hydraulic, pneumatic | Master creation, freeze check |
| `freeze_approver_id` | user | Design head (`design_settings.default_approver_id`) | Master submit |
| `mandatory_line_fields_buy` | multi_select | make, part_number | `line_blockers` extension |
| `make_buy_default_by_category` | json_list | Electrical → buy (locked) | Line create |
| `long_lead_threshold_days` | int | 45 | Long-lead flag, reports (Phase 2) |
| `max_bom_levels` | int | 5 (explosion hard stop stays 15 as a cycle guard) | Explosion warning |
| `auto_push_on_freeze` | bool | off | Freeze |
| `shortage_include_open_po` | bool | on | Shortage |
| `shortage_include_others_reserved` | bool | off | Shortage |
| `cost_basis` | select | last_po_rate | Cost roll-up |

"Only Item Master items allowed" and "revision only through ECN after freeze" are **locked in code**, not settings. They are rules, not preferences. The `EBOM-RRV-NNNN` prefix goes into the shared `number_series` once the Platform framework (§27) exists; until then it is a constant.

---

# 10. Wiring checklist

This is every file a new module touches. Missing items here have broken deploys before.

**Backend**
- [ ] `modules/engineering/{models,routes,schemas,reports}/__init__.py`, `service.py` (push, shortage, freeze check), `migration.py` (§12)
- [ ] Add `"engineering"` to `AVAILABLE_APPS` in `main/models/user.py:10`
- [ ] Add a `MODULES["engineering"]` entry with subtabs, an `electrical.bom` subtab and a `hydraulic.pneumatic_bom` subtab in `core/permission_registry.py`
- [ ] Import the models in **both** `backend/alembic/env.py` and `main.py`, and include the routers in `main.py`
- [ ] Add `register_audited(...)` for the five new models in `core/audit_registry.py`
- [ ] Alembic migration: add the §4.1 columns to `design_bom*` (defensive `inspect` checks, `batch_alter_table`), backfill `discipline='mechanical'` and `bom_kind='assembly'`, create the §4.2 tables, add `design_bom_id` to `electrical_jobs` / `hyd_systems`, and seed the `modules` row with a DELETE in `downgrade()`. Chain off the **current** head. It is `e7c4a1b9d2f5` (maintenance phase 2) as of writing, but run `alembic heads` first, because Design, Quality and Maintenance are all adding migrations today.
- [ ] Refactor `design/routes/boms.py` → `design/bom_service.py`: public `explode(db, rev, project_id=None)`, `build_lines(...)`, `bom_authority(...)`. Fix the explosion preference so the project's own BOM wins in a project context.
- [ ] `register(DocumentAdapter(...))` for `engineering_master_bom`
- [ ] `backend/app/tests/test_engineering.py`: freeze gate (each section state × waiver), ECN-only revision, phantom flattening and quantity multiplication in the push, diff, shortage netting (including open PR double-count protection), discipline authority, and the R3 make-line block

**Frontend**
- [ ] Add `'engineering'` to the `AppModule` union in `types/index.ts:1` and to the literal union in `hooks/useAuth.ts` (`useRequireApp`)
- [ ] Add a Sidebar icon and entry in `components/Sidebar.tsx`, after Design and before Electrical
- [ ] Add a landing card in `app/dashboard/page.tsx`
- [ ] Add `engineeringApi` in `lib/api.ts` and the interfaces in `types/index.ts`. Extend `DesignBomLine` types with the new fields.
- [ ] Add `ENTITY_LINK` entries (`engineering_master_bom`, `engineering_shortage_run`, `engineering_production_push`) in `components/erp/NotificationBell.tsx`
- [ ] Add tour configs in `lib/tour/configs/engineering*.ts` and register them in `lib/tour/registry.ts`
- [ ] Delete the four duplicate scaffold folders (§8)

**Docs**
- [ ] Turn this plan into `docs/02-modules/engineering/overview.md` once built. Update `docs/02-modules/design/overview.md`, which still says "automatic BOM sync into Production" is out of scope, and add a changelog entry.

---

# 11. Notifications

Notifications use `notify_user` / `broadcast_notification`. Following the Teams rule, **only approval requests and reminders pass `teams=True`**. Everything else is bell-only.

| Type | Recipients | When | Teams |
|---|---|---|---|
| `engineering_freeze_check_needed` / `engineering_freeze_approval_needed` | Named checker / freeze approver | Master submitted / checked | **Yes** (approval) |
| `engineering_master_frozen` | Production planners (broadcast `app_name="production"`), Store, P2P, the discipline owners | Master frozen | No |
| `engineering_section_released` | Master coordinator | A system BOM used by a draft master is released | No |
| `engineering_child_revised` | Master coordinator | A child of a frozen master gets a new released revision | No |
| `engineering_push_created` | Production BOM approvers | Drafts created by a push | **Yes** (they must activate) |
| `engineering_push_pending_reminder` | Production BOM approvers | Daily, while a push has unactivated drafts for more than 3 days, at most once per day (the existing `hr_reminders.py` "don't notify twice" check) | **Yes** (reminder) |
| `engineering_freeze_pending_reminder` | Freeze approver | Daily, while a master waits for more than the Design `review_overdue_days` | **Yes** (reminder) |

Discipline BOM check/approve notifications are already sent by the Design engine. They must gain `teams=True`, because they are approval requests (§14 note to the Design session).

---

# 12. Migration of existing data

This is run as an **admin-triggered, idempotent data migration** (`engineering/migration.py` behind `POST /engineering/admin/migrate/{source}?dry_run=true`), not inside Alembic. The data needs human review, and Alembic only adds the columns. Each run produces an Excel report. **Before running on production, take a dump**: the 05-Oct DB reset showed prod can differ from expectations, so check `min(users.created_at)` and keep the dump in `D:\PremnathrailBackup\dumps`.

## 12.1 Electrical BOM lines (`electrical_bom_items`)

1. **Item mapping, for lines with null `store_item_id`.** Matching is tried in order:
   - (a) exact `part_number` = `store_items.manufacturer_part_number` or `part_number`, and same `make` (case/space-insensitive);
   - (b) exact `part_number` only, when it is unique;
   - (c) no automatic match: the line is listed with the top 3 name-similarity candidates.

   The dry-run Excel has a "chosen item code" column. The Electrical lead fills it in and re-imports it (`POST …/migrate/electrical?mapping=file`). Lines still unmapped migrate as **new-item request lines** (`new_item_name = description`, `new_item_spec = make / part no. / rating / specification`). Store then gets them through the existing new-item broadcast, and the release blocker forces each one to be resolved. No line is ever dropped.
2. **Structure.** Electrical BOMs are per *vehicle job* today. The engineering BOM is per *model/project*. Default (Q3): for each distinct (`rrv_model`, `erp_project.pm project` if any), take the **most recent job's** lines as the electrical `system` BOM R0 **draft**, set `legacy_source`, and link every job of that model to it (`electrical_jobs.design_bom_id`). Other jobs' differing lines are listed in the report as "deviations to review", and are not merged automatically.
3. **Status.** Everything migrates as **draft R0**. `selection_status = approved` is not a four-eyes release, so it is not treated as one. The Electrical head re-releases each BOM through check → approve.
4. **Procurement state.** `procurement_status` / `p2p_request_id` stay on the legacy table for history. From then on, the shortage check (§5.6) replaces them.
5. The table becomes read-only in the UI for one release, then is dropped (master plan §25 migration rule).

## 12.2 Hydraulic components → Item Master, then Hydraulic BOMs

1. **`hyd_components` → `store_items`**:
   - (a) where `hyd_components.store_item_id` is set: keep it;
   - (b) else match `part_number` + `manufacturer` against Item Master (same rules as 12.1);
   - (c) else **create the Store item** through Store's item service (`generate_item_code`, type `material`, category "Hydraulic & Pneumatic" (`HYD`), make = `manufacturer`, `manufacturer_part_number` = `part_number`, UOM = the BOM line UOM).

   Category (c) requires Store-head approval of the dry-run list first, because it creates master data (§41 "New item request approval"). Then `hyd_components.store_item_id` is written.
2. **Technical attributes** (bore, rod, stroke, displacement, pressure, ports, seals, temperatures) go into `store_items.specification` as one normalized line ("Bore 63 mm · Rod 36 mm · Stroke 400 mm · Rated 210 bar · Port 3/4" BSP"). `hyd_components` stays read-only as the structured reference until Store decides on item specification attributes (Q8).
3. **`hyd_boms` → `design_boms`**: one `design_bom` per `bom_number` (`discipline` = the hyd BOM's `system_type`, `bom_kind = system`, `legacy_source = hyd_bom:<number>/<rev>`). Each `hyd_boms` row (one per revision letter) becomes a `design_bom_revision` in letter order: `released` → released, earlier released/`obsolete` → superseded, `draft` → draft. The original letter goes into `change_summary` ("Migrated from HBOM-0012 Rev B"). Lines map `component_id` → `store_item_id`, and keep `tag_number`, qty, UOM and remarks. `hyd_systems.design_bom_id` is set to the released one.
4. Migrated released revisions are recorded as released by the original `released_by_id`, with `reviewed_by_id` null and a migration event. They are history, not a fresh four-eyes release. The next change goes through an ECN.

## 12.3 Design BOMs already created today

They get `discipline = mechanical`, `bom_kind = assembly`. No other change.

---

# 13. Dependencies and sequence with the Electrical / Hydraulic re-scope

```
Item Master go-live (§16: v3 import, categories incl. finished goods + system phantoms)
        │                                   ┐
Design BOM committed by Design session      │  prerequisites (not this module's work)
        ▼                                   ┘
E-1  Engineering Phase 1 schema + engine refactor (§4.1, bom_authority)   ← Engineering
        │
        ├──► E/H re-scope step "BOM tab on shared engine"                 ← Electrical / Hydraulic sessions
        │       Electrical stage 3/4 gates read design BOM state
        │       Hydraulic BOM tab writes design_boms; Pneumatic subtab
        ├──► Data migration 12.1 / 12.2 (dry run → review → apply)         ← Engineering, with E/H leads
        ▼
E-2  Master BOM + freeze (needs at least one discipline on the shared engine; others can be N/A)
        ▼
E-3  Push to Production + shortage/PR (needs released masters; P2P store_item_id optional)
        ▼
E/H re-scope remainder: Electrical stage 5 "Purchase Requirement" reads the shortage run;
RRV Build stages 5–7 gates read "system BOM released" (Production §17)
```

- **Electrical must not keep extending `electrical_bom_items`** once E-1 lands. The re-scope's "add mandatory `store_item_id`" (master plan §10) is **replaced** by the migration to the shared engine. Doing both would mean migrating twice.
- **Hydraulic's "replace `hyd_components` with Item Master"** (§11) is the same work as 12.2. It is done once, by whichever session gets there first, using `engineering/migration.py`.
- **Pneumatic** has no BOM data today. It starts directly on the shared engine (`discipline = pneumatic`).
- **Production** needs no change before E-3. Its RRV Build gates for stages 5–7 can read `design_boms` state afterwards (Production re-scope).

---

# 14. Collision notes (files other sessions are editing now)

From `git status` on 06-Oct-2026. **Re-read each file immediately before editing, and make small anchored insertions only** (parallel sessions rule).

| File / area | Current state | Engineering's touch | Handling |
|---|---|---|---|
| `backend/app/modules/design/**` (`models/bom.py`, `bom_service.py`, `routes/boms.py`, `schemas/bom.py`, `whereused.py`, `access.py` — all **untracked, uncommitted**) and `dashboard/design/boms/**` | Design session building now | Add columns (§4.1), move `_explode` / `_build_lines` into `bom_service`, `bom_authority`, widen the router dependency, move `BomLinesEditor` | **Do not start until the Design session has committed.** Then do it as one refactor commit with no behaviour change, and run `test_design_phases.py` before adding features. |
| `core/permission_registry.py`, `core/audit_registry.py`, `main.py`, `alembic/env.py`, `main/models/user.py` | Modified by several sessions (uncommitted) | Anchored inserts | Standard shared-registry care |
| `backend/alembic/versions/` | 14 untracked migrations; head `e7c4a1b9d2f5` | One new migration | `alembic heads` immediately before writing `down_revision`; upgrade the dev DB only to our own revision |
| `frontend/src/lib/api.ts`, `types/index.ts`, `components/erp/NotificationBell.tsx`, `app/dashboard/page.tsx` | Modified (uncommitted) | Anchored inserts | Same |
| `components/electrical/ElectricalNav.tsx`, `components/hydraulic/HydraulicNav.tsx`, `dashboard/electrical/project-work/`, `dashboard/hydraulic/project-work/` | Modified/new (uncommitted) | BOM tab wiring belongs to the E/H re-scope, not Engineering | Leave to the E/H sessions; Engineering only provides the shared editor and API |
| `production/routes/*`, `production/service.py`, `models/work_order.py` | Modified (Production/Quality sessions) | Read-only reuse (`available_qty`, new-version logic called as a service) | No edits planned. If the new-version logic is route-local, extract it in a coordinated, separate commit. |
| `p2p/models/*`, `dashboard/p2p/new/page.tsx` | Modified (MD → Partner wording) | None in Phase 2 (prefill already supports multi-line) | `store_item_id` on P2P lines is P2P's change |
| `store/models/item.py` | Clean | `lead_time_days` (Phase 2) | Coordinate with the Store owner |

---

# 15. Phased delivery

**Phase 1: One engine, all disciplines (foundation)**
- Module wiring (§10)
- `design_bom*` column additions
- `bom_service` refactor and `bom_authority`
- Project-aware explosion fix
- Line fields: tag, make (approved-makes check), part no., long-lead flag, R3 make-line block
- Engineering BOM register (all disciplines), explosion tree, where-used across disciplines, compare revisions
- Pending-item-codes dashboard list
- Migration tooling 12.1 / 12.2 with dry-run reports, and the first apply on staging
- Backend tests

*Exit criterion:* an Electrical engineer and a Hydraulic engineer can each author, check and release their system BOM on the shared engine **without the Design app**. Every migrated electrical and hydraulic BOM is visible in Engineering → BOMs with Item Master codes (unmapped lines visible as new-item requests). Where-used for a relay returns its electrical BOMs and any mechanical BOM that uses it.

**Phase 2: RRV master, freeze, Production push, shortage → PR**
- Master BOM creation with section lines and phantom system items
- Sections panel and N/A waivers, freeze check with the full blocker list, freeze approval (Teams on approval), `frozen_tree`
- Child-revised flag, ECN-only revision of masters
- Push preview with diff, draft creation, push history and activation tracking
- Shortage run with PO/PR netting, "Raise PR for selected" through the session prefill, Link PR
- `store_items.lead_time_days` and the derived long-lead flag, long-lead list
- Master BOM Word document of record
- Settings page; reminders; tours

*Exit criterion:* for one real RRV model, the Design head freezes EBOM-RRV-0001 R0 with mechanical, electrical and hydraulic released and pneumatic N/A. A planner pushes it and Production activates the resulting Production BOM (electrical/hydraulic items appear directly under the RRV main assembly). A shortage run for 2 RRVs raises one multi-line PR. A second run shows that PR as `open_pr`, so nothing is double-requested.

**Phase 3: Variants, cost and change tooling**
- Copy-to-project (customer variant masters) with project-context explosion and shortage
- Cost roll-up report with selectable basis, and cost snapshots per revision for revision-to-revision cost comparison
- "Add parent masters to this ECN" one-click impact from the ECN
- Effectivity display on push (which open RRV builds are affected)
- Optional `auto_push_on_freeze`
- Retire `electrical_bom_items` and `hyd_bom*` / `hyd_components` (read-only → drop, with backup)
- Customer "recommended spares" list for Service, generated from the frozen master (replaces `hyd_spare_parts`, §11)

*Exit criterion:* a customer-specific variant of a model can be frozen and pushed without touching the model master. Management can see the material cost of R2 vs R3 of a master and which lines caused the difference. The legacy E/H BOM tables are dropped with no screen still reading them.

---

# 16. Open questions (recommended default in **bold**; Phase 1 proceeds on the default)

1. **Discipline BOMs on the shared engine instead of Electrical/Hydraulic keeping their own.** This is the core recommendation (§2.2). **Default: yes.** It reverses the Design memory note "merging is an open follow-up", so please confirm explicitly.
2. **RRV model as an Item Master item.** **Default: yes, one finished-good item per RRV model**, plus one phantom item per discipline system per model. Store's category list has no "Finished Goods" or "Sub-assembly" category today (`STORE_TYPE_CATEGORIES`), so Store must add e.g. "Assemblies & Finished Goods". Who owns creating these items: Design head or Store?
3. **Electrical BOM granularity.** Today it is per vehicle job. **Default: per model (or per customer project), with vehicle jobs referencing it.** Per-vehicle differences become an ECN or a project variant. Are there real per-vehicle electrical differences (e.g. customer-specific lighting) that happen often enough to need per-vehicle BOMs?
4. **Are any hoses, pipes or harnesses made in-house?** (Master plan §26 Q4.) **Default: all bought out.** Hydraulic `make` lines are allowed but rare, and electrical `make` is blocked (R3). If harnesses are made in-house, the harness becomes a mechanical-style make assembly with its own Production BOM.
5. **Freeze approver.** **Default: the Design head.** No Partner sign-off, because a BOM freeze is a technical release (D1 Partners stay for commercial and value approvals). Should a Partner sign off the *first* freeze of a new RRV model?
6. **Revision labels.** **Default: R0, R1… for every BOM, master included** (same as drawings). §9 shows "Rev A". Is a letter style needed for customer/RDSO submissions?
7. **Push trigger.** **Default: manual, by the Production planner** (§34). Should freeze auto-create drafts?
8. **Item specification attributes.** **Default: hydraulic technical attributes go into `store_items.specification` text,** and `hyd_components` stays read-only. A structured attribute table on the Item Master is a Store decision for later.
9. **Item code format.** The plan says `CCC-SSS-NNNN`, but the code generates `<TYPE>-<CAT>-<NNNN>`. **Engineering is unaffected** (it uses ids). Store should still settle this before the v3 import.
10. **Open PO matching.** **Default: match by `part_code = item_code` in Phase 2,** and switch to `store_item_id` when P2P adds it. Is Purchase consistently putting the item code in `part_code` today? If not, open-PO netting under-counts until P2P rule 5 lands.
11. **Shortage scope.** **Default: buy leaves only, all locations, reserved stock of other projects not available.** Should a shortage run also reserve the available stock for the project (Store reservation) in one click?
12. **Who releases E/H/P drawings.** **DECIDED (2026-10-07): the discipline department head, or a user the head assigns, releases E/H/P drawings in the Design register; Design keeps numbering, revisions and ECN** (§3.1).
