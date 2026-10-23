"""Purpose of a purchase requisition (2026-10-23).

The PR form asks "what is this purchase for?" first; the answer decides what
it must be charged to, so every rupee lands on a real cost object:

  customer_order   production of an ordered machine: its Order Project (a
                   sales order is accepted too — its project is derived);
                   lines name their vehicle / lot
  machine_project  service of a delivered machine (ERP project); the charge
                   is optional (work order, internal order, sales order, order project)
  development      an internal order (the development job and its budget)
  department       nothing on the PR — Purchase picks the cost centre on the
                   PO (the requester's department's by default, see below)
  capital          an internal order (the asset job and its budget)
  stock            nothing — store stock is charged when it is issued

Overhead purposes (department / capital / development / stock) are not bought
for a customer project, so every line is Inhouse. Requisitions raised before
this (purpose NULL) keep the old existing/new project rules.

The purpose also narrows the PR category (what is bought, which decides the
buyer) to the ones that make sense for it, and pre-fills the category and
requirement type where one answer is the usual one (PURPOSE_FORM)."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import event, func, select

from app.modules.p2p.models.p2p_request import P2P_PURPOSES, P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder

# Purposes whose lines are never for a customer project.
INHOUSE_ONLY = ("development", "department", "capital", "stock")

# What each purpose may be charged to; the first is the required one where
# the purpose has a single answer. None in the tuple = may be left blank.
_ALLOWED: dict[str, tuple] = {
    "customer_order": ("order_project", "sales_order"),
    "machine_project": (None, "work_order", "internal_order", "sales_order", "order_project"),
    "development": ("internal_order",),
    # Older requisitions carry a cost centre; new ones leave it to the PO.
    "department": (None, "cost_center"),
    "capital": ("internal_order",),
    "stock": (None,),
}

# Per purpose: categories offered (in this order), the pre-filled category
# (None = the requester picks) and the pre-filled requirement type. 'Others'
# is never offered — it has no buyer and says nothing in reports.
PURPOSE_FORM: dict[str, dict] = {
    "customer_order": {"categories": ("RAW", "PNH", "ELE", "HWC", "MKT", "JOB"),
                       "category": None, "requirement_type": "Material"},
    "machine_project": {"categories": ("PNH", "ELE", "HWC", "MKT", "JOB", "SRV"),
                        "category": None, "requirement_type": "Material + Service"},
    "development": {"categories": ("RAW", "PNH", "ELE", "HWC", "MKT", "JOB", "SRV"),
                    "category": None, "requirement_type": "Material"},
    "department": {"categories": ("ADM", "HWC", "MKT", "SRV", "ELE"),
                   "category": "ADM", "requirement_type": "Material"},
    "capital": {"categories": ("CAP", "ELE", "PNH", "SRV"),
                "category": "CAP", "requirement_type": "Capital Equipment"},
    "stock": {"categories": ("HWC", "RAW", "PNH", "ELE", "MKT"),
              "category": "HWC", "requirement_type": "Material"},
}


def category_problem(purpose: str | None, category_code: str | None) -> str | None:
    """Why `category_code` doesn't fit the purpose (None when it does)."""
    form = PURPOSE_FORM.get(purpose or "")
    if form is None or category_code in form["categories"]:
        return None
    from app.modules.p2p.models.p2p_request import P2P_CATEGORIES
    ok = ", ".join(P2P_CATEGORIES[c] for c in form["categories"])
    return (f"Category {P2P_CATEGORIES.get(category_code or '', category_code or 'none')} doesn't fit a "
            f"{P2P_PURPOSES[purpose].lower()} requisition — pick one of: {ok}.")


_NEED = {
    "customer_order": "the order project of the machine being built",
    "development": "the internal order of the development job — ask Finance to open one in Finance › Masters › Internal orders if it isn't in the list",
    "capital": "the internal order of the asset purchase — ask Finance to open one in Finance › Masters › Internal orders if it isn't in the list",
}


