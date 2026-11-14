"""Material Issue line "Name on DC" (owner, 2026-11-13): the item's name on the vendor's bill, learnt from
goods receipts, is offered on the issue and printed on the delivery challan; stock stays on the item."""
from datetime import date

from app.modules.store.models.material_issue import StoreMaterialIssueItem
from app.modules.store.models.pre_po_receipt import StoreItemVendorName, bill_name_key
from app.tests.test_store_issue_form_standard import _h, _post, env  # noqa: F401 - env is a fixture

API = "/api/v1/store/material-issues"


def _remember(db, env, name, used_on):
    db.add(StoreItemVendorName(vendor_id=env["vendor"].id, store_item_id=env["item"].id, invoice_name=name,
                               name_key=bill_name_key(name), times_used=1, last_used_on=used_on))
    db.commit()


def test_bill_names_are_offered_latest_first(client, db, env):
    _remember(db, env, "SS HEX BOLT M12x50", date(2026, 10, 1))
    from app.modules.accounts.models.vendor import Vendor
    other = Vendor(code="V-IFS2", name="Bolt House", status="active")
    db.add(other)
    db.commit()
    db.add(StoreItemVendorName(vendor_id=other.id, store_item_id=env["item"].id, invoice_name="Hex Bolt 12 x 50",
                               name_key="hex bolt 12 x 50", times_used=1, last_used_on=date(2026, 11, 10)))
    db.commit()
    r = client.get(f"{API}/bill-names", params={"item_ids": f"{env['item'].id},999999"}, headers=_h(env["keeper"]))
    assert r.status_code == 200, r.text
    assert r.json() == {str(env["item"].id): ["Hex Bolt 12 x 50", "SS HEX BOLT M12x50"], "999999": []}
    assert client.get(f"{API}/bill-names", params={"item_ids": "abc"}, headers=_h(env["keeper"])).status_code == 422


def test_project_issue_keeps_the_name_on_dc(client, db, env):
    r = client.post(API, json={"location_id": env["loc"].id, "issue_type": "project", "erp_project_id": env["project"].id,
                               "challan_number": "DC-P9",
                               "items": [{"item_id": env["item"].id, "quantity": 2, "dc_name": "  SS HEX BOLT M12x50 "}]},
                    headers=_h(env["keeper"]))
    assert r.status_code == 200, r.text
    assert r.json()["items"][0]["dc_name"] == "SS HEX BOLT M12x50"
    assert db.query(StoreMaterialIssueItem).filter_by(issue_id=r.json()["id"]).one().item_id == env["item"].id
    got = client.get(f"{API}/{r.json()['id']}", headers=_h(env["keeper"])).json()
    assert got["items"][0]["dc_name"] == "SS HEX BOLT M12x50"
    # Without a name the line is as before.
    r = _post(client, env, issue_type="production")
    assert r.status_code == 200 and r.json()["items"][0]["dc_name"] is None
