# Central authorization — how every module plugs in

One authorization framework for the whole ERP, administered in **Organization**:

```
User → Role(s) + extra grants → Permission (module : tab : action)   "what can they do"
User → Data scope per module (role, or personal override)            "which records"
Transaction → Workflow (stages) → Approver(s) → Approval status      "who approves, in what order"
```

Modules **declare** their tabs/actions, record tables and transaction types. Organization **decides**
who gets them. No module keeps its own approver lists, approval tables or access rules any more.

| Concern | Core code | Admin screen |
|---|---|---|
| Permissions | `app/core/permission_registry.py`, `app/core/permissions.py`, frontend `lib/permissions.ts` (`useCan`) | Organization › Role & Permissions |
| Data scope | `app/core/data_scope.py` | Role editor "Data access" column; user page overrides |
| Approvals | `app/modules/organization/services/approval_engine.py`, models `organization/models/approval.py` | Organization › Approval Workflows |
| Delegation | same engine (`ApprovalDelegation`) | Organization › Delegations, My Approvals |
| Sessions / sign-in | `app/modules/organization/services/security.py` | Organization › Security & Sessions |

Standard actions: `view create edit delete submit approve reject cancel export print import`. A tab
lists **only the actions it really enforces**.

---

## 1. Permissions (unchanged rules)

- Backend: `Depends(require_tab_action("<module>", "<tab>", "<action>"))`, or `ensure_tab_action(...)` inline.
- Frontend: `const { can } = useCan(); can('p2p', 'purchase_requisitions', 'submit')` to hide buttons.
- Deleting: `ensure_can_delete(user, record, module, tab)` (own records only, admins any).
- **Submit / Cancel**: when a tab gets an engine-backed submit, add `"submit"` and `"cancel"` to that
  tab's action list in `permission_registry.MODULES` and check them on the submit / cancel routes.
  (A central migration grants `submit`+`cancel` to everyone who already had `create` on those tabs, so
  nobody loses the ability to submit.)

## 2. Data scope

Levels: `own`, `assigned`, `department`, `plant`, `multi_plant`, `organization`.
A user's level per module = widest level of their active roles that open the module
(`Role.data_scopes[module]`, missing = organization), unless `User.data_access_scopes[module]` overrides.
Admins = organization. Plant = `User.branch_id`; multi-plant = that plus active Branch user assignments.
Department = same `User.department` name at the same plant (record owner's department, or the record's
own department column).

### Register each main record table once (module import time — e.g. in the module's `access.py`/`service.py`, imported by its routes)

```python
from app.core.data_scope import register_scoped

register_scoped(
    P2PRequest, "p2p",
    entity_type="p2p_request",          # = the approval engine entity_type, so approvers see what they approve
    owner=("requester_id", "created_by_id"),   # "own"
    assigned=("buyer_id",),             # "assigned" — column names, or callable(user) -> SQL expr for M:N tables
    branch="branch_id",                 # plant column if the record has one (else the owner's plant is used)
    department=None,                    # free-text department column on the record, if any
    label="purchase requisition",       # used in the 403 message
)
```

Register only **top-level records a user lists/opens** (PR, PO, leave request, NCR, drawing…), not
child lines, masters or settings (masters are organization-wide by nature).

### Enforce

```python
from app.core.data_scope import apply_scope, ensure_in_scope

q = apply_scope(db.query(P2PRequest), user, P2PRequest)     # every list / export / dashboard count of these records
ensure_in_scope(db, user, pr)                                 # every GET/PATCH/action on one record (after the 404 check)
```

`ensure_in_scope` raises 403 with the user's scope in the message. Child endpoints (`/prs/{id}/items`)
check the parent. Don't scope admin-only masters, settings or lookups used for dropdowns.

## 3. Approval engine

### Declare the transaction type (module import time)

```python
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction

def _pr_decided(db, req, outcome, actor):   # approved | rejected | returned | cancelled
    pr = db.get(P2PRequest, req.entity_id)
    pr.status = {"approved": "approved", "rejected": "rejected", "returned": "draft", "cancelled": "draft"}[outcome]
    # + whatever the module did before on approval (numbering, notifications to buyer, etc.)

register_transaction(TransactionType(
    key="p2p.purchase_requisition", module_key="p2p", subtab_key="purchase_requisitions",
    label="Purchase requisition", entity_type="p2p_request", url="/dashboard/p2p/{id}",
    context_fields={"project_type": {"label": "Project type", "type": "choice", "choices": [...]},
                    "project_head_id": {"label": "Project head", "type": "user"}},
    default_stages=[StageDef("PR approvers", "specific_users", {"user_ids": [...]}, approval_mode="all")],
    require_permission=True,      # approver must also hold p2p:purchase_requisitions:approve
    distinct_approvers=False, allow_self_approval=False,
    on_decided=_pr_decided,
))
```

`default_stages` must reproduce **today's** routing, so behaviour doesn't change on the day the module
moves over; the admin then edits stages in Organization › Approval Workflows. Settings that used to hold
approver lists (e.g. Procurement settings `pr_approvers`) must be **moved into the stage config** —
`ensure_workflow` creates the stored workflow on first use from `default_stages`, so build
`default_stages` lazily from the current setting values the first time, or write a migration that
creates the `approval_workflows` row from them. Then remove the old setting from the module's settings UI
and point the user to Organization › Approval Workflows.

