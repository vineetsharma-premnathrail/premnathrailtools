"""ERP service SAP gaps: installed base links (IE01/IB51), warranty check on
SR create / edit, commissioning SR sets the machine's warranty, spare
consumption from Store against an SR (issue / return / Store form type
Service), and service billing into a GST AR invoice."""
import importlib.util
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from app.auth.jwt_handler import create_access_token
from app.modules.erp.models.project import Project
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.erp.models.service_material import ServiceMaterial
from app.modules.erp import warranty
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.products.models.product import FinishedProduct
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.material_issue import StoreMaterialIssue
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.modules.crm.models.organization import Organization
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.tests.test_accounts_finance import books, gstin_for  # noqa: F401  (fixture)

SR = "/api/v1/erp/service-requests"
PROJ = "/api/v1/erp/projects"


import pytest as _pytest
from app.modules.erp import billing as _sr_billing

# Closing / sending for closure needs both actual execution dates.
CLOSE_READY = {"actual_date_attended": "2026-10-01", "actual_completion_date": "2026-10-02"}


@_pytest.fixture(autouse=True)
def _service_billing_live(request, monkeypatch):
    """Service billing ships as 'Upcoming' (SERVICE_BILLING_ENABLED=False);
    these tests exercise the built feature, so switch it on — except the
    test that checks it is refused while upcoming."""
    if "upcoming" not in request.node.name:
        monkeypatch.setattr(_sr_billing, "SERVICE_BILLING_ENABLED", True)


def test_service_billing_is_upcoming_and_refuses_invoices():
    from fastapi import HTTPException
    with _pytest.raises(HTTPException) as exc:
        _sr_billing.ensure_billing_enabled()
    assert exc.value.status_code == 409 and "upcoming" in exc.value.detail


def hdr(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def mk_user(db, email, role="admin", perms=None, apps=("erp",)):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps),
             erp_permissions=perms or [], granular_permissions=[])
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def mk_machine(db, serial, **kw):
    p = Project(serial_number=serial, model_name=kw.pop("model_name", "RRV-X"), **kw)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def mk_sr(client, user, project, service_type="repair_breakdown", **extra):
    return client.post(SR, json={"project_id": project.id, "issue_title": "Hydraulic leak", "service_type": service_type, **extra},
                       headers=hdr(user))


def stock(db, qty=10, cost=200.0, **item_kw):
    loc = db.query(StoreLocation).filter(StoreLocation.code == "MS").first()
    if loc is None:
        loc = StoreLocation(name="Main Store", code="MS")
        db.add(loc)
        db.flush()
    n = db.query(StoreItem).count() + 1
    item = StoreItem(item_code=f"SP-{n:04d}", item_name=item_kw.pop("item_name", f"Seal kit {n}"), uom="NOS", item_type="material",
                     status="active", standard_cost=cost, **item_kw)
    db.add(item)
    db.flush()
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="manual_in", quantity=qty, unit_cost=cost)
    db.commit()
    return loc, item


def on_hand(db, item, loc):
    b = db.query(StoreStockBalance).filter(StoreStockBalance.item_id == item.id, StoreStockBalance.location_id == loc.id).first()
    return b.on_hand_qty if b else 0


# ── Installed base ──────────────────────────────────────────────────────────

def test_migration_backfill_matches_exact_gstin_or_name_only(db):
    path = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "95a3518f0dcd_erp_installed_base_service_billing.py"
    spec = importlib.util.spec_from_file_location("mig_95a3", path)
    mig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mig)

    g1 = gstin_for("27", "AAAGC0001A")
    by_gst = Organization(name="Central Railway", gst_number=g1)
    by_name = Organization(name="Konkan Railway")
    dup1, dup2 = Organization(name="Twin Co"), Organization(name="twin co ")
    prod = FinishedProduct(code="P-1", name="Rail Road Vehicle", product_type="vehicle", model_number="RRV-500")
    db.add_all([by_gst, by_name, dup1, dup2, prod])
    db.commit()
    m1 = mk_machine(db, "BF-1", client_company="Some other text", client_gst=g1.lower() + " ", model_name="rrv-500")
    m2 = mk_machine(db, "BF-2", client_company="  konkan railway ", model_name="Rail Road Vehicle")
    m3 = mk_machine(db, "BF-3", client_company="Konkan Rly")          # near-miss: no fuzzy match
    m4 = mk_machine(db, "BF-4", client_company="Twin Co")              # two orgs match: left unlinked
    mig.op = SimpleNamespace(get_bind=lambda: db.connection())
    mig._backfill_installed_base()
    db.expire_all()
    assert (db.get(Project, m1.id).customer_id, db.get(Project, m1.id).product_id) == (by_gst.id, prod.id)
    assert (db.get(Project, m2.id).customer_id, db.get(Project, m2.id).product_id) == (by_name.id, prod.id)
    assert db.get(Project, m3.id).customer_id is None
    assert db.get(Project, m4.id).customer_id is None
    assert db.get(Project, m1.id).client_company == "Some other text"  # display text kept


