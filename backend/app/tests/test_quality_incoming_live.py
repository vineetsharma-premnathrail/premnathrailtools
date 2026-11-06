"""Quality incoming inspection live (2026-11-06): the default F/STR/01 checklist,
Quality-only lot actions (separate from Store), segregation of duties on a
deviation, the read-only Quality status on the GRN, and the Excel inspection report."""
import io

import pytest
from openpyxl import load_workbook

from app.modules.quality.models.characteristic import QualityCharacteristic
from app.modules.quality.models.inspection_plan import QualityInspectionPlan
from app.modules.quality.services.standard_checklist import (
    STANDARD_PARAMETERS, STANDARD_PLAN_NUMBER, ensure_standard_incoming_plan,
)
from app.tests.test_p2p_requests import _requester, _create_pr, _purchaser, _raise_po
from app.tests.test_quality_phase1 import (
    Q, approved_plan, balance, defect, hdr, make_user, setup_item,
)

L = f"{Q}/inspection-lots"
PARAMS = [p[1] for p in STANDARD_PARAMETERS]


@pytest.fixture(autouse=True)
def _sqlite_number_series(monkeypatch):
    monkeypatch.setattr("app.modules.p2p.service._lock_number_series", lambda db, prefix: None)


def _incoming_lot(db, item, loc, user, qty=20, vendor="Acme Steels"):
    """What the GRN does for a flagged line: Quality stock + an incoming lot."""
    from app.modules.quality.services.lots import create_lot
    lot = create_lot(db, inspection_type="incoming", source_type="manual", item=item, quantity=qty, location_id=loc.id,
                     user_id=user.id, receive_into_quality=True, vendor_name=vendor, source_reference="GRN-T-1")
    db.commit()
    return lot


def _get(client, lot_id, user):
    r = client.get(f"{L}/{lot_id}", headers=hdr(user))
    assert r.status_code == 200, r.text
    return r.json()


def _record(client, lot, user, fail: str | None = None, submit=True):
    entries = []
    for res in lot["results"]:
        failing = res["characteristic_name"] == fail
        e = {"result_id": res["id"], "defects_found": 1 if failing else 0, "remarks": f"{res['characteristic_name']} checked"}
        if failing:
            e["defect_code_id"] = defect_id()
        entries.append(e)
    r = client.post(f"{L}/{lot['id']}/results", json={"entries": entries}, headers=hdr(user))
    assert r.status_code == 200, r.text
    if submit:
        r = client.post(f"{L}/{lot['id']}/submit-results", headers=hdr(user))
        assert r.status_code == 200, r.text
    return r.json()


_defect_id: dict = {}


def defect_id():
    return _defect_id["id"]


@pytest.fixture
def people(db):
    _defect_id["id"] = defect(db).id
    return {
        "insp": make_user(db, "qi.insp@x.com", quality_role="inspector"),
        "eng": make_user(db, "qi.eng@x.com", quality_role="engineer"),
        "head": make_user(db, "qi.head@x.com", quality_role="head"),
        "head2": make_user(db, "qi.head2@x.com", quality_role="head"),
        # Store only: no Quality access at all.
        "store": make_user(db, "qi.store@x.com", apps=(), granular_permissions=["store:stock:view", "store:grn:view", "store:grn:create"]),
        # Quality dashboard only: can look, cannot work a lot or print it.
        "viewer": make_user(db, "qi.viewer@x.com", apps=(), granular_permissions=["quality:dashboard:view", "quality:inspection_lots:view"]),
    }


# --- default checklist ------------------------------------------------------

def test_default_checklist_is_attached_when_the_item_has_no_plan(client, db, people):
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"])
    d = _get(client, lot.id, people["insp"])
    assert [r["characteristic_name"] for r in d["results"]] == PARAMS
    assert d["plan_id"] and d["sample_size"] == 5
    assert all(r["sample_size"] == 5 and r["accept_number"] == 0 and r["char_type"] == "attribute" for r in d["results"])
    by_name = {r["characteristic_name"]: r for r in d["results"]}
    assert by_name["Grade"]["specification"] == "As per MTC" and by_name["Grade"]["method"] == "Supplier MTC / Third Party Verification"
    assert by_name["Weight"]["unit"] == "KG" and by_name["Qty"]["unit"] == "PCS"
    assert by_name["Dimension"]["specification"] == "As per Drawing" and by_name["Dimension"]["method"] == "Measuring Instrument"


