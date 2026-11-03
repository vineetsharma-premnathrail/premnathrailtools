"""Item Master import builds the masters it needs (2026-11-02): a unit,
category or subcategory that is not in Store settings yet is created from the
file instead of failing the row, and reported back in the result."""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.store.models.category import StoreItemCategory
from app.modules.store.models.item import StoreItem, StoreUom

API = "/api/v1/store/items"


def _h(db):
    user = User(email="store.importer@premnathrail.com", name="store.importer", role="user", is_active=True, assigned_apps=["store"])
    db.add(user)
    db.commit()
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def _upload(client, h, csv):
    return client.post(f"{API}/import", files={"file": ("items.csv", csv, "text/csv")}, headers=h)


def test_import_creates_missing_unit_category_and_subcategory(client, db):
    h = _h(db)
    csv = ("item_type,category,subcategory,item_name,uom,technical_specification\n"
           "Material,Hydraulics,Cylinders,Cylinder 80 bore,PKT10,80 x 400\n"
           "Material,Hydraulics,Cylinders,Cylinder 100 bore,pkt10,100 x 400\n"
           "Material,Hydraulics,,Hose 1/2 inch,MTR,\n")
    r = _upload(client, h, csv)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["errors"] == [] and len(body["created"]) == 3
    assert body["new_units"] == ["PKT10"]
    assert body["new_categories"] == [
        {"category": "Hydraulics", "subcategory": None, "item_type": "Material"},
        {"category": "Hydraulics", "subcategory": "Cylinders", "item_type": "Material"},
    ]
    assert db.query(StoreUom).filter(StoreUom.code == "PKT10").count() == 1
    cats = db.query(StoreItemCategory).all()
    top = [c for c in cats if c.parent_id is None]
    assert [c.name for c in top] == ["Hydraulics"] and top[0].item_type == "material" and len(top[0].code) == 3
    sub = [c for c in cats if c.parent_id == top[0].id]
    assert [c.name for c in sub] == ["Cylinders"]
    items = db.query(StoreItem).order_by(StoreItem.item_code).all()
    assert [(i.category, i.subcategory, i.uom) for i in items] == [
        ("Hydraulics", "Cylinders", "PKT10"), ("Hydraulics", "Cylinders", "PKT10"), ("Hydraulics", None, "MTR")]


def test_import_reuses_existing_category_of_any_type(client, db):
    h = _h(db)
    db.add(StoreItemCategory(name="Consumables", code="CON", item_type=None))
    db.commit()
    r = _upload(client, h, "item_type,category,subcategory,item_name,uom\nMaterial,consumables,,Grease tube,NOS\n")
    assert r.status_code == 200 and r.json()["errors"] == [], r.text
    assert r.json()["new_categories"] == [] and r.json()["new_units"] == []
    assert db.query(StoreItemCategory).count() == 1
    assert db.query(StoreItem).one().category == "Consumables"


def test_import_refuses_overlong_unit(client, db):
    h = _h(db)
    r = _upload(client, h, "item_type,category,subcategory,item_name,uom\nMaterial,,,Odd item,THISUNITCODEISWAYTOOLONGTOFIT\n")
    assert r.status_code == 200
    assert r.json()["created"] == [] and "too long" in r.json()["errors"][0]["reason"]
    assert db.query(StoreUom).filter(StoreUom.code.like("THISUNIT%")).count() == 0