def test_machine_customer_link_fills_snapshot_and_installed_base_groups(client, db):
    admin = mk_user(db, "ib_admin@premnathrail.com")
    org = Organization(name="Northern Railway", gst_number=gstin_for("07", "AAAGN0002B"), state="Delhi", address="Baroda House")
    prod = FinishedProduct(code="P-2", name="Tamping Machine", product_type="vehicle", warranty_months=18)
    db.add_all([org, prod])
    db.commit()
    r = client.post(PROJ, json={"serial_number": "IB-1", "customer_id": org.id, "product_id": prod.id,
                                "commissioning_date": (date.today() - timedelta(days=30)).isoformat()}, headers=hdr(admin))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["customer_name"] == "Northern Railway" and body["product_name"] == "Tamping Machine"
    assert body["client_company"] == "Northern Railway" and body["client_gst"] == org.gst_number
    assert client.post(PROJ, json={"serial_number": "IB-2", "customer_id": 99999}, headers=hdr(admin)).status_code == 422
    mk_machine(db, "IB-3")  # not linked yet
    base = client.get(f"{PROJ}/installed-base", headers=hdr(admin)).json()
    assert base[0]["customer_name"] == "Northern Railway" and base[0]["machine_count"] == 1
    assert base[0]["machines"][0]["warranty_status"] == "in_warranty"   # 18 product months from commissioning
    assert base[-1]["customer_id"] is None
    only = client.get(f"{PROJ}/installed-base", params={"customer_id": org.id}, headers=hdr(admin)).json()
    assert len(only) == 1 and only[0]["machines"][0]["serial_number"] == "IB-1"
    opts = client.get(f"{PROJ}/link-options", headers=hdr(admin)).json()
    assert any(c["id"] == org.id for c in opts["customers"]) and any(p["warranty_months"] == 18 for p in opts["products"])


# ── Warranty check ──────────────────────────────────────────────────────────

def test_sr_chargeability_defaults_from_warranty_and_override_needs_reason(client, db):
    admin = mk_user(db, "w_admin@premnathrail.com")
    covered = mk_machine(db, "W-1", commissioning_date=date.today() - timedelta(days=60))       # 12-month default
    expired = mk_machine(db, "W-2", warranty_start_date=date(2020, 1, 1), warranty_end_date=date(2021, 1, 1))

    sr = mk_sr(client, admin, covered).json()
    assert sr["warranty_status"] == "in_warranty" and sr["is_chargeable"] is False and sr["billing_status"] == "not_billable"
    r = mk_sr(client, admin, covered, is_chargeable=True)
    assert r.status_code == 422 and "reason" in r.json()["detail"]
    r = mk_sr(client, admin, covered, is_chargeable=True, chargeable_reason="Damage by customer's operator")
    assert r.status_code == 201 and r.json()["is_chargeable"] is True
    assert db.query(AuditLog).filter(AuditLog.entity_id == r.json()["id"], AuditLog.action == "chargeability_overridden").count() == 1

    out = mk_sr(client, admin, expired).json()
    assert out["warranty_status"] == "out_of_warranty" and out["is_chargeable"] is True
    r = mk_sr(client, admin, expired, service_type="warranty")
    assert r.status_code == 422 and "out of warranty" in r.json()["detail"]
    r = mk_sr(client, admin, expired, service_type="warranty", chargeable_reason="Goodwill — same failure as last year")
    assert r.status_code == 201 and r.json()["is_chargeable"] is False
    assert mk_sr(client, admin, covered, service_type="warranty", is_chargeable=True, chargeable_reason="x").status_code == 422

    # Edit: switching type recomputes the default; flipping needs a reason.
    r = client.patch(f"{SR}/{sr['id']}", json={"service_type": "paid_service"}, headers=hdr(admin))
    assert r.status_code == 200 and r.json()["is_chargeable"] is True
    r = client.patch(f"{SR}/{sr['id']}", json={"is_chargeable": False}, headers=hdr(admin))
    assert r.status_code == 422
    r = client.patch(f"{SR}/{sr['id']}", json={"is_chargeable": False, "chargeable_reason": "Waived by Partner"}, headers=hdr(admin))
    assert r.status_code == 200 and r.json()["is_chargeable"] is False and r.json()["chargeable_reason"] == "Waived by Partner"

    chk = client.get(f"{SR}/warranty-check", params={"project_id": expired.id, "service_type": "repair_breakdown"}, headers=hdr(admin)).json()
    assert chk["warranty_status"] == "out_of_warranty" and chk["default_chargeable"] is True


