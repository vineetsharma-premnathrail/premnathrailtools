"""Product Management: product master, applications, specifications."""
from app.core.permission_words import place
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem

API = "/api/v1/products"


def _user(db, email, role="user", grants=None):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True)
    u.granular_permissions = list(grants or [])
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _auth(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _product(client, h, **over):
    body = {"code": "rrb-sv", "name": "RRB Sanding Vehicle", "product_type": "vehicle", "status": "development"}
    body.update(over)
    return client.post(API, json=body, headers=h)


def test_full_flow(client, db):
    admin = _auth(_user(db, "pm.admin@premnathrail.com", role="admin"))

    r = client.post(f"{API}/applications", json={"code": "ohe-insp", "name": "OHE inspection"}, headers=admin)
    assert r.status_code == 200, r.text
    app_id = r.json()["id"]
    assert r.json()["code"] == "OHE-INSP"
    dup = client.post(f"{API}/applications", json={"code": "OHE-INSP", "name": "x"}, headers=admin)
    assert dup.status_code == 409 and "already exists" in dup.json()["detail"]

    item = StoreItem(item_code="FG-0001", item_name="RRB Sanding Vehicle (FG)", status="active")
    db.add(item)
    db.commit()

    r = _product(client, admin, application_ids=[app_id], store_item_id=item.id, warranty_months=12,
                 specifications=[{"parameter": "Max speed on rail", "value": "40", "unit": "km/h"}, {"parameter": "", "value": ""}])
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["code"] == "RRB-SV" and p["uom"] == "Nos"
    assert [a["code"] for a in p["applications"]] == ["OHE-INSP"]
    assert len(p["specifications"]) == 1 and p["store_item_code"] == "FG-0001"

    assert _product(client, admin).status_code == 409
    clash = _product(client, admin, code="RRB-2", store_item_id=item.id)
    assert clash.status_code == 409 and "already linked" in clash.json()["detail"]
    bad = _product(client, admin, code="X1", product_type="boat")
    assert bad.status_code == 422

    listed = client.get(API, params={"application_id": app_id}, headers=admin).json()
    assert [x["code"] for x in listed] == ["RRB-SV"]
    apps = client.get(f"{API}/applications", headers=admin).json()
    assert apps[0]["product_count"] == 1

    r = client.patch(f"{API}/{p['id']}", json={"status": "active", "application_ids": [], "specifications": []}, headers=admin)
    assert r.status_code == 200 and r.json()["applications"] == [] and r.json()["specifications"] == []

    blocked = client.delete(f"{API}/{p['id']}", headers=admin)
    assert blocked.status_code == 409 and "Discontinued" in blocked.json()["detail"]
    client.patch(f"{API}/{p['id']}", json={"status": "development"}, headers=admin)
    assert client.delete(f"{API}/{p['id']}", headers=admin).status_code == 200
    assert client.get(f"{API}/{p['id']}", headers=admin).status_code == 404


def test_permissions(client, db):
    viewer = _auth(_user(db, "pm.viewer@premnathrail.com", grants=["products:products:view"]))
    outsider = _auth(_user(db, "pm.out@premnathrail.com"))
    assert client.get(API, headers=viewer).status_code == 200
    assert client.get(API, headers=outsider).status_code == 403
    r = _product(client, viewer)
    assert r.status_code == 403 and place("sales:products:create").split(" › ")[-1] in r.json()["detail"]
