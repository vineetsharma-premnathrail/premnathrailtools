"""Dispatch release — rule 8: finished goods are not dispatched without a
decided final inspection and, where the contract requires it, an accepted
customer / third-party inspection with its certificate.

Where dispatch happens (decided): there is no sales-order / delivery module
yet. Finished goods leave through a Store Material Issue of issue type
"dispatch" (Dispatch to customer), against the ERP machine / order
(erp_projects — its PO is the customer order, and it carries the contract's
third_party_inspection_required + inspection_agency). The Store issue calls
ensure_dispatch_allowed for every line; Quality → Dispatch check uses the
same check() so anybody can see why a dispatch is blocked.

Note: Quality / Blocked stock can't be dispatched anyway (issues only draw
Free stock — Phase 1). These checks add the paper trail on top.
"""
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.quality.models.inspection_call import QualityInspectionCall
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.store.models.item import StoreItem

DISPATCH_ISSUE_TYPE = "dispatch"
_ACCEPTING = ("accept", "accept_with_deviation", "partial")


class DispatchBlocked(ValueError):
    status = 409


def _dispatched(db: Session, *, item_id: int, batch_number: str | None = None, erp_project_id: int | None = None,
                exclude_issue_id: int | None = None) -> float:
    from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
    q = db.query(func.coalesce(func.sum(StoreMaterialIssueItem.quantity), 0.0)).join(
        StoreMaterialIssue, StoreMaterialIssue.id == StoreMaterialIssueItem.issue_id,
    ).filter(StoreMaterialIssue.issue_type == DISPATCH_ISSUE_TYPE, StoreMaterialIssueItem.item_id == item_id)
    if batch_number is not None:
        q = q.filter(StoreMaterialIssueItem.batch_number == batch_number)
    if erp_project_id is not None:
        q = q.filter(StoreMaterialIssue.erp_project_id == erp_project_id)
    if exclude_issue_id:
        q = q.filter(StoreMaterialIssue.id != exclude_issue_id)
    return float(q.scalar() or 0.0)


def _dispatched_for_element(db: Session, *, item_id: int, element_id: int, exclude_issue_id: int | None = None) -> float:
    """Already dispatched for a project unit - counted once the
    Store dispatch issue carries order_project_element_id (0 until then)."""
    from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
    if not hasattr(StoreMaterialIssue, "order_project_element_id"):
        return 0.0
    q = db.query(func.coalesce(func.sum(StoreMaterialIssueItem.quantity), 0.0)).join(
        StoreMaterialIssue, StoreMaterialIssue.id == StoreMaterialIssueItem.issue_id,
    ).filter(StoreMaterialIssue.issue_type == DISPATCH_ISSUE_TYPE, StoreMaterialIssueItem.item_id == item_id,
             StoreMaterialIssue.order_project_element_id == element_id)
    if exclude_issue_id:
        q = q.filter(StoreMaterialIssue.id != exclude_issue_id)
    return float(q.scalar() or 0.0)


def final_inspection_needed(db: Session, item: StoreItem) -> bool:
    from app.modules.quality.services.lots import needs_inspection_on_receipt
    return needs_inspection_on_receipt(db, item, "final")


