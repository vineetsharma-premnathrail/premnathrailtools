"""Quality Phase 2 — production & dispatch: in-process gate lots (next
operation held), first article inspection (rule 9), job work receipt lots,
customer / third-party inspection calls, dispatch block (rule 8), store
quarantine clear routed through the NCR, documents of record, lot photos,
inspection call reminders."""
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.modules.erp.models.project import Project
from app.modules.main.models.notification import Notification
from app.modules.production.models.work_order import ProductionWorkOrder, ProductionWorkOrderOperation
from app.modules.quality.models.first_article import QualityFirstArticle
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.services import first_article as fai_service
from app.modules.quality.services.lots import create_lot_for_grn_line, create_lot_for_production_output
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.tests.test_quality_phase1 import (  # noqa: F401  (fixture)
    Q, make_user, hdr, setup_item, balance, approved_plan, defect, record_all, defect_id_cache, release_fai,
    _sqlite_number_series,
)


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    import app.middleware.owasp as owasp
    monkeypatch.setitem(owasp.RATE_CONFIG["write"], "limit", 100000)


def _team(db, tag):
    eng = make_user(db, f"eng-{tag}@x.com", apps=("quality", "store", "production"), quality_role="engineer")
    head = make_user(db, f"head-{tag}@x.com", apps=("quality", "store", "production"), quality_role="head")
    return eng, head


def _grn_lot(db, item, loc, vendor, user, qty=10, n=[0]):
    n[0] += 1
    grn = SimpleNamespace(id=n[0], store_location_id=loc.id, grn_number=f"GRN-T-{n[0]}", received_date=date.today())
    line = SimpleNamespace(id=None, received_quantity=qty)
    lot = create_lot_for_grn_line(db, grn, line, item, vendor, user.id)
    db.commit()
    return lot


def _inspect_and_decide(client, lot_id, eng, head, decision="accept", **extra):
    lot = client.get(f"{Q}/inspection-lots/{lot_id}", headers=hdr(eng)).json()
    lot = record_all(client, lot, eng, fail_first=decision in ("reject", "accept_with_deviation"))
    return client.post(f"{Q}/inspection-lots/{lot['id']}/decision", json={"decision": decision, **extra}, headers=hdr(head))


# --- In-process gates ---------------------------------------------------------

def test_in_process_gate_lot_holds_next_operation_until_decided(client, db):
    eng, head = _team(db, "ip")
    supervisor = make_user(db, "sup-ip@x.com", apps=("production",))
    item, loc = setup_item(db, "Bogie frame", flagged=False)
    approved_plan(client, db, item, eng, head, inspection_type="in_process")
    wo = ProductionWorkOrder(wo_number="WO-T-1", product_item_id=item.id, bom_id=1, quantity_planned=4, status="in_progress",
                             supervisor_id=supervisor.id)
    db.add(wo)
    db.flush()
    weld = ProductionWorkOrderOperation(work_order_id=wo.id, sequence=10, operation_name="Weld", requires_inspection=True, status="in_progress")
    paint = ProductionWorkOrderOperation(work_order_id=wo.id, sequence=20, operation_name="Paint")
    db.add_all([weld, paint])
    db.commit()
    base = f"/api/v1/production/work-orders/{wo.id}/operations"

    r = client.post(f"{base}/{weld.id}/complete", json={}, headers=hdr(eng))
    assert r.status_code == 409 and "Request Inspection" in r.json()["detail"]
    w = client.post(f"{base}/{weld.id}/request-inspection", headers=hdr(eng)).json()
    gate = next(o for o in w["operations"] if o["id"] == weld.id)
    assert gate["inspection_status"] == "pending" and gate["quality_lot_id"]
    lot = db.get(QualityInspectionLot, gate["quality_lot_id"])
    assert lot.inspection_type == "in_process" and lot.source_type == "work_order_operation" and lot.plan_id

    held = client.post(f"{base}/{paint.id}/start", headers=hdr(eng))
    assert held.status_code == 409 and "on hold" in held.json()["detail"] and lot.lot_number in held.json()["detail"]
    assert client.post(f"{base}/{weld.id}/complete", json={}, headers=hdr(eng)).status_code == 409

    r = _inspect_and_decide(client, lot.id, eng, head)
    assert r.status_code == 200, r.text
    assert r.json()["gate"]["wo_number"] == "WO-T-1"
    assert db.query(Notification).filter_by(user_id=supervisor.id, notification_type="production_inspection_result").count() == 1
    assert client.post(f"{base}/{weld.id}/complete", json={}, headers=hdr(eng)).status_code == 200
    assert client.post(f"{base}/{paint.id}/start", headers=hdr(eng)).status_code == 200


