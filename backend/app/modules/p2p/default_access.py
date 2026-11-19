"""Default Procurement roles and PR / PO approval workflows (owner, 2026-11-19).

Applied ONCE by migration e8b4c2d6f1a3 so production starts with a working setup;
afterwards the admin changes everything from Organization › Role & Permissions
and Organization › Workflows as usual (nothing here runs again).

Roles (Procurement ticks only - a role's ticks of other modules are kept):
  PR Requester            "Everyone" role: raise and track own requisitions
                          (the role first named "purchase user" is renamed to it)
  Procurement – Approver  department heads, project heads, partners: open and decide
                          what is routed to them, with PO values and the quote comparison
  Purchaser               buyers: every requisition, RFQ, PO upload, vendors
  Purchase Head           Purchaser + every buyer's lines, re-assign, short-close

Users are added from data, never from names written here:
  Approver       every department head + every Partner
  Purchase Head  head(s) of the department named "Purchase" + users flagged Purchase head
  Purchaser      members of the "Purchase" department who are not a Purchase Head
Existing members are never removed.

Workflows (stages replaced; admin can change them afterwards):
  PR  1 Department head (skipped when the department has none, or the head raised it)
      2 Project head picked on the requisition (skipped when none is picked)
      3 Purchase team - anyone holding R.F.Q › Create, any one approves
  PO  1 Purchase head - holders of "All buyers' lines" (Purchase Head role), any one
      2 Project head picked on the requisition (skipped when none)
      3 Any one Partner
"""
from __future__ import annotations

import sqlalchemy as sa

P = "p2p"


def _tab(tab: str, *actions: str) -> list[str]:
    return [f"{P}:{tab}:{a}" for a in actions]


def _feat(tab: str, feature: str, *actions: str) -> list[str]:
    return [f"{P}:{tab}.{feature}:{a}" for a in actions]


REQUESTER = [
    *_tab("purchase_requisitions", "view", "create", "edit", "submit", "cancel"),
    *_feat("purchase_requisitions", "my_requisitions", "view"),
    *_feat("purchase_requisitions", "approvals", "view"),
    *_feat("purchase_requisitions", "fulfilment", "view"),
    *_feat("purchase_requisitions", "attachments", "view", "create"),
    *_feat("purchase_requisitions", "history", "view"),
]

APPROVER = [
    *_tab("purchase_requisitions", "view"),
    *_feat("purchase_requisitions", "approvals", "view"),
    *_feat("purchase_requisitions", "my_requisitions", "view"),
    *_feat("purchase_requisitions", "purchase_order", "view"),
    *_feat("purchase_requisitions", "fulfilment", "view"),
    *_feat("purchase_requisitions", "attachments", "view"),
    *_feat("purchase_requisitions", "history", "view"),
    *_feat("purchase_requisitions", "prices", "view"),
    *_tab("rfq", "view"),
    *_feat("rfq", "vendor_quotes", "view"),
    *_feat("rfq", "comparison", "view"),
    *_feat("rfq", "prices", "view"),
    *_tab("purchase_orders", "view"),
    *_feat("purchase_orders", "po_document", "view"),
    *_feat("purchase_orders", "prices", "view"),
    *_feat("purchase_orders", "history", "view"),
    *_feat("purchase_orders", "amendments", "view"),
]

PURCHASER = [
    *_tab("purchase_desk", "view"),
    *_tab("purchase_requisitions", "view", "edit"),
    *_feat("purchase_requisitions", "my_requisitions", "view"),
    *_feat("purchase_requisitions", "all_requisitions", "view"),
    *_feat("purchase_requisitions", "approvals", "view"),
    *_feat("purchase_requisitions", "purchase_order", "view"),
    *_feat("purchase_requisitions", "fulfilment", "view", "create", "edit"),
    *_feat("purchase_requisitions", "my_lines", "view"),
    *_feat("purchase_requisitions", "attachments", "view", "create"),
    *_feat("purchase_requisitions", "history", "view"),
    *_feat("purchase_requisitions", "prices", "view"),
    *_tab("rfq", "view", "create", "edit", "export"),
    *_feat("rfq", "vendor_quotes", "view", "create", "edit", "delete"),
    *_feat("rfq", "comparison", "view", "export"),
    *_feat("rfq", "award", "view", "edit"),
    *_feat("rfq", "prices", "view"),
    *_tab("purchase_orders", "view", "create", "edit", "submit", "export", "print"),
    *_feat("purchase_orders", "po_document", "view", "create"),
    *_feat("purchase_orders", "prices", "view"),
    *_feat("purchase_orders", "history", "view"),
    *_feat("purchase_orders", "amendments", "view", "create"),
    *_feat("purchase_orders", "delivery_costs", "view", "create", "edit"),
    *_feat("purchase_orders", "service_entries", "view"),
    *_feat("purchase_orders", "link_item", "view", "edit"),
    *_tab("vendors", "view", "create", "edit", "export"),
    *_feat("vendors", "documents", "view", "create"),
    *_feat("vendors", "catalog", "view", "create", "edit", "export"),
    *_feat("vendors", "info_records", "view", "create", "edit"),
    *_feat("vendors", "prices", "view"),
    *_tab("mis", "view", "export"),
]

