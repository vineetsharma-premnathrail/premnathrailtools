"""Deleting a vendor (Procurement and Accounts): allowed only while no document
uses it; otherwise a real message names where it is used."""
from app.auth.jwt_handler import create_access_token
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_catalog_item import VendorCatalogItem
from app.modules.main.models.user import User
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder

PROC = "/api/v1/p2p/vendors"
FIN = "/api/v1/accounts/vendors"
GRANTS = ["p2p:vendors:view", "p2p:vendors:create", "p2p:vendors:edit", "p2p:vendors:delete",
          "accounts:vendors:view", "accounts:vendors:delete"]


def _user(db, email, grants=GRANTS):
    u = User(email=email, name=email.split("@")[0].title(), role="user", is_active=True, granular_permissions=grants)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _vendor(client, u, name):
    r = client.post(PROC, headers=_h(u), json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_unused_vendor_is_deleted_with_its_catalog(client, db):
    u = _user(db, "buyer@premnathrail.com")
    vid = _vendor(client, u, "Mistake Traders")
    db.add(VendorCatalogItem(vendor_id=vid, item_name="Bolt"))
    db.commit()
    r = client.delete(f"{PROC}/{vid}", headers=_h(u))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Vendor, vid) is None


def test_vendor_on_a_po_is_kept_with_a_real_reason(client, db):
    u = _user(db, "buyer2@premnathrail.com")
    vid = _vendor(client, u, "Used Steel")
    po = P2PPurchaseOrder.__table__
    db.execute(po.insert().values(**{c.name: _fill(c, vid) for c in po.columns if _needs(c)}))
    db.commit()
    for base in (PROC, FIN):
        r = client.delete(f"{base}/{vid}", headers=_h(u))
        assert r.status_code == 409, r.text
        assert "purchase order" in r.json()["detail"] and "Inactive or Blocked" in r.json()["detail"]
    assert db.get(Vendor, vid) is not None


def test_delete_needs_delete_permission(client, db):
    maker = _user(db, "maker@premnathrail.com")
    vid = _vendor(client, maker, "Nope Ltd")
    viewer = _user(db, "viewer@premnathrail.com", grants=["p2p:vendors:view", "p2p:vendors:edit"])
    assert client.delete(f"{PROC}/{vid}", headers=_h(viewer)).status_code == 403


def _needs(col):
    return col.name == "vendor_id" or (not col.nullable and col.default is None and col.server_default is None
                                       and not col.primary_key)


def _fill(col, vid):
    if col.name == "vendor_id":
        return vid
    from datetime import date, datetime
    py = col.type.python_type
    if py is int:
        return 1
    if py is float:
        return 0.0
    if py is bool:
        return False
    if py is datetime:
        return datetime(2026, 1, 1)
    if py is date:
        return date(2026, 1, 1)
    return f"T-{col.name}"[: getattr(col.type, "length", None) or 50]
