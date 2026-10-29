"""The Project Manager creates the PEW project of a confirmed New Project sales order
(owner, 2026-10-28): confirming creates no project and tells the Project Managers;
the order shows "Pending project creation"; All Projects › From Sales Order lists
it and creates the project with the chosen project manager; amendments keep
syncing the units of the project once it exists."""
from datetime import timedelta

from app.modules.main.models.notification import Notification
from app.modules.projects.models.project import PmProject
from app.modules.sales import service as svc
from app.modules.sales.models.order import SalesOrder
from app.tests.test_sales import BASE, TODAY, confirm, create_order, hdr, make_user, setup_customer, setup_people

PM = "/api/v1/projects/units"
_PM_PERMS = ["projects:all_projects:view", "projects:all_projects:create"]


def _projects(db, so_id):
    db.expire_all()
    return db.query(PmProject).filter(PmProject.sales_order_id == so_id).all()


def test_project_manager_creates_project_from_sales_order(client, db):
    maker, head, director, _ = setup_people(db)
    pm_lead = make_user(db, "pmlead@premnathrail.com", apps=("projects",), is_project_manager=True,
                        granular_permissions=_PM_PERMS)
    pm_other = make_user(db, "pm2@premnathrail.com", apps=("projects",), is_project_manager=True)
    no_app_pm = make_user(db, "pm3@premnathrail.com", apps=("sales",), is_project_manager=True)
    plain = make_user(db, "plain@premnathrail.com", apps=("projects",), granular_permissions=["projects:all_projects:view"])
    _org, inq, _ = setup_customer(db, qty=2, price=1000000)

    # 1. Confirmation creates no project and tells the Project Managers (bell only).
    so = confirm(client, db, create_order(client, db, maker, inq), maker, head, director)
    assert _projects(db, so["id"]) == []
    notes = db.query(Notification).filter(Notification.notification_type == "sales_order_project_needed").all()
    assert {n.user_id for n in notes} == {pm_lead.id, pm_other.id}  # PM app needed; not the plain user
    assert no_app_pm.id not in {n.user_id for n in notes}
    n = notes[0]
    assert n.title == f"Create project for {so['so_number']}"
    assert "Central Railway" in n.message and "CR/PO/2026/771" in n.message and "2 vehicle" in n.message
    assert n.entity_type == "sales_order" and n.entity_id == so["id"]

    # 2. The order shows "Pending project creation" (derived; stored status stays confirmed).
    detail = client.get(f"{BASE}/orders/{so['id']}", headers=hdr(maker)).json()
    assert detail["status"] == "confirmed" and detail["display_status"] == "pending_project"
    assert detail["pm_project_id"] is None
    listed = next(x for x in client.get(f"{BASE}/orders", headers=hdr(maker)).json() if x["id"] == so["id"])
    assert listed["display_status"] == "pending_project"

    # 3. Awaiting list (management only).
    assert client.get(f"{PM}/awaiting-sales-orders", headers=hdr(plain)).status_code == 403
    r = client.get(f"{PM}/awaiting-sales-orders", headers=hdr(pm_lead))
    assert r.status_code == 200, r.text
    rows = r.json()
    assert [x["id"] for x in rows] == [so["id"]]
    assert rows[0]["so_number"] == so["so_number"] and rows[0]["vehicles"] == 2
    assert rows[0]["customer_po_number"] == "CR/PO/2026/771" and rows[0]["last_delivery_date"]

    # 4. Bad picks are refused with the reason.
    r = client.post(f"{PM}/from-sales-order", json={"sales_order_id": 999999, "project_manager_id": pm_other.id},
                    headers=hdr(pm_lead))
    assert r.status_code == 404 and "pick the order again" in r.json()["detail"]
    pm_other.is_active = False
    db.commit()
    r = client.post(f"{PM}/from-sales-order", json={"sales_order_id": so["id"], "project_manager_id": pm_other.id},
                    headers=hdr(pm_lead))
    assert r.status_code == 422 and "deactivated" in r.json()["detail"]
    pm_other.is_active = True
    db.commit()
    r = client.post(f"{PM}/from-sales-order", json={"sales_order_id": so["id"], "project_manager_id": pm_other.id},
                    headers=hdr(plain))
    assert r.status_code == 403

    # 5. Create: PEW number, chosen PM, one unit per vehicle.
    r = client.post(f"{PM}/from-sales-order", json={"sales_order_id": so["id"], "project_manager_id": pm_other.id},
                    headers=hdr(pm_lead))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["project_code"].startswith("PEW-") and body["id"]
    [p] = _projects(db, so["id"])
    assert p.id == body["id"] and p.project_manager_id == pm_other.id and p.created_by_id == pm_lead.id
    vehicles = [e for e in p.elements if e.kind == "vehicle" and e.status != "cancelled"]
    assert len(vehicles) == 2
    assert db.query(Notification).filter(Notification.user_id == pm_other.id,
                                         Notification.notification_type == "pm_project_manager").count() == 1

    # Back to plain "Confirmed"; no longer awaiting.
    detail = client.get(f"{BASE}/orders/{so['id']}", headers=hdr(maker)).json()
    assert detail["display_status"] == "confirmed" and detail["pm_project_code"] == p.project_code
    assert client.get(f"{PM}/awaiting-sales-orders", headers=hdr(pm_lead)).json() == []

    # 6. Second create → 409 naming the project.
    r = client.post(f"{PM}/from-sales-order", json={"sales_order_id": so["id"], "project_manager_id": pm_lead.id},
                    headers=hdr(pm_lead))
    assert r.status_code == 409 and p.project_code in r.json()["detail"]
    assert len(_projects(db, so["id"])) == 1

    # 7. An amendment still syncs the units of the existing project.
    order = db.get(SalesOrder, so["id"])
    proposed = svc.snapshot(order)
    proposed["lines"][0]["quantity"] = 3
    proposed["schedule"].append({"line_number": 1, "quantity": 1, "contract_delivery_date": str(TODAY + timedelta(days=400))})
    svc.apply_amendment(db, order, proposed)
    db.commit()
    [p] = _projects(db, so["id"])
    assert sum(1 for e in p.elements if e.kind == "vehicle" and e.status != "cancelled") == 3


