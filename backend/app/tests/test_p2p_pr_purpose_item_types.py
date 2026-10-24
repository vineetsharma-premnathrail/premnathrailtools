"""Item types a purchase requisition purpose allows (p2p/purpose.py
PURPOSE_ITEM_TYPES): exposed on /p2p-requests/meta and softly checked when a
new requisition is submitted."""
from app.modules.p2p.purpose import PURPOSE_ITEM_TYPES
from app.modules.store.models.item import STORE_ITEM_TYPES
from app.tests.p2p_workflow_helpers import master_item
from app.tests.test_p2p_pr_purpose import _post
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    BASE, _requester, _sqlite_number_series, auth_header,
)


def test_meta_exposes_item_types_per_purpose(client, db):
    req = _requester(db, "purpose.it1@premnathrail.com")
    meta = {p["code"]: p for p in client.get(f"{BASE}/meta", headers=auth_header(req)).json()["purposes"]}
    assert set(meta) == set(PURPOSE_ITEM_TYPES)
    for code, p in meta.items():
        assert p["item_types"] == list(PURPOSE_ITEM_TYPES[code])
        assert set(p["item_types"]) <= set(STORE_ITEM_TYPES)
    assert meta["capital"]["item_types"][0] == "asset"
    assert "asset" not in meta["stock"]["item_types"] and "service" not in meta["stock"]["item_types"]


def test_new_requisition_refuses_item_type_that_does_not_fit_the_purpose(client, db):
    req = _requester(db, "purpose.it2@premnathrail.com")
    asset = master_item(db, "Laser cutter", code="AST-LC-01", item_type="asset")
    untyped = master_item(db, "Odd thing", code="ODD-01")
    custom = master_item(db, "Custom typed", code="CUS-01", item_type="packing")

    r = _post(client, db, req, asset, purpose="stock", category_code="HWC")
    assert r.status_code == 422, r.text
    d = r.json()["detail"]
    assert "Line 1" in d and "AST-LC-01" in d and "asset item" in d and "material, consumable, tool equipment" in d

    # Fits a capital purchase (category / charge rules are checked after).
    r = _post(client, db, req, asset, purpose="capital", category_code="CAP")
    assert r.status_code == 400 and "internal order" in r.json()["detail"], r.text

    # Items with no type, or a custom type, are never judged; a draft is never refused.
    assert _post(client, db, req, untyped, purpose="stock", category_code="HWC").status_code == 200
    assert _post(client, db, req, custom, purpose="stock", category_code="HWC").status_code == 200
    assert _post(client, db, req, asset, purpose="stock", category_code="HWC", save_as_draft=True).status_code == 200


def test_legacy_requisition_without_purpose_is_not_judged(client, db):
    req = _requester(db, "purpose.it3@premnathrail.com")
    asset = master_item(db, "Old asset", code="AST-OLD-01", item_type="asset")
    r = _post(client, db, req, asset, purpose=None, project_label="PEW-17A", project_type="existing")
    assert r.status_code == 200, r.text