def test_warranty_end_uses_product_months():
    prod = SimpleNamespace(warranty_months=24)
    p = SimpleNamespace(warranty_start_date=None, commissioning_date=date(2025, 1, 31), handover_date=None, warranty_end_date=None,
                        product_id=1, product=prod, extended_warranty=False, extended_warranty_end=None, amc_end_date=None, amc_status=None)
    start, end = warranty.warranty_window(None, p)
    assert start == date(2025, 1, 31) and end == date(2027, 1, 30)
    assert warranty.warranty_status_on(None, p, date(2026, 6, 1)) == "in_warranty"
    assert warranty.warranty_status_on(None, p, date(2027, 2, 1)) == "out_of_warranty"


def test_closing_commissioning_sr_sets_machine_commissioning_and_warranty(client, db):
    admin = mk_user(db, "c_admin@premnathrail.com")
    prod = FinishedProduct(code="P-3", name="Rail Welder", product_type="machine", warranty_months=12)
    db.add(prod)
    db.commit()
    m = mk_machine(db, "C-1", product_id=prod.id, delivery_date=date(2026, 9, 1))
    sr = mk_sr(client, admin, m, service_type="installation_commissioning").json()
    assert sr["is_chargeable"] is False
    r = client.patch(f"{SR}/{sr['id']}", json={**CLOSE_READY, "status": "closed", "resolution_description": "Commissioned at site",
                                              "actual_completion_date": "2026-10-05"}, headers=hdr(admin))
    assert r.status_code == 200, r.text
    db.expire_all()
    m = db.get(Project, m.id)
    assert m.commissioning_date == date(2026, 10, 5) and m.warranty_start_date == date(2026, 10, 5)
    assert m.warranty_end_date == date(2027, 10, 4)


# ── Spare consumption ───────────────────────────────────────────────────────