def test_custom_name_and_non_project_order_refused(client, db):
    maker, head, director, _ = setup_people(db)
    pm_lead = make_user(db, "pmlead@premnathrail.com", apps=("projects",), is_project_manager=True,
                        granular_permissions=_PM_PERMS)
    org, inq, _ = setup_customer(db, qty=1, price=1000000)
    so = confirm(client, db, create_order(client, db, maker, inq), maker, head, director)
    r = client.post(f"{PM}/from-sales-order",
                    json={"sales_order_id": so["id"], "project_manager_id": pm_lead.id, "name": "  CR tower car  "},
                    headers=hdr(pm_lead))
    assert r.status_code == 200, r.text
    assert _projects(db, so["id"])[0].name == "CR tower car"

    # A spares-only order needs no project: not listed, refused with the reason, no PM notice.
    from app.tests.test_sales import payload_from_prefill, won_inquiry
    inq2 = won_inquiry(db, org, "INQ-SPARES-01")
    body = payload_from_prefill(client, hdr(maker), inq2)
    body["customer_po_number"] = "CR/PO/2026/999"
    body["lines"] = [{"line_number": 1, "line_type": "spares", "description": "Spare kit", "uom": "NOS",
                      "quantity": 4, "unit_price": 1000, "discount_percent": 0, "gst_rate": 18}]
    body["schedule"] = [{"line_number": 1, "quantity": 4, "contract_delivery_date": str(TODAY + timedelta(days=30))}]
    body["order_type"] = "accessories"
    r = client.post(f"{BASE}/orders", json=body, headers=hdr(maker))
    assert r.status_code == 200, r.text
    so2 = confirm(client, db, r.json(), maker, head, director)
    assert client.get(f"{PM}/awaiting-sales-orders", headers=hdr(pm_lead)).json() == []
    assert client.get(f"{BASE}/orders/{so2['id']}", headers=hdr(maker)).json()["display_status"] == "confirmed"
    r = client.post(f"{PM}/from-sales-order", json={"sales_order_id": so2["id"], "project_manager_id": pm_lead.id},
                    headers=hdr(pm_lead))
    assert r.status_code == 422 and "New Project" in r.json()["detail"]
    assert db.query(Notification).filter(Notification.notification_type == "sales_order_project_needed",
                                         Notification.entity_id == so2["id"]).count() == 0