PURCHASE_HEAD = [
    *PURCHASER,
    *_feat("purchase_requisitions", "all_lines", "view", "edit"),
    *_feat("purchase_requisitions", "buyer", "view", "edit"),
    *_feat("purchase_requisitions", "close", "view", "edit"),
    *_tab("purchase_orders", "cancel"),
    *_feat("purchase_orders", "amendments", "cancel"),
]

# name, description, grants, data scope for Procurement, is_default ("Everyone")
ROLES = {
    "requester": ("PR Requester", "Every employee: raise and track own purchase requisitions.", REQUESTER, "assigned", True),
    "approver": ("Procurement – Approver", "Department heads, project heads and partners: open and decide the requisitions "
                 "and POs routed to them, with PO values and the quotation comparison.", APPROVER, "assigned", False),
    "purchaser": ("Purchaser", "Buyers: every requisition, RFQs, vendor quotes, PO upload and vendors.", PURCHASER, "organization", False),
    "purchase_head": ("Purchase Head", "Purchaser + every buyer's lines: re-assign buyers, award, upload POs and short-close.",
                      PURCHASE_HEAD, "organization", False),
}
# Older names of the same roles on production, renamed on the way.
OLD_NAMES = {"requester": ("purchase user",)}

PR_STAGES = [
    ("Department head", "department_head", {}, True),
    ("Project head", "record_field", {"field": "project_head_id"}, True),
    ("Purchase team", "permission", {"permission": "p2p:rfq:create"}, False),
]
PO_STAGES = [
    ("Purchase head", "permission", {"permission": "p2p:purchase_requisitions.all_lines:edit"}, False),
    ("Project head", "record_field", {"field": "project_head_id"}, True),
    ("Partner (final approval)", "partner", {}, False),
]
WORKFLOWS = {
    # key: (module, name, stages, allow_self_approval, distinct_approvers)
    "p2p.purchase_requisition": ("p2p", "Purchase requisition", PR_STAGES, False, False),
    "p2p.purchase_order": ("p2p", "Purchase order", PO_STAGES, False, True),
}

_roles = sa.table("roles", sa.column("id", sa.Integer), sa.column("name", sa.String), sa.column("description", sa.Text),
                  sa.column("permissions", sa.JSON), sa.column("data_scopes", sa.JSON), sa.column("is_system", sa.Boolean),
                  sa.column("is_default", sa.Boolean), sa.column("is_active", sa.Boolean))
_user_roles = sa.table("user_roles", sa.column("user_id", sa.Integer), sa.column("role_id", sa.Integer))
_users = sa.table("users", sa.column("id", sa.Integer), sa.column("is_active", sa.Boolean), sa.column("role", sa.String),
                  sa.column("is_partner", sa.Boolean), sa.column("is_purchase_head", sa.Boolean),
                  sa.column("department", sa.String), sa.column("department_id", sa.Integer))
_depts = sa.table("departments", sa.column("id", sa.Integer), sa.column("name", sa.String),
                  sa.column("head_user_id", sa.Integer), sa.column("secondary_head_user_id", sa.Integer),
                  sa.column("additional_head_user_ids", sa.JSON))
_wf = sa.table("approval_workflows", sa.column("id", sa.Integer), sa.column("key", sa.String), sa.column("module_key", sa.String),
               sa.column("name", sa.String), sa.column("is_active", sa.Boolean), sa.column("allow_self_approval", sa.Boolean),
               sa.column("distinct_approvers", sa.Boolean), sa.column("require_permission", sa.Boolean))
_stages = sa.table("approval_workflow_stages", sa.column("workflow_id", sa.Integer), sa.column("sequence", sa.Integer),
                   sa.column("name", sa.String), sa.column("approver_rule", sa.String), sa.column("rule_config", sa.JSON),
                   sa.column("approval_mode", sa.String), sa.column("conditions", sa.JSON),
                   sa.column("skip_if_no_approver", sa.Boolean), sa.column("escalation_config", sa.JSON))