def check(db: Session, *, item_id: int, quantity: float, batch_number: str | None = None,
          erp_project_id: int | None = None, exclude_issue_id: int | None = None,
          contract_qty: float | None = None, order_project_element_id: int | None = None) -> list[str]:
    """Every reason this quantity can't be dispatched yet (empty = allowed).
    contract_qty: the item's total on the whole dispatch (several batches)
    for the contract check; defaults to quantity.
    order_project_element_id: the project unit (vehicle / lot being
    dispatched - the third-party requirement then comes from its Sales Order
    (single source of truth) instead of the ERP machine."""
    item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
    if not item:
        return [f"Item #{item_id} isn't in the Item Master."]
    name = f"{item.item_code} {item.item_name}"
    batch = (batch_number or "").strip() or None
    problems: list[str] = []

    # 8a — decided final inspection for the batch being dispatched.
    if final_inspection_needed(db, item):
        if not batch:
            problems.append(f"{name} gets a final inspection, so a dispatch must name the batch / serial number that passed it "
                            "(the work order number unless a serial was given at Receive Output).")
        else:
            lots = db.query(QualityInspectionLot).filter(
                QualityInspectionLot.item_id == item.id, QualityInspectionLot.batch_number == batch,
                QualityInspectionLot.inspection_type.in_(("final", "first_article")),
                QualityInspectionLot.decision.in_(_ACCEPTING),
            ).all()
            accepted = sum(l.accepted_qty or 0 for l in lots)
            if not lots:
                open_lot = db.query(QualityInspectionLot).filter(
                    QualityInspectionLot.item_id == item.id, QualityInspectionLot.batch_number == batch,
                    QualityInspectionLot.inspection_type.in_(("final", "first_article")),
                ).order_by(QualityInspectionLot.id.desc()).first()
                if open_lot and open_lot.status in ("created", "in_inspection", "results_recorded"):
                    problems.append(f"Rule 8: final inspection lot {open_lot.lot_number} for {name} batch {batch} has no usage "
                                    "decision yet — Quality must decide it before dispatch.")
                elif open_lot:
                    problems.append(f"Rule 8: final inspection lot {open_lot.lot_number} for {name} batch {batch} was rejected — "
                                    "it can't be dispatched (see its NCR).")
                else:
                    problems.append(f"Rule 8: there is no decided final inspection for {name} batch {batch}. Receive it through "
                                    "Production → Receive Output (it goes to a final inspection lot) and get it accepted first.")
            else:
                done = _dispatched(db, item_id=item.id, batch_number=batch, exclude_issue_id=exclude_issue_id)
                if done + quantity > accepted + 1e-9:
                    problems.append(f"Rule 8: only {accepted:g} of {name} batch {batch} passed final inspection "
                                    f"({', '.join(l.lot_number for l in lots)}) and {done:g} is already dispatched — "
                                    f"{max(accepted - done, 0):g} can still go, not {quantity:g}.")

    # 8b — contract needs a customer / third-party inspection certificate.
    if order_project_element_id:
        from app.modules.quality.services.order_project_inspection import element_dispatch_problems
        problems += element_dispatch_problems(
            db, element_id=order_project_element_id, item_id=item.id, item_name=name, quantity=contract_qty or quantity,
            dispatched_qty=_dispatched_for_element(db, item_id=item.id, element_id=order_project_element_id,
                                                   exclude_issue_id=exclude_issue_id))
    elif erp_project_id:
        from app.modules.erp.models.project import Project
        project = db.query(Project).filter(Project.id == erp_project_id).first()
        if not project:
            problems.append(f"ERP machine / order #{erp_project_id} not found.")
        elif project.third_party_inspection_required:
            agency = _agency_label(db, project.inspection_agency)
            contract = project.po_number or project.serial_number
            calls = db.query(QualityInspectionCall).filter(
                QualityInspectionCall.erp_project_id == project.id, QualityInspectionCall.item_id == item.id,
                QualityInspectionCall.status.in_(("accepted", "partially_accepted")),
                QualityInspectionCall.certificate_number.isnot(None),
            ).all()
            cleared = sum(c.accepted_qty or 0 for c in calls)
            done = _dispatched(db, item_id=item.id, erp_project_id=project.id, exclude_issue_id=exclude_issue_id)
            if not calls:
                problems.append(f"Rule 8: contract {contract} needs {agency} inspection before dispatch, and {name} has no "
                                "accepted inspection call with a certificate number for it. Raise / record the call in "
                                "Quality → Inspection Calls.")
            elif done + (contract_qty or quantity) > cleared + 1e-9:
                problems.append(f"Rule 8: {agency} has cleared {cleared:g} of {name} for contract {contract} "
                                f"({', '.join(c.certificate_number for c in calls)}) and {done:g} is already dispatched — "
                                f"{max(cleared - done, 0):g} can still go, not {contract_qty or quantity:g}. Offer the rest for inspection first.")
    return problems


def _agency_label(db: Session, value: str | None) -> str:
    from app.modules.quality.models.masters import QualityMasterValue
    from app.modules.quality.services.settings import ensure_master_lists
    if not value:
        return "customer / third-party"
    ensure_master_lists(db)
    row = db.query(QualityMasterValue).filter(QualityMasterValue.list_key == "inspection_agencies",
                                              QualityMasterValue.value == value).first()
    return row.label if row else value


def ensure_dispatch_allowed(db: Session, *, lines: list[dict], erp_project_id: int | None,
                            exclude_issue_id: int | None = None, order_project_element_id: int | None = None) -> None:
    """lines: [{item_id, quantity, batch_number}]. Raises DispatchBlocked
    with every reason at once."""
    problems = []
    # Same item + batch on two lines counts together.
    merged: dict[tuple, float] = {}
    for ln in lines:
        key = (ln["item_id"], (ln.get("batch_number") or "").strip() or None)
        merged[key] = merged.get(key, 0.0) + float(ln["quantity"])
    item_totals: dict[int, float] = {}
    for (item_id, _), qty in merged.items():
        item_totals[item_id] = item_totals.get(item_id, 0.0) + qty
    contract_checked: set[int] = set()
    for (item_id, batch), qty in merged.items():
        # The contract check runs once per item, on the item's total.
        first = item_id not in contract_checked
        contract_checked.add(item_id)
        problems += check(db, item_id=item_id, quantity=qty, batch_number=batch,
                          erp_project_id=erp_project_id if first else None, exclude_issue_id=exclude_issue_id,
                          contract_qty=item_totals[item_id],
                          order_project_element_id=order_project_element_id if first else None)
    if problems:
        raise DispatchBlocked(" ".join(problems))
