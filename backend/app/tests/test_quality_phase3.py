"""Quality Phase 3 — improvement: CAPA 8D (triggers, stage checks, D8
effectiveness, reopen, rule 6 for NCR closure, overdue reminders, 8D
report), customer complaints (NCR + CAPA, response, close only when the
CAPA is effective, repeat flag, traceability / containment), supplier
quality (approved vendor list ↔ FAI, monthly rating → On watch / tightened
sampling / vendor CAPA → Blocked with Partner approval, blocked vendor
stops lot acceptance and POs, switching to reduced / skip-lot), defect Pareto."""
from datetime import date, timedelta

import pytest

from app.modules.main.models.user import User
from app.modules.quality.models.capa import QualityCapa, QualityCapaAction
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.models.supplier_quality import QualityApprovedVendor
from app.modules.quality.services import supplier_quality as sq
from app.modules.quality.services.ncr import create_manual as create_ncr
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.tests.test_quality_phase1 import (  # noqa: F401  (fixture)
    Q, make_user, hdr, setup_item, approved_plan, defect, record_all, defect_id_cache, release_fai, _rejected_ncr,
    _sqlite_number_series,
)
from app.tests.test_quality_phase2 import _grn_lot, _inspect_and_decide


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    import app.middleware.owasp as owasp
    monkeypatch.setitem(owasp.RATE_CONFIG["write"], "limit", 100000)


def _team(db, tag):
    eng = make_user(db, f"eng-{tag}@x.com", apps=("quality", "store", "purchase"), quality_role="engineer")
    head = make_user(db, f"head-{tag}@x.com", apps=("quality", "store", "purchase"), quality_role="head")
    return eng, head


def _period():
    t = date.today()
    return f"{t.year}-{t.month:02d}"


def _complete_d1_d4(client, capa_id, eng, head):
    r = client.patch(f"{Q}/capa/{capa_id}", json={
        "responsible_user_id": eng.id, "problem_statement": "Bore oversize on 3 lots",
        "containment_actions": "100% sorting of stock; hold dispatch", "root_cause_method": "why_why",
        "why_analysis": ["Bore oversize", "Tool worn", "No tool-life limit"], "root_cause": "No tool-life control on the boring bar",
    }, headers=hdr(eng))
    assert r.status_code == 200, r.text
    r = client.put(f"{Q}/capa/{capa_id}/team", json={"members": [{"user_id": eng.id, "role": "champion"},
                                                                 {"user_id": head.id, "role": "member"}]}, headers=hdr(eng))
    assert r.status_code == 200, r.text


# --- CAPA triggers + rule 6 ------------------------------------------------------

def test_major_ncr_raises_capa_and_ncr_closes_only_once_actions_are_planned(client, db):
    eng, head = _team(db, "c1")
    head2 = make_user(db, "head-c1b@x.com", quality_role="head")
    item, loc = setup_item(db, cost=10)
    ncr = _rejected_ncr(client, db, item, loc, eng, head2, recorder=eng)
    capa = db.query(QualityCapa).filter(QualityCapa.ncr_id == ncr.id).one()
    assert capa.trigger == "ncr" and capa.status == "open" and capa.defect_code_id == ncr.defect_code_id

    from app.modules.quality.services.capa import ncr_closure_problem
    assert "still 'Open'" in ncr_closure_problem(db, ncr)
    capa.status = "root_cause_found"
    db.commit()
    assert ncr_closure_problem(db, ncr)
    capa.status = "actions_in_progress"
    db.commit()
    assert ncr_closure_problem(db, ncr) is None


