"""Quality Phase 1 — core inspection: stock types, sampling, plans, lots
(auto from GRN / production output), usage decisions, NCR disposition
workflow and its approval / segregation rules, settings."""
import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
from app.modules.quality.models.capa import QualityCapa
from app.modules.quality.models.characteristic import QualityCharacteristic
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.quality.models.masters import QualityDefectCode
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.services import access
from app.modules.quality.services.sampling import aql_plan, sampling_for_line
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.tests.test_p2p_requests import _requester, _create_pr, _purchaser, _raise_po

Q = "/api/v1/quality"


@pytest.fixture(autouse=True)
def _sqlite_number_series(monkeypatch):
    monkeypatch.setattr("app.modules.p2p.service._lock_number_series", lambda db, prefix: None)


def make_user(db, email, role="user", apps=("quality", "store"), quality_role=None, **flags):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps))
    for k, v in flags.items():
        setattr(u, k, v)
    if quality_role:
        access.apply_role(u, quality_role)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def hdr(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def setup_item(db, name="Brake block", flagged=True, cert=False, cost=1000.0):
    loc = StoreLocation(code=f"S{db.query(StoreLocation).count() + 1}", name=f"Main store {db.query(StoreLocation).count() + 1}")
    item = StoreItem(item_code=f"MT-GEN-{db.query(StoreItem).count() + 1:04d}", item_name=name, uom="NOS",
                     inspection_on_receipt=flagged, test_certificate_required=cert, standard_cost=cost)
    db.add_all([loc, item])
    db.commit()
    return item, loc


def balance(db, item, loc):
    db.expire_all()
    return db.query(StoreStockBalance).filter_by(item_id=item.id, location_id=loc.id).one()


def approved_plan(client, db, item, engineer, head, inspection_type="incoming", critical=False):
    ch1 = QualityCharacteristic(code=f"DIA{item.id}{inspection_type[:2]}", name="Bore diameter", char_type="variable", unit="mm",
                                classification="critical" if critical else "major")
    ch2 = QualityCharacteristic(code=f"VIS{item.id}{inspection_type[:2]}", name="Visual", char_type="attribute", classification="minor")
    db.add_all([ch1, ch2])
    db.commit()
    r = client.post(f"{Q}/inspection-plans", json={
        "item_id": item.id, "inspection_type": inspection_type, "sampling_type": "aql", "aql": 1.0,
        "lines": [{"characteristic_id": ch1.id, "nominal": 50, "min_value": 49.9, "max_value": 50.1},
                  {"characteristic_id": ch2.id}],
    }, headers=hdr(engineer))
    assert r.status_code == 200, r.text
    r = client.post(f"{Q}/inspection-plans/{r.json()['id']}/approve", headers=hdr(head))
    assert r.status_code == 200, r.text
    return r.json()


def defect(db):
    d = db.query(QualityDefectCode).first()
    if not d:
        d = QualityDefectCode(code="DIM-01", name="Oversize", category="dimensional")
        db.add(d)
        db.commit()
    return d


def manual_lot_in_quality(client, db, item, loc, engineer, qty=10):
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=qty)
    db.commit()
    r = client.post(f"{Q}/inspection-lots", json={"inspection_type": "stock_reinspection", "item_id": item.id, "quantity": qty,
                                                   "location_id": loc.id, "take_from_free": True}, headers=hdr(engineer))
    assert r.status_code == 200, r.text
    return r.json()


def record_all(client, lot, user, fail_first=False):
    entries = []
    for res in lot["results"]:
        if res["char_type"] == "variable":
            vals = [50.0] * min(res["sample_size"], 3)
            if fail_first:
                vals[0] = 50.5
            entries.append({"result_id": res["id"], "measured_values": vals, "defect_code_id": defect_id_cache.get("id")})
        else:
            entries.append({"result_id": res["id"], "defects_found": 0})
    r = client.post(f"{Q}/inspection-lots/{lot['id']}/results", json={"entries": entries}, headers=hdr(user))
    assert r.status_code == 200, r.text
    r = client.post(f"{Q}/inspection-lots/{lot['id']}/submit-results", headers=hdr(user))
    assert r.status_code == 200, r.text
    return r.json()


