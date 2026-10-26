"""Editable purchase requisition purpose rules (Procurement > Settings >
Purpose rules, p2p/purpose.py resolve_purpose_rules + routes/purpose_rules.py):
defaults unchanged, an override is applied by /meta and by the server
validators, a bad override is refused with the fix, locks follow single
options, and requisitions with no purpose are never re-judged."""
from app.modules.p2p import purpose as pp
from app.modules.p2p.models.p2p_request import P2P_PURPOSES
from app.tests.test_p2p_requests import make_user
from app.tests.p2p_workflow_helpers import master_item
from app.tests.test_p2p_pr_purpose import _post
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    BASE, _create_payload, _requester, _sqlite_number_series, auth_header,
)

RULES = "/api/v1/p2p/purpose-rules"


def _admin(db):
    return make_user(db, "rules.admin@premnathrail.com", role="admin")


def _meta(client, user):
    return {p["code"]: p for p in client.get(f"{BASE}/meta", headers=auth_header(user)).json()["purposes"]}


def _put(client, admin, purpose, **changes):
    rules = {**pp.default_rules(purpose), **changes}
    return client.put(f"{RULES}/{purpose}", json={"rules": rules}, headers=auth_header(admin))


def test_defaults_reproduce_the_code_dicts(client, db):
    resolved = pp.resolve_purpose_rules(db)
    for code in P2P_PURPOSES:
        r = resolved[code]
        assert r["categories"] == list(pp.PURPOSE_FORM[code]["categories"])
        assert r["item_types"] == list(pp.PURPOSE_ITEM_TYPES[code])
        assert r["allowed_charges"] == tuple(pp._ALLOWED[code]) or set(r["allowed_charges"]) == set(pp._ALLOWED[code])
        assert r["category"] == pp.PURPOSE_FORM[code]["category"]
        assert r["requirement_type"] == pp.PURPOSE_FORM[code]["requirement_type"]
        assert r["category_locked"] is False and r["requirement_type_locked"] is False
        assert r["inhouse_only"] == (code in pp.INHOUSE_ONLY)
    # One project per machine: no per-line vehicle / Project-or-Inhouse choice.
    assert {c: resolved[c]["line_project_mode"] for c in resolved} == {
        "customer_order": "inherit", "machine_project": "inherit", "development": "inhouse",
        "department": "inhouse", "capital": "inhouse", "stock": "inhouse"}
    user = _requester(db, "rules.req0@premnathrail.com")
    meta = _meta(client, user)
    assert meta["department"]["default_category"] == "ADM" and meta["department"]["category_locked"] is False
    assert meta["customer_order"]["charged_to_kinds"] == ["work_order", "internal_order", "sales_order", "order_project"] and meta["customer_order"]["charged_required"] is False


def test_override_is_applied_to_meta_and_locks_single_options(client, db):
    admin = _admin(db)
    r = _put(client, admin, "department", categories=["ADM"], default_category="ADM", requirement_types=["Material"],
             default_requirement_type="Material")
    assert r.status_code == 200, r.text
    d = next(p for p in r.json()["purposes"] if p["code"] == "department")
    assert d["is_default"] is False and d["form"]["category"] == "ADM" and d["form"]["category_locked"] is True
    meta = _meta(client, _requester(db, "rules.req1@premnathrail.com"))["department"]
    assert meta["categories"] == ["ADM"] and meta["category_locked"] is True
    assert meta["requirement_types"] == ["Material"] and meta["requirement_type_locked"] is True
    assert _meta(client, admin)["stock"]["category_locked"] is False  # other purposes untouched

    # Several options + the lock switch + a default = locked too.
    assert _put(client, admin, "stock", lock_category=True).status_code == 200
    assert _meta(client, admin)["stock"]["category_locked"] is True

    # Reset puts the code default back.
    r = client.post(f"{RULES}/department/reset", headers=auth_header(admin))
    assert r.status_code == 200
    assert _meta(client, admin)["department"]["categories"] == list(pp.PURPOSE_FORM["department"]["categories"])


def test_invalid_overrides_are_refused_with_the_fix(client, db):
    admin = _admin(db)
    cases = [
        ({"categories": ["ADM", "ZZZ"]}, "not valid for categories"),
        ({"categories": []}, "pick at least one option"),
        ({"categories": ["ADM", "HWC"], "default_category": "ELE"}, "must be one of the categorys offered"),
        ({"lock_category": True, "default_category": None}, "pick a default category"),
        ({"item_types": ["gadget"]}, "not valid for item types"),
        ({"charged_to_kinds": ["order_project"]}, "not valid for Charged To"),
        ({"charged_required": True, "charged_to_kinds": []}, "no kind is allowed"),
        ({"line_project_mode": "per_line"}, "line project mode"),
    ]
    for changes, text in cases:
        r = _put(client, admin, "department", **changes)
        assert r.status_code == 422 and text in r.json()["detail"], (changes, r.text)
    # Nothing was saved by the refusals.
    assert _meta(client, admin)["department"]["categories"] == list(pp.PURPOSE_FORM["department"]["categories"])
    assert client.put(f"{RULES}/nonsense", json={"rules": {}}, headers=auth_header(admin)).status_code == 404