def test_same_defect_three_times_in_window_raises_repeat_defect_capa(client, db):
    eng, _ = _team(db, "c2")
    item, _ = setup_item(db, "Spring")
    code = defect(db)
    ncrs = [create_ncr(db, {"source": "internal", "severity": "minor", "item_id": item.id, "quantity": 1,
                            "defect_code_id": code.id, "description": f"Crack {i}"}, eng) for i in range(3)]
    db.commit()
    capas = db.query(QualityCapa).filter(QualityCapa.item_id == item.id).all()
    assert len(capas) == 1 and capas[0].trigger == "repeat_defect"
    assert {l.ncr_id for l in capas[0].ncr_links} == {n.id for n in ncrs}
    # A fourth repeat links to the same open CAPA.
    n4 = create_ncr(db, {"source": "internal", "severity": "minor", "item_id": item.id, "quantity": 1,
                         "defect_code_id": code.id, "description": "Crack 4"}, eng)
    db.commit()
    db.refresh(capas[0])
    assert db.query(QualityCapa).filter(QualityCapa.item_id == item.id).count() == 1
    assert n4.id in {l.ncr_id for l in capas[0].ncr_links}


# --- CAPA 8D workflow ----------------------------------------------------------------

def test_capa_8d_stage_checks_effectiveness_and_reopen(client, db):
    eng, head = _team(db, "c3")
    inspector = make_user(db, "insp-c3@x.com", quality_role="inspector")
    assert client.post(f"{Q}/capa", json={"title": "x"}, headers=hdr(inspector)).status_code == 403
    r = client.post(f"{Q}/capa", json={"title": "Bore oversize repeats", "severity": "major"}, headers=hdr(eng))
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    r = client.post(f"{Q}/capa/{cid}/advance", headers=hdr(eng))
    assert r.status_code == 422 and "D2 problem" in r.json()["detail"] and "D4 root cause" in r.json()["detail"]
    _complete_d1_d4(client, cid, eng, head)
    assert client.post(f"{Q}/capa/{cid}/advance", headers=hdr(eng)).json()["status"] == "root_cause_found"
    # D5 needed before actions start.
    assert client.post(f"{Q}/capa/{cid}/advance", headers=hdr(eng)).status_code == 422
    due = str(date.today() + timedelta(days=10))
    assert client.post(f"{Q}/capa/{cid}/actions", json={"description": "Fix", "owner_id": eng.id,
                                                        "due_date": str(date.today() - timedelta(days=1))}, headers=hdr(eng)).status_code == 422
    body = client.post(f"{Q}/capa/{cid}/actions", json={"description": "Tool-life counter on boring bar", "owner_id": eng.id,
                                                        "due_date": due}, headers=hdr(eng)).json()
    assert client.post(f"{Q}/capa/{cid}/advance", headers=hdr(eng)).json()["status"] == "actions_in_progress"
    act_id = body["actions"][0]["id"]
    r = client.post(f"{Q}/capa/{cid}/advance", headers=hdr(eng))
    assert r.status_code == 422 and "still open" in r.json()["detail"]
    assert client.post(f"{Q}/capa/{cid}/actions/{act_id}/done", json={}, headers=hdr(eng)).status_code == 422  # evidence
    client.post(f"{Q}/capa/{cid}/actions/{act_id}/done", json={"evidence": "Counter fitted, SOP-12"}, headers=hdr(eng))
    r = client.post(f"{Q}/capa/{cid}/advance", headers=hdr(eng))
    assert r.status_code == 422 and "D7" in r.json()["detail"]
    # D7: an inspection-plan update needs the document reference.
    body = client.post(f"{Q}/capa/{cid}/actions", json={"kind": "preventive", "prevention_type": "update_inspection_plan",
                                                        "description": "Add bore check every 10 pcs", "owner_id": eng.id,
                                                        "due_date": due}, headers=hdr(eng)).json()
    prev_id = next(a["id"] for a in body["actions"] if a["kind"] == "preventive")
    assert client.post(f"{Q}/capa/{cid}/actions/{prev_id}/done", json={"evidence": "Plan revised"}, headers=hdr(eng)).status_code == 422
    client.post(f"{Q}/capa/{cid}/actions/{prev_id}/done", json={"evidence": "Plan revised", "evidence_reference": "IP-2026-0004 rev 2"},
                headers=hdr(eng))
    body = client.post(f"{Q}/capa/{cid}/advance", headers=hdr(eng)).json()
    assert body["status"] == "effectiveness_check" and body["effectiveness_due_date"] == str(date.today() + timedelta(days=90))

    # D8: Quality head only, and not before the period ends.
    assert client.post(f"{Q}/capa/{cid}/effectiveness", json={"effective": True}, headers=hdr(eng)).status_code == 403
    r = client.post(f"{Q}/capa/{cid}/effectiveness", json={"effective": True}, headers=hdr(head))
    assert r.status_code == 409 and "due on" in r.json()["detail"]
    # Not effective → reopened, actions superseded, report revision bumped.
    r = client.post(f"{Q}/capa/{cid}/effectiveness", json={"effective": False}, headers=hdr(head))
    assert r.status_code == 422
    body = client.post(f"{Q}/capa/{cid}/effectiveness", json={"effective": False, "remarks": "Recurred on line 2"}, headers=hdr(head)).json()
    assert body["status"] == "reopened" and body["report_revision"] == 1 and all(a["superseded"] for a in body["actions"])

    # Second round → effective after the period.
    assert client.post(f"{Q}/capa/{cid}/advance", headers=hdr(eng)).json()["status"] == "root_cause_found"
    client.post(f"{Q}/capa/{cid}/actions", json={"description": "Poka-yoke gauge", "owner_id": eng.id, "due_date": due}, headers=hdr(eng))
    client.patch(f"{Q}/capa/{cid}", json={"prevention_not_needed_reason": "Covered by the earlier plan update"}, headers=hdr(eng))
    a = db.query(QualityCapaAction).filter(QualityCapaAction.capa_id == cid, QualityCapaAction.superseded.is_(False)).one()
    client.post(f"{Q}/capa/{cid}/advance", headers=hdr(eng))
    client.post(f"{Q}/capa/{cid}/actions/{a.id}/done", json={"evidence": "Gauge in use"}, headers=hdr(eng))
    assert client.post(f"{Q}/capa/{cid}/advance", headers=hdr(eng)).json()["status"] == "effectiveness_check"
    capa = db.get(QualityCapa, cid)
    capa.effectiveness_due_date = date.today()
    db.commit()
    body = client.post(f"{Q}/capa/{cid}/effectiveness", json={"effective": True, "remarks": "No recurrence in 90 days"}, headers=hdr(head)).json()
    assert body["status"] == "closed" and body["effectiveness_result"] == "effective"
    assert client.patch(f"{Q}/capa/{cid}", json={"title": "edit"}, headers=hdr(head)).status_code == 409
    r = client.post(f"{Q}/capa/{cid}/reopen", json={"reason": "Customer reported again"}, headers=hdr(head))
    assert r.json()["status"] == "reopened" and r.json()["report_revision"] == 2


