"""Sales dashboard tiles + lists (plan §7) and the Phase 1 reports: order
book, backlog by delivery month, LD exposure."""
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.sales import service as svc
from app.modules.sales import approvals as sap
from app.modules.sales.access import scoped_orders
from app.modules.sales.models.order import SalesOrder, SALES_ORDER_OPEN_STATUSES
from app.modules.sales.models.extension import SalesDeliveryExtension
from app.modules.sales.routes.schedule import board_rows
from app.modules.sales.views import order_response

router = APIRouter(prefix="/sales", tags=["Sales"], dependencies=[Depends(require_app_access("sales"))])


def _ld_totals(db: Session, rows, orders: dict[int, SalesOrder] | None = None) -> dict[int, tuple[float, float]]:
    """so_id → (LD accrued, LD forecast) of the order's open rows, clamped at
    what is left of the contract-value cap after LD already accrued on its
    delivered vehicles (svc.order_open_ld) — not a plain sum of rows."""
    sums: dict[int, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for r in rows:
        sums[r.so_id][0] += r.ld_amount or 0
        sums[r.so_id][1] += r.ld_forecast_amount or 0
    if orders is None:
        orders = {o.id: o for o in db.query(SalesOrder).options(selectinload(SalesOrder.schedules))
                  .filter(SalesOrder.id.in_(list(sums))).all()} if sums else {}
    out = {}
    for so_id, (acc, fc) in sums.items():
        so = orders.get(so_id)
        out[so_id] = svc.order_open_ld(so, acc, fc) if so else (round(acc, 2), round(fc, 2))
    return out


def _open_orders(db: Session, user: User) -> list[SalesOrder]:
    q = db.query(SalesOrder).options(selectinload(SalesOrder.lines), selectinload(SalesOrder.schedules)).filter(
        SalesOrder.is_deleted == False, SalesOrder.status.in_(SALES_ORDER_OPEN_STATUSES))  # noqa: E712
    return scoped_orders(q, user).all()


@router.get("/dashboard")
async def dashboard(db: Session = Depends(get_db), user: User = Depends(require_tab_access("sales", "dashboard"))):
    today = svc.today_ist()
    month = today.strftime("%Y-%m")
    orders = _open_orders(db, user)
    rows = board_rows(db, user=user)
    pending = scoped_orders(db.query(SalesOrder).filter(SalesOrder.is_deleted == False, SalesOrder.status == "pending_approval"), user).all()  # noqa: E712
    mine = []
    for so in pending:
        via_engine, stage, _names = sap.engine_state(db, sap.ORDER_ENTITY, so.id)
        if via_engine:
            if stage and sap.can_decide(db, user, sap.ORDER_ENTITY, so.id):
                mine.append({"id": so.id, "display_number": so.display_number, "customer_name": so.customer_name,
                             "grand_total": so.grand_total, "level": None, "stage": stage, "submitted_at": so.submitted_at})
            continue
        lvl = svc.next_level(db, "sales_order", so.id, so.approval_round, so.required_approval_level)
        if lvl and so.submitted_by_id != user.id and (svc.holds_level(db, user, lvl) or user.role == "admin"):
            mine.append({"id": so.id, "display_number": so.display_number, "customer_name": so.customer_name,
                         "grand_total": so.grand_total, "level": lvl, "stage": svc.LEVEL_LABEL[lvl], "submitted_at": so.submitted_at})
    ext = db.query(SalesDeliveryExtension).filter(
        SalesDeliveryExtension.status == "requested",
        SalesDeliveryExtension.so_id.in_(scoped_orders(db.query(SalesOrder.id), user)),
    ).order_by(SalesDeliveryExtension.id).all()
    so_names = {o.id: o.display_number for o in db.query(SalesOrder).filter(SalesOrder.id.in_({e.so_id for e in ext})).all()} if ext else {}
    ld = _ld_totals(db, rows, {o.id: o for o in orders})
    delivered_value = 0.0
    for so in orders:
        delivered_value += sum(svc.unit_value(so, r) for r in so.schedules if r.status in ("delivered", "commissioned"))
    return {
        "tiles": {
            "open_order_value": round(sum(float(o.grand_total or 0) for o in orders), 2),
            "open_orders": len(orders),
            "units_due_this_month": sum(int(r.quantity) for r in rows if r.current_delivery_date and r.current_delivery_date.strftime("%Y-%m") == month),
            "units_overdue": sum(1 for r in rows if r.risk == "overdue"),
            "units_at_risk": sum(1 for r in rows if r.risk == "at_risk"),
            "ld_accrued": round(sum(a for a, _f in ld.values()), 2),
            "ld_forecast": round(sum(f for _a, f in ld.values()), 2),
            "pending_approval": len(pending),
        },
        "approvals_waiting_for_me": mine,
        "rows_at_risk": [r.model_dump() for r in rows if r.risk][:25],
        "extensions_pending": [{"id": e.id, "so_id": e.so_id, "so_display": so_names.get(e.so_id), "requested_new_date": e.requested_new_date,
                                "reason_category": e.reason_category, "vehicles": len(e.schedule_ids or [])} for e in ext],
    }


@router.get("/reports/order-book")
async def order_book(db: Session = Depends(get_db), user: User = Depends(require_tab_access("sales", "reports"))):
    out = []
    for so in _open_orders(db, user):
        r = order_response(db, so, user, light=True)
        delivered = sum(svc.unit_value(so, s) for s in so.schedules if s.status in ("delivered", "commissioned"))
        out.append({"id": so.id, "so_number": so.display_number, "customer_name": r.customer_name, "status": so.status,
                    "order_month": so.confirmed_at.strftime("%Y-%m") if so.confirmed_at else None,
                    "models": sorted({ln.rrv_model for ln in so.lines if ln.rrv_model}),
                    "taxable_total": so.taxable_total, "grand_total": so.grand_total,
                    "delivered_value": round(delivered, 2), "balance_value": round(float(so.taxable_total or 0) - delivered, 2),
                    "units_total": r.units_total, "units_delivered": r.units_delivered, "next_due_date": r.next_due_date})
    out.sort(key=lambda x: x["so_number"])
    return out


@router.get("/reports/backlog")
async def backlog(db: Session = Depends(get_db), user: User = Depends(require_tab_access("sales", "reports"))):
    buckets: dict[str, dict] = defaultdict(lambda: {"units": 0, "value": 0.0, "at_risk": 0, "overdue": 0, "ld_forecast": 0.0})
    for r in board_rows(db, user=user):
        key = r.current_delivery_date.strftime("%Y-%m") if r.current_delivery_date else "undated"
        b = buckets[key]
        b["units"] += int(r.quantity)
        b["value"] = round(b["value"] + (r.unit_value or 0), 2)
        b["at_risk"] += 1 if r.risk == "at_risk" else 0
        b["overdue"] += 1 if r.risk == "overdue" else 0
        b["ld_forecast"] = round(b["ld_forecast"] + (r.ld_forecast_amount or 0), 2)
    return [{"month": k, **v} for k, v in sorted(buckets.items())]


@router.get("/reports/ld-exposure")
async def ld_exposure(db: Session = Depends(get_db), user: User = Depends(require_tab_access("sales", "reports"))):
    per_so: dict[int, dict] = {}
    rows = board_rows(db, user=user)
    for r in rows:
        d = per_so.setdefault(r.so_id, {"so_id": r.so_id, "so_number": r.so_display, "customer_name": r.customer_name,
                                        "ld_accrued": 0.0, "ld_forecast": 0.0, "overdue_units": 0, "at_risk_units": 0, "rows": []})
        d["ld_accrued"] = round(d["ld_accrued"] + (r.ld_amount or 0), 2)
        d["ld_forecast"] = round(d["ld_forecast"] + (r.ld_forecast_amount or 0), 2)
        d["overdue_units"] += 1 if r.risk == "overdue" else 0
        d["at_risk_units"] += 1 if r.risk == "at_risk" else 0
        if r.ld_amount or r.ld_forecast_amount or r.risk:
            d["rows"].append({"schedule_id": r.id, "line_number": r.line_number, "vehicle": r.sequence,
                              "current_delivery_date": r.current_delivery_date, "committed_date": r.committed_date,
                              "build_number": r.build_number, "risk": r.risk, "ld_accrued": r.ld_amount or 0,
                              "ld_forecast": r.ld_forecast_amount or 0})
    for so_id, (acc, fc) in _ld_totals(db, rows).items():
        per_so[so_id]["ld_accrued"], per_so[so_id]["ld_forecast"] = acc, fc  # per-SO totals respect the contract-value cap
    return sorted(per_so.values(), key=lambda d: -(d["ld_accrued"] + d["ld_forecast"]))
