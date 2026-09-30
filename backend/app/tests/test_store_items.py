"""Store item master: auto item codes (<TYPE>-<CATEGORY>-<NNNN>), the fixed
UOM list, and the meta/preview endpoints the Add Item form uses."""
import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.store.models.category import StoreItemCategory

API = "/api/v1/store/items"


@pytest.fixture
def h(db):
    user = User(email="store.keeper@premnathrail.com", name="store.keeper", role="user", is_active=True, assigned_apps=["store"])
    db.add(user)
    db.add_all([StoreItemCategory(name="Hydraulics", code="HYD"), StoreItemCategory(name="Bearings", code="BRG")])
    db.commit()
    db.refresh(user)
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def create(client, h, **body):
    return client.post(API, json={"item_name": "Item", "uom": "NOS", "item_type": "raw_material", **body}, headers=h)


def test_codes_are_generated_per_type_and_category(client, h):
    first = create(client, h, item_name="Hydraulic cylinder 80 bore", category="Hydraulics")
    assert first.status_code == 200, first.text
    assert first.json()["item_code"] == "RM-HYD-0001"
    assert create(client, h, item_name="Hose 1/2in", category="Hydraulics").json()["item_code"] == "RM-HYD-0002"
    assert create(client, h, item_name="Bearing 6205", category="Bearings", item_type="spare_part").json()["item_code"] == "SP-BRG-0001"
    assert create(client, h, item_name="Misc part").json()["item_code"] == "RM-GEN-0001"


def test_preview_matches_the_next_saved_code(client, h):
    create(client, h, category="Hydraulics")
    preview = client.get(f"{API}/next-code", params={"item_type": "raw_material", "category": "Hydraulics"}, headers=h).json()
    assert preview["item_code"] == "RM-HYD-0002"
    assert create(client, h, category="Hydraulics").json()["item_code"] == preview["item_code"]


def test_manual_code_still_accepted_but_must_be_unique(client, h):
    assert create(client, h, item_code="legacy-001").json()["item_code"] == "LEGACY-001"
    dup = create(client, h, item_code="LEGACY-001")
    assert dup.status_code == 409 and "leave the code blank" in dup.json()["detail"]


def test_uom_is_required_and_must_come_from_the_list(client, h):
    missing = client.post(API, json={"item_name": "No unit"}, headers=h)
    assert missing.status_code == 400 and "unit of measure" in missing.json()["detail"]
    bad = create(client, h, uom="Nos.")
    assert bad.status_code == 400 and "UOM dropdown" in bad.json()["detail"]
    ok = create(client, h, uom="kg")
    assert ok.status_code == 200 and ok.json()["uom"] == "KG"

    item_id = ok.json()["id"]
    assert client.patch(f"{API}/{item_id}", json={"uom": "furlong"}, headers=h).status_code == 400
    assert client.patch(f"{API}/{item_id}", json={"uom": ""}, headers=h).status_code == 400
    assert client.patch(f"{API}/{item_id}", json={"uom": "mtr"}, headers=h).json()["uom"] == "MTR"


def test_invalid_item_type_is_refused(client, h):
    r = create(client, h, item_type="gadget")
    assert r.status_code == 400 and "valid item type" in r.json()["detail"]


def test_meta_lists_types_with_prefixes_and_uoms(client, h):
    meta = client.get(f"{API}/meta", headers=h).json()
    assert {"value": "raw_material", "label": "Raw Material", "prefix": "RM"} in meta["item_types"]
    assert any(u["value"] == "NOS" for u in meta["uoms"])