def _upsert_role(conn, key: str) -> int:
    name, description, grants, scope, is_default = ROLES[key]
    names = [name.lower(), *(n.lower() for n in OLD_NAMES.get(key, ()))]
    row = conn.execute(sa.select(_roles.c.id, _roles.c.permissions, _roles.c.data_scopes)
                       .where(sa.func.lower(_roles.c.name).in_(names)).order_by(_roles.c.id)).first()
    if row is None:
        return conn.execute(sa.insert(_roles).values(
            name=name, description=description, permissions=list(grants), data_scopes={P: scope},
            is_system=False, is_default=is_default, is_active=True).returning(_roles.c.id)).scalar_one()
    # Overwrite only the Procurement ticks and scope; other modules stay as the admin set them.
    others = [g for g in (row.permissions or []) if not str(g).startswith(f"{P}:")]
    scopes = {k: v for k, v in (row.data_scopes or {}).items() if k != P and not k.startswith(f"{P}:")}
    conn.execute(sa.update(_roles).where(_roles.c.id == row.id).values(
        name=name, description=description, permissions=others + list(grants), data_scopes={**scopes, P: scope},
        is_default=is_default, is_active=True))
    return row.id


def _add_members(conn, role_id: int, user_ids: set[int]) -> int:
    if not user_ids:
        return 0
    active = {r.id for r in conn.execute(sa.select(_users.c.id).where(
        _users.c.id.in_(user_ids), _users.c.is_active.is_(True), sa.func.coalesce(_users.c.role, "") != "admin"))}
    have = {r.user_id for r in conn.execute(sa.select(_user_roles.c.user_id).where(_user_roles.c.role_id == role_id))}
    new = sorted(active - have)
    if new:
        conn.execute(sa.insert(_user_roles), [{"user_id": u, "role_id": role_id} for u in new])
    return len(new)


def _heads(row) -> set[int]:
    extra = row.additional_head_user_ids or []
    return {i for i in (row.head_user_id, row.secondary_head_user_id, *extra) if isinstance(i, int)}


def _set_workflow(conn, key: str) -> None:
    module, name, stages, self_ok, distinct = WORKFLOWS[key]
    wf_id = conn.execute(sa.select(_wf.c.id).where(_wf.c.key == key)).scalar()
    values = dict(is_active=True, allow_self_approval=self_ok, distinct_approvers=distinct, require_permission=False)
    if wf_id is None:
        wf_id = conn.execute(sa.insert(_wf).values(key=key, module_key=module, name=name, **values)
                             .returning(_wf.c.id)).scalar_one()
    else:
        conn.execute(sa.update(_wf).where(_wf.c.id == wf_id).values(**values))
    conn.execute(sa.delete(_stages).where(_stages.c.workflow_id == wf_id))
    conn.execute(sa.insert(_stages), [
        {"workflow_id": wf_id, "sequence": i + 1, "name": s_name, "approver_rule": rule, "rule_config": cfg,
         "approval_mode": "any", "conditions": [], "skip_if_no_approver": skip, "escalation_config": {}}
        for i, (s_name, rule, cfg, skip) in enumerate(stages)])


def apply_default_procurement_access(conn) -> dict:
    """Create / overwrite the four roles, add their users from data, set the PR and PO
    workflows. `conn` is a SQLAlchemy Connection (the migration's op.get_bind())."""
    ids = {k: _upsert_role(conn, k) for k in ROLES}
    depts = conn.execute(sa.select(_depts)).all()
    all_heads = set().union(*(_heads(d) for d in depts)) if depts else set()
    purchase_depts = [d for d in depts if (d.name or "").strip().lower() == "purchase"]
    partners = {r.id for r in conn.execute(sa.select(_users.c.id).where(_users.c.is_partner.is_(True)))}
    flagged = {r.id for r in conn.execute(sa.select(_users.c.id).where(_users.c.is_purchase_head.is_(True)))}
    purchase_heads = set().union(*(_heads(d) for d in purchase_depts)) | flagged if purchase_depts else flagged
    dept_ids = [d.id for d in purchase_depts]
    members = {r.id for r in conn.execute(sa.select(_users.c.id).where(sa.or_(
        sa.func.lower(sa.func.trim(sa.func.coalesce(_users.c.department, ""))) == "purchase",
        _users.c.department_id.in_(dept_ids) if dept_ids else sa.false())))}
    added = {
        "approver": _add_members(conn, ids["approver"], (all_heads | partners) - purchase_heads),
        "purchase_head": _add_members(conn, ids["purchase_head"], purchase_heads),
        "purchaser": _add_members(conn, ids["purchaser"], members - purchase_heads),
    }
    for key in WORKFLOWS:
        _set_workflow(conn, key)
    return {"roles": ids, "added": added}