def test_rejected_gate_raises_ncr_and_can_be_requested_again(client, db):
    eng, head = _team(db, "ip2")
    item, _ = setup_item(db, "Axle", flagged=False)
    approved_plan(client, db, item, eng, head, inspection_type="in_process")
    wo = ProductionWorkOrder(wo_number="WO-T-2", product_item_id=item.id, bom_id=1, quantity_planned=3, status="in_progress")
    db.add(wo)
    db.flush()
    op = ProductionWorkOrderOperation(work_order_id=wo.id, sequence=10, operation_name="Machine", requires_inspection=True)
    db.add(op)
    db.commit()
    base = f"/api/v1/production/work-orders/{wo.id}/operations/{op.id}"
    lot_id = client.post(f"{base}/request-inspection", headers=hdr(eng)).json()["operations"][0]["quality_lot_id"]
    defect_id_cache["id"] = defect(db).id
    r = _inspect_and_decide(client, lot_id, eng, head, decision="reject")
    assert r.status_code == 200 and len(r.json()["ncrs"]) == 1
    r = client.post(f"{base}/complete", json={}, headers=hdr(eng))
    assert r.status_code == 409 and "rejected" in r.json()["detail"]
    again = client.post(f"{base}/request-inspection", headers=hdr(eng)).json()["operations"][0]
    assert again["quality_lot_id"] != lot_id and again["inspection_status"] == "pending"


# --- First article (rule 9) ----------------------------------------------------

def test_first_article_from_grn_blocks_regular_lots_until_approved(client, db):
    eng, head = _team(db, "fai")
    item, loc = setup_item(db, "Wheel disc")
    approved_plan(client, db, item, eng, head)  # incoming plan (no own FAI plan → fallback, fixed sample)

    first = _grn_lot(db, item, loc, "Acme Forge", eng, qty=40)
    assert first.inspection_type == "first_article"
    fai = db.query(QualityFirstArticle).filter_by(lot_id=first.id).one()
    assert fai.trigger == "new_item" and fai.vendor_name == "Acme Forge" and fai.status == "open"
    non_critical = [r for r in first.results if r.classification != "critical"]
    assert non_critical and all(r.sample_size == 5 and r.accept_number == 0 for r in non_critical)

    second = _grn_lot(db, item, loc, "Acme Forge", eng)
    assert second.inspection_type == "incoming"
    r = _inspect_and_decide(client, second.id, eng, head)
    assert r.status_code == 409 and "Rule 9" in r.json()["detail"] and fai.fai_number in r.json()["detail"]

    # FAI can't be approved before its lot is decided; engineer approves after.
    r = client.post(f"{Q}/first-articles/{fai.id}/decision", json={"approve": True}, headers=hdr(eng))
    assert r.status_code == 409 and "usage decision" in r.json()["detail"]
    assert _inspect_and_decide(client, first.id, eng, head).status_code == 200
    inspector = make_user(db, "insp-fai@x.com", quality_role="inspector")
    assert client.post(f"{Q}/first-articles/{fai.id}/decision", json={"approve": True}, headers=hdr(inspector)).status_code == 403
    r = client.post(f"{Q}/first-articles/{fai.id}/decision", json={"approve": True}, headers=hdr(eng))
    assert r.status_code == 200 and r.json()["status"] == "approved"
    assert client.post(f"{Q}/inspection-lots/{second.id}/decision", json={"decision": "accept"}, headers=hdr(head)).status_code == 200

    # A new vendor needs its own first article.
    beta = _grn_lot(db, item, loc, "Beta Castings", eng)
    assert beta.inspection_type == "first_article"
    assert db.query(QualityFirstArticle).filter_by(lot_id=beta.id).one().trigger == "new_vendor"


