"""Item Master unit-wise names (owner, 2026-11-07): Item Name is the name as on
the vendor's invoice; each unit / plant can keep its own internal name. The
names are saved per unit, returned with the unit's name, and found by search."""
import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.store.models.location import StoreLocation

API = "/api/v1/store/items"


@pytest.fixture
def env(db):
    user = User(email="unit.names@premnathrail.com", name="unit.names", role="user", is_active=True, assigned_apps=["store"])
    u1, u2 = Branch(name="Unit 1", code="U1"), Branch(name="Unit 2", code="U2")
    rdc = Branch(name="RDC", code="RDC")  # no store → no unit-wise name
    db.add_all([user, u1, u2, rdc])
    db.flush()
    db.add_all([StoreLocation(name="Unit 1 Store", code="S-U1", branch_id=u1.id),
                StoreLocation(name="Unit 2 Store", code="S-U2", branch_id=u2.id)])
    db.commit()
    h = {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}
    return {"h": h, "u1": u1.id, "u2": u2.id}


def create(client, env, **body):
    return client.post(API, json={"item_name": "MS ROUND BAR EN8 DIA 40", "uom": "NOS", "item_type": "material", **body}, headers=env["h"])


def test_units_list_for_the_form(client, env):
    # Only units that run a store (RDC has none, so it gets no name box).
    r = client.get(f"{API}/units", headers=env["h"])
    assert r.status_code == 200, r.text
    assert [u["name"] for u in r.json()] == ["Unit 1", "Unit 2"]


def test_names_saved_per_unit_blanks_dropped(client, env):
    r = create(client, env, unit_names=[{"branch_id": env["u1"], "name": "  Shaft blank  "}, {"branch_id": env["u2"], "name": " "}])
    assert r.status_code == 200, r.text
    assert r.json()["unit_names"] == [{"branch_id": env["u1"], "name": "Shaft blank", "unit": "Unit 1"}]


def test_edit_replaces_names_and_empty_clears(client, env):
    item = create(client, env).json()
    assert item["unit_names"] is None
    r = client.patch(f"{API}/{item['id']}", json={"unit_names": [{"branch_id": env["u2"], "name": "Axle rod"}]}, headers=env["h"])
    assert r.status_code == 200, r.text
    assert r.json()["unit_names"][0]["unit"] == "Unit 2"
    r = client.patch(f"{API}/{item['id']}", json={"unit_names": []}, headers=env["h"])
    assert r.json()["unit_names"] is None


def test_one_name_per_unit_and_unit_must_exist(client, env):
    two = create(client, env, unit_names=[{"branch_id": env["u1"], "name": "A"}, {"branch_id": env["u1"], "name": "B"}])
    assert two.status_code == 422 and "Unit 1 has two names" in two.json()["detail"]
    gone = create(client, env, unit_names=[{"branch_id": 99999, "name": "A"}])
    assert gone.status_code == 422 and "no longer exists" in gone.json()["detail"]


def test_search_finds_unit_name_with_other_words(client, env):
    create(client, env, unit_names=[{"branch_id": env["u1"], "name": "Shaft blank"}])
    create(client, env, item_name="Bearing 6205")
    hits = client.get(API, params={"search": "shaft en8"}, headers=env["h"]).json()
    assert [i["item_name"] for i in hits] == ["MS ROUND BAR EN8 DIA 40"]


def test_export_then_import_round_trip_keeps_unit_names(client, env):
    """The Excel export can be imported back as is: its titles ("Item Name",
    "Name at Unit 1" …) are read like the template's names, new rows save their
    unit-wise names, and an existing item gets the names filled in the file."""
    import io
    from openpyxl import Workbook, load_workbook
    existing = create(client, env).json()
    x = client.get(f"{API}/export", headers=env["h"])
    assert x.status_code == 200, x.text
    rows = list(load_workbook(io.BytesIO(x.content)).active.iter_rows(values_only=True))
    assert list(rows[0]) == ["item_type", "category", "subcategory", "item_name", "Name at Unit 1", "Name at Unit 2",
                             "uom", "technical_specification", "lead_time_days", "legacy_code", "part_code",
                             "hsn_sac_code", "gst_rate", "preferred_vendor", "standard_cost", "min_order_qty", "reorder_level"]
    wb = Workbook()
    ws = wb.active
    ws.append(rows[0])
    row = list(rows[1])
    row[4] = "Shaft blank"
    ws.append(row)
    new = list(rows[1])
    new[3], new[5] = "MS ROUND BAR EN8 DIA 50", "Axle rod 50"
    ws.append(new)
    buf = io.BytesIO()
    wb.save(buf)
    r = client.post(f"{API}/import", files={"file": ("items.xlsx", buf.getvalue())}, headers=env["h"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert [c["item_name"] for c in body["created"]] == ["MS ROUND BAR EN8 DIA 50"]
    assert body["existing"][0]["reason"] == "Already exists — unit-wise names updated"
    got = client.get(f"{API}/{existing['id']}", headers=env["h"]).json()["unit_names"]
    assert got == [{"branch_id": env["u1"], "name": "Shaft blank", "unit": "Unit 1"}]