defect_id_cache: dict = {}


# --- sampling ---------------------------------------------------------------

def test_iso_2859_sampling_table(db):
    p = aql_plan(db, 1500, 2.5, "II", "normal")
    assert (p.code_letter, p.sample_size, p.accept_number, p.reject_number) == ("K", 125, 7, 8)
    p = aql_plan(db, 1000, 4.0, "II", "normal")
    assert (p.code_letter, p.sample_size, p.accept_number) == ("J", 80, 7)
    p = aql_plan(db, 60, 1.0, "II", "normal")  # E row, AQL 1.0 → 0/1 at n=13
    assert (p.sample_size, p.accept_number) == (13, 0)
    tight = aql_plan(db, 1500, 1.0, "II", "tightened")
    assert tight.accept_number < aql_plan(db, 1500, 1.0, "II", "normal").accept_number
    s = sampling_for_line(db, lot_size=40, classification="critical", sampling_type="aql", aql=1.0, level="II",
                          severity="normal", fixed_sample_size=None)
    assert (s.sample_size, s.accept_number) == (40, 0)
    small = aql_plan(db, 5, 0.65, "II", "normal")
    assert small.sample_size == 5  # sample ≥ lot → 100%


# --- stock types ------------------------------------------------------------

def test_quality_and_blocked_stock_cannot_be_issued(db):
    item, loc = setup_item(db)
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="quality_in", quantity=10)
    with pytest.raises(ValueError) as e:
        post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="issue", quantity=1)
    assert "Quality stock waiting for inspection" in str(e.value)
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="quality_block", quantity=4)
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="quality_release", quantity=6)
    b = balance(db, item, loc)
    assert (b.on_hand_qty, b.quality_qty, b.quarantine_qty) == (6, 0, 4)
    with pytest.raises(ValueError) as e:
        post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="issue", quantity=7)
    assert "Blocked" in str(e.value)


# --- plans ------------------------------------------------------------------

def test_only_one_approved_plan_per_item_and_type(client, db):
    eng = make_user(db, "eng@x.com", quality_role="engineer")
    head = make_user(db, "head@x.com", quality_role="head")
    item, _ = setup_item(db)
    plan = approved_plan(client, db, item, eng, head)
    assert plan["status"] == "approved"
    # A second plan for the same item+type is refused — revise instead.
    r = client.post(f"{Q}/inspection-plans", json={"item_id": item.id, "inspection_type": "incoming"}, headers=hdr(eng))
    assert r.status_code == 409 and "New revision" in r.json()["detail"]
    rev = client.post(f"{Q}/inspection-plans/{plan['id']}/new-revision", headers=hdr(eng)).json()
    assert rev["revision"] == 2 and rev["status"] == "draft"
    # Approved plans are frozen.
    assert client.patch(f"{Q}/inspection-plans/{plan['id']}", json={"aql": 2.5}, headers=hdr(eng)).status_code == 409
    # Engineers can't approve (explicit Quality head authority).
    assert client.post(f"{Q}/inspection-plans/{rev['id']}/approve", headers=hdr(eng)).status_code == 403
    assert client.post(f"{Q}/inspection-plans/{rev['id']}/approve", headers=hdr(head)).json()["status"] == "approved"
    assert client.get(f"{Q}/inspection-plans/{plan['id']}", headers=hdr(eng)).json()["status"] == "obsolete"


# --- GRN → incoming lot → decision → GRN line ------------------------------