def test_standard_checklist_is_seeded_once_and_safe_to_rerun(db):
    first = ensure_standard_incoming_plan(db)
    again = ensure_standard_incoming_plan(db)
    db.commit()
    assert first.id == again.id
    assert db.query(QualityInspectionPlan).filter(QualityInspectionPlan.plan_number == STANDARD_PLAN_NUMBER).count() == 1
    assert db.query(QualityCharacteristic).filter(QualityCharacteristic.code.like("F-STR-01-%")).count() == len(STANDARD_PARAMETERS)
    assert len(again.lines) == len(STANDARD_PARAMETERS) and first.status == "approved" and first.item_id is None
    # A half-seeded database (a line removed) is repaired, not duplicated.
    db.delete(again.lines[-1])
    db.commit()
    db.expire_all()
    repaired = ensure_standard_incoming_plan(db)
    assert len(repaired.lines) == len(STANDARD_PARAMETERS)


def test_item_specific_approved_plan_wins_over_the_standard_checklist(client, db, people):
    item, loc = setup_item(db)
    approved_plan(client, db, item, people["eng"], people["head"])
    lot = _incoming_lot(db, item, loc, people["eng"])
    names = [r["characteristic_name"] for r in _get(client, lot.id, people["eng"])["results"]]
    assert names == ["Bore diameter", "Visual"]


def test_tightened_sampling_doubles_the_standard_sample(client, db, people):
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"], qty=40)
    r = client.post(f"{L}/{lot.id}/sampling", json={"sampling_severity": "tightened"}, headers=hdr(people["eng"]))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["sample_size"] == 10 and all(x["sample_size"] == 10 for x in d["results"])