def test_overdue_capa_action_reminds_owner_and_heads_on_teams(client, db, monkeypatch):
    from app.tasks.quality_reminders import _send_capa_reminders
    sent = []
    monkeypatch.setattr("app.tasks.quality_reminders.notify_user", lambda db, **kw: sent.append(kw))
    eng, head = _team(db, "c4")
    owner = make_user(db, "owner-c4@x.com", apps=("production",))
    cid = client.post(f"{Q}/capa", json={"title": "Weld porosity"}, headers=hdr(eng)).json()["id"]
    body = client.post(f"{Q}/capa/{cid}/actions", json={"description": "Dry the electrodes", "owner_id": owner.id,
                                                        "due_date": str(date.today() + timedelta(days=1))}, headers=hdr(eng)).json()
    act = db.get(QualityCapaAction, body["actions"][0]["id"])
    act.due_date = date.today() - timedelta(days=2)
    db.commit()
    _send_capa_reminders(db)
    rows = [k for k in sent if k["notification_type"] == "quality_capa_action_overdue"]
    assert {k["user_id"] for k in rows} >= {owner.id, head.id} and all(k["teams"] for k in rows)
    # The action owner (outside Quality grants) can close their action with evidence.
    r = client.post(f"{Q}/capa/{cid}/actions/{act.id}/done", json={"evidence": "Oven installed"}, headers=hdr(owner))
    assert r.status_code == 403  # owner has no Quality app access → blocked at the router
    owner.assigned_apps = ["production", "quality"]
    db.commit()
    r = client.post(f"{Q}/capa/{cid}/actions/{act.id}/done", json={"evidence": "Oven installed"}, headers=hdr(owner))
    assert r.status_code == 200 and r.json()["actions"][0]["status"] == "done"


