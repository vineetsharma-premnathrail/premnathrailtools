"""Line items shown in the approval email for requisitions and purchase
orders (organization/services/approval_mail.py loads this on first use)."""
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.services.approval_mail import money, register_email_lines
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.pricing import sees_prices

PR_KEY = "p2p.purchase_requisition"
PO_KEY = "p2p.purchase_order"


def _qty(v) -> str:
    return f"{float(v or 0):,.3f}".rstrip("0").rstrip(".")


def _item(name, part_code) -> str:
    return f"{name} ({part_code})" if part_code else (name or "")


def _pr_lines(db: Session, req: ApprovalRequest, reader: User) -> dict | None:
    pr = db.get(P2PRequest, req.entity_id)
    if pr is None:
        return None
    rows = [[i + 1, _item(it.item_name, it.part_code), it.make or "", _qty(it.quantity), it.unit or ""]
            for i, it in enumerate(sorted(pr.items, key=lambda x: x.id))]
    return {"title": "Items requested", "columns": ["#", "Item", "Make", "Qty", "Unit"],
            "align": ["r", "l", "l", "r", "l"], "rows": rows}


def _po_lines(db: Session, req: ApprovalRequest, reader: User) -> dict | None:
    po = db.get(P2PPurchaseOrder, req.entity_id)
    if po is None:
        return None
    if not sees_prices(reader, "purchase_orders"):
        # Same Prices switch as the portal: quantities only.
        rows = [[i + 1, _item(it.item_name, it.part_code), f"{_qty(it.quantity)} {it.unit or ''}".strip()]
                for i, it in enumerate(sorted(po.items, key=lambda x: x.id))]
        return {"title": "Order lines", "columns": ["#", "Item", "Qty"], "align": ["r", "l", "r"], "rows": rows}
    rows = [[i + 1, _item(it.item_name, it.part_code), f"{_qty(it.quantity)} {it.unit or ''}".strip(),
             money(it.unit_price) if it.unit_price is not None else "",
             f"{it.tax_rate:g}%" if it.tax_rate is not None else "",
             money(it.line_total) if it.line_total is not None else ""]
            for i, it in enumerate(sorted(po.items, key=lambda x: x.id))]
    return {"title": "Order lines", "columns": ["#", "Item", "Qty", "Rate", "Tax", "Amount"],
            "align": ["r", "l", "r", "r", "r", "r"], "rows": rows}


register_email_lines(PR_KEY, _pr_lines)
register_email_lines(PO_KEY, _po_lines)