def test_grn_for_flagged_item_goes_to_quality_and_lot_decision_completes_grn(client, db, monkeypatch):
    # PO approval is P2P's concern (covered in test_p2p_requests) — bypass it here.
    monkeypatch.setattr("app.modules.p2p.routes.goods_receipts._po_approval_block_reason", lambda db, po: None)
    requester = _requester(db, "reqq@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": "Brake block", "quantity": 20, "unit": "NOS", "project_inhouse": "Project"}])
    buyer = _purchaser(db, "buyerq@premnathrail.com")
    _raise_po(client, db, pr, buyer)
    item, loc = setup_item(db, "Brake block")
    eng = make_user(db, "eng2@x.com", quality_role="engineer")
    head = make_user(db, "head2@x.com", quality_role="head")
    approved_plan(client, db, item, eng, head)

    po = next(p for p in client.get("/api/v1/p2p/purchase-orders", headers=hdr(buyer)).json() if p["p2p_request_id"] == pr["id"])
    grn = client.post("/api/v1/p2p/goods-receipts", json={
        "purchase_order_id": po["id"], "store_location_id": loc.id,
        "items": [{"po_item_id": po["items"][0]["id"], "received_quantity": 20}],
    }, headers=hdr(buyer))
    assert grn.status_code == 200, grn.text
    grn = grn.json()
    assert grn["items"][0]["quality_status"] == "in_quality"
    b = balance(db, item, loc)
    assert (b.on_hand_qty, b.quality_qty) == (0, 20)

    # The store's GRN inspection can't decide a line Quality owns.
    r = client.post(f"/api/v1/p2p/goods-receipts/{grn['id']}/inspect", json={"items": [
        {"item_id": grn["items"][0]["id"], "accepted_quantity": 20, "rejected_quantity": 0, "quality_status": "passed"}]},
        headers=hdr(buyer))
    assert r.status_code == 409 and "Quality" in r.json()["detail"]

    lot = client.get(f"{Q}/inspection-lots", params={"mine": True}, headers=hdr(eng)).json()[0]
    assert lot["source_reference"] == grn["grn_number"] and lot["plan_id"]
    lot = client.post(f"{Q}/inspection-lots/{lot['id']}/start", headers=hdr(eng)).json()
    defect_id_cache["id"] = defect(db).id
    lot = record_all(client, lot, eng, fail_first=True)
    failing = next(r for r in lot["results"] if r["char_type"] == "variable")
    assert failing["result"] == "fail"

    # Failures can't be plainly accepted; partial rejection is fine.
    r = client.post(f"{Q}/inspection-lots/{lot['id']}/decision", json={"decision": "accept"}, headers=hdr(head))
    assert r.status_code == 409
    r = client.post(f"{Q}/inspection-lots/{lot['id']}/decision", json={"decision": "partial", "accepted_qty": 15, "rejected_qty": 5}, headers=hdr(head))
    assert r.status_code == 200, r.text
    lot = r.json()
    assert lot["status"] == "decision_made" and len(lot["ncrs"]) == 1
    b = balance(db, item, loc)
    assert (b.on_hand_qty, b.quality_qty, b.quarantine_qty) == (15, 0, 5)

    g = client.get(f"/api/v1/p2p/goods-receipts/{grn['id']}", headers=hdr(buyer)).json()
    assert g["status"] == "completed"
    assert (g["items"][0]["accepted_quantity"], g["items"][0]["rejected_quantity"], g["items"][0]["quality_status"]) == (15, 5, "partial")

    # Decided lots are immutable.
    r = client.post(f"{Q}/inspection-lots/{lot['id']}/results", json={"entries": []}, headers=hdr(eng))
    assert r.status_code == 409


def test_failed_critical_characteristic_blocks_deviation(client, db):
    eng = make_user(db, "eng3@x.com", quality_role="engineer")
    head = make_user(db, "head3@x.com", quality_role="head")
    head2 = make_user(db, "head3b@x.com", quality_role="head")
    item, loc = setup_item(db)
    approved_plan(client, db, item, eng, head, inspection_type="stock_reinspection", critical=True)
    lot = manual_lot_in_quality(client, db, item, loc, eng)
    crit = next(r for r in lot["results"] if r["classification"] == "critical")
    assert crit["sample_size"] == 10 and crit["accept_number"] == 0  # critical → 100%
    defect_id_cache["id"] = defect(db).id
    lot = record_all(client, lot, eng, fail_first=True)
    r = client.post(f"{Q}/inspection-lots/{lot['id']}/decision",
                    json={"decision": "accept_with_deviation", "deviation_reference": "DEV-1"}, headers=hdr(head2))
    assert r.status_code == 409 and "Rule 4" in r.json()["detail"]


