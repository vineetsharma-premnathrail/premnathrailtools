"""Product master access (CRM › Products, one tab `crm:products`; moved from Sales 2026-10-30).

The master is tab-gated, not owner-scoped (owner decision): everyone who may open the
tab sees every product, like the vendor master. What is gated is the tab view, the
create / edit / delete actions and — separately — the Pricing feature."""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.products.models.product import FinishedProduct

BASE = "/api/v1/products"


def _hdr(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _user(db, email, grants=None, role="user"):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, granular_permissions=list(grants or []))
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _products(db, creator):
    for code in ("PS-1", "PS-2"):
        db.add(FinishedProduct(code=code, name=f"Product {code}", product_type="machine", created_by_id=creator.id))
    db.commit()
    return {p.code: p for p in db.query(FinishedProduct).all()}


def test_products_are_tab_gated_not_owner_scoped(client, db):
    owner = _user(db, "ps.owner@premnathrail.com", ["crm:products:view"])
    viewer = _user(db, "ps.viewer@premnathrail.com", ["crm:products:view"])
    prods = _products(db, owner)

    # A viewer sees every product, including ones somebody else created.
    assert {p["code"] for p in client.get(BASE, headers=_hdr(viewer)).json()} == {"PS-1", "PS-2"}
    assert client.get(f"{BASE}/{prods['PS-1'].id}", headers=_hdr(viewer)).status_code == 200


def test_no_products_tab_means_no_access(client, db):
    other = _user(db, "ps.other@premnathrail.com", ["crm:organizations:view"])  # a CRM user without the Products tab
    nobody = _user(db, "ps.nobody@premnathrail.com")
    prods = _products(db, other)
    for u in (other, nobody):
        for method, url, body in (("get", BASE, None), ("get", f"{BASE}/{prods['PS-1'].id}", None),
                                  ("get", f"{BASE}/applications", None)):
            r = getattr(client, method)(url, headers=_hdr(u))
            assert r.status_code == 403, (u.email, url, r.text)
    r = client.get(BASE, headers=_hdr(other))
    assert "Products" in r.json()["detail"]  # the message names the tab to ask for


def test_create_edit_delete_need_their_own_action(client, db):
    viewer = _user(db, "ps.v2@premnathrail.com", ["crm:products:view"])
    editor = _user(db, "ps.editor@premnathrail.com", ["crm:products:view", "crm:products:create", "crm:products:edit", "crm:products:delete"])
    admin = _user(db, "ps.admin@premnathrail.com", role="admin")
    prods = _products(db, admin)
    body = {"code": "PS-9", "name": "Nine", "product_type": "machine"}
    assert client.post(BASE, json=body, headers=_hdr(viewer)).status_code == 403
    assert client.patch(f"{BASE}/{prods['PS-1'].id}", json={"name": "Hijack"}, headers=_hdr(viewer)).status_code == 403
    assert client.post(f"{BASE}/applications", json={"code": "APP-1", "name": "App one"}, headers=_hdr(viewer)).status_code == 403
    assert client.post(BASE, json=body, headers=_hdr(editor)).status_code == 200
    assert client.patch(f"{BASE}/{prods['PS-1'].id}", json={"name": "Renamed"}, headers=_hdr(editor)).status_code == 200
    # Company delete rule: 'Delete' on the tab AND only what you created yourself (admins excepted).
    r = client.delete(f"{BASE}/{prods['PS-2'].id}", headers=_hdr(editor))
    assert r.status_code == 403 and "created yourself" in r.json()["detail"]
    assert client.delete(f"{BASE}/{prods['PS-2'].id}", headers=_hdr(admin)).status_code in (200, 409)


def test_pricing_writes_need_the_pricing_feature(client, db):
    # One feature ticked = a customised role: it no longer inherits Pricing from the tab's create / edit.
    editor = _user(db, "ps.pe@premnathrail.com", ["crm:products:view", "crm:products:create", "crm:products:edit",
                                                   "crm:products.specifications:view"])
    pricer = _user(db, "ps.pricer@premnathrail.com", ["crm:products:view", "crm:products.pricing:view", "crm:products.pricing:create"])
    prods = _products(db, editor)
    body = {"condition_type": "price", "item_kind": "product", "product_id": prods["PS-1"].id, "amount": 1000, "valid_from": "2026-01-01"}
    r = client.post(f"{BASE}/price-conditions", json=body, headers=_hdr(editor))
    assert r.status_code == 403 and "Pricing" in r.json()["detail"]
    assert client.post(f"{BASE}/price-conditions", json=body, headers=_hdr(pricer)).status_code == 201