def test_grn_line_shows_the_quality_lot_to_store(client, db, people, monkeypatch):
    monkeypatch.setattr("app.modules.p2p.routes.goods_receipts._po_approval_block_reason", lambda db, po: None)
    item, loc = setup_item(db, "Brake block")
    requester = _requester(db, "qi.req@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"store_item_id": item.id, "quantity": 20, "project_inhouse": "Project"}])
    buyer = _purchaser(db, "qi.buyer@premnathrail.com")
    _raise_po(client, db, pr, buyer)
    po = next(p for p in client.get("/api/v1/p2p/purchase-orders", headers=hdr(buyer)).json() if p["p2p_request_id"] == pr["id"])
    grn = client.post("/api/v1/p2p/goods-receipts", json={
        "purchase_order_id": po["id"], "store_location_id": loc.id,
        "items": [{"po_item_id": po["items"][0]["id"], "received_quantity": 20}]}, headers=hdr(buyer))
    assert grn.status_code == 200, grn.text
    line = grn.json()["items"][0]
    assert line["quality_status"] == "in_quality" and line["quality_lot_number"]
    assert line["quality_lot_status"] == "created" and line["quality_lot_decision"] is None
    assert line["quality_lots"][0]["lot_number"] == line["quality_lot_number"] and line["quality_lot_id"] == line["quality_lots"][0]["id"]
    # The frontend asks for signed refs: the lead lot id gets its quality_lot_id_ref.
    with_refs = client.get(f"/api/v1/p2p/goods-receipts/{grn.json()['id']}", headers={**hdr(buyer), "X-Record-Refs": "1"}).json()
    assert with_refs["items"][0]["quality_lot_id_ref"]
    # The lot carries the standard checklist even though no plan was ever created for the item.
    lot = client.get(L, params={"mine": True}, headers=hdr(people["insp"])).json()[0]
    assert [r["characteristic_name"] for r in _get(client, lot["id"], people["insp"])["results"]] == PARAMS
    assert balance(db, item, loc).quality_qty == 20
    # Decide it (accept) — the GRN detail then shows the decision.
    _record(client, _get(client, lot["id"], people["insp"]), people["insp"])
    assert client.post(f"{L}/{lot['id']}/decision", json={"decision": "accept"}, headers=hdr(people["head"])).status_code == 200
    line = client.get(f"/api/v1/p2p/goods-receipts/{grn.json()['id']}", headers=hdr(buyer)).json()["items"][0]
    assert line["quality_lot_status"] == "decision_made" and line["quality_lot_decision"] == "accept"


# --- Store cannot do Quality's work -------------------------------------------

@pytest.mark.parametrize("method,path,body", [
    ("post", "/{id}/start", None),
    ("post", "/{id}/assign", {"user_id": 1}),
    ("post", "/{id}/results", {"entries": []}),
    ("post", "/{id}/submit-results", None),
    ("post", "/{id}/decision", {"decision": "accept"}),
    ("post", "/{id}/close", None),
    ("post", "/{id}/cancel", {"reason": "x"}),
    ("post", "/{id}/test-certificate", {"received": True, "reference": "M1"}),
])
def test_store_only_user_cannot_work_or_decide_a_lot(client, db, people, method, path, body):
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"])
    r = getattr(client, method)(f"{L}{path.format(id=lot.id)}", **({"json": body} if body is not None else {}), headers=hdr(people["store"]))
    assert r.status_code == 403
    assert r.json()["detail"] == ("Quality decisions are made in the Quality module by Quality users — "
                                  "ask an admin to give you Quality › Inspection Lots access.")
    db.expire_all()
    assert balance(db, item, loc).quality_qty == 20  # nothing moved


def test_store_only_user_cannot_open_a_lot_or_its_report(client, db, people):
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"])
    for url in (f"{L}/{lot.id}", f"{L}/{lot.id}/report.xlsx", L):
        r = client.get(url, headers=hdr(people["store"]))
        assert r.status_code == 403 and "Quality › Inspection Lots access" in r.json()["detail"]


def test_quality_user_without_edit_or_approve_cannot_start_or_decide(client, db, people):
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"])
    r = client.post(f"{L}/{lot.id}/start", headers=hdr(people["viewer"]))
    assert r.status_code == 403 and "Edit" in r.json()["detail"]
    _record(client, _get(client, lot.id, people["eng"]), people["eng"])
    r = client.post(f"{L}/{lot.id}/decision", json={"decision": "accept"}, headers=hdr(people["viewer"]))
    assert r.status_code == 403 and "Usage decision" in r.json()["detail"]
    # An inspector records results but may not decide.
    r = client.post(f"{L}/{lot.id}/decision", json={"decision": "accept"}, headers=hdr(people["insp"]))
    assert r.status_code == 403


# --- segregation of duties ----------------------------------------------------

def test_recorder_cannot_accept_with_deviation_another_head_can(client, db, people):
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"])
    d = _record(client, _get(client, lot.id, people["head"]), people["head"], fail="Appearance")  # the head records
    assert next(r for r in d["results"] if r["characteristic_name"] == "Appearance")["result"] == "fail"
    body = {"decision": "accept_with_deviation", "deviation_reference": "DEV-11"}
    r = client.post(f"{L}/{lot.id}/decision", json=body, headers=hdr(people["head"]))
    assert r.status_code == 403
    assert "another Quality user with head authority" in r.json()["detail"] and "segregation of duties" in r.json()["detail"]
    r = client.post(f"{L}/{lot.id}/decision", json=body, headers=hdr(people["head2"]))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "decision_made" and r.json()["decision"] == "accept_with_deviation"
    assert balance(db, item, loc).on_hand_qty == 20


# --- inspection report ----------------------------------------------------------

def _xlsx(r):
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert "attachment" in r.headers["content-disposition"] and ".xlsx" in r.headers["content-disposition"]
    return load_workbook(io.BytesIO(r.content))


def _texts(ws):
    return {c.coordinate: c.value for row in ws.iter_rows() for c in row if c.value is not None}


def test_report_xlsx_keeps_the_f_str_01_layout_and_carries_the_results(client, db, people):
    item, loc = setup_item(db, "Plate 6mm")
    lot = _incoming_lot(db, item, loc, people["eng"], qty=20)
    _record(client, _get(client, lot.id, people["insp"]), people["insp"], fail="Dimension")
    r = client.post(f"{L}/{lot.id}/decision", json={"decision": "reject", "remarks": "Out of drawing size"}, headers=hdr(people["head"]))
    assert r.status_code == 200, r.text

    wb = load_workbook(io.BytesIO(client.get(f"{L}/{lot.id}/report.xlsx", headers=hdr(people["eng"])).content))
    ws = wb.worksheets[0]
    t = _texts(ws)
    # Header box, title and column headings of the template are intact.
    assert t["J1"] == "F/STR/01" and t["J2"] == "01.02.2025" and t["C1"].startswith("Premnath")
    assert t["A5"] == "Incoming Inspection Standard"
    assert ws.page_setup.orientation == "landscape"
    heads = [ws.cell(row=9, column=c).value for c in range(1, 13)]
    assert heads[:5] == ["S. No.", "Operation Name", "Parameter", "SPECIFICATION", "Measuring  Method"] and heads[10] == "Result"
    # Three images: logo + the two footer signatures, the footer ones moved with the footer.
    assert len(ws._images) == 3
    assert any(m.startswith("C1:") for m in map(str, ws.merged_cells.ranges))
    # Lot information.
    values = set(map(str, t.values()))
    assert lot.lot_number in values and "GRN-T-1" in values and "Acme Steels" in values and "Plate 6mm" in "".join(values)
    assert "20 NOS" in values
    # One row per parameter with its result and what the inspector wrote.
    rows = {ws.cell(row=r, column=3).value: r for r in range(10, 16)}
    assert list(rows) == PARAMS
    assert ws.cell(row=rows["Grade"], column=11).value == "OK" and "Grade checked" in ws.cell(row=rows["Grade"], column=12).value
    assert ws.cell(row=rows["Dimension"], column=11).value == "NOT OK" and "1 defective of 5" in ws.cell(row=rows["Dimension"], column=12).value
    assert ws.cell(row=rows["Grade"], column=4).value == "As per MTC" and ws.cell(row=rows["Grade"], column=7).value == 5
    # Decision, people and the template footer (below the table, with its signature images).
    assert any("Reject (full)" in str(v) for v in values) and "Out of drawing size" in values
    assert "qi.insp" in values and "qi.head" in values
    foot = next(c for c, v in t.items() if v == "Prepared By -")
    assert foot.startswith("A") and int(foot[1:]) > 15  # moved down below the added info band, decision block and notes
    foot_row = int(foot[1:])
    assert all(im.anchor._from.row == foot_row - 1 for im in ws._images if im.anchor._from.row > 5)
    assert t[f"D{foot_row}"] == "Approved By -" and t[f"G{foot_row}"] == "Customer Approved By -"
    assert ws.print_area.endswith(f"{foot_row}")


def test_report_needs_print_permission_and_an_existing_lot(client, db, people):
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"])
    r = client.get(f"{L}/{lot.id}/report.xlsx", headers=hdr(people["viewer"]))
    assert r.status_code == 403 and "Print" in r.json()["detail"] and "Inspection Lots" in r.json()["detail"]
    r = client.get(f"{L}/999999/report.xlsx", headers=hdr(people["eng"]))
    assert r.status_code == 404 and "not found" in r.json()["detail"]
    assert client.get(f"{L}/{lot.id}/report.xlsx", headers=hdr(people["insp"])).status_code == 200  # inspector role prints too


def test_report_for_an_item_plan_adds_rows_and_keeps_the_footer_below(client, db, people):
    item, loc = setup_item(db)
    approved_plan(client, db, item, people["eng"], people["head"])
    lot = _incoming_lot(db, item, loc, people["eng"], qty=10)
    d = _get(client, lot.id, people["eng"])
    entries = [({"result_id": r["id"], "measured_values": [50.0, 50.02]} if r["char_type"] == "variable"
                else {"result_id": r["id"], "defects_found": 0}) for r in d["results"]]
    assert client.post(f"{L}/{lot.id}/results", json={"entries": entries}, headers=hdr(people["eng"])).status_code == 200
    ws = _xlsx(client.get(f"{L}/{lot.id}/report.xlsx", headers=hdr(people["eng"]))).worksheets[0]
    t = _texts(ws)
    assert t["C10"] == "Bore diameter" and "50 (49.9 to 50.1) mm" in t["D10"] and "Measured: 50, 50.02 mm" in t["L10"]
    assert t["C11"] == "Visual" and t["K10"] == "OK"
    assert "Prepared By -" in t.values()


def test_dashboard_counts_lots_in_inspection(client, db, people):
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"])
    k = client.get(f"{Q}/dashboard", headers=hdr(people["eng"])).json()["kpis"]
    assert (k["lots_waiting"], k["lots_in_inspection"]) == (1, 0)
    assert client.post(f"{L}/{lot.id}/start", headers=hdr(people["eng"])).status_code == 200
    k = client.get(f"{Q}/dashboard", headers=hdr(people["eng"])).json()["kpis"]
    assert (k["lots_waiting"], k["lots_in_inspection"]) == (1, 1)


# --- review fixes (2026-11-06): partial decision, formula text, standard plan protection, scope ---

def test_partial_on_a_failed_lot_needs_the_deviation_controls(client, db, people):
    _set_rule(db, "ncr_auto_raise", "on")  # the NCR count below is part of what is checked
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"])
    _record(client, _get(client, lot.id, people["head"]), people["head"], fail="Appearance")  # the head recorded
    body = {"decision": "partial", "accepted_qty": 15, "rejected_qty": 5}
    r = client.post(f"{L}/{lot.id}/decision", json=body, headers=hdr(people["head2"]))
    assert r.status_code == 422 and "concession reference" in r.json()["detail"]
    body["deviation_reference"] = "DEV-5"
    # The recorder cannot decide it, even though he is a head.
    r = client.post(f"{L}/{lot.id}/decision", json=body, headers=hdr(people["head"]))
    assert r.status_code == 403 and "segregation of duties" in r.json()["detail"]
    # A non-head with decision rights cannot use part of a failed lot either.
    r = client.post(f"{L}/{lot.id}/decision", json=body, headers=hdr(people["eng"]))
    assert r.status_code == 403 and "only a Quality head" in r.json()["detail"]
    db.expire_all()
    assert balance(db, item, loc).quality_qty == 20  # nothing moved by the refusals
    r = client.post(f"{L}/{lot.id}/decision", json=body, headers=hdr(people["head2"]))
    assert r.status_code == 200, r.text
    assert len(r.json()["ncrs"]) == 2
    b = balance(db, item, loc)
    assert (b.on_hand_qty, b.quarantine_qty) == (15, 5)


def test_partial_with_a_critical_failure_is_refused(client, db, people):
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"])
    from app.modules.quality.models.inspection_lot import QualityLotResult
    db.query(QualityLotResult).filter(QualityLotResult.lot_id == lot.id, QualityLotResult.characteristic_name == "Dimension"
                                      ).update({"classification": "critical"})
    db.commit()
    _record(client, _get(client, lot.id, people["eng"]), people["eng"], fail="Dimension")
    r = client.post(f"{L}/{lot.id}/decision", json={"decision": "partial", "accepted_qty": 15, "rejected_qty": 5,
                                                    "deviation_reference": "DEV-6"}, headers=hdr(people["head"]))
    assert r.status_code == 422 and "Rule 4" in r.json()["detail"] and "Dimension" in r.json()["detail"]


def test_partial_on_a_lot_without_failures_is_still_a_plain_split(client, db, people):
    _set_rule(db, "ncr_auto_raise", "on")  # the NCR count below is part of what is checked
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"])
    _record(client, _get(client, lot.id, people["eng"]), people["eng"])
    r = client.post(f"{L}/{lot.id}/decision", json={"decision": "partial", "accepted_qty": 15, "rejected_qty": 5}, headers=hdr(people["head"]))
    assert r.status_code == 200, r.text
    assert len(r.json()["ncrs"]) == 1  # only the rejected part


def test_report_text_that_looks_like_a_formula_stays_text(client, db, people):
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"], vendor="=1+1")
    d = _get(client, lot.id, people["eng"])
    entries = [{"result_id": r["id"], "defects_found": 0, "remarks": "=cmd|' /C calc'!A0" if r["characteristic_name"] == "Grade" else "+cmd"}
               for r in d["results"]]
    assert client.post(f"{L}/{lot.id}/results", json={"entries": entries}, headers=hdr(people["eng"])).status_code == 200
    ws = _xlsx(client.get(f"{L}/{lot.id}/report.xlsx", headers=hdr(people["eng"]))).worksheets[0]
    cells = [c for row in ws.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith(("=", "+", "-", "@"))]
    assert any(c.value == "=1+1" for c in cells), "the vendor name should be in the sheet"
    assert all(c.data_type == "s" for c in cells), [(c.coordinate, c.data_type) for c in cells]


def test_standard_checklist_cannot_be_revised_retired_edited_or_deleted(client, db, people):
    plan = ensure_standard_incoming_plan(db)
    db.commit()
    P = f"{Q}/inspection-plans/{plan.id}"
    admin = make_user(db, "qi.admin@x.com", role="admin")
    for method, url in (("post", f"{P}/new-revision"), ("post", f"{P}/obsolete"), ("patch", P), ("delete", P)):
        kw = {"json": {"title": "x"}} if method == "patch" else {}
        who = admin if method == "delete" else people["head"]  # Delete is an admin-level grant
        r = getattr(client, method)(url, headers=hdr(who), **kw)
        assert r.status_code == 409 and "standard incoming checklist" in r.json()["detail"], (method, r.text)
    db.expire_all()
    assert db.query(QualityInspectionPlan).filter_by(plan_number=STANDARD_PLAN_NUMBER).one().status == "approved"


def test_standard_characteristics_are_protected_in_masters(client, db, people):
    ensure_standard_incoming_plan(db)
    db.commit()
    grade = db.query(QualityCharacteristic).filter_by(code="F-STR-01-GRADE").one()
    M = f"{Q}/masters/characteristics"
    r = client.patch(f"{M}/{grade.id}", json={"name": "Material grade"}, headers=hdr(people["eng"]))
    assert r.status_code == 409 and "standard incoming checklist" in r.json()["detail"]
    assert client.patch(f"{M}/{grade.id}", json={"is_active": False}, headers=hdr(people["eng"])).status_code == 409
    r = client.post(M, json={"code": "f-str-01-extra", "name": "Extra", "char_type": "attribute", "classification": "minor"}, headers=hdr(people["eng"]))
    assert r.status_code == 409 and "F-STR-01-" in r.json()["detail"]
    # The specification text may still be corrected.
    r = client.patch(f"{M}/{grade.id}", json={"description": "As per MTC and PO"}, headers=hdr(people["eng"]))
    assert r.status_code == 200 and r.json()["description"] == "As per MTC and PO"


def test_deleted_standard_plan_is_restored_not_duplicated(db):
    plan = ensure_standard_incoming_plan(db)
    plan.is_deleted = True
    db.commit()
    again = ensure_standard_incoming_plan(db)
    db.commit()
    assert again.id == plan.id and again.is_deleted is False and again.status == "approved"


def test_report_of_another_users_lot_is_out_of_scope(client, db, people, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "DEFAULT_DATA_SCOPE", "assigned")  # production default: own + assigned records
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"])  # created by eng, nobody assigned
    other = make_user(db, "qi.other@x.com", quality_role="inspector")
    r = client.get(f"{L}/{lot.id}/report.xlsx", headers=hdr(other))
    assert r.status_code == 403, r.text
    assert client.get(f"{L}/{lot.id}", headers=hdr(other)).status_code == 403
    assert client.get(f"{L}/{lot.id}/report.xlsx", headers=hdr(people["eng"])).status_code == 200  # the creator still can


# --- rules behind Quality settings (first article / NCR default OFF), list views, sampling -------------

def _set_rule(db, key, value):
    from app.modules.quality.models.masters import QualitySetting
    row = db.query(QualitySetting).filter_by(key=key).first()
    if row is None:
        db.add(QualitySetting(key=key, value=value))
    else:
        row.value = value
    db.commit()


def _two_grns(client, db, monkeypatch, per_grn=10):
    """One PO of 2 x per_grn of a flagged item, received in two GRNs from the same vendor."""
    monkeypatch.setattr("app.modules.p2p.routes.goods_receipts._po_approval_block_reason", lambda db, po: None)
    item, loc = setup_item(db, "Plate 8mm")
    requester = _requester(db, "qi.req2@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"store_item_id": item.id, "quantity": per_grn * 2, "project_inhouse": "Project"}])
    buyer = _purchaser(db, "qi.buyer2@premnathrail.com")
    _raise_po(client, db, pr, buyer)
    po = next(p for p in client.get("/api/v1/p2p/purchase-orders", headers=hdr(buyer)).json() if p["p2p_request_id"] == pr["id"])
    grns = []
    for _ in range(2):
        g = client.post("/api/v1/p2p/goods-receipts", json={
            "purchase_order_id": po["id"], "store_location_id": loc.id,
            "items": [{"po_item_id": po["items"][0]["id"], "received_quantity": per_grn}]}, headers=hdr(buyer))
        assert g.status_code == 200, g.text
        grns.append(g.json())
    return item, loc, buyer, grns


def test_first_article_control_is_off_by_default_so_every_grn_lot_is_accepted(client, db, people, monkeypatch):
    item, loc, buyer, grns = _two_grns(client, db, monkeypatch)
    lots = client.get(L, headers=hdr(people["insp"])).json()
    assert len(lots) == 2 and {l["inspection_type"] for l in lots} == {"incoming"}  # no first-article lot
    for lot in sorted(lots, key=lambda x: x["id"]):
        _record(client, _get(client, lot["id"], people["insp"]), people["insp"])
        r = client.post(f"{L}/{lot['id']}/decision", json={"decision": "accept"}, headers=hdr(people["head"]))
        assert r.status_code == 200, r.text  # no "Rule 9" refusal on the second lot of the same item + vendor
    assert balance(db, item, loc).on_hand_qty == 20


def test_first_article_control_on_blocks_the_second_lot_until_the_first_is_approved(client, db, people, monkeypatch):
    _set_rule(db, "first_article_on_new_vendor", "on")
    item, loc, buyer, grns = _two_grns(client, db, monkeypatch)
    all_lots = client.get(L, headers=hdr(people["insp"])).json()
    assert sorted(l["inspection_type"] for l in all_lots) == ["first_article", "incoming"]
    second = next(l for l in all_lots if l["inspection_type"] == "incoming")
    _record(client, _get(client, second["id"], people["insp"]), people["insp"])
    r = client.post(f"{L}/{second['id']}/decision", json={"decision": "accept"}, headers=hdr(people["head"]))
    assert r.status_code == 409 and "Rule 9" in r.json()["detail"] and "→" not in r.json()["detail"]


def test_ncr_is_not_raised_by_default_and_rejected_stock_goes_to_blocked(client, db, people):
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"])
    _record(client, _get(client, lot.id, people["insp"]), people["insp"], fail="Dimension")
    r = client.post(f"{L}/{lot.id}/decision", json={"decision": "reject"}, headers=hdr(people["head"]))
    assert r.status_code == 200, r.text
    assert r.json()["ncrs"] == []
    from app.modules.quality.models.ncr import QualityNcr
    assert db.query(QualityNcr).count() == 0
    b = balance(db, item, loc)
    assert (b.on_hand_qty, b.quality_qty, b.quarantine_qty) == (0, 0, 20)


def test_deviation_without_ncr_keeps_the_deviation_number_on_the_lot(client, db, people):
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"])
    _record(client, _get(client, lot.id, people["insp"]), people["insp"], fail="Appearance")
    r = client.post(f"{L}/{lot.id}/decision", json={"decision": "accept_with_deviation", "deviation_reference": "DEV-77"}, headers=hdr(people["head"]))
    assert r.status_code == 200, r.text
    assert r.json()["deviation_reference"] == "DEV-77" and r.json()["ncrs"] == []
    assert balance(db, item, loc).on_hand_qty == 20


def test_ncr_is_raised_when_the_rule_is_switched_on(client, db, people):
    _set_rule(db, "ncr_auto_raise", "on")
    item, loc = setup_item(db)
    lot = _incoming_lot(db, item, loc, people["eng"])
    _record(client, _get(client, lot.id, people["insp"]), people["insp"], fail="Dimension")
    r = client.post(f"{L}/{lot.id}/decision", json={"decision": "reject"}, headers=hdr(people["head"]))
    assert r.status_code == 200 and len(r.json()["ncrs"]) == 1


def test_rules_are_quality_settings(client, db, people):
    r = client.get(f"{Q}/settings", headers=hdr(people["head"]))
    assert r.status_code == 200, r.text
    vals = r.json()["values"]
    assert vals["first_article_on_new_vendor"] == "off" and vals["ncr_auto_raise"] == "off"
    r = client.put(f"{Q}/settings", json={"values": {"ncr_auto_raise": "maybe"}}, headers=hdr(people["head"]))
    assert r.status_code in (400, 422) and "must be one of" in r.json()["detail"]


def test_lot_list_views_match_the_dashboard_cards(client, db, people):
    item, loc = setup_item(db)
    a = _incoming_lot(db, item, loc, people["eng"])
    b = _incoming_lot(db, item, loc, people["eng"])
    c = _incoming_lot(db, item, loc, people["eng"])
    assert client.post(f"{L}/{b.id}/start", headers=hdr(people["eng"])).status_code == 200
    _record(client, _get(client, c.id, people["insp"]), people["insp"], fail="Dimension")
    assert client.post(f"{L}/{c.id}/decision", json={"decision": "reject"}, headers=hdr(people["head"])).status_code == 200

    def ids(view):
        r = client.get(L, params={"view": view}, headers=hdr(people["eng"]))
        assert r.status_code == 200, r.text
        return {x["id"] for x in r.json()}
    assert ids("waiting") == {a.id, b.id}
    assert ids("in_inspection") == {b.id}
    assert ids("overdue") == set()
    assert ids("decided_month") == {c.id} and ids("rejected_month") == {c.id}
    k = client.get(f"{Q}/dashboard", headers=hdr(people["eng"])).json()["kpis"]
    assert (k["lots_waiting"], k["lots_in_inspection"], k["month_lots_decided"]) == (2, 1, 1)
    from datetime import date, timedelta
    a.lot_date = date.today() - timedelta(days=10)
    db.commit()
    assert ids("overdue") == {a.id}
    r = client.get(L, params={"view": "bogus"}, headers=hdr(people["eng"]))
    assert r.status_code == 422 and "waiting" in r.json()["detail"]


def test_tightened_doubling_is_only_for_the_standard_checklist(db):
    from app.modules.quality.services.sampling import sampling_for_line
    kw = dict(lot_size=100, classification="major", sampling_type="fixed", aql=None, level="II", severity="tightened", fixed_sample_size=5)
    assert sampling_for_line(db, **kw).sample_size == 5  # another fixed plan (or a first article) is unchanged
    assert sampling_for_line(db, double_fixed_when_tightened=True, **kw).sample_size == 10


def test_rejected_grn_stock_can_go_back_to_the_vendor_without_an_ncr(client, db, people, monkeypatch):
    """NCR off: a rejected incoming lot's stock sits in Blocked stock; Store's Return to Vendor must be able to send it back."""
    item, loc, buyer, grns = _two_grns(client, db, monkeypatch, per_grn=10)
    lots = sorted(client.get(L, headers=hdr(people["insp"])).json(), key=lambda x: x["id"])
    _record(client, _get(client, lots[0]["id"], people["insp"]), people["insp"], fail="Dimension")
    assert client.post(f"{L}/{lots[0]['id']}/decision", json={"decision": "reject"}, headers=hdr(people["head"])).status_code == 200
    grn = client.get(f"/api/v1/p2p/goods-receipts/{grns[0]['id']}", headers=hdr(buyer)).json()
    line = grn["items"][0]
    assert line["rejected_quantity"] == 10
    r = client.post("/api/v1/p2p/vendor-returns", json={
        "goods_receipt_id": grn["id"], "reason": "quality_rejection",
        "items": [{"grn_item_id": line["id"], "source": "rejected", "quantity": 10}]}, headers=hdr(buyer))
    assert r.status_code == 201, r.json()  # no NCR (auto-raise off) → Store returns it straight from Blocked stock
    assert balance(db, item, loc).quarantine_qty == 0  # the Blocked stock left with the vendor