def project_type_for(purpose: str | None) -> str | None:
    """The older existing/new project type, still filled on every requisition:
    approval workflow conditions are written on it, and a NULL project_type
    means "pre-matrix legacy PR" to the PO approval code. Only new development
    is 'new'; everything else follows the 'existing' route it always took."""
    if not purpose:
        return None
    return "new" if purpose == "development" else "existing"


def header_problems(purpose: str | None, account_assignment: str | None, project_label: str | None) -> list[str]:
    """What is missing / wrong on a submitted requisition's header, worded as
    the fix. Empty when it is fine."""
    if not purpose:
        return ["Choose the purpose of this requisition — customer order, machine / service project, new development, "
                "department running cost, asset / capital purchase or store stock refill."]
    if purpose not in P2P_PURPOSES:
        return [f"Purpose must be one of: {', '.join(P2P_PURPOSES.values())}."]
    label = P2P_PURPOSES[purpose].lower()
    allowed = _ALLOWED[purpose]
    if account_assignment not in allowed:
        if purpose == "stock":
            return ["A store stock refill isn't charged to anything when it is bought — its cost goes to whoever Store "
                    "issues it to. Set Charged To back to blank, or pick another purpose."]
        if account_assignment is None:
            return [f"A {label} requisition needs {_NEED[purpose]}."]
        names = {"order_project": "order project", "sales_order": "sales order", "work_order": "production work order",
                 "internal_order": "internal order", "cost_center": "cost centre"}
        ok = ", ".join(names[a] for a in allowed if a)
        return [f"A {label} requisition can't be charged to a {names.get(account_assignment, account_assignment)} — "
                f"charge it to: {ok}."]
    if purpose == "machine_project" and not (project_label or "").strip():
        return ["Pick the machine project this requisition is for."]
    return []


# ---------------------------------------------------------------- PO cost centre

@event.listens_for(P2PPurchaseOrder, "before_insert")
def _po_cost_center_from_pr(_mapper, connection, target: P2PPurchaseOrder) -> None:
    """Every way a PO is made (RFQ draft, quotation award, direct) starts it
    with a cost centre when its requisition is overhead: the PR's own one
    (older requisitions), else — for a department running cost — the
    requester's department's one active cost centre. Purchase can change it."""
    if target.cost_center_id is not None or not target.p2p_request_id or target.internal_order_id:
        return
    row = connection.execute(
        select(P2PRequest.cost_center_id, P2PRequest.purpose, P2PRequest.department)
        .where(P2PRequest.id == target.p2p_request_id)).first()
    if row is None:
        return
    if row[0]:
        target.cost_center_id = row[0]
    elif row[1] == "department" and (row[2] or "").strip():
        from app.modules.organization.models.cost_center import CostCenter
        from app.modules.organization.models.department import Department
        ids = connection.execute(
            select(CostCenter.id).join(Department, CostCenter.department_id == Department.id)
            .where(func.lower(Department.name) == row[2].strip().lower(), CostCenter.status == "active")).all()
        if len(ids) == 1:
            target.cost_center_id = ids[0][0]


def check_po_charge(db, pr: P2PRequest, po: P2PPurchaseOrder) -> None:
    """400 when a department running-cost PO goes for approval with no cost
    centre (an internal order also counts as a charge)."""
    if pr.purpose == "department" and not po.cost_center_id and not po.internal_order_id:
        raise HTTPException(status_code=400, detail=(
            f"PO '{po.po_number}' is for a department running cost ({pr.department or 'no department'}) but has no cost "
            "centre — pick the cost centre on the PO before sending it for approval. If the department has none, ask "
            "Finance to set one up in Organization › Cost centres."))


def check_cost_center(db, cost_center_id: int | None) -> None:
    """400 unless the cost centre exists and is active."""
    if not cost_center_id:
        return
    from app.modules.organization.models.cost_center import CostCenter
    cc = db.get(CostCenter, cost_center_id)
    if cc is None:
        raise HTTPException(status_code=400, detail="That cost centre doesn't exist — pick it again from the list.")
    if cc.status != "active":
        raise HTTPException(status_code=400, detail=f"Cost centre {cc.code} — {cc.name} is {cc.status} — pick an active one.")