def test_deviation_needs_a_head_who_did_not_record_results(client, db):
    eng = make_user(db, "eng4@x.com", quality_role="engineer")
    head = make_user(db, "head4@x.com", quality_role="head")
    head2 = make_user(db, "head4b@x.com", quality_role="head")
    item, loc = setup_item(db)
    approved_plan(client, db, item, eng, head2, inspection_type="stock_reinspection")
    lot = manual_lot_in_quality(client, db, item, loc, eng)
    defect_id_cache["id"] = defect(db).id
    lot = record_all(client, lot, head, fail_first=True)  # head recorded the results
    body = {"decision": "accept_with_deviation", "deviation_reference": "DEV-7"}
    r = client.post(f"{Q}/inspection-lots/{lot['id']}/decision", json=body, headers=hdr(head))
    assert r.status_code == 403 and "segregation" in r.json()["detail"]
    r = client.post(f"{Q}/inspection-lots/{lot['id']}/decision", json=body, headers=hdr(head2))
    assert r.status_code == 200, r.text
    assert balance(db, item, loc).on_hand_qty == 10
    ncr = db.query(QualityNcr).filter(QualityNcr.lot_id == lot["id"]).one()
    assert ncr.disposition_type == "use_as_is" and ncr.status == "action_done"


def test_missing_test_certificate_blocks_acceptance(client, db):
    eng = make_user(db, "eng5@x.com", quality_role="engineer")
    head = make_user(db, "head5@x.com", quality_role="head")
    item, loc = setup_item(db, cert=True)
    approved_plan(client, db, item, eng, head)
    from app.modules.quality.services.lots import create_lot
    lot = create_lot(db, inspection_type="incoming", source_type="manual", item=item, quantity=5, location_id=loc.id,
                     user_id=eng.id, receive_into_quality=True)
    db.commit()
    lot = client.get(f"{Q}/inspection-lots/{lot.id}", headers=hdr(eng)).json()
    lot = record_all(client, lot, eng)
    r = client.post(f"{Q}/inspection-lots/{lot['id']}/decision", json={"decision": "accept"}, headers=hdr(head))
    assert r.status_code == 409 and "test certificate" in r.json()["detail"]
    assert client.post(f"{Q}/inspection-lots/{lot['id']}/test-certificate", json={"received": True, "reference": "MTC-9"},
                       headers=hdr(eng)).status_code == 200
    assert client.post(f"{Q}/inspection-lots/{lot['id']}/decision", json={"decision": "accept"}, headers=hdr(head)).status_code == 200


def test_lot_without_approved_plan_cannot_start(client, db):
    eng = make_user(db, "eng6@x.com", quality_role="engineer")
    item, loc = setup_item(db)
    lot = manual_lot_in_quality(client, db, item, loc, eng)
    r = client.post(f"{Q}/inspection-lots/{lot['id']}/start", headers=hdr(eng))
    assert r.status_code == 409 and "rule 2" in r.json()["detail"]


# --- NCR disposition workflow ------------------------------------------------

def _rejected_ncr(client, db, item, loc, eng, head, recorder):
    approved_plan(client, db, item, eng, head, inspection_type="stock_reinspection")
    lot = manual_lot_in_quality(client, db, item, loc, eng)
    defect_id_cache["id"] = defect(db).id
    lot = record_all(client, lot, recorder, fail_first=True)
    r = client.post(f"{Q}/inspection-lots/{lot['id']}/decision", json={"decision": "reject"}, headers=hdr(head))
    assert r.status_code == 200, r.text
    return db.query(QualityNcr).filter(QualityNcr.lot_id == lot["id"]).one()