def test_spares_issue_and_return_through_store_ledger(client, db):
    admin = mk_user(db, "s_admin@premnathrail.com")
    loc, item = stock(db, qty=10, cost=250.0, hsn_sac_code="8483", gst_rate=18)
    m = mk_machine(db, "S-1", warranty_start_date=date(2020, 1, 1), warranty_end_date=date(2021, 1, 1))
    sr = mk_sr(client, admin, m).json()
    mat = client.post(f"{SR}/{sr['id']}/materials", json={"store_item_id": item.id, "quantity": 3, "unit_price": 400},
                      headers=hdr(admin)).json()
    assert mat["material_name"] == item.item_name and mat["is_warranty_covered"] is False

    r = client.post(f"{SR}/{sr['id']}/materials/{mat['id']}/issue", json={"location_id": loc.id, "quantity": 20, "challan_number": "DC-1"},
                    headers=hdr(admin))
    assert r.status_code == 409 and "10" in r.json()["detail"]
    assert client.post(f"{SR}/{sr['id']}/materials/{mat['id']}/issue", json={"location_id": loc.id, "quantity": 3, "challan_number": " "},
                       headers=hdr(admin)).status_code == 422
    r = client.post(f"{SR}/{sr['id']}/materials/{mat['id']}/issue", json={"location_id": loc.id, "quantity": 3, "challan_number": "DC-1"},
                    headers=hdr(admin))
    assert r.status_code == 200, r.text
    assert r.json()["qty_issued"] == 3 and r.json()["unit_cost"] == 250
    assert on_hand(db, item, loc) == 7
    issue = db.query(StoreMaterialIssue).filter(StoreMaterialIssue.service_request_id == sr["id"]).one()
    assert issue.issue_type == "service" and issue.erp_project_id == m.id and issue.challan_number == "DC-1"

    assert client.post(f"{SR}/{sr['id']}/materials/{mat['id']}/return", json={"quantity": 5}, headers=hdr(admin)).status_code == 422
    r = client.post(f"{SR}/{sr['id']}/materials/{mat['id']}/return", json={"quantity": 1}, headers=hdr(admin))
    assert r.status_code == 200 and r.json()["net_issued"] == 2
    assert on_hand(db, item, loc) == 8
    got = client.get(f"{SR}/{sr['id']}", headers=hdr(admin)).json()
    assert got["total_material_cost"] == 800 and got["material_cost_actual"] == 500
    assert client.delete(f"{SR}/{sr['id']}/materials/{mat['id']}", headers=hdr(admin)).status_code == 409
    assert len(client.get(f"{SR}/{sr['id']}/store-issues", headers=hdr(admin)).json()) == 1


def test_only_store_users_issue_spares(client, db):
    engineer = mk_user(db, "s_eng@premnathrail.com", role="user", perms=["sr_create", "sr_edit"])
    loc, item = stock(db, qty=5)
    m = mk_machine(db, "S-2")
    sr = mk_sr(client, engineer, m)
    assert sr.status_code == 201, sr.text
    sr = sr.json()
    mat = client.post(f"{SR}/{sr['id']}/materials", json={"store_item_id": item.id, "quantity": 1}, headers=hdr(engineer)).json()
    r = client.post(f"{SR}/{sr['id']}/materials/{mat['id']}/issue", json={"location_id": loc.id, "quantity": 1, "challan_number": "DC-2"},
                    headers=hdr(engineer))
    assert r.status_code == 403 and "Store" in r.json()["detail"]
    assert on_hand(db, item, loc) == 5


def test_store_issue_form_type_service_books_on_the_sr(client, db):
    admin = mk_user(db, "s_store@premnathrail.com", apps=("erp", "store"))
    loc, item = stock(db, qty=6, cost=100.0)
    m = mk_machine(db, "S-3")
    sr = mk_sr(client, admin, m).json()
    r = client.post("/api/v1/store/material-issues", json={
        "location_id": loc.id, "issue_type": "service", "service_request_id": sr["id"], "challan_number": "DC-9",
        "items": [{"item_id": item.id, "quantity": 2}]}, headers=hdr(admin))
    assert r.status_code == 200, r.text
    assert r.json()["erp_project_id"] == m.id and "Service request" in (r.json().get("against_label") or "")
    mats = db.query(ServiceMaterial).filter(ServiceMaterial.service_request_id == sr["id"]).all()
    assert len(mats) == 1 and mats[0].store_item_id == item.id and mats[0].qty_issued == 2 and mats[0].unit_cost == 100
    r = client.post("/api/v1/store/material-issues", json={
        "location_id": loc.id, "issue_type": "service", "items": [{"item_id": item.id, "quantity": 1}], "challan_number": "DC-10"},
        headers=hdr(admin))
    assert r.status_code == 422 and "Service request" in r.json()["detail"]


# ── Service billing ─────────────────────────────────────────────────────────

def _billable_sr(client, db, admin, customer, site_state):
    loc, item = stock(db, qty=10, cost=300.0, hsn_sac_code="84831099", gst_rate=18)
    m = mk_machine(db, f"B-{customer.id}-{site_state[:3]}", customer_id=customer.id, site_state=site_state,
                   warranty_start_date=date(2020, 1, 1), warranty_end_date=date(2021, 1, 1))
    sr = mk_sr(client, admin, m).json()
    mat = client.post(f"{SR}/{sr['id']}/materials", json={"store_item_id": item.id, "quantity": 2, "unit_price": 1000},
                      headers=hdr(admin)).json()
    assert client.post(f"{SR}/{sr['id']}/materials/{mat['id']}/issue", json={"location_id": loc.id, "quantity": 2, "challan_number": "DC-B"},
                       headers=hdr(admin)).status_code == 200
    r = client.patch(f"{SR}/{sr['id']}", json={"service_cost": 5000, "transport_cost": 1000, "status": "work_completed"}, headers=hdr(admin))
    assert r.status_code == 200, r.text
    return sr


