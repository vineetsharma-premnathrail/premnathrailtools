"""Test helpers for HISTORIC sales-order projects.

The Sales module was retired on 2026-10-30: there is no API to create, submit
or approve an order any more. Tests that still need a PEW project with vehicle /
lot units (the historic-order rules of Production, Store, Quality, P2P and Design)
build the confirmed order straight from the models here and then create the
project the way the Project Manager's action did
(so_projects.ensure_project_for_order(create=True))."""
from datetime import date, datetime, timedelta, timezone

from app.auth.jwt_handler import create_access_token
from app.modules.crm.models.organization import Organization
from app.modules.main.models.user import User
from app.modules.projects import so_projects as op_core
from app.modules.sales.models.order import SalesBillingPlanLine, SalesOrder, SalesOrderLine, SalesOrderSchedule

TODAY = date.today()


def make_user(db, email, apps=("projects",), role="user", **flags):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps), **flags)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def hdr(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def make_customer(db, name="Central Railway"):
    org = db.query(Organization).filter(Organization.name == name).first()
    if org is None:
        org = Organization(name=name, gst_number="27AAAGC1234F1Z5", state="Maharashtra", city="Mumbai")
        db.add(org)
        db.commit()
    return org


def make_confirmed_order(db, *, qty: int = 2, price: float = 1_000_000.0, spares_qty: int = 0, customer=None,
                         owner: User | None = None, confirmed_by: User | None = None, due: date | None = None,
                         number: str | None = None, product_item_id: int | None = None, billing: list[dict] | None = None,
                         **order_fields) -> SalesOrder:
    """A confirmed historic New Project order: `qty` RRV vehicles (one delivery row each,
    quantity 1) and optionally a spares line, a 20 / 80 billing plan, PO 'CR/PO/2026/771'.
    `product_item_id` sets the vehicle line's finished-good item; `billing` replaces the 20 / 80 plan
    ([{"milestone_type": "drawing_approval", "percent": 10}, ...]). Extra keyword arguments set
    SalesOrder columns (e.g. inspection_agency="third_party")."""
    org = customer or make_customer(db)
    owner = owner or make_user(db, "so.owner@premnathrail.com")
    confirmed_by = confirmed_by or owner
    due = due or TODAY + timedelta(days=120)
    count = db.query(SalesOrder).count() + 1
    taxable = round(qty * price, 2)
    fields = {"order_type": "road_rail_vehicle", "order_category": "new_project", **order_fields}
    order = SalesOrder(
        so_number=number or f"SO/2026/{count:04d}", status="confirmed",
        customer_id=org.id, customer_name=org.name, source_type="direct", customer_po_number="CR/PO/2026/771",
        customer_po_date=TODAY, customer_po_received_date=TODAY, currency="INR", subtotal=taxable, taxable_total=taxable,
        gst_total=round(taxable * 0.18, 2), grand_total=round(taxable * 1.18, 2), sales_owner_id=owner.id, created_by_id=owner.id,
        confirmed_by_id=confirmed_by.id, confirmed_at=datetime.now(timezone.utc), deviation_flags=[], **fields,
    )
    db.add(order)
    db.flush()
    if qty:
        line = SalesOrderLine(so_id=order.id, line_number=1, line_type="rrv", rrv_model="RRV-10T", description="Rail cum Road Vehicle 10T",
                              quantity=qty, unit_price=price, taxable_amount=taxable, gst_rate=18, line_total=round(taxable * 1.18, 2),
                              qty_scheduled=qty, product_item_id=product_item_id)
        db.add(line)
        db.flush()
        for i in range(qty):
            d = due + timedelta(days=30 * i)
            db.add(SalesOrderSchedule(so_id=order.id, so_line_id=line.id, sequence=i + 1, quantity=1,
                                      contract_delivery_date=d, current_delivery_date=d, status="open"))
    if spares_qty:
        spares = SalesOrderLine(so_id=order.id, line_number=2 if qty else 1, line_type="spares", description="Spare kit", uom="NOS",
                                quantity=spares_qty, unit_price=1000, taxable_amount=spares_qty * 1000, gst_rate=18,
                                line_total=round(spares_qty * 1180, 2), qty_scheduled=spares_qty)
        db.add(spares)
        db.flush()
        db.add(SalesOrderSchedule(so_id=order.id, so_line_id=spares.id, sequence=1, quantity=spares_qty,
                                  contract_delivery_date=TODAY + timedelta(days=60), current_delivery_date=TODAY + timedelta(days=60),
                                  status="open"))
    plan = billing or [{"milestone_type": "advance", "percent": 20}, {"milestone_type": "delivery", "percent": 80}]
    for i, m in enumerate(plan, start=1):
        db.add(SalesBillingPlanLine(so_id=order.id, sequence=i, milestone_type=m["milestone_type"], percent=m["percent"],
                                    amount=round(taxable * 1.18 * m["percent"] / 100, 2),
                                    per_unit=bool(m.get("per_unit", False)), description=m.get("description")))
    db.commit()
    db.refresh(order)
    return order


def create_project_for(db, so_id: int, actor: User | None = None, project_manager_id: int | None = None):
    order = db.get(SalesOrder, so_id)
    actor = actor or (db.get(User, order.confirmed_by_id) if order.confirmed_by_id else None)
    project = op_core.ensure_project_for_order(
        db, order, actor, create=True, project_manager_id=project_manager_id or order.sales_owner_id)
    db.commit()
    return project


def order_with_project(db, **kw) -> dict:
    """A confirmed historic order plus its PEW project (units and department hooks synced).
    Returns {"id", "so_number", "status"} — the shape the old confirm() returned."""
    order = make_confirmed_order(db, **kw)
    create_project_for(db, order.id)
    db.expire_all()
    order = db.get(SalesOrder, order.id)
    return {"id": order.id, "so_number": order.so_number, "status": order.status}


# ---------------------------------------------------------------------------
# Finance (bill-from-order) fixtures: a confirmed historic order with a billing plan, built from the models.

BILLING_PLAN = (("advance", 20), ("delivery", 70), ("commissioning", 10))


def make_billing_order(db, customer, *, qty=2, price=1_000_000.0, plan=BILLING_PLAN, line_type="rrv", item_id=None,
                       due: date | None = None, so_number: str | None = None) -> SalesOrder:
    """A confirmed order with `qty` units, a billing plan and totals worked out the way the old Sales
    service did (taxable = qty x price, GST 18%, milestone amount = percent of the grand total).
    Billing statuses are derived with billing.sync_order, like Finance does on open."""
    from app.modules.accounts.services import billing

    d0 = due or (TODAY - timedelta(days=34))
    taxable = round(qty * price, 2)
    gst = round(taxable * 0.18, 2)
    so = SalesOrder(
        status="confirmed", so_number=so_number or f"SO/T/{customer.id:04d}", customer_id=customer.id, customer_name=customer.name,
        customer_gstin=customer.gst_number, place_of_supply_state_code=customer.gst_number[:2], customer_po_number="CR/PO/9",
        customer_po_date=d0 - timedelta(days=60), price_basis="for_destination", ld_applicable=True, ld_rate_percent=0.5,
        ld_rate_period="week", ld_basis="delayed_value", ld_max_percent=10, warranty_rule="from_delivery",
        warranty_months_from_delivery=12, confirmed_at=datetime.now(timezone.utc) - timedelta(days=50),
        subtotal=taxable, taxable_total=taxable, gst_total=gst, grand_total=round(taxable + gst, 2), deviation_flags=[],
    )
    so.lines.append(SalesOrderLine(line_number=1, line_type=line_type, description="Rail cum Road Vehicle 10T", hsn_sac_code="8604",
                                   quantity=qty, unit_price=price, gst_rate=18, product_item_id=item_id, taxable_amount=taxable,
                                   gst_amount=gst, line_total=round(taxable + gst, 2), qty_scheduled=qty))
    db.add(so)
    db.flush()
    rows = qty if line_type == "rrv" else 1
    for i in range(rows):
        so.schedules.append(SalesOrderSchedule(
            so_line_id=so.lines[0].id, sequence=i + 1, quantity=1 if line_type == "rrv" else qty,
            contract_delivery_date=d0 - timedelta(days=14), current_delivery_date=d0 - timedelta(days=14), status="open",
            consignee_name="Sr DME, Kurla"))
    for i, (t, pct) in enumerate(plan, start=1):
        so.billing_lines.append(SalesBillingPlanLine(sequence=i, milestone_type=t, percent=pct, status="not_due",
                                                     amount=round((taxable + gst) * pct / 100, 2)))
    db.flush()
    billing.sync_order(db, so)
    db.commit()
    return so


def deliver_row(db, so: SalesOrder, row: SalesOrderSchedule, on: date, *, reference: str = "RN-1", quantity: float | None = None,
                dispatch_only: bool = False) -> None:
    """Records dispatch (and delivery) of a delivery row the way the old Sales delivery service stored it
    (events plus the row / line / order columns), then lets Finance re-derive the billing status."""
    from app.modules.accounts.services import billing
    from app.modules.sales.models.delivery import SalesDeliveryEvent

    qty = float(row.quantity if quantity is None else quantity)
    line = next(ln for ln in so.lines if ln.id == row.so_line_id)
    kinds = ["dispatch"] if dispatch_only else ["dispatch", "delivery"]
    for kind in kinds:
        db.add(SalesDeliveryEvent(so_id=so.id, schedule_id=row.id, so_line_id=row.so_line_id, event=kind, quantity=qty,
                                  event_date=on, reference=reference, source="manual"))
    row.qty_dispatched = qty
    row.dispatched_on = on if qty >= float(row.quantity) else None
    line.qty_dispatched = float(line.qty_dispatched or 0) + qty
    if not dispatch_only:
        row.qty_delivered, row.delivered_on, row.status = qty, on, "delivered"
        line.qty_delivered = float(line.qty_delivered or 0) + qty
        so.status = "delivered" if all(r.status in ("delivered", "commissioned") for r in so.schedules) else "partially_delivered"
    else:
        row.status = "dispatched"
        so.status = "in_execution"
    db.flush()
    billing.sync_order(db, so)
    db.commit()