def test_8d_report_spec_and_render(client, db):
    from app.modules.quality.reports import documents as qdocs
    from app.modules.quality.reports.render import render_pdf
    eng, head = _team(db, "c5")
    cid = client.post(f"{Q}/capa", json={"title": "Paint peel"}, headers=hdr(eng)).json()["id"]
    capa = db.get(QualityCapa, cid)
    with pytest.raises(qdocs.DocumentNotReady):
        qdocs.capa_8d_spec(db, capa)
    _complete_d1_d4(client, cid, eng, head)
    client.patch(f"{Q}/capa/{cid}", json={"root_cause_method": "both", "fishbone": {"method": ["No pre-treatment"], "material": ["Old primer"]}},
                 headers=hdr(eng))
    client.post(f"{Q}/capa/{cid}/advance", headers=hdr(eng))
    db.expire_all()
    spec = qdocs.capa_8d_spec(db, db.get(QualityCapa, cid))
    headings = [s["heading"] for s in spec["sections"]]
    assert headings[0].startswith("D1") and any(h.startswith("D8") for h in headings)
    assert render_pdf(spec, "test")[:4] == b"%PDF"
    assert client.get(f"{Q}/records/capa/{cid}/8d-report.pdf", headers=hdr(eng)).status_code == 200
    try:
        import app.utils.docx_letterhead  # noqa: F401
    except ImportError:
        return
    from app.modules.quality.reports.render import render_docx
    assert render_docx(spec)[:2] == b"PK"


# --- Customer complaints ---------------------------------------------------------------

def test_complaint_flow_ncr_capa_response_and_close_only_when_capa_effective(client, db):
    eng, head = _team(db, "cc")
    item, loc = setup_item(db, "Brake beam", flagged=False)
    defect_id = defect(db).id
    r = client.post(f"{Q}/complaints", json={"customer_name": "Northern Railway", "item_id": item.id, "batch_number": "B-77",
                                             "description": "Weld crack after 2 months", "severity": "major",
                                             "category": "product_failure", "defect_code_id": defect_id, "source": "email"},
                    headers=hdr(eng))
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["status"] == "open" and c["repeat_of_id"] is None
    # Same customer + item → repeat.
    c2 = client.post(f"{Q}/complaints", json={"customer_name": "northern railway", "item_id": item.id, "description": "Again"},
                     headers=hdr(eng)).json()
    assert c2["repeat_of_number"] == c["complaint_number"]
    assert client.post(f"{Q}/complaints", json={"customer_name": "X", "description": "y", "category": "nope"}, headers=hdr(eng)).status_code == 422

    # Containment: the batch in stock and already dispatched.
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=5, batch_number="B-77")
    db.commit()
    cont = client.get(f"{Q}/complaints/{c['id']}/containment", headers=hdr(eng)).json()
    assert cont["in_stock"][0]["free"] == 5 and cont["keys"] == ["B-77"]

    body = client.post(f"{Q}/complaints/{c['id']}/investigate", json={"owner_id": eng.id}, headers=hdr(eng)).json()
    assert body["status"] == "under_investigation" and body["ncr_number"] and body["capa_number"]
    ncr = db.get(QualityNcr, body["ncr_id"])
    assert ncr.source == "complaint" and ncr.source_reference == c["complaint_number"]
    capa = db.get(QualityCapa, body["capa_id"])
    assert capa.trigger == "complaint" and capa.complaint_id == c["id"] and capa.responsible_user_id == eng.id

    # Response needs the CAPA root cause.
    r = client.post(f"{Q}/complaints/{c['id']}/response", json={"response_text": "8D attached"}, headers=hdr(eng))
    assert r.status_code == 409 and "root cause" in r.json()["detail"]
    capa.status = "root_cause_found"
    db.commit()
    assert client.post(f"{Q}/complaints/{c['id']}/response", json={"response_text": "8D attached"}, headers=hdr(eng)).json()["status"] == "response_sent"
    assert client.post(f"{Q}/complaints/{c['id']}/feedback", json={"accepted": True}, headers=hdr(eng)).status_code == 422
    body = client.post(f"{Q}/complaints/{c['id']}/feedback", json={"accepted": True, "reference": "Email 12-10"}, headers=hdr(eng)).json()
    assert body["status"] == "customer_accepted" and body["response_days"] == 0
    client.patch(f"{Q}/complaints/{c['id']}", json={"replacement_cost": 12000, "travel_cost": 3000}, headers=hdr(eng))

    assert client.post(f"{Q}/complaints/{c['id']}/close", json={}, headers=hdr(eng)).status_code == 403
    r = client.post(f"{Q}/complaints/{c['id']}/close", json={}, headers=hdr(head))
    assert r.status_code == 409 and "effective" in r.json()["detail"]
    capa.status, capa.effectiveness_result = "closed", "effective"
    db.commit()
    body = client.post(f"{Q}/complaints/{c['id']}/close", json={"resolution_notes": "Done"}, headers=hdr(head)).json()
    assert body["status"] == "closed" and body["total_cost"] == 15000
    stats = client.get(f"{Q}/complaints/stats", headers=hdr(head)).json()
    assert stats["repeats"] == 1 and stats["total_cost"] == 15000