def test_chargeable_sr_raises_gst_invoice_interstate_igst(client, books):
    db = books["db"]
    admin = mk_user(db, "b_admin@premnathrail.com")
    sr = _billable_sr(client, db, admin, books["c_other"], "Delhi")      # company in Maharashtra (27)
    preview = client.get(f"{SR}/{sr['id']}/invoice", headers=hdr(admin)).json()
    assert preview["problem"] is None and len(preview["preview_lines"]) == 3
    r = client.post(f"{SR}/{sr['id']}/invoice", json={"invoice_date": "2026-07-20"}, headers=hdr(admin))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["billing_status"] == "invoiced" and body["invoice_number"].startswith("DRAFT-")
    txn = db.get(ARTransaction, body["ar_transaction_id"])
    assert txn.reference_type == "service_request" and txn.reference_id == sr["id"] and txn.customer_id == books["c_other"].id
    assert txn.is_interstate and txn.place_of_supply_state_code == "07"
    assert float(txn.invoice_amount) == 8000 and float(txn.igst_amount) == 1440 and float(txn.cgst_amount) == 0
    codes = sorted(l.hsn_sac_code for l in txn.lines)
    assert codes == ["84831099", "998717", "998717"]
    # Second invoice blocked; typed invoice no. rejected.
    assert client.post(f"{SR}/{sr['id']}/invoice", json={}, headers=hdr(admin)).status_code == 409
    assert client.patch(f"{SR}/{sr['id']}", json={"invoice_number": "INV-HAND"}, headers=hdr(admin)).status_code == 422

    # Finance posts it → the SR shows the SI number.
    from app.modules.accounts import service
    service.post_customer_invoice(db, ar_transaction_id=txn.id, created_by_id=books["checker"].id)
    db.commit()
    got = client.get(f"{SR}/{sr['id']}", headers=hdr(admin)).json()
    assert got["invoice_number"].startswith("SI/") and got["payment_status"] == "invoiced"


def test_intrastate_split_and_billing_guards(client, books):
    db = books["db"]
    admin = mk_user(db, "b_admin2@premnathrail.com")
    sr = _billable_sr(client, db, admin, books["c_local"], "Maharashtra")
    r = client.post(f"{SR}/{sr['id']}/invoice", json={"invoice_date": "2026-07-20"}, headers=hdr(admin))
    assert r.status_code == 201, r.text
    txn = db.get(ARTransaction, r.json()["ar_transaction_id"])
    assert not txn.is_interstate and float(txn.cgst_amount) == 720 and float(txn.sgst_amount) == 720

    # Free job and machine without customer are refused with the reason.
    free_m = mk_machine(db, "B-FREE", customer_id=books["c_local"].id, commissioning_date=date.today() - timedelta(days=10))
    free = mk_sr(client, admin, free_m).json()
    client.patch(f"{SR}/{free['id']}", json={"status": "work_completed"}, headers=hdr(admin))
    r = client.post(f"{SR}/{free['id']}/invoice", json={}, headers=hdr(admin))
    assert r.status_code == 409 and "free of charge" in r.json()["detail"]
    orphan = mk_machine(db, "B-NOCUST", warranty_start_date=date(2020, 1, 1), warranty_end_date=date(2021, 1, 1))
    o = mk_sr(client, admin, orphan).json()
    client.patch(f"{SR}/{o['id']}", json={"service_cost": 100, "status": "work_completed"}, headers=hdr(admin))
    r = client.post(f"{SR}/{o['id']}/invoice", json={}, headers=hdr(admin))
    assert r.status_code == 422 and "Customer" in r.json()["detail"]
    # Still open SR can't be invoiced.
    open_sr = mk_sr(client, admin, orphan).json()
    assert client.post(f"{SR}/{open_sr['id']}/invoice", json={}, headers=hdr(admin)).status_code == 409
