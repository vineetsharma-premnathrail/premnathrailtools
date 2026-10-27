"""CRM › Reports (modules/crm/reporting.py): every dashboard page runs, leads by
month / outcome are counted right, money and per-person figures follow the
rights, and only leads in the viewer's scope are counted."""
from __future__ import annotations

from datetime import date, datetime, timezone

from app.auth.jwt_handler import create_access_token
from app.modules.crm.models.inquiry import Inquiry, Quotation, QuotationLineItem
from app.modules.crm.models.organization import Organization
from app.modules.main.models.user import User

URL = "/api/v1/reports/crm"
PERIOD = {"date_from": "2026-01-01", "date_to": "2026-12-31"}


def _user(db, email, role="user", grants=None, scope=None):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=["crm"],
             data_access_scopes=scope or {})
    if grants is not None:
        u.granular_permissions = list(grants)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _auth(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _seed(db, owner):
    org = Organization(name="Northern Railway")
    db.add(org)
    db.flush()
    rows = [  # (no, created, stage, status, closed, source, value)
        ("0301", datetime(2026, 8, 5, tzinfo=timezone.utc), "Requirement Received", "Requirement Received", None, "Website", 100000),
        ("0302", datetime(2026, 8, 20, tzinfo=timezone.utc), "Order Received", "Closed - Ordered", datetime(2026, 9, 10, tzinfo=timezone.utc), "Referral", 500000),
        ("0303", datetime(2026, 9, 2, tzinfo=timezone.utc), "Closed – Not Ordered", "Closed - Not Ordered", datetime(2026, 9, 30, tzinfo=timezone.utc), "Website", 200000),
    ]
    out = []
    for no, created, stage, status, closed, source, value in rows:
        inq = Inquiry(universal_id=f"PRT-INQ-2026-{no}", org_id=org.id, created_by_id=owner.id, bd_owner_id=owner.id,
                      bd_owner=owner.name, current_stage=stage, status=status, closed_at=closed, lead_source=source,
                      expected_value=value, lost_reason_code="price" if "Not" in status else None, product_category="Road Rail Vehicle")
        inq.created_at = created
        db.add(inq)
        db.flush()
        out.append(inq)
    q = Quotation(inquiry_id=out[1].id, quot_number="QT-2026-0302-01", quotation_type="Domestic", gst_type="CGST_SGST",
                  quote_date=date(2026, 8, 25), status="accepted", customer_response="Accepted", created_at=datetime(2026, 8, 25, tzinfo=timezone.utc))
    db.add(q)
    db.flush()
    db.add(QuotationLineItem(quotation_id=q.id, description="RRV", quantity=1, unit_price=1000, gst_percent=18, subtotal=1000, total=1180))
    db.commit()
    return out


def _page(client, user, page, **body):
    return client.post(f"{URL}/dashboard/{page}", json={**PERIOD, **body}, headers=_auth(user))


def test_every_page_runs_and_counts_leads_by_month_and_outcome(client, db):
    admin = _user(db, "crm_rep_admin@premnathrail.com", role="admin")
    _seed(db, admin)
    cat = client.get(URL, headers=_auth(admin)).json()
    pages = [p["key"] for d in cat["dashboards"] for p in d["pages"]]
    # Owner 2026-10-27: CRM Reports keeps only the Leads page (no pipeline / won & lost / quotations / team).
    assert pages == ["overview"]
    ov = _page(client, admin, "overview").json()
    assert set(ov["kpis"]) == {"k_total", "k_customers", "k_open", "k_won", "k_lost", "k_quoted"}  # no win rate / expected value
    assert ov["kpis"]["k_total"]["value"] == 3
    assert ov["kpis"]["k_won"]["value"] == 1 and ov["kpis"]["k_lost"]["value"] == 1
    month = ov["results"]["by_month"]
    counts = dict(zip(month["tokens"], month["values"]))
    assert counts["2026-08-01"] == 2 and counts["2026-09-01"] == 1


def test_money_and_people_follow_rights(client, db):
    owner = _user(db, "crm_rep_owner@premnathrail.com", grants=["crm:reports:view"], scope={"crm": "assigned"})
    other = _user(db, "crm_rep_other@premnathrail.com")
    _seed(db, owner)
    _seed_other = Inquiry(universal_id="PRT-INQ-2026-0399", org_id=db.query(Organization).first().id,
                          created_by_id=other.id, bd_owner_id=other.id)
    db.add(_seed_other)
    db.commit()
    cat = client.get(URL, headers=_auth(owner)).json()
    pages = {p["key"]: p for d in cat["dashboards"] for p in d["pages"]}
    kpi_ids = [k["id"] for k in pages["overview"]["kpis"]]
    assert "k_value" not in kpi_ids and "team" not in pages
    ov = _page(client, owner, "overview").json()
    assert ov["kpis"]["k_total"]["value"] == 3  # the other person's lead is outside this user's scope


def test_no_reports_right_is_403(client, db):
    u = _user(db, "crm_rep_none@premnathrail.com", grants=["crm:inquiries_tenders:view"])
    assert client.get(URL, headers=_auth(u)).status_code == 403