def test_new_drawing_revision_needs_first_article(client, db):
    from app.modules.design.models.document import DesignDocument, DesignDocumentRevision
    eng, head = _team(db, "rev")
    item, loc = setup_item(db, "Guide wheel")
    approved_plan(client, db, item, eng, head)
    doc = DesignDocument(doc_number="DWG-0042", title="Guide wheel", document_type="part_drawing", discipline="mechanical",
                         store_item_id=item.id, status="active")
    db.add(doc)
    db.flush()
    db.add(DesignDocumentRevision(document_id=doc.id, revision_index=0, revision_label="A", status="released"))
    db.commit()
    assert fai_service.current_drawing_ref(db, item.id) == "DWG-0042 rev A"
    db.add(QualityFirstArticle(fai_number="FAI-OLD", item_id=item.id, item_name=item.item_name, vendor_name="Acme",
                               drawing_ref="DWG-0042 rev A", trigger="new_item", status="approved", source_type="manual"))
    db.commit()
    assert _grn_lot(db, item, loc, "Acme", eng).inspection_type == "incoming"
    db.query(DesignDocumentRevision).filter_by(document_id=doc.id).update({"status": "superseded"})
    db.add(DesignDocumentRevision(document_id=doc.id, revision_index=1, revision_label="B", status="released"))
    db.commit()
    lot = _grn_lot(db, item, loc, "Acme", eng)
    assert lot.inspection_type == "first_article"
    fai = db.query(QualityFirstArticle).filter_by(lot_id=lot.id).one()
    assert fai.trigger == "new_revision" and fai.drawing_ref == "DWG-0042 rev B"


def test_production_release_waits_for_in_house_first_article(db):
    item, loc = setup_item(db, "Rail clamp")
    eng = make_user(db, "eng-prod-fai@x.com", quality_role="engineer")
    lot = create_lot_for_production_output(db, work_order=SimpleNamespace(id=1, wo_number="WO-1"), item=item, quantity=1,
                                           location_id=loc.id, batch_number="WO-1", user_id=eng.id)
    assert lot.inspection_type == "first_article"
    fai_service.check_production_release(db, item, "WO-1")  # the FAI's own work order is fine
    with pytest.raises(fai_service.FaiError) as e:
        fai_service.check_production_release(db, item, "WO-2")
    assert "Rule 9" in str(e.value)


# --- Job work receipt -------------------------------------------------------------

def test_job_work_receipt_goes_to_quality_lot(client, db):
    eng, _ = _team(db, "jw")
    item, loc = setup_item(db, "Machined hub")
    release_fai(db, item, "Precision Works")
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=10)
    db.commit()
    issue = client.post("/api/v1/store/material-issues", json={
        "location_id": loc.id, "issue_type": "production", "vendor_name": "Precision Works",
        "items": [{"item_id": item.id, "quantity": 4}]}, headers=hdr(eng))
    assert issue.status_code == 200, issue.text
    ret = client.post("/api/v1/store/material-returns", json={
        "location_id": loc.id, "source_type": "issue", "source_issue_id": issue.json()["id"],
        "items": [{"item_id": item.id, "quantity": 4, "condition": "good"}]}, headers=hdr(eng))
    assert ret.status_code == 200, ret.text
    lot = db.query(QualityInspectionLot).filter_by(source_type="material_return").one()
    assert lot.inspection_type == "job_work" and lot.vendor_name == "Precision Works" and lot.stock_in_quality
    b = balance(db, item, loc)
    assert (b.on_hand_qty, b.quality_qty) == (6, 4)