def test_only_settings_editors_can_save(client, db):
    req = _requester(db, "rules.req2@premnathrail.com")
    r = client.put(f"{RULES}/stock", json={"rules": pp.default_rules("stock")}, headers=auth_header(req))
    assert r.status_code == 403


def test_server_enforces_overridden_category_requirement_type_and_item_types(client, db):
    admin = _admin(db)
    req = _requester(db, "rules.req3@premnathrail.com")
    consumable = master_item(db, "Floor cleaner", code="HK-FC-77", item_type="consumable")
    material = master_item(db, "Steel plate", code="RM-SP-77", item_type="material")

    assert _put(client, admin, "department", categories=["ADM"], default_category="ADM",
                requirement_types=["Material"], default_requirement_type="Material",
                item_types=["consumable"]).status_code == 200

    # A category the new rules don't offer, though it was fine before.
    r = _post(client, db, req, consumable, purpose="department", category_code="HWC")
    assert r.status_code == 400 and "doesn't fit a department running cost requisition" in r.json()["detail"], r.text
    # Requirement type outside the rules.
    r = _post(client, db, req, consumable, purpose="department", category_code="ADM", requirement_type="Service")
    assert r.status_code == 400 and "Requirement type Service" in r.json()["detail"], r.text
    # Item type outside the rules.
    r = _post(client, db, req, material, purpose="department", category_code="ADM")
    assert r.status_code == 422 and "material item" in r.json()["detail"], r.text
    # What the rules offer goes through.
    r = _post(client, db, req, consumable, purpose="department", category_code="ADM", requirement_type="Material")
    assert r.status_code == 200, r.text

    # A locked category with several options must be the default one.
    assert _put(client, admin, "stock", lock_category=True).status_code == 200  # HWC default
    r = _post(client, db, req, material, purpose="stock", category_code="RAW")
    assert r.status_code == 400 and "always Hardware & Consumables" in r.json()["detail"], r.text


def test_charged_to_override_changes_what_the_server_accepts(client, db):
    admin = _admin(db)
    req = _requester(db, "rules.req4@premnathrail.com")
    item = master_item(db, "Floor cleaner", code="HK-FC-78", item_type="consumable")
    # Development normally needs an internal order; make the charge optional.
    r = _post(client, db, req, item, purpose="development", category_code="RAW")
    assert r.status_code == 400 and "R&D project" in r.json()["detail"], r.text
    assert _put(client, admin, "development", charged_required=False).status_code == 200
    r = _post(client, db, req, item, purpose="development", category_code="RAW")
    assert r.status_code == 200, r.text


def test_line_project_mode_inherit_and_inhouse(client, db):
    admin = _admin(db)
    req = _requester(db, "rules.req5@premnathrail.com")
    item = master_item(db, "Floor cleaner", code="HK-FC-79", item_type="consumable")
    # Overhead: every line Inhouse, a sent vehicle is dropped.
    r = _post(client, db, req, item, purpose="stock", category_code="HWC")
    assert r.status_code == 200 and r.json()["items"][0]["project_inhouse"] == "Inhouse"
    # Switch the overhead purpose to inherit: lines are stored "Project" (like Service-raised ones).
    assert _put(client, admin, "stock", line_project_mode="inherit").status_code == 200
    r = _post(client, db, req, item, purpose="stock", category_code="HWC")
    assert r.status_code == 200 and r.json()["items"][0]["project_inhouse"] == "Project"
    # Lines sent with no Project / Inhouse choice at all are fine under a project purpose.
    body = _create_payload(project_label=None, project_type=None, category_code="HWC", purpose="stock",
                           items=[{"store_item_id": item.id, "quantity": 1}])
    assert client.post(BASE, json=body, headers=auth_header(req)).status_code == 200


def test_requisition_without_a_purpose_is_never_rejudged(client, db):
    admin = _admin(db)
    req = _requester(db, "rules.req6@premnathrail.com")
    item = master_item(db, "Steel plate", code="RM-SP-80", item_type="asset")
    assert _put(client, admin, "capital", categories=["CAP"], default_category="CAP").status_code == 200
    # Legacy PR (no purpose): category / item-type rules don't apply.
    assert pp.category_problem(None, "OTH", db=db) is None
    assert pp.item_type_problem(None, "Line 1", "X", "Y", "asset", db=db) is None
    assert pp.requirement_type_problem(None, "Anything", db=db) is None
    r = _post(client, db, req, item, purpose=None, project_label="Alpha", project_type="existing", category_code="RAW")
    assert r.status_code == 200, r.text


def test_a_saved_rule_that_no_longer_validates_falls_back_to_default(db):
    from app.modules.main.models.module_setting import ModuleSetting
    db.add(ModuleSetting(module_key="p2p", key=pp.RULES_KEY_PREFIX + "stock", value={"categories": ["GONE"]}))
    db.commit()
    assert pp.resolve_purpose_rules(db)["stock"]["categories"] == list(pp.PURPOSE_FORM["stock"]["categories"])
