"""Role-wise UI visibility in Store (core/visibility.py, catalogue in
core/features/store.py): Item Master, plant data, Material Issues, GRN and
Stock Adjustments. Coded dropdown values (item type, issue type, MRP type /
make-or-buy) are enforced by the server; the option endpoints list every
value with `allowed` so the form can filter and still show a saved record's
value."""
from datetime import date

import pytest

from app.auth.jwt_handler import create_access_token
from app.core import visibility
from app.core.permission_registry import MODULES
from app.core.visibility import VISIBILITY, clean_rules
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.store.models.doc_type import STORE_DOC_TYPE_DEFAULTS
from app.modules.store.models.item import STORE_ITEM_TYPE_LABELS, StoreItem
from app.modules.store.models.item_plant import STORE_MRP_TYPES, STORE_PROCUREMENT_TYPES
from app.modules.store.models.location import StoreLocation
from app.tests._stock_seed import seed_opening_stock

ITEMS_KEY = "store:items"
PLANT_KEY = "store:items.plant_data"
ISSUES_KEY = "store:issues"
STORE_GRANTS = ["store:items:view", "store:items:create", "store:items:edit", "store:items.plant_data:view",
                "store:items.plant_data:edit", "store:issues:view", "store:issues:create"]
ITEMS = "/api/v1/store/items"
ISSUES = "/api/v1/store/material-issues"


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _user(db, email, **kw):
    u = User(email=email, name=email.split("@")[0].title(), role="user", is_active=True, assigned_apps=["store"],
             granular_permissions=[], **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _role(db, name, rules=None, permissions=tuple(STORE_GRANTS)):
    r = Role(name=name, permissions=list(permissions), visibility_rules=rules or {})
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def _give(db, user, *roles):
    user.roles = list(roles)
    db.commit()
    db.refresh(user)
    user.__dict__.pop("_visibility_effective_cache", None)


@pytest.fixture
def keeper(db):
    """A store keeper whose role allows only Consumable items, General / Office
    issues and reorder-point planning."""
    u = _user(db, "vis.keeper@premnathrail.com")
    _give(db, u, _role(db, "Consumables keeper", {
        ITEMS_KEY: {"options": {"item_type": ["consumable"]}, "hidden_sections": ["photo"]},
        PLANT_KEY: {"options": {"mrp_type": ["reorder_point"]}},
        ISSUES_KEY: {"options": {"issue_type": ["general"]}},
    }))
    return u


@pytest.fixture
def open_keeper(db):
    """A store keeper whose role sets no visibility rule at all."""
    u = _user(db, "vis.open@premnathrail.com")
    _give(db, u, _role(db, "Open keeper"))
    return u


def _item_payload(**over):
    return {"item_name": "Hand gloves", "uom": "PAIR", "item_type": "consumable", **over}


# ---------- catalogue ----------

def test_store_catalogue_keys_resolve_to_tabs_or_features():
    for key in (ITEMS_KEY, PLANT_KEY, ISSUES_KEY, "store:grn", "store:adjustments"):
        assert key in VISIBILITY, key
        module, tabfeat = key.split(":", 1)
        tab, _, feature = tabfeat.partition(".")
        assert tab in MODULES[module]["actions"], key
        if feature:
            assert feature in MODULES[module]["features"][tab], key


def test_store_catalogue_matches_the_coded_values():
    cat = visibility.catalog()
    assert cat[ITEMS_KEY]["options"]["item_type"]["values"] == STORE_ITEM_TYPE_LABELS
    assert cat[ISSUES_KEY]["options"]["issue_type"]["values"] == {d["value"]: d["label"] for d in STORE_DOC_TYPE_DEFAULTS["issue"]}
    assert list(cat[PLANT_KEY]["options"]["mrp_type"]["values"]) == list(STORE_MRP_TYPES)
    assert cat[PLANT_KEY]["options"]["procurement_type"]["values"] == STORE_PROCUREMENT_TYPES
    # required-holding sections are locked, optional ones are not
    assert cat[ITEMS_KEY]["sections"]["item_details"]["locked"] and not cat[ITEMS_KEY]["sections"]["photo"]["locked"]
    assert cat[ISSUES_KEY]["sections"]["issue_details"]["locked"] and cat[ISSUES_KEY]["sections"]["items"]["locked"]
    assert not cat[ISSUES_KEY]["sections"]["remarks"]["locked"]
    assert cat["store:grn"]["sections"]["receipt"]["locked"] and cat["store:grn"]["sections"]["line_items"]["locked"]
    assert cat["store:adjustments"]["sections"]["adjustment_details"]["locked"] and cat["store:adjustments"]["sections"]["items"]["locked"]
    # GRN and Adjustments have no coded dropdown (reason is free text, GRN picks DB records only)
    assert cat["store:grn"]["options"] == {} and cat["store:adjustments"]["options"] == {}


def test_store_catalogue_is_grouped_per_screen():
    """Spec v2: every Store item names the screen it sits on (form / item page / list)."""
    cat = visibility.catalog()
    assert cat[ITEMS_KEY]["screens"] == {"form": "Add / Edit Item form", "detail": "Item page", "list": "Item Master list"}
    assert set(cat[ISSUES_KEY]["screens"]) == {"form", "list"}
    assert set(cat["store:grn"]["screens"]) == {"form", "list"}
    assert set(cat["store:adjustments"]["screens"]) == {"form", "list"}
    assert set(cat[PLANT_KEY]["screens"]) == {"main"}
    for key in (ITEMS_KEY, PLANT_KEY, ISSUES_KEY, "store:grn", "store:adjustments"):
        entry = cat[key]
        for group in ("sections", "options", "tables"):
            for name, item in entry[group].items():
                assert item["screen"] in entry["screens"], (key, group, name)
                # item-page keys carry the detail_ prefix, nothing else does
                assert name.startswith("detail_") == (item["screen"] == "detail"), (key, group, name)
    items = cat[ITEMS_KEY]
    assert items["options"]["item_type"]["screen"] == "form" and items["tables"]["items"]["screen"] == "list"
    detail = {k for k, v in items["sections"].items() if v["screen"] == "detail"}
    assert {"detail_summary", "detail_plant_data", "detail_vendors", "detail_photo", "detail_purchasing"} <= detail
    assert items["sections"]["detail_summary"]["locked"]
    assert not any(items["sections"][k]["locked"] for k in detail - {"detail_summary"})
    assert cat[ISSUES_KEY]["tables"]["issues"]["screen"] == "list" and cat[ISSUES_KEY]["tables"]["form_items"]["screen"] == "form"
    assert cat["store:grn"]["tables"]["receipts"]["screen"] == "list" and cat["store:grn"]["tables"]["form_lines"]["screen"] == "form"
    # a role may hide item-page blocks, but never the summary
    assert clean_rules({ITEMS_KEY: {"hidden_sections": ["detail_vendors", "detail_photo"]}}) == {
        ITEMS_KEY: {"hidden_sections": ["detail_photo", "detail_vendors"]}}
    with pytest.raises(ValueError):
        clean_rules({ITEMS_KEY: {"hidden_sections": ["detail_summary"]}})


def test_store_tables_never_offer_code_status_or_money_columns():
    """The record's own code / number, its status and money never appear as hideable
    columns (a linked document's number, e.g. the PO on a GRN, is a plain reference)."""
    banned = {"code", "number", "status", "value", "rate", "cost", "amount", "price"}
    for key in (ITEMS_KEY, ISSUES_KEY, "store:grn", "store:adjustments"):
        for table, spec in VISIBILITY[key]["tables"].items():
            for col in spec["columns"]:
                assert not (set(col.lower().split("_")) & banned), (key, table, col)


def test_clean_rules_accepts_store_rules_and_refuses_locked_sections():
    out = clean_rules({ITEMS_KEY: {"options": {"item_type": ["consumable", "material"]}, "hidden_columns": {"items": ["uom"]}},
                       ISSUES_KEY: {"hidden_sections": ["notes"], "options": {"issue_type": ["general"]}}})
    assert out == {ITEMS_KEY: {"options": {"item_type": ["consumable", "material"]}, "hidden_columns": {"items": ["uom"]}},
                   ISSUES_KEY: {"hidden_sections": ["notes"], "options": {"issue_type": ["general"]}}}
    with pytest.raises(ValueError) as e:
        clean_rules({ISSUES_KEY: {"hidden_sections": ["items"]}})
    assert str(e.value) == "'Items' holds a required field, so it can't be hidden. Leave it visible."


# ---------- Item Master ----------

def test_item_create_refuses_a_type_outside_the_role_with_the_real_reason(client, db, keeper):
    r = client.post(ITEMS, json=_item_payload(item_type="material"), headers=_h(keeper))
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == (
        "Item Type 'Material' isn't available to your role — you can pick: Consumable. Ask an admin to widen it in "
        "Organization › Role & Permissions › Store › Item Master › Visibility.")
    # leaving the type out is not a way round the restriction
    r = client.post(ITEMS, json={"item_name": "Hand gloves", "uom": "PAIR"}, headers=_h(keeper))
    assert r.status_code == 422, r.text
    assert "Item Type" in r.json()["detail"] and "Consumable" in r.json()["detail"]


def test_item_create_passes_for_an_allowed_type_and_for_an_unrestricted_role(client, db, keeper, open_keeper):
    r = client.post(ITEMS, json=_item_payload(), headers=_h(keeper))
    assert r.status_code == 200, r.text
    assert r.json()["item_type"] == "consumable"
    r = client.post(ITEMS, json=_item_payload(item_name="Steel plate", item_type="material", uom="KG"), headers=_h(open_keeper))
    assert r.status_code == 200, r.text


def test_item_update_checks_only_a_changed_type(client, db, keeper):
    item = StoreItem(item_code="MT-VIS-1", item_name="Old plate", uom="KG", item_type="material")
    db.add(item)
    db.commit()
    # renaming an item that already holds a type outside the role is fine ...
    r = client.patch(f"{ITEMS}/{item.id}", json={"item_name": "Old plate 12mm"}, headers=_h(keeper))
    assert r.status_code == 200, r.text
    # ... sending the same type back unchanged too ...
    r = client.patch(f"{ITEMS}/{item.id}", json={"item_type": "material"}, headers=_h(keeper))
    assert r.status_code == 200, r.text
    # ... but changing it to another disallowed type is refused
    r = client.patch(f"{ITEMS}/{item.id}", json={"item_type": "asset"}, headers=_h(keeper))
    assert r.status_code == 422, r.text
    assert "Item Type 'Asset' isn't available to your role" in r.json()["detail"]
    r = client.patch(f"{ITEMS}/{item.id}", json={"item_type": "consumable"}, headers=_h(keeper))
    assert r.status_code == 200, r.text


def test_item_import_is_refused_for_a_role_that_limits_the_item_type(client, db):
    """The Excel import is not checked line by line, so a role with an Item Type list cannot use it."""
    csv = "item_name,uom,item_type" + chr(10) + "Hand gloves,PAIR,consumable" + chr(10)
    grants = tuple(STORE_GRANTS) + ("store:items:import",)
    limited = _user(db, "vis.import.limited@premnathrail.com")
    _give(db, limited, _role(db, "Consumables importer", {ITEMS_KEY: {"options": {"item_type": ["consumable"]}}}, permissions=grants))
    r = client.post(f"{ITEMS}/import", files={"file": ("items.csv", csv, "text/csv")}, headers=_h(limited))
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == (
        "Your role limits the Item Type of new items, and the Excel import is not checked line by line — add them from Add Item, "
        "or ask an admin to widen Item Type for your role (Organization › Role & Permissions › Store › Item Master › Visibility).")
    assert db.query(StoreItem).filter(StoreItem.item_name == "Hand gloves").count() == 0
    # A role without an Item Type rule imports as before.
    free = _user(db, "vis.import.free@premnathrail.com")
    _give(db, free, _role(db, "Free importer", {}, permissions=grants))
    r = client.post(f"{ITEMS}/import", files={"file": ("items.csv", csv, "text/csv")}, headers=_h(free))
    assert r.status_code == 200, r.text
    assert len(r.json()["created"]) == 1


def test_item_meta_and_item_types_list_every_type_with_allowed(client, db, keeper, open_keeper):
    for url, pick in ((f"{ITEMS}/meta", lambda j: j["item_types"]), ("/api/v1/store/item-types", lambda j: j)):
        r = client.get(url, headers=_h(keeper))
        assert r.status_code == 200, r.text
        rows = pick(r.json())
        assert {t["value"] for t in rows} >= set(STORE_ITEM_TYPE_LABELS)  # the list is not filtered
        assert {t["value"] for t in rows if t["allowed"]} == {"consumable"}
        # unrestricted users get the plain rows (other modules' pickers compare them as-is)
        rows = pick(client.get(url, headers=_h(open_keeper)).json())
        assert rows and all("allowed" not in t for t in rows)


# ---------- plant data ----------

def test_plant_data_refuses_a_disallowed_mrp_type_and_flags_allowed(client, db, keeper):
    branch = Branch(name="Plant VIS", code="VIS")
    item = StoreItem(item_code="CN-VIS-1", item_name="Gloves", uom="PAIR", item_type="consumable")
    db.add_all([branch, item])
    db.commit()
    r = client.get(f"{ITEMS}/{item.id}/plants", headers=_h(keeper))
    assert r.status_code == 200, r.text
    meta = r.json()["meta"]
    assert {m["value"] for m in meta["mrp_types"] if m["allowed"]} == {"reorder_point"}
    assert all(m["allowed"] for m in meta["procurement_types"])
    row = {"branch_id": branch.id, "mrp_type": "mrp", "procurement_type": "buy"}
    r = client.put(f"{ITEMS}/{item.id}/plants", json={"plants": [row]}, headers=_h(keeper))
    assert r.status_code == 422, r.text
    assert r.json()["detail"].startswith("MRP type 'MRP (PD)' isn't available to your role — you can pick: Reorder point (VB).")
    r = client.put(f"{ITEMS}/{item.id}/plants", json={"plants": [{**row, "mrp_type": "reorder_point"}]}, headers=_h(keeper))
    assert r.status_code == 200, r.text
    assert r.json()["plants"][0]["mrp_type"] == "reorder_point"


# ---------- Material Issues ----------

@pytest.fixture
def issue_env(db, keeper):
    manager = _user(db, "vis.manager@premnathrail.com")
    dept = Department(name="Office", code="OFF-VIS")
    loc = StoreLocation(name="VIS Store", code="VIS", manager_user_id=manager.id)
    item = StoreItem(item_code="CN-VIS-2", item_name="Marker pen", uom="NOS", item_type="consumable")
    db.add_all([dept, loc, item])
    db.commit()
    seed_opening_stock(db, item.id, loc.id, 100, created_by_id=manager.id)
    return {"dept": dept, "loc": loc, "item": item}


def _issue(client, user, env, **body):
    return client.post(ISSUES, json={"location_id": env["loc"].id, "items": [{"item_id": env["item"].id, "quantity": 1}],
                                     "issue_date": date.today().isoformat(), **body}, headers=_h(user))


def test_issue_create_refuses_a_type_outside_the_role(client, db, keeper, issue_env):
    r = _issue(client, keeper, issue_env, issue_type="production")
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == (
        "Issue Type 'Production' isn't available to your role — you can pick: General / Office. Ask an admin to widen it in "
        "Organization › Role & Permissions › Store › Issues › Visibility.")
    # no type at all is refused too (a PR-raised issue has none, but a restricted role must say)
    r = _issue(client, keeper, issue_env)
    assert r.status_code == 422, r.text
    assert "Issue Type" in r.json()["detail"] and "General / Office" in r.json()["detail"]


def test_issue_create_passes_for_an_allowed_type(client, db, keeper, issue_env):
    r = _issue(client, keeper, issue_env, issue_type="general", department_id=issue_env["dept"].id)
    assert r.status_code == 200, r.text
    assert r.json()["issue_type"] == "general"


def test_issue_types_list_carries_allowed_without_filtering(client, db, keeper, open_keeper):
    rows = client.get("/api/v1/store/doc-types/issue", headers=_h(keeper)).json()
    assert {t["value"] for t in rows} == {d["value"] for d in STORE_DOC_TYPE_DEFAULTS["issue"]}
    assert {t["value"] for t in rows if t["allowed"]} == {"general"}
    assert all(t["allowed"] for t in client.get("/api/v1/store/doc-types/issue", headers=_h(open_keeper)).json())
    # other kinds are untouched by the rule
    assert all("allowed" not in t for t in client.get("/api/v1/store/doc-types/return_source", headers=_h(keeper)).json())


def test_admin_is_never_restricted(client, db):
    admin = _user(db, "vis.admin@premnathrail.com")
    admin.role = "admin"
    db.commit()
    _give(db, admin, _role(db, "Restricted admin role", {ITEMS_KEY: {"options": {"item_type": ["consumable"]}}}))
    r = client.post(ITEMS, json=_item_payload(item_name="Lathe", item_type="asset", uom="NOS"), headers=_h(admin))
    assert r.status_code == 200, r.text
    assert all("allowed" not in t for t in client.get(f"{ITEMS}/meta", headers=_h(admin)).json()["item_types"])