# --- Inspection calls + dispatch (rule 8) ------------------------------------------

def _decided_final_lot(client, db, item, loc, eng, head, qty=5, batch="WO-9"):
    release_fai(db, item)
    lot = create_lot_for_production_output(db, work_order=SimpleNamespace(id=9, wo_number=batch), item=item, quantity=qty,
                                           location_id=loc.id, batch_number=batch, user_id=eng.id)
    db.commit()
    approved_plan(client, db, item, eng, head, inspection_type="final")
    client.post(f"{Q}/inspection-lots/{lot.id}/refresh-plan", headers=hdr(eng))
    r = _inspect_and_decide(client, lot.id, eng, head)
    assert r.status_code == 200, r.text
    return lot


def test_dispatch_needs_final_inspection_and_third_party_certificate(client, db):
    eng, head = _team(db, "dsp")
    item, loc = setup_item(db, "Tamping unit")
    project = Project(serial_number="PRT-TU-01", model_name="Tamper", client_company="Northern Railway", po_number="NR/PO/77",
                      third_party_inspection_required=True, inspection_agency="rites")
    db.add(project)
    db.commit()
    dispatch = lambda qty, batch="WO-9": client.post("/api/v1/store/material-issues", json={  # noqa: E731
        "location_id": loc.id, "issue_type": "dispatch", "erp_project_id": project.id, "challan_number": "DC-1",
        "items": [{"item_id": item.id, "quantity": qty, "batch_number": batch}]}, headers=hdr(eng))

    r = dispatch(1)
    assert r.status_code == 409 and "no decided final inspection" in r.json()["detail"]
    _decided_final_lot(client, db, item, loc, eng, head)
    r = dispatch(2)
    assert r.status_code == 409 and "RITES" in r.json()["detail"] and "Inspection Calls" in r.json()["detail"]
    noproj = client.post("/api/v1/store/material-issues", json={"location_id": loc.id, "issue_type": "dispatch",
                         "items": [{"item_id": item.id, "quantity": 1, "batch_number": "WO-9"}]}, headers=hdr(eng))
    assert noproj.status_code == 422

    call = client.post(f"{Q}/inspection-calls", json={"erp_project_id": project.id, "item_id": item.id, "quantity": 3,
                                                     "batch_number": "WO-9", "call_date": str(date.today())}, headers=hdr(eng))
    assert call.status_code == 200, call.text
    call = call.json()
    assert call["agency"] == "rites" and call["status"] == "scheduled" and call["order_reference"] == "NR/PO/77"
    r = client.post(f"{Q}/inspection-calls/{call['id']}/result", json={"result": "accepted"}, headers=hdr(eng))
    assert r.status_code == 422 and "certificate" in r.json()["detail"]
    r = client.post(f"{Q}/inspection-calls/{call['id']}/result", json={"result": "accepted", "certificate_number": "RITES/IC/123"}, headers=hdr(eng))
    assert r.status_code == 200 and r.json()["status"] == "accepted"
    assert client.post(f"{Q}/inspection-calls/{call['id']}/result", json={"result": "rejected", "remarks": "x"}, headers=hdr(eng)).status_code == 409

    assert dispatch(2).status_code == 200
    r = dispatch(2)
    assert r.status_code == 409 and "1 can still go" in r.json()["detail"]
    check = client.post(f"{Q}/inspection-calls/dispatch-check", json={"item_id": item.id, "quantity": 1, "batch_number": "WO-9",
                                                                      "erp_project_id": project.id}, headers=hdr(eng)).json()
    assert check["allowed"] is True