Approver rules: `reporting_manager`, `department_head`, `plant_head`, `partner`, `director`,
`user_flag` (`{"flag": "is_finance_manager"}`), `specific_users` (`{"user_ids": [..]}`), `role`
(`{"role_id": n}`), `permission` (`{"permission": "quality:ncr:approve"}` — holders through a non-blanket
role), `record_field` (`{"field": "<context user field>"}` — a person chosen on the record, e.g. Design's
named approver). Any rule's config may add `"plus_permission": "hr:approvals:approve"` — holders of
that permission may also act at the stage (e.g. HR staff alongside the reporting manager). The
`permission` rule takes people who hold the grant through a real role/extra grant, falling back to
everyone holding it (migrated "Standard access" roles) — i.e. exactly who could approve before.
HR handover: `engine.reassign_pending(db, from_user_id, to_user_id, actor)`. `"same_plant": true` in a
stage's rule_config keeps only approvers of the document's plant (else the requester's).
Module rules that must hold on EVERY decision path (segregation of duties, "the inspector can't approve
their own lot") go in `TransactionType.validate_decision(db, request, step, user, decision)` — it runs
inside `engine.decide`, so the central `/approvals` endpoints and ApprovalPanel enforce it too.
One-click authority decisions: `engine.submit(..., notify=False)` then `engine.decide(...)` so the stage
isn't pinged first. Record deleted/cancelled: `engine.cancel_for_entity(...)` (forced).
Other type options: `on_stage_passed(db, request, sequence, actor)` for an intermediate status after a
stage (Design "checked → in approval"); `comment_required_on_approve=True` (P2P). Submit option
`exclude_user_ids=[...]` bars extra people (who prepared / owns the document) under four-eyes.
`plus_permission` holders may decide and see it in My Approvals but are **not** notified — unless the
main rule finds nobody, then they become the approvers. Four-eyes and "different person per stage" bind
admin stand-ins too (switch "Requester may approve own document" on per workflow to relax). Stage options: `approval_mode` any/all, `conditions` (`[{"field": "amount", "op": "gt",
"value": 5000000}]`, ops `eq ne gt gte lt lte in not_in true false`), `skip_if_no_approver`,
escalation (`escalate_after_hours` + `escalation_rule`).
Workflow options: `allow_self_approval`, `distinct_approvers` (four-eyes across stages),
`require_permission`.

### Submit / decide / cancel

```python
from app.modules.organization.services import approval_engine as engine

engine.submit(db, "p2p.purchase_requisition", entity_id=pr.id, requester=user, title=pr.title,
              reference=pr.pr_number, amount=pr.total, branch_id=pr.branch_id,
              context={"project_type": pr.project_type, "project_head_id": pr.project_head_id})
pr.status = "pending_approval"
db.commit()
```

- `submit` raises 422 with the exact reason when a stage has no approver ("Department 'Stores' has no
  head — set one in Organization › Department"). If the workflow is switched off or no stage applies, the
  request is approved immediately and `on_decided(..., "approved")` runs.
- Deciding: the frontend uses `<ApprovalPanel entityType="p2p_request" entityId={id} onChanged={reload} />`
  (central `POST /approvals/requests/{id}/decide`). If a module keeps its own approve/reject endpoints for
  compatibility, they must just call `engine.decide(db, request_id, user, "approve"|"reject"|"return", comment)`
  with `engine.latest_request(db, entity_type, id)`.
- Withdraw: `engine.cancel(...)`, or `engine.cancel_for_entity(db, entity_type, id, user)` when the record
  itself is cancelled/deleted.
- The engine enforces: current approver / delegate / escalation target (or admin stand-in with comment),
  four-eyes, distinct approvers, the tab's approve/reject permission, comment on reject/return. It notifies
  approvers (Teams + bell) and the requester (bell), writes audit rows, and never commits.
- Notifications use `notification_type="approval"` with the record's `entity_type` — add the entity type to
  `ENTITY_LINK` in `frontend/src/components/erp/NotificationBell.tsx`.

### Migrating an existing module flow

1. Register the transaction type with `default_stages` = current behaviour (incl. amount limits as conditions).
2. Replace the module's own approver resolution + approval-table writes with `engine.submit` / `engine.decide`.
3. Keep the module's status field; set it in `on_decided`.
4. Old approval rows (history) stay readable; open (pending) items at cut-over: either let the old code path
   finish them (check `latest_request` is None) or migrate them into `approval_requests` — pick what is safe and
   say so.
5. Replace the module's approve/reject UI with `ApprovalPanel` (or call the central endpoints from it).
6. Remove module-level approver settings and per-user approver flags *only* from that module's UI.
7. Tests: submit → decide → status, and the four-eyes/permission paths.

## 4. My Approvals / delegation / security

- **My Approvals** (`/dashboard/organization/approvals`, every user): inbox across modules, my requests,
  decided by me, and my delegations ("while I'm away, X approves for me").
- **Delegations**: from/to/dates, all modules or one module/one transaction type. The delegate can decide any
  step addressed to the delegator in that window; the step records "decided by X as delegate".
- **Security & Sessions**: SSO means MFA / password / lockout live in Microsoft Entra ID (Conditional Access).
  The ERP sets access-token minutes, session days, idle timeout, max concurrent sessions; shows live sessions
  with revoke; logs sign-ins and blocked sign-ins (with IP) to the audit trail.