def test_scrap_above_limit_needs_partner_and_segregation_applies(client, db):
    if not hasattr(User, "is_partner"):
        pytest.skip("User.is_partner (Company Info → Partners) not in this tree yet")
    eng = make_user(db, "eng7@x.com", quality_role="engineer")
    head = make_user(db, "head7@x.com", quality_role="head")
    head2 = make_user(db, "head7b@x.com", quality_role="head")
    partner = make_user(db, "partner7@x.com", is_partner=True)
    item, loc = setup_item(db, cost=10000)  # 10 × ₹10,000 = ₹1,00,000 > ₹50,000 limit
    ncr = _rejected_ncr(client, db, item, loc, eng, head2, recorder=head)
    assert ncr.severity == "major" and ncr.stock_blocked and ncr.status == "open"
    codes = client.get(f"{Q}/masters/disposition-codes", headers=hdr(eng)).json()
    scrap = next(c for c in codes if c["disposition_type"] == "scrap")

    body = client.post(f"{Q}/ncr/{ncr.id}/propose-disposition", json={"disposition_code_id": scrap["id"]}, headers=hdr(eng)).json()
    assert body["pending_roles"] == ["quality_head", "partner"]
    # The head who recorded the results can't approve a major NCR's disposition.
    r = client.post(f"{Q}/ncr/{ncr.id}/approve-disposition", json={"role": "quality_head"}, headers=hdr(head))
    assert r.status_code == 403 and "segregation" in r.json()["detail"]
    # Only a Partner can give partner approval.
    assert client.post(f"{Q}/ncr/{ncr.id}/approve-disposition", json={"role": "partner"}, headers=hdr(head2)).status_code == 403
    assert client.post(f"{Q}/ncr/{ncr.id}/approve-disposition", json={"role": "quality_head"}, headers=hdr(head2)).status_code == 200
    body = client.post(f"{Q}/ncr/{ncr.id}/approve-disposition", json={"role": "partner"}, headers=hdr(partner)).json()
    assert body["status"] == "disposition_decided"

    assert client.post(f"{Q}/ncr/{ncr.id}/action", json={"action_reference": ""}, headers=hdr(eng)).status_code == 422
    body = client.post(f"{Q}/ncr/{ncr.id}/action", json={"action_reference": "SCRAP-1"}, headers=hdr(eng)).json()
    assert body["status"] == "action_done"
    assert balance(db, item, loc).quarantine_qty == 0
    assert client.post(f"{Q}/ncr/{ncr.id}/verify", json={}, headers=hdr(eng)).json()["status"] == "verified"
    # Rule 6: major NCR needs a CAPA before closure.
    r = client.post(f"{Q}/ncr/{ncr.id}/close", json={"material_cost": 100000}, headers=hdr(head2))
    assert r.status_code == 409 and "CAPA" in r.json()["detail"]
    from datetime import date
    db.add(QualityCapa(capa_number="CAPA-1", action_type="corrective", ncr_id=ncr.id, title="Fix", action_plan="x",
                       status="open", due_date=date.today()))
    db.commit()
    body = client.post(f"{Q}/ncr/{ncr.id}/close", json={"material_cost": 100000}, headers=hdr(head2)).json()
    assert body["status"] == "closed" and body["cost_of_non_quality"] == 100000
    assert client.patch(f"{Q}/ncr/{ncr.id}", json={"description": "edit"}, headers=hdr(head2)).status_code == 409


