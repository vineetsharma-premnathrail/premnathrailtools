"""Product Management data scope: the product list and product pages follow
the user's Products data scope (Organization › Role & Permissions)."""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.products.models.product import FinishedProduct

BASE = "/api/v1/products"


def _hdr(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _user(db, email, level=None, role="user"):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True)
    db.add(u)
    db.commit()
    if level:
        r = Role(name=f"Products – {level} ({email})", permissions=["products:*:*"], data_scopes={"sales": level})
        db.add(r)
        db.commit()
        u.roles = [r]
        db.commit()
    db.refresh(u)
    return u


def test_products_own_scope(client, db):
    owner = _user(db, "ps.owner@premnathrail.com", "own")
    other = _user(db, "ps.other@premnathrail.com", "own")
    admin = _user(db, "ps.admin@premnathrail.com", role="admin")
    for code, u in (("PS-1", owner), ("PS-2", other)):
        db.add(FinishedProduct(code=code, name=f"Product {code}", product_type="machine", created_by_id=u.id))
    db.commit()
    mine = db.query(FinishedProduct).filter_by(code="PS-1").one()
    theirs = db.query(FinishedProduct).filter_by(code="PS-2").one()

    assert [p["code"] for p in client.get(BASE, headers=_hdr(owner)).json()] == ["PS-1"]
    assert client.get(f"{BASE}/{mine.id}", headers=_hdr(owner)).status_code == 200
    r = client.get(f"{BASE}/{theirs.id}", headers=_hdr(owner))
    assert r.status_code == 403 and "Own records" in r.json()["detail"]
    assert client.patch(f"{BASE}/{theirs.id}", json={"name": "Hijack"}, headers=_hdr(owner)).status_code == 403
    assert client.delete(f"{BASE}/{theirs.id}", headers=_hdr(owner)).status_code == 403

    # Admins (and roles left at the default "Entire organization") see everything.
    assert {p["code"] for p in client.get(BASE, headers=_hdr(admin)).json()} == {"PS-1", "PS-2"}