def test_traceability_from_batch_to_grn_vendor_and_lots(client, db):
    eng, head = _team(db, "tr")
    item, loc = setup_item(db, "Coil spring")
    approved_plan(client, db, item, eng, head)
    release_fai(db, item, "Spring Co")
    lot = _grn_lot(db, item, loc, "Spring Co", eng)
    lot.batch_number = "HEAT-9"
    db.commit()
    out = client.get(f"{Q}/complaints/traceability", params={"item_id": item.id, "batch": "heat-9"}, headers=hdr(eng)).json()
    assert out["lots"][0]["lot_number"] == lot.lot_number and out["grns"][0]["vendor_name"] == "Spring Co"
    assert client.get(f"{Q}/complaints/traceability", headers=hdr(eng)).status_code == 422


# --- Supplier quality -------------------------------------------------------------------

def test_first_receipt_adds_trial_vendor_and_fai_approval_approves_it(client, db):
    eng, head = _team(db, "avl")
    item, loc = setup_item(db, "Axle box")
    approved_plan(client, db, item, eng, head)
    first = _grn_lot(db, item, loc, "Acme  Forge", eng)
    avl = sq.get_avl(db, item.id, "acme forge")
    assert avl and avl.status == "trial" and avl.vendor_name == "Acme Forge"
    # Manual approval is refused for an FAI-controlled item.
    r = client.post(f"{Q}/supplier-quality/avl/{avl.id}/approve", json={"reason": "ok"}, headers=hdr(head))
    assert r.status_code == 409 and "first article" in r.json()["detail"]
    assert _inspect_and_decide(client, first.id, eng, head).status_code == 200
    from app.modules.quality.models.first_article import QualityFirstArticle
    fai = db.query(QualityFirstArticle).filter_by(lot_id=first.id).one()
    assert client.post(f"{Q}/first-articles/{fai.id}/decision", json={"approve": True}, headers=hdr(eng)).status_code == 200
    db.expire_all()
    avl = db.get(QualityApprovedVendor, avl.id)
    assert avl.status == "approved" and avl.fai_id == fai.id and avl.valid_until > date.today()