def test_rework_creates_reinspection_lot_and_use_as_is_needs_design(client, db):
    eng = make_user(db, "eng8@x.com", quality_role="engineer")
    head = make_user(db, "head8@x.com", quality_role="head")
    designer = make_user(db, "design8@x.com", apps=("quality", "design"))
    item, loc = setup_item(db, cost=10)
    ncr = _rejected_ncr(client, db, item, loc, eng, head, recorder=eng)
    codes = {c["disposition_type"]: c for c in client.get(f"{Q}/masters/disposition-codes", headers=hdr(eng)).json()}

    body = client.post(f"{Q}/ncr/{ncr.id}/propose-disposition", json={"disposition_code_id": codes["use_as_is"]["id"]}, headers=hdr(eng)).json()
    assert set(body["pending_roles"]) == {"quality_head", "design"}
    # Reject → back to no disposition.
    assert client.post(f"{Q}/ncr/{ncr.id}/approve-disposition", json={"role": "quality_head", "approve": False},
                       headers=hdr(head)).status_code == 422  # reason required
    body = client.post(f"{Q}/ncr/{ncr.id}/approve-disposition", json={"role": "quality_head", "approve": False, "remarks": "Rework it"},
                       headers=hdr(head)).json()
    assert body["disposition_status"] == "none"

    client.post(f"{Q}/ncr/{ncr.id}/propose-disposition", json={"disposition_code_id": codes["rework"]["id"]}, headers=hdr(eng))
    # Engineer recorded the major NCR's results → can't self-approve the rework.
    assert client.post(f"{Q}/ncr/{ncr.id}/approve-disposition", json={"role": "quality_engineer"}, headers=hdr(eng)).status_code == 403
    assert client.post(f"{Q}/ncr/{ncr.id}/approve-disposition", json={"role": "quality_engineer"}, headers=hdr(head)).json()["status"] == "disposition_decided"
    body = client.post(f"{Q}/ncr/{ncr.id}/action", json={"action_reference": "RW-1"}, headers=hdr(eng)).json()
    assert body["reinspection_lot_id"]
    b = balance(db, item, loc)
    assert (b.quarantine_qty, b.quality_qty) == (0, 10)
    # Can't verify until the re-inspection lot is decided.
    assert client.post(f"{Q}/ncr/{ncr.id}/verify", json={}, headers=hdr(eng)).status_code == 409
    assert designer  # design authority exists for the use-as-is path


def test_settings_only_head_edits_and_changes_are_audited(client, db):
    eng = make_user(db, "eng9@x.com", quality_role="engineer")
    head = make_user(db, "head9@x.com", quality_role="head")
    assert client.put(f"{Q}/settings", json={"values": {"lot_waiting_days": 3}}, headers=hdr(eng)).status_code == 403
    r = client.put(f"{Q}/settings", json={"values": {"vendor_weight_quality": 70}}, headers=hdr(head))
    assert r.status_code == 422 and "100%" in r.json()["detail"]
    r = client.put(f"{Q}/settings", json={"values": {"lot_waiting_days": 3, "scrap_value_limit": 75000}}, headers=hdr(head))
    assert r.status_code == 200 and r.json()["values"]["lot_waiting_days"] == 3
    from app.modules.main.models.audit_log import AuditLog
    assert db.query(AuditLog).filter(AuditLog.entity_type == "quality_setting").count() >= 2
    vals = client.get(f"{Q}/masters/values", params={"list_key": "ncr_sources"}, headers=hdr(eng)).json()
    assert {"incoming", "final", "audit"} <= {v["value"] for v in vals}


def test_production_output_of_flagged_item_goes_to_final_lot(db):
    from types import SimpleNamespace
    from app.modules.quality.services.lots import create_lot_for_production_output, needs_inspection_on_receipt
    eng = make_user(db, "eng10@x.com", quality_role="engineer")
    item, loc = setup_item(db)
    assert needs_inspection_on_receipt(db, item, "final")
    lot = create_lot_for_production_output(db, work_order=SimpleNamespace(id=1, wo_number="WO-1"), item=item, quantity=2,
                                           location_id=loc.id, batch_number="WO-1", user_id=eng.id)
    assert lot.inspection_type == "final" and lot.status == "created"
    assert balance(db, item, loc).quality_qty == 2
    assert db.query(QualityInspectionLot).count() == 1