def test_rejected_inspection_call_raises_ncr(client, db):
    eng, head = _team(db, "icr")
    item, loc = setup_item(db, "Brake beam", flagged=False)
    call = client.post(f"{Q}/inspection-calls", json={"order_reference": "CR/PO/1", "item_id": item.id, "quantity": 4,
                                                     "agency": "customer"}, headers=hdr(eng)).json()
    assert call["status"] == "requested"
    r = client.post(f"{Q}/inspection-calls/{call['id']}/result", json={
        "result": "partially_accepted", "accepted_qty": 3, "rejected_qty": 1, "certificate_number": "CUST-9",
        "remarks": "Weld spatter on one beam", "result_date": str(date.today())}, headers=hdr(eng))
    assert r.status_code == 200, r.text
    ncr = db.get(QualityNcr, r.json()["ncr_id"])
    assert ncr.source == "customer_inspection" and ncr.quantity == 1 and ncr.auto_raised


def test_contract_requirement_is_quality_head_only(client, db):
    eng, head = _team(db, "ctr")
    project = Project(serial_number="PRT-X-1")
    db.add(project)
    db.commit()
    body = {"third_party_inspection_required": True, "inspection_agency": "rdso"}
    assert client.put(f"{Q}/inspection-calls/contracts/{project.id}", json=body, headers=hdr(eng)).status_code == 403
    assert client.put(f"{Q}/inspection-calls/contracts/{project.id}", json={"third_party_inspection_required": True, "inspection_agency": "bogus"},
                      headers=hdr(head)).status_code == 422
    assert client.put(f"{Q}/inspection-calls/contracts/{project.id}", json=body, headers=hdr(head)).json()["inspection_agency"] == "rdso"


def test_inspection_call_reminder_goes_to_engineers_on_teams(client, db, monkeypatch):
    from app.tasks.quality_reminders import _send_quality_reminders
    sent = []
    monkeypatch.setattr("app.tasks.quality_reminders.notify_user", lambda db, **kw: sent.append(kw))
    eng, _ = _team(db, "rem")
    item, _ = setup_item(db, "Coupler", flagged=False)
    client.post(f"{Q}/inspection-calls", json={"order_reference": "PO-5", "item_id": item.id, "quantity": 1, "agency": "rites",
                                              "call_date": str(date.today() + timedelta(days=1))}, headers=hdr(eng))
    _send_quality_reminders(db)
    calls = [k for k in sent if k["notification_type"] == "quality_inspection_call_due"]
    assert calls and all(k["teams"] for k in calls) and "tomorrow" in calls[0]["message"]


# --- Store quarantine clear can't release NCR-blocked stock -------------------------

def test_quarantine_clear_refuses_ncr_blocked_stock(client, db):
    eng, head = _team(db, "qc")
    item, loc = setup_item(db, "Spring", flagged=False)
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=10)
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="quarantine_in", quantity=2)
    db.commit()
    ncr = client.post(f"{Q}/ncr", json={"source": "internal", "severity": "minor", "item_id": item.id, "quantity": 3,
                                       "location_id": loc.id, "block_stock": True, "description": "Cracked coils"}, headers=hdr(eng))
    assert ncr.status_code == 200, ncr.text
    clear = lambda q: client.post("/api/v1/store/stock/quarantine/clear", json={  # noqa: E731
        "item_id": item.id, "location_id": loc.id, "quantity": q, "disposition": "release"}, headers=hdr(eng))
    r = clear(3)
    assert r.status_code == 409 and ncr.json()["ncr_number"] in r.json()["detail"] and "Only 2" in r.json()["detail"]
    assert clear(2).status_code == 200  # the returned-damaged quantity isn't Quality's


# --- Documents of record + photos -----------------------------------------------------

