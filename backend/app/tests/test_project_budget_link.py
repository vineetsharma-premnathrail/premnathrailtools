"""Finance budgets linked to projects (2026-10-27): a Project Management or
R&D project links a budget Finance created; one budget belongs to one project;
the project shows budget / committed / actual / available."""
from datetime import date, timedelta

from app.auth.jwt_handler import create_access_token
from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.main.models.user import User
from app.modules.projects.models.project import PmProject

API = "/api/v1"
TODAY = date.today()


def _user(db, email, **flags):
    u = User(email=email, name=email.split("@")[0], role="user", assigned_apps=["projects", "rnd"], is_active=True, **flags)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _budget(db, code, amount=500000, status="open"):
    io = InternalOrder(code=code, name=f"Budget {code}", order_type="capital", budgeted_amount=amount, status=status)
    db.add(io)
    db.commit()
    return io


def _pm_body(**extra):
    data = {"name": "Tamping", "client_name": "RVNL", "customer_po_ref": "PO/1", "sales_order_ref": "SO-1",
            "start_date": str(TODAY), "target_handover_date": str(TODAY + timedelta(days=30))}
    data.update(extra)
    return data


def test_pm_project_links_budget_and_shows_spend(client, db):
    partner = _user(db, "bud.partner@x.com", is_partner=True)
    io = _budget(db, "IO-PM-01")
    opts = client.get(f"{API}/projects/budget-options", headers=_h(partner))
    assert opts.status_code == 200, opts.text
    assert [o["code"] for o in opts.json()] == ["IO-PM-01"]

    # A budget is never linked while the project is created (2026-10-30): it is refused with the fix ...
    r = client.post(f"{API}/projects", headers=_h(partner), json=_pm_body(internal_order_id=io.id))
    assert r.status_code == 422 and "link a budget later from the project's Overview" in r.json()["detail"], r.text
    # ... and linked afterwards from the project's Overview.
    pid = client.post(f"{API}/projects", headers=_h(partner), json=_pm_body()).json()["id"]
    r = client.patch(f"{API}/projects/{pid}", headers=_h(partner), json={"internal_order_id": io.id})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["internal_order_id"] == io.id and body["internal_order_code"] == "IO-PM-01"

    spend = client.get(f"{API}/projects/{body['id']}/budget", headers=_h(partner))
    assert spend.status_code == 200, spend.text
    s = spend.json()["summary"]
    assert spend.json()["linked"] is True
    assert s["budgeted_amount"] == 500000 and s["actual_amount"] == 0 and s["available_amount"] == 500000

    # Held now: no longer offered, and a second project can't take it.
    assert client.get(f"{API}/projects/budget-options", headers=_h(partner)).json() == []
    pid2 = client.post(f"{API}/projects", headers=_h(partner), json=_pm_body(name="Second")).json()["id"]
    r2 = client.patch(f"{API}/projects/{pid2}", headers=_h(partner), json={"internal_order_id": io.id})
    assert r2.status_code == 422 and "already linked to project" in r2.json()["detail"], r2.text


def test_pm_edit_switches_and_unlinks_budget(client, db):
    partner = _user(db, "bud.partner2@x.com", is_partner=True)
    a, b = _budget(db, "IO-PM-A"), _budget(db, "IO-PM-B")
    pid = client.post(f"{API}/projects", headers=_h(partner), json=_pm_body()).json()["id"]
    assert client.patch(f"{API}/projects/{pid}", headers=_h(partner), json={"internal_order_id": a.id}).status_code == 200
    # Editing keeps the current budget listed.
    codes = [o["code"] for o in client.get(f"{API}/projects/budget-options", params={"project_id": pid}, headers=_h(partner)).json()]
    assert codes == ["IO-PM-A", "IO-PM-B"]
    r = client.patch(f"{API}/projects/{pid}", headers=_h(partner), json={"internal_order_id": b.id})
    assert r.status_code == 200 and r.json()["internal_order_code"] == "IO-PM-B", r.text
    r = client.patch(f"{API}/projects/{pid}", headers=_h(partner), json={"internal_order_id": None})
    assert r.status_code == 200 and r.json()["internal_order_id"] is None, r.text
    db.expire_all()
    assert db.get(PmProject, pid).internal_order_id is None


def test_closed_budget_cannot_be_linked(client, db):
    partner = _user(db, "bud.partner3@x.com", is_partner=True)
    io = _budget(db, "IO-PM-C", status="closed")
    pid = client.post(f"{API}/projects", headers=_h(partner), json=_pm_body()).json()["id"]
    r = client.patch(f"{API}/projects/{pid}", headers=_h(partner), json={"internal_order_id": io.id})
    assert r.status_code == 422 and "only Open or In progress budgets" in r.json()["detail"], r.text


def test_pm_budget_options_need_management(client, db):
    plain = _user(db, "bud.plain@x.com")
    r = client.get(f"{API}/projects/budget-options", headers=_h(plain))
    assert r.status_code == 403, r.text


def test_rnd_project_links_finance_budget(client, db):
    admin = _user(db, "bud.rnd.admin@x.com")
    admin.role = "admin"
    db.commit()
    io = _budget(db, "IO-RND-F1", amount=300000)
    r = client.post(f"{API}/rnd/projects", headers=_h(admin), json={
        "title": "Bogie research", "objective": "Lighter frame", "internal_order_id": io.id, "budget_amount": 99,
        "origin": "new_project", "origin_note": "Proposed by R&D head", "attachment_count": 1})
    assert r.status_code == 200, r.text
    body = r.json()
    # The amount is Finance's, not the typed one.
    assert body["budget_from_finance"] is True and body["budget_amount"] == 300000 and body["internal_order_code"] == "IO-RND-F1"

    spend = client.get(f"{API}/rnd/projects/{body['id']}/budget", headers=_h(admin)).json()
    assert spend["linked"] is True and spend["summary"]["budgeted_amount"] == 300000

    r = client.patch(f"{API}/rnd/projects/{body['id']}", headers=_h(admin), json={"budget_amount": 5})
    assert r.status_code == 422 and "ask Finance to change the amount" in r.json()["detail"], r.text

    # Held by the R&D project: a PM project can't take it.
    partner = _user(db, "bud.partner4@x.com", is_partner=True)
    pid = client.post(f"{API}/projects", headers=_h(partner), json=_pm_body()).json()["id"]
    r = client.patch(f"{API}/projects/{pid}", headers=_h(partner), json={"internal_order_id": io.id})
    assert r.status_code == 422 and "R&D project" in r.json()["detail"], r.text