def test_low_rating_puts_vendor_on_watch_with_tightened_sampling_and_vendor_capa(client, db, monkeypatch):
    sent = []
    import app.modules.quality.services.supplier_quality as sqmod
    monkeypatch.setattr(sqmod, "notify_user", lambda db, **kw: sent.append(kw))
    eng, head = _team(db, "rate")
    buyer = make_user(db, "buyer-rate@x.com", apps=("purchase",), is_purchase_head=True) if hasattr(User, "is_purchase_head") \
        else make_user(db, "buyer-rate@x.com", apps=("purchase",))
    item, loc = setup_item(db, "Brake shoe")
    approved_plan(client, db, item, eng, head)
    release_fai(db, item, "Okay Castings")
    defect_id_cache["id"] = defect(db).id
    a = _grn_lot(db, item, loc, "Okay Castings", eng, qty=10)
    assert _inspect_and_decide(client, a.id, eng, head).status_code == 200
    b = _grn_lot(db, item, loc, "Okay Castings", eng, qty=10)
    lot_b = record_all(client, client.get(f"{Q}/inspection-lots/{b.id}", headers=hdr(eng)).json(), eng, fail_first=True)
    r = client.post(f"{Q}/inspection-lots/{lot_b['id']}/decision",
                    json={"decision": "partial", "accepted_qty": 8, "rejected_qty": 2}, headers=hdr(head))
    assert r.status_code == 200, r.text

    r = client.post(f"{Q}/supplier-quality/ratings/run", json={"period": _period()}, headers=hdr(eng))
    assert r.status_code == 403
    cards = client.post(f"{Q}/supplier-quality/ratings/run", json={"period": _period()}, headers=hdr(head)).json()
    card = next(c for c in cards if c["vendor_key"] == "okay castings")
    assert card["quality_score"] == 90 and card["ncr_major"] == 1 and card["rating_band"] == "on_watch"
    avl = sq.get_avl(db, item.id, "Okay Castings")
    db.refresh(avl)
    assert avl.status == "on_watch" and avl.sampling_state == "tightened"
    assert db.query(QualityCapa).filter(QualityCapa.trigger == "vendor_trend", QualityCapa.vendor_name == "Okay Castings").count() == 1
    assert any(k["user_id"] == buyer.id and k["notification_type"] == "quality_vendor_rating_low" for k in sent)
    # New lots from this vendor are tightened.
    c = _grn_lot(db, item, loc, "Okay Castings", eng, qty=10)
    assert c.sampling_severity == "tightened"
    # Re-running keeps one scorecard per vendor + month.
    client.post(f"{Q}/supplier-quality/ratings/run", json={"period": _period()}, headers=hdr(head))
    assert len([x for x in client.get(f"{Q}/supplier-quality/ratings", params={"vendor": "Okay Castings"}, headers=hdr(head)).json()
                if x["period"] == _period()]) == 1


def test_blocked_vendor_needs_partner_then_stops_acceptance_and_pos(client, db):
    if not hasattr(User, "is_partner"):
        pytest.skip("User.is_partner (Company Info → Partners) not in this tree yet")
    eng, head = _team(db, "blk")
    partner = make_user(db, "partner-blk@x.com", is_partner=True)
    item, loc = setup_item(db, "Buffer")
    approved_plan(client, db, item, eng, head)
    release_fai(db, item, "Bad Forge")
    defect_id_cache["id"] = defect(db).id
    a = _grn_lot(db, item, loc, "Bad Forge", eng, qty=10)
    assert _inspect_and_decide(client, a.id, eng, head, decision="reject").status_code == 200
    client.post(f"{Q}/supplier-quality/ratings/run", json={"period": _period()}, headers=hdr(head))
    avl = sq.get_avl(db, item.id, "Bad Forge")
    db.refresh(avl)
    assert avl.status == "on_watch" and avl.pending_action == "block"

    assert client.post(f"{Q}/supplier-quality/avl/{avl.id}/decision", json={"approve": True}, headers=hdr(head)).status_code == 403
    body = client.post(f"{Q}/supplier-quality/avl/{avl.id}/decision", json={"approve": True}, headers=hdr(partner)).json()
    assert body["status"] == "blocked" and body["pending_action"] is None and body["events"]

    b = _grn_lot(db, item, loc, "Bad Forge", eng, qty=10)
    r = _inspect_and_decide(client, b.id, eng, head)
    assert r.status_code == 409 and "BLOCKED" in r.json()["detail"]
    with pytest.raises(sq.SupplierError) as e:
        sq.ensure_po_allowed(db, "bad forge", [item.id, None])  # None = an older unlinked line, skipped
    assert "Buffer" in str(e.value)
    sq.ensure_po_allowed(db, "Good Forge", [item.id])  # other vendors unaffected