def test_documents_render_from_decided_lot_and_deviation(client, db):
    pytest.importorskip("app.utils.docx_letterhead")  # letterhead helper ships with the managed-documents framework
    from app.modules.quality.reports import documents as qdocs
    from app.modules.quality.reports.render import render_docx, render_pdf
    eng, head = _team(db, "doc")
    head2 = make_user(db, "head2-doc@x.com", quality_role="head")
    item, loc = setup_item(db, "Rail anchor", flagged=False)
    approved_plan(client, db, item, eng, head, inspection_type="stock_reinspection")
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=10)
    db.commit()
    lot = client.post(f"{Q}/inspection-lots", json={"inspection_type": "stock_reinspection", "item_id": item.id, "quantity": 10,
                                                   "location_id": loc.id, "take_from_free": True}, headers=hdr(eng)).json()
    r = client.get(f"{Q}/records/lots/{lot['id']}/inspection-report.pdf", headers=hdr(eng))
    assert r.status_code == 409 and "usage decision" in r.json()["detail"]
    defect_id_cache["id"] = defect(db).id
    r = _inspect_and_decide(client, lot["id"], eng, head2, decision="accept_with_deviation", deviation_reference="CONC-7")
    assert r.status_code == 200, r.text
    db.expire_all()
    lot_row = db.get(QualityInspectionLot, lot["id"])
    for spec in (qdocs.inspection_report_spec(db, lot_row), qdocs.test_certificate_spec(db, lot_row)):
        assert render_docx(spec)[:2] == b"PK" and render_pdf(spec, "test")[:4] == b"%PDF"
    assert "CONC-7" in qdocs.test_certificate_spec(db, lot_row)["statement"]
    r = client.get(f"{Q}/records/lots/{lot['id']}/test-certificate.pdf", headers=hdr(eng))
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    ncr_id = r_ncr = next(n["id"] for n in client.get(f"{Q}/inspection-lots/{lot['id']}", headers=hdr(eng)).json()["ncrs"])
    r_ncr = client.get(f"{Q}/records/ncr/{ncr_id}/deviation-approval.pdf", headers=hdr(eng))
    assert r_ncr.status_code == 200 and r_ncr.content[:4] == b"%PDF"
    ncr = db.get(QualityNcr, ncr_id)
    assert render_docx(qdocs.deviation_spec(db, ncr))[:2] == b"PK"


def test_lot_photos_only_while_open(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "site-1")

    async def fake_upload(site, folder, f):
        return {"path": f"{folder}/{f.filename}"}
    monkeypatch.setattr("app.utils.sharepoint.upload_file_to_sharepoint", fake_upload)
    eng, head = _team(db, "ph")
    item, loc = setup_item(db, "Pad", flagged=False)
    approved_plan(client, db, item, eng, head, inspection_type="stock_reinspection")
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=4)
    db.commit()
    lot = client.post(f"{Q}/inspection-lots", json={"inspection_type": "stock_reinspection", "item_id": item.id, "quantity": 4,
                                                   "location_id": loc.id, "take_from_free": True}, headers=hdr(eng)).json()
    bad = client.post(f"{Q}/inspection-lots/{lot['id']}/photos", files={"files": ("a.txt", b"x", "text/plain")}, headers=hdr(eng))
    assert bad.status_code == 400 and "isn't an image" in bad.json()["detail"]
    r = client.post(f"{Q}/inspection-lots/{lot['id']}/photos", files={"files": ("crack.jpg", b"\xff\xd8\xff", "image/jpeg")},
                    data={"result_id": str(lot["results"][0]["id"]), "caption": "Crack at weld"}, headers=hdr(eng))
    assert r.status_code == 200, r.text
    assert r.json()["photos"][0]["caption"] == "Crack at weld"
    assert _inspect_and_decide(client, lot["id"], eng, head).status_code == 200
    r = client.post(f"{Q}/inspection-lots/{lot['id']}/photos", files={"files": ("late.jpg", b"\xff\xd8\xff", "image/jpeg")}, headers=hdr(eng))
    assert r.status_code == 409 and "part of the record" in r.json()["detail"]
