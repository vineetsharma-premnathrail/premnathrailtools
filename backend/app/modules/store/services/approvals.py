"""Store approvals on the central approval engine
(app/modules/organization/services/approval_engine.py).

Two Store documents need a second person before they change stock:

  store.material_return   Material Return    (Store › Returns)
  store.stock_adjustment  Stock Adjustment   (Store › Adjustments)

Who approves is configured in Organization › Approval Workflows. The default
stages reproduce the routing Store had before the move:

* Material return — one stage per return source / line condition that needed
  an approval (the old StoreDocType.approver_rule, which is fixed in code):
    "Other (no issue reference)" source → the store's manager
    "Damaged" condition                 → the head(s) of the department the material was issued to
    "Rejected (quality)" condition      → the designated users of that condition (empty = the store's manager)
  Each stage only applies when the return uses that source/condition
  (stage conditions on `source_type` / `condition_<value>`); any one approver
  of a stage decides it, and the creator never approves their own return.
  Approvers don't need a Store grant (a department head usually has none).
* Stock adjustment — the Store Manager the creator names on it
  (`approver_id`), who must hold Store › Adjustments › Approve.

Material Issues post at once and have no approval (Store › Issues lists no
approve/reject action). GRN acceptance lives in P2P (goods receipts).
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.modules.organization.models.approval import ApprovalWorkflow, ApprovalWorkflowStage
from app.modules.organization.services import approval_engine as engine
from app.modules.store.models.doc_type import STORE_DOC_TYPE_DEFAULTS, StoreDocType

RETURN_KEY = "store.material_return"
ADJUSTMENT_KEY = "store.stock_adjustment"
TRANSFER_KEY = "store.stock_transfer"
RETURN_ENTITY = "material_return"
ADJUSTMENT_ENTITY = "stock_adjustment"
TRANSFER_ENTITY = "stock_transfer"

# The person/people each old approver rule pointed at, as a context field.
_RULE_FIELD = {
    "warehouse_manager": "warehouse_manager_id",
    "department_head": "department_head_ids",
    "specific_users": "warehouse_manager_id",  # fallback when no designated users are named
}
_RULE_STAGE_LABEL = {
    "warehouse_manager": "Store in-charge",
    "department_head": "Department head",
    "specific_users": "Designated approver",
}


def return_context_fields() -> dict:
    sources = [d["value"] for d in STORE_DOC_TYPE_DEFAULTS["return_source"]]
    fields = {
        "source_type": {"label": "Return source", "type": "choice", "choices": sources},
        "warehouse_manager_id": {"label": "Manager of the return store", "type": "user"},
        "department_head_ids": {"label": "Head(s) of the department the material was issued to", "type": "user"},
    }
    for d in STORE_DOC_TYPE_DEFAULTS["return_condition"]:
        fields[f"condition_{d['value']}"] = {"label": f"Has a '{d['label']}' line", "type": "bool"}
    return fields


def _condition_for(kind: str, value: str) -> list[dict]:
    if kind == "return_source":
        return [{"field": "source_type", "op": "eq", "value": value}]
    return [{"field": f"condition_{value}", "op": "true"}]


def return_default_stages(rows: list[dict] | None = None) -> list[engine.StageDef]:
    """Default stages from the code-fixed return sources/conditions. `rows`
    (live StoreDocType values) add the label an admin gave a row and the
    designated users of a "specific users" row."""
    live = {(r["kind"], r["value"]): r for r in rows or []}
    stages = []
    for kind in ("return_source", "return_condition"):
        for d in STORE_DOC_TYPE_DEFAULTS[kind]:
            rule = d.get("approver_rule", "none")
            if rule == "none":
                continue
            row = live.get((kind, d["value"]), {})
            label = row.get("label") or d["label"]
            name = f"{_RULE_STAGE_LABEL[rule]} — {label}"
            user_ids = [int(i) for i in row.get("approver_user_ids") or []]
            if rule == "specific_users" and user_ids:
                stages.append(engine.StageDef(name, "specific_users", {"user_ids": user_ids},
                                              conditions=_condition_for(kind, d["value"])))
            else:
                stages.append(engine.StageDef(name, "record_field", {"field": _RULE_FIELD[rule]},
                                              conditions=_condition_for(kind, d["value"])))
    return stages


def adjustment_default_stages() -> list[engine.StageDef]:
    return [engine.StageDef("Store manager named on the adjustment", "record_field", {"field": "approver_id"})]


def transfer_default_stages() -> list[engine.StageDef]:
    """The manager of the sending store answers for the stock leaving it.
    A store with no manager set falls back to whoever holds Store ›
    Transfers › Approve (plus_permission holders become the approvers when
    the main rule finds nobody)."""
    return [engine.StageDef("Manager of the sending store", "record_field",
                            {"field": "from_manager_id", "plus_permission": "store:transfers:approve"})]


def _live_doc_type_rows(db: Session) -> list[dict]:
    return [
        {"kind": t.kind, "value": t.value, "label": t.label, "approver_user_ids": list(t.approver_user_ids or [])}
        for t in db.query(StoreDocType).filter(StoreDocType.kind.in_(("return_source", "return_condition"))).all()
    ]


def ensure_return_workflow(db: Session) -> ApprovalWorkflow:
    """The stored Material Return workflow — on first use it is created from
    the live return types (so a QC user named on "Rejected (quality)" stays
    that stage's approver), not from the code defaults."""
    wf = db.query(ApprovalWorkflow).filter(ApprovalWorkflow.key == RETURN_KEY).first()
    if wf is not None:
        return wf
    tt = engine.get_type(RETURN_KEY)
    wf = ApprovalWorkflow(
        key=RETURN_KEY, module_key=tt.module_key, name=tt.label, allow_self_approval=tt.allow_self_approval,
        distinct_approvers=tt.distinct_approvers, require_permission=tt.require_permission,
    )
    wf.stages = [
        ApprovalWorkflowStage(sequence=i + 1, name=s.name, approver_rule=s.approver_rule, rule_config=s.rule_config,
                              approval_mode=s.approval_mode, conditions=s.conditions,
                              skip_if_no_approver=s.skip_if_no_approver, escalation_config={})
        for i, s in enumerate(return_default_stages(_live_doc_type_rows(db)))
    ]
    db.add(wf)
    db.flush()
    return wf


def migrate_store_approval_workflows(bind) -> dict:
    """One-off: create the Store approval workflows from today's config
    (return types' designated approvers) so Organization › Approval
    Workflows shows them before the first submission. Idempotent. (The Store
    setting `adjustment_approver_ids` was never read by any route, so there is
    nothing to carry over from it.) Returns a summary."""
    db = Session(bind=bind)
    try:
        # Make sure the transaction types are registered (route modules register them).
        import app.modules.store.routes.material_returns  # noqa: F401
        import app.modules.store.routes.stock_adjustments  # noqa: F401

        created = []
        if not db.query(ApprovalWorkflow).filter(ApprovalWorkflow.key == RETURN_KEY).first():
            ensure_return_workflow(db)
            created.append(RETURN_KEY)
        if not db.query(ApprovalWorkflow).filter(ApprovalWorkflow.key == ADJUSTMENT_KEY).first():
            engine.ensure_workflow(db, ADJUSTMENT_KEY)
            created.append(ADJUSTMENT_KEY)
        db.commit()
        return {"created": created}
    finally:
        db.close()