def test_switching_to_reduced_and_skip_lot_for_consistently_good_vendor(client, db, monkeypatch):
    eng, head = _team(db, "sw")
    item, loc = setup_item(db, "Bolt")
    approved_plan(client, db, item, eng, head)
    release_fai(db, item, "Good Fasteners")
    from app.modules.quality.models.masters import QualitySetting
    for k, v in (("reduced_after_lots", 2), ("skip_lot_after_lots", 5), ("skip_lot_frequency", 2)):
        db.add(QualitySetting(key=k, value=v))
    db.commit()
    first = _grn_lot(db, item, loc, "Good Fasteners", eng)
    avl = sq.get_avl(db, item.id, "Good Fasteners")
    avl.status, avl.last_score = "approved", 99
    db.commit()
    assert _inspect_and_decide(client, first.id, eng, head).status_code == 200
    for _ in range(4):
        lot = _grn_lot(db, item, loc, "Good Fasteners", eng)
        assert _inspect_and_decide(client, lot.id, eng, head).status_code == 200
    db.refresh(avl)
    assert avl.sampling_state == "reduced" and avl.skip_lot_active
    skipped = _grn_lot(db, item, loc, "Good Fasteners", eng)
    assert skipped.skip_lot and skipped.sampling_severity == "reduced"
    assert all(r.classification == "critical" for r in skipped.results)  # non-critical characteristics skipped
    full = _grn_lot(db, item, loc, "Good Fasteners", eng)
    assert not full.skip_lot  # 1 lot in 2 is fully inspected
    # A rejection ends skip-lot and returns to normal sampling.
    defect_id_cache["id"] = defect(db).id
    assert _inspect_and_decide(client, full.id, eng, head, decision="reject").status_code == 200
    db.refresh(avl)
    assert avl.sampling_state == "normal" and not avl.skip_lot_active


def test_vendor_audit_findings_raise_capa(client, db):
    eng, head = _team(db, "aud")
    a = client.post(f"{Q}/supplier-quality/audits", json={"vendor_name": "Acme Forge", "planned_date": str(date.today())},
                    headers=hdr(eng)).json()
    r = client.post(f"{Q}/supplier-quality/audits/{a['id']}/complete", json={
        "audit_date": str(date.today()), "score": 72, "result": "conditional",
        "findings": [{"type": "major", "description": "No calibration records"}, {"type": "observation", "description": "Housekeeping"}],
    }, headers=hdr(eng))
    assert r.status_code == 200, r.text
    assert r.json()["capa_number"]
    capa = db.get(QualityCapa, r.json()["capa_id"])
    assert capa.trigger == "audit" and capa.audit_reference == a["audit_number"] and capa.vendor_name == "Acme Forge"


# --- Defect Pareto -----------------------------------------------------------------------

def test_defect_pareto_ranks_codes_with_cumulative_percent(client, db):
    eng, _ = _team(db, "par")
    from app.modules.quality.models.masters import QualityDefectCode
    c1 = QualityDefectCode(code="PAR-1", name="Burr", category="surface")
    c2 = QualityDefectCode(code="PAR-2", name="Oversize", category="dimensional")
    db.add_all([c1, c2])
    db.commit()
    item, _ = setup_item(db, "Pin")
    for code, n in ((c1, 3), (c2, 1)):
        for i in range(n):
            create_ncr(db, {"source": "incoming", "severity": "minor", "item_id": item.id, "quantity": 2, "vendor_name": "V1",
                            "defect_code_id": code.id, "description": "d", "skip_capa_triggers": True}, eng)
    db.commit()
    out = client.get(f"{Q}/analysis/defect-pareto", params={"item_id": item.id, "vendor": "v1"}, headers=hdr(eng)).json()
    assert out["total"] == 4 and [r["code"] for r in out["rows"]] == ["PAR-1", "PAR-2"]
    assert out["rows"][0]["cumulative_percent"] == 75 and out["rows"][1]["cumulative_percent"] == 100
    assert out["rows"][0]["vital_few"] and out["rows"][1]["vital_few"]
    assert client.get(f"{Q}/analysis/defect-pareto", params={"basis": "x"}, headers=hdr(eng)).status_code == 422
    assert client.get(f"{Q}/analysis/defect-pareto", params={"source": "final", "item_id": item.id}, headers=hdr(eng)).json()["total"] == 0
