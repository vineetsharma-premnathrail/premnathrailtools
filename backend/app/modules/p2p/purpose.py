"""Purpose of a purchase requisition (2026-10-23).

The PR form asks "what is this purchase for?" first; the answer decides what
it must be charged to, so every rupee lands on a real cost object:

  customer_order   Order Project or its sales order (lines: vehicle / lot)
  machine_project  an existing machine project; the charge is optional
                   (work order, internal order, sales order, order project)
  development      an internal order (the development job and its budget)
  department       a cost centre — the requester's department by default
  capital          an internal order (the asset job and its budget)
  stock            nothing — store stock is charged when it is issued

Overhead purposes (department / capital / development / stock) are not bought
for a customer project, so every line is Inhouse. Requisitions raised before
this (purpose NULL) keep the old existing/new project rules."""
from __future__ import annotations

from app.modules.p2p.models.p2p_request import P2P_PURPOSES

# Purposes whose lines are never for a customer project.
INHOUSE_ONLY = ("development", "department", "capital", "stock")

# What each purpose may be charged to; the first is the required one where
# the purpose has a single answer. None in the tuple = may be left blank.
_ALLOWED: dict[str, tuple] = {
    "customer_order": ("order_project", "sales_order"),
    "machine_project": (None, "work_order", "internal_order", "sales_order", "order_project"),
    "development": ("internal_order",),
    "department": ("cost_center",),
    "capital": ("internal_order",),
    "stock": (None,),
}

_NEED = {
    "customer_order": "the order project (or its sales order) this material is bought for",
    "development": "the internal order of the development job — ask Finance to open one in Finance › Masters › Internal orders if it isn't in the list",
    "department": "the cost centre of the department that uses it",
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
