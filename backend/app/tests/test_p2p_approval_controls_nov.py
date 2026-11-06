"""Procurement approval controls (2026-11-06):
- a requisition carries an estimated value (qty x last PO rate / moving average / standard cost) and a
  "some lines have no price" flag, so PR stages can test Amount;
- a PO carries risk facts (quantity above requisition, vendor not L1, single quotation) for its stages;
- the department condition is a pick-list of Departments (dynamic choices in the approval engine);
- the old pre-workflow approve / reject code is gone: an item still on it is moved into the workflow."""
from datetime import date
from itertools import count

import pytest
from fastapi import HTTPException

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.organization.services import approval_engine as engine
from app.modules.p2p import approvals as p2p_approvals
from app.modules.p2p.approvals import PO_KEY, PR_KEY
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_item import RFQItem
from app.modules.p2p.models.vendor_quotation import VendorQuotation, VendorQuotationItem
from app.tests.p2p_workflow_helpers import master_item, set_po_workflow, set_pr_workflow

BASE = "/api/v1/p2p/requests"
WF = "/api/v1/organization/workflows"
_seq = count(1)
APPROVER = ["p2p:purchase_requisitions:view", "p2p:purchase_orders:view"]
REQUESTER = ["p2p:purchase_requisitions:view", "p2p:purchase_requisitions:create", "p2p:purchase_requisitions:submit"]
BUYER = ["purchase:desk:view", "p2p:purchase_requisitions:view", "p2p:purchase_requisitions:edit", "p2p:purchase_orders:view"]


@pytest.fixture(autouse=True)
def _sqlite_number_series(monkeypatch):
    monkeypatch.setattr("app.modules.p2p.service._lock_number_series", lambda db, prefix: None)


def _user(db, grants=(), role="user", **kw):
    n = next(_seq)
    u = User(email=f"nov.p2p{n}@premnathrail.com", name=f"novp2p{n}", role=role, is_active=True,
             granular_permissions=list(grants), department=kw.pop("department", "R&D"), **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _stage(name, user_ids, conditions=(), mode="any"):
    return {"name": name, "approver_rule": "specific_users", "rule_config": {"user_ids": list(user_ids)}, "approval_mode": mode,
            "conditions": list(conditions)}


def _raise(client, user, lines):
    """lines = [(StoreItem, qty)]"""
    r = client.post(BASE, json={"category_code": "RAW", "project_label": "RRV-7", "project_type": "existing", "priority": "standard",
                                "items": [{"store_item_id": it.id, "quantity": q, "project_inhouse": "Project"} for it, q in lines]},
                    headers=_h(user))
    assert r.status_code == 200, r.text
    return r.json()


def _stage_names(db, entity_type, entity_id):
    req = engine.latest_request(db, entity_type, entity_id)
    return sorted({s.stage_name for s in req.steps if s.status != "skipped"}), req


@pytest.fixture
def team(db):
    return {"admin": _user(db, role="admin"), "requester": _user(db, REQUESTER), "a1": _user(db, APPROVER),
            "a2": _user(db, APPROVER), "buyer": _user(db, BUYER), "partner": _user(db, APPROVER, is_partner=True)}


# ── 1. PR value ─────────────────────────────────────────────────────────────

def test_pr_amount_is_the_estimate_and_a_stage_on_amount_applies_correctly(client, db, team):
    engine.save_workflow(db, PR_KEY, {"stages": [
        _stage("Everyone", [team["a1"].id]),
        _stage("Over 1000", [team["a2"].id], [{"field": "amount", "op": "gt", "value": 1000}]),
    ]}, team["admin"])
    db.commit()
    gear = master_item(db, "Gear 11", moving_average_cost=600.0, standard_cost=1.0)

    small = _raise(client, team["requester"], [(gear, 1)])      # 600
    big = _raise(client, team["requester"], [(gear, 2)])        # 1200
    names, req_small = _stage_names(db, "p2p_request", small["id"])
    assert names == ["Everyone"] and req_small.amount == 600
    names, req_big = _stage_names(db, "p2p_request", big["id"])
    assert names == ["Everyone", "Over 1000"] and req_big.amount == 1200
    assert "est. ₹1,200" in req_big.title
    assert req_big.context["has_unpriced_lines"] is False


def test_unit_estimate_prefers_last_po_rate_then_moving_average_then_standard(db, monkeypatch):
    po_rate = master_item(db, "Est PO rate", moving_average_cost=600.0, standard_cost=500.0)
    avg = master_item(db, "Est avg", moving_average_cost=600.0, standard_cost=500.0)
    std = master_item(db, "Est std", standard_cost=500.0)
    none = master_item(db, "Est none")
    monkeypatch.setattr("app.modules.p2p.info_records.price_history",
                        lambda _db, item_id, vendor_id=None, limit=200: [{"unit_price": 50.0}] if item_id == po_rate.id else [])
    cache: dict = {}
    assert p2p_approvals._unit_estimate(db, po_rate.id, cache) == 50.0
    assert p2p_approvals._unit_estimate(db, avg.id, cache) == 600.0
    assert p2p_approvals._unit_estimate(db, std.id, cache) == 500.0
    assert p2p_approvals._unit_estimate(db, none.id, cache) == 0.0
    assert p2p_approvals._unit_estimate(db, None, cache) == 0.0


def test_unpriced_lines_set_the_flag_and_do_not_add_to_the_amount(client, db, team):
    engine.save_workflow(db, PR_KEY, {"stages": [
        _stage("Everyone", [team["a1"].id]),
        _stage("Check prices", [team["a2"].id], [{"field": "has_unpriced_lines", "op": "true"}]),
    ]}, team["admin"])
    db.commit()
    priced = master_item(db, "Gear 12", moving_average_cost=100.0)
    unpriced = master_item(db, "Gear 13")
    ok = _raise(client, team["requester"], [(priced, 3)])
    assert _stage_names(db, "p2p_request", ok["id"])[0] == ["Everyone"]
    mixed = _raise(client, team["requester"], [(priced, 3), (unpriced, 5)])
    names, req = _stage_names(db, "p2p_request", mixed["id"])
    assert names == ["Check prices", "Everyone"] and req.amount == 300 and req.context["has_unpriced_lines"] is True
    none = _raise(client, team["requester"], [(unpriced, 1)])
    _, req_none = _stage_names(db, "p2p_request", none["id"])
    assert req_none.amount is None  # no price at all is not "₹0"


def test_pr_amount_label_and_flag_are_declared_for_admins(client, db, team):
    fields = client.get(f"{WF}/{PR_KEY}", headers=_h(team["admin"])).json()["type"]["context_fields"]
    assert fields["amount"]["label"] == "Estimated value (₹, from Item Master prices)"
    assert fields["has_unpriced_lines"]["type"] == "bool"
    po_fields = client.get(f"{WF}/{PO_KEY}", headers=_h(team["admin"])).json()["type"]["context_fields"]
    assert po_fields["amount"]["label"] == "Amount (₹)" and "has_unpriced_lines" not in po_fields


# ── 2. PO risk fields ───────────────────────────────────────────────────────

def _po_world(db, team, *, quotes=3, po_to=0, reason=None, qty=4.0, po_qty=None):
    """An approved requisition with one line, an RFQ with `quotes` vendor quotes (vendor 0 is L1: lowest price) and a
    draft PO to the vendor at index `po_to`. Returns (pr, po, rfq)."""
    item = master_item(db, f"Risk item {next(_seq)}")
    pr = P2PRequest(p2p_number=f"P2P-RAW-2026-{7000 + next(_seq)}", category_code="RAW", project_type="existing", approval_scheme="engine",
                    request_date=date.today(), requested_by_id=team["requester"].id, status="approved", project_label="RK")
    db.add(pr)
    db.flush()
    line = P2PRequestItem(p2p_request_id=pr.id, store_item_id=item.id, item_name=item.item_name, unit="Nos", quantity=qty,
                          project_inhouse="Project", fulfillment_status="sent_to_procurement")
    db.add(line)
    db.flush()
    rfq = RFQ(rfq_number=f"RFQ-RK-{next(_seq):04d}", p2p_request_id=pr.id, status="locked", buyer_id=team["buyer"].id,
              created_by_id=team["buyer"].id, single_quotation_reason=reason)
    db.add(rfq)
    db.flush()
    db.add(RFQItem(rfq_id=rfq.id, pr_item_id=line.id, store_item_id=item.id, quantity=qty))
    vqs = []
    for i in range(quotes):
        vq = VendorQuotation(rfq_id=rfq.id, p2p_request_id=pr.id, vendor_id=900 + i, vendor_name=f"Vendor {i}", quoted_price=0)
        db.add(vq)
        db.flush()
        db.add(VendorQuotationItem(vendor_quotation_id=vq.id, pr_item_id=line.id, store_item_id=item.id, quantity=qty,
                                   unit_price=100.0 + 10 * i))
        vqs.append(vq)
    db.flush()
    vend = vqs[po_to]
    po = P2PPurchaseOrder(po_number=f"PO-RK-{next(_seq):04d}", p2p_request_id=pr.id, vendor_id=vend.vendor_id, vendor_name=vend.vendor_name,
                          status="draft", po_date=date.today(), created_by_id=team["buyer"].id, rfq_id=rfq.id, total_value=500.0)
    db.add(po)
    db.flush()
    db.add(P2PPurchaseOrderItem(purchase_order_id=po.id, item_name=item.item_name, store_item_id=item.id, unit="Nos",
                                quantity=po_qty if po_qty is not None else qty, unit_price=100.0, pr_item_id=line.id))
    db.commit()
    db.refresh(pr)
    db.refresh(po)
    return pr, po, rfq


def test_po_to_the_l1_vendor_with_enough_quotes_has_no_risk(db, team):
    pr, po, _ = _po_world(db, team, quotes=3, po_to=0)
    flags = p2p_approvals.po_risk_flags(db, pr, po)
    assert flags == {"qty_raised_lines": 0, "non_l1_lines": 0, "single_quotation": False}


def test_po_to_a_vendor_that_is_not_l1_is_flagged(db, team):
    pr, po, _ = _po_world(db, team, quotes=3, po_to=2)
    assert p2p_approvals.po_risk_flags(db, pr, po)["non_l1_lines"] == 1


def test_single_or_limited_quotation_is_flagged(db, team):
    pr, po, _ = _po_world(db, team, quotes=1, po_to=0)             # fewer quotes than the Settings minimum (3)
    assert p2p_approvals.po_risk_flags(db, pr, po)["single_quotation"] is True
    pr, po, _ = _po_world(db, team, quotes=3, po_to=0, reason="Only this vendor makes it")
    assert p2p_approvals.po_risk_flags(db, pr, po)["single_quotation"] is True


def test_quotes_that_are_not_eligible_do_not_count_towards_the_minimum(db, team):
    pr, po, rfq = _po_world(db, team, quotes=3, po_to=0)
    assert p2p_approvals.is_single_quotation(db, po) is False
    vq = db.query(VendorQuotation).filter_by(rfq_id=rfq.id).order_by(VendorQuotation.id.desc()).first()
    vq.commercial_status = "rejected"      # out of the ranking: only 2 real quotes left
    db.commit()
    assert p2p_approvals.is_single_quotation(db, po) is True


def test_po_with_no_rfq_counts_as_single_quotation_but_not_as_non_l1(db, team):
    pr, po, _ = _po_world(db, team, quotes=3, po_to=0)
    po.rfq_id = None
    db.commit()
    flags = p2p_approvals.po_risk_flags(db, pr, po)
    assert flags["single_quotation"] is True and flags["non_l1_lines"] == 0


def test_a_failing_risk_check_counts_as_a_risk_and_keeps_the_transaction_usable(db, team, monkeypatch):
    pr, po, _ = _po_world(db, team, quotes=3, po_to=0)

    def boom(*_a, **_k):
        raise RuntimeError("sql broke")
    monkeypatch.setattr(p2p_approvals, "non_l1_lines", boom)
    flags = p2p_approvals.po_risk_flags(db, pr, po)
    assert flags["non_l1_lines"] >= 1 and flags["single_quotation"] is False
    assert db.query(P2PPurchaseOrder).count() >= 1   # the session still works


def test_po_stages_apply_only_when_their_risk_condition_holds(db, team):
    engine.save_workflow(db, PO_KEY, {"stages": [
        _stage("PO approvers", [team["a1"].id]),
        _stage("Non-L1 check", [team["a2"].id], [{"field": "non_l1_award", "op": "true"}]),
        _stage("Single quote check", [team["partner"].id], [{"field": "single_quotation", "op": "true"}]),
        _stage("Qty check", [team["admin"].id], [{"field": "qty_above_requisition", "op": "true"}]),
    ]}, team["admin"])
    db.commit()
    # Clean: L1 vendor, 3 quotes, quantity as requested.
    pr, po, _ = _po_world(db, team, quotes=3, po_to=0)
    req = p2p_approvals.submit_po(db, pr, po, team["buyer"])
    assert sorted({s.stage_name for s in req.steps}) == ["PO approvers"]
    assert req.context["non_l1_award"] is False and req.context["single_quotation"] is False
    assert req.context["qty_above_requisition"] is False and "vendor not L1" not in req.title
    # Non-L1 vendor: the title tells the approver, only the non-L1 stage joins.
    pr, po, _ = _po_world(db, team, quotes=3, po_to=1)
    req = p2p_approvals.submit_po(db, pr, po, team["buyer"])
    assert sorted({s.stage_name for s in req.steps}) == ["Non-L1 check", "PO approvers"]
    assert "vendor not L1 on 1 line(s)" in req.title and req.context["non_l1_award"] is True
    # Single quotation, quantity above the requisition.
    pr, po, _ = _po_world(db, team, quotes=1, po_to=0, qty=4.0, po_qty=6.0)
    req = p2p_approvals.submit_po(db, pr, po, team["buyer"])
    assert sorted({s.stage_name for s in req.steps}) == ["PO approvers", "Qty check", "Single quote check"]
    assert " — single quotation" in req.title and "qty raised above requisition on 1 line(s)" in req.title


def test_amendment_type_accepts_a_po_workflow_with_risk_conditions(db, team):
    """The amendment workflow is seeded from the PO workflow; its fields must include the PO's risk fields."""
    from app.modules.p2p import po_amendments
    engine.save_workflow(db, PO_KEY, {"stages": [
        _stage("PO approvers", [team["a1"].id]),
        _stage("Non-L1 check", [team["a2"].id], [{"field": "non_l1_award", "op": "true"}]),
    ]}, team["admin"])
    db.commit()
    fields = engine.get_type(po_amendments.AMEND_KEY).context_fields
    assert {"non_l1_award", "single_quotation", "qty_above_requisition", "department_id", "value_change"} <= set(fields)
    po_amendments.seed_workflow(db)  # raised 422 "doesn't have that field" before the PO fields were declared


# ── 3. Department pick-list ─────────────────────────────────────────────────

def _depts(db):
    plant_a, plant_b = Branch(name="Plant A", code="PA"), Branch(name="Plant B", code="PB")
    db.add_all([plant_a, plant_b])
    db.flush()
    d = {"stores": Department(name="Stores", code="ST", branch_id=plant_a.id),
         "design_a": Department(name="Design", code="DS-A", branch_id=plant_a.id),
         "design_b": Department(name="Design", code="DS-B", branch_id=plant_b.id)}
    db.add_all(d.values())
    db.commit()
    return d


def test_department_condition_is_a_pick_list_of_departments(client, db, team):
    d = _depts(db)
    out = client.get(f"{WF}/{PR_KEY}", headers=_h(team["admin"])).json()["type"]["context_fields"]
    assert "department" not in out
    f = out["department_id"]
    assert f["label"] == "Requester's department" and f["type"] == "choice"
    assert set(f["choices"]) == {str(x.id) for x in d.values()}
    assert f["choice_labels"][str(d["stores"].id)] == "Stores"
    # Two departments share a name: the plant tells them apart.
    assert f["choice_labels"][str(d["design_a"].id)] == "Design (Plant A)"
    assert f["choice_labels"][str(d["design_b"].id)] == "Design (Plant B)"
    # The list endpoint carries the same choices; other modules' fields are untouched.
    listed = {w["key"]: w for w in client.get(WF, headers=_h(team["admin"])).json()}
    assert listed[PO_KEY]["context_fields"]["department_id"]["choice_labels"][str(d["stores"].id)] == "Stores"
    assert engine.get_type(PR_KEY).context_fields["department_id"].get("choices") is None  # the registered type stays static


def test_saving_a_stage_on_an_unknown_department_is_refused_with_a_clear_reason(client, db, team):
    d = _depts(db)
    bad = {"stages": [_stage("Dept", [team["a1"].id], [{"field": "department_id", "op": "eq", "value": "99999"}])]}
    r = client.put(f"{WF}/{PR_KEY}", json=bad, headers=_h(team["admin"]))
    assert r.status_code == 422, r.text
    assert "'99999'" in r.json()["detail"] and "Requester's department" in r.json()["detail"] and "Stores" in r.json()["detail"]
    # The preview and the setup check refuse it too.
    assert client.post(f"{WF}/{PR_KEY}/check", json=bad, headers=_h(team["admin"])).status_code == 422
    # A real department saves.
    good = {"stages": [_stage("Dept", [team["a1"].id], [{"field": "department_id", "op": "eq", "value": str(d["stores"].id)}])]}
    r = client.put(f"{WF}/{PR_KEY}", json=good, headers=_h(team["admin"]))
    assert r.status_code == 200, r.text
    # Deny by default: no workflow-view permission, no access to the choices.
    assert client.get(f"{WF}/{PR_KEY}", headers=_h(_user(db, REQUESTER))).status_code == 403
    assert client.put(f"{WF}/{PR_KEY}", json=good, headers=_h(_user(db, ["organization:workflows:view"]))).status_code == 403


def test_approves_in_shows_the_department_name_not_its_id(db, team):
    d = _depts(db)
    engine.save_workflow(db, PR_KEY, {"stages": [
        _stage("Stores only", [team["a1"].id], [{"field": "department_id", "op": "eq", "value": str(d["stores"].id)}])]}, team["admin"])
    db.commit()
    rows = [r for r in engine.approves_in_user(db, team["a1"])["stages"] if r["workflow_key"] == PR_KEY]
    assert rows and "Requester's department" in rows[0]["applies_when"] and rows[0]["applies_when"].endswith("Stores")


def test_static_validation_does_not_crash_on_a_choices_from_field():
    tt = engine.get_type(PR_KEY)
    # Without a database (registration time) a dynamic field is not value-checked.
    engine._validate_stage_def({"name": "x", "approver_rule": "partner", "conditions": [
        {"field": "department_id", "op": "eq", "value": "anything"}]}, tt)


def test_pr_stage_on_department_applies_to_that_requesters_department(client, db, team):
    d = _depts(db)
    in_stores = _user(db, REQUESTER, department_id=d["stores"].id, department="Stores")
    in_design = _user(db, REQUESTER, department_id=d["design_a"].id, department="Design")
    engine.save_workflow(db, PR_KEY, {"stages": [
        _stage("Everyone", [team["a1"].id]),
        _stage("Stores only", [team["a2"].id], [{"field": "department_id", "op": "eq", "value": str(d["stores"].id)}]),
    ]}, team["admin"])
    db.commit()
    gear = master_item(db, "Gear 14", moving_average_cost=10.0)
    assert _stage_names(db, "p2p_request", _raise(client, in_stores, [(gear, 1)])["id"])[0] == ["Everyone", "Stores only"]
    assert _stage_names(db, "p2p_request", _raise(client, in_design, [(gear, 1)])["id"])[0] == ["Everyone"]


def test_a_stored_stage_on_the_old_department_name_is_converted_not_refused(client, db, team):
    d = _depts(db)
    legacy = [{"name": "Stores", "approver_rule": "specific_users", "rule_config": {"user_ids": [team["a1"].id]},
               "conditions": [{"field": "department", "op": "eq", "value": "Stores"}]}]
    # Saving (what the editor sends back for an old stage) turns the name into the department id.
    r = client.put(f"{WF}/{PR_KEY}", json={"stages": legacy}, headers=_h(team["admin"]))
    assert r.status_code == 200, r.text
    cond = r.json()["workflow"]["stages"][0]["conditions"][0]
    assert cond["field"] == "department_id" and cond["value"] == str(d["stores"].id)
    # Amendment seeding copies PO stages, so a stored 'department' stage must not make it 422.
    from app.modules.p2p import po_amendments
    engine.save_workflow(db, PO_KEY, {"stages": [_stage("PO", [team["a1"].id])]}, team["admin"])
    wf = engine.ensure_workflow(db, PO_KEY)
    wf.stages[0].conditions = [{"field": "department", "op": "in", "value": ["Stores"]}]   # as stored before the change
    db.commit()
    po_amendments.seed_workflow(db)
    # A name shared by two plants, or unknown, is refused with the name.
    ambiguous = [{**legacy[0], "conditions": [{"field": "department", "op": "eq", "value": "Design"}]}]
    r = client.put(f"{WF}/{PR_KEY}", json={"stages": ambiguous}, headers=_h(team["admin"]))
    assert r.status_code == 422 and "'Design'" in r.json()["detail"] and "2 departments" in r.json()["detail"]
    unknown = [{**legacy[0], "conditions": [{"field": "department", "op": "eq", "value": "Nowhere"}]}]
    r = client.put(f"{WF}/{PR_KEY}", json={"stages": unknown}, headers=_h(team["admin"]))
    assert r.status_code == 422 and "'Nowhere'" in r.json()["detail"] and "no department has that name" in r.json()["detail"]


def test_a_stage_saved_on_the_old_department_name_still_evaluates(db, team):
    """The name text stays in the runtime context so a stored 'department' condition keeps working."""
    pr, po, _ = _po_world(db, team)
    assert p2p_approvals._pr_context(pr)["department"] == pr.department
    assert engine._holds([{"field": "department", "op": "eq", "value": "R&D"}], {"department": "R&D"})


# ── 4. Old approval route removed; in-flight items move into the workflow ──

def _legacy_pr(db, team, status="submitted"):
    pr = P2PRequest(p2p_number=f"P2P-RAW-2026-{6000 + next(_seq)}", category_code="RAW", project_type="existing", approval_scheme="settings",
                    request_date=date.today(), requested_by_id=team["requester"].id, status=status, project_label="Old")
    db.add(pr)
    db.flush()
    db.add(P2PRequestItem(p2p_request_id=pr.id, item_name="Bolt", quantity=1, project_inhouse="Project"))
    db.commit()
    return pr


def test_reject_of_a_requisition_on_the_old_route_moves_it_into_the_workflow(client, db, team):
    set_pr_workflow(db, [team["a1"].id], team["admin"])
    pr = _legacy_pr(db, team)
    # Somebody with no part in the old route (and no Approve) can't open it.
    r = client.post(f"{BASE}/{pr.id}/reject", json={"reason": "No"}, headers=_h(team["a1"]))
    assert r.status_code == 409 and "still on the old approval route" in r.json()["detail"] and "Approve on Purchase requisitions" in r.json()["detail"]
    assert engine.latest_request(db, "p2p_request", pr.id) is None
    # An admin opens it: moved, nothing decided.
    r = client.post(f"{BASE}/{pr.id}/reject", json={"reason": "No"}, headers=_h(team["admin"]))
    assert r.status_code == 409 and "old approval route" in r.json()["detail"] and "My Approvals" in r.json()["detail"]
    db.expire_all()
    assert engine.latest_request(db, "p2p_request", pr.id).status == "pending"
    assert db.get(P2PRequest, pr.id).status == "submitted"
    assert db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=pr.id, action="moved_to_workflow").count() == 1
    # Asking again is now an ordinary engine decision.
    r = client.post(f"{BASE}/{pr.id}/reject", json={"reason": "No"}, headers=_h(team["a1"]))
    assert r.status_code == 200 and r.json()["status"] == "rejected"


def test_a_reject_click_never_approves_as_a_side_effect(client, db, team):
    engine.save_workflow(db, PR_KEY, {"stages": [
        _stage("Never", [team["a1"].id], [{"field": "priority", "op": "eq", "value": "urgent"}])]}, team["admin"])
    db.commit()
    pr = _legacy_pr(db, team)          # standard priority: no stage applies, the workflow approves it at once
    r = client.post(f"{BASE}/{pr.id}/reject", json={"reason": "No"}, headers=_h(team["admin"]))
    assert r.status_code == 409 and "now approved" in r.json()["detail"] and "rejection was not applied" in r.json()["detail"]
    db.expire_all()
    got = db.get(P2PRequest, pr.id)
    assert got.status == "approved" and got.rejected_reason is None


def test_a_missing_or_inactive_requester_is_never_replaced_by_the_person_who_clicked(client, db, team):
    set_pr_workflow(db, [team["a1"].id], team["admin"])
    pr = _legacy_pr(db, team)
    team["requester"].is_active = False
    db.commit()
    r = client.post(f"{BASE}/{pr.id}/approve", json={"comment": "ok"}, headers=_h(team["admin"]))
    assert r.status_code == 409 and "requester" in r.json()["detail"] and "no longer active" in r.json()["detail"]
    assert "Ask an admin to cancel it" in r.json()["detail"]
    db.expire_all()
    assert engine.latest_request(db, "p2p_request", pr.id) is None
    pr2 = _legacy_pr(db, team)
    pr2.requested_by_id = None
    db.commit()
    r = client.post(f"{BASE}/{pr2.id}/approve", json={"comment": "ok"}, headers=_h(team["admin"]))
    assert r.status_code == 409 and "is not recorded" in r.json()["detail"]


def test_a_po_on_the_old_route_is_moved_into_the_workflow_as_its_buyer(client, db, team):
    set_po_workflow(db, [team["a1"].id], team["admin"])
    pr, po, _ = _po_world(db, team)
    po.status = "issued"          # sent for approval before Approval Workflows: no approval request
    pr.status = "po_raised"
    db.commit()
    assert engine.latest_request(db, "p2p_purchase_order", po.id) is None
    # A viewer with no Approve and no part in the old route can't open it.
    r = client.post(f"{BASE}/{pr.id}/approve-po", json={"comment": "ok"}, headers=_h(team["a1"]))
    assert r.status_code == 409 and "still on the old approval route" in r.json()["detail"], r.text
    assert engine.latest_request(db, "p2p_purchase_order", po.id) is None
    # A Partner (the old route's final approver) opens it once.
    r = client.post(f"{BASE}/{pr.id}/approve-po", json={"comment": "ok"}, headers=_h(team["partner"]))
    assert r.status_code == 409 and "old approval route" in r.json()["detail"] and "My Approvals" in r.json()["detail"], r.text
    db.expire_all()
    req = engine.latest_request(db, "p2p_purchase_order", po.id)
    assert req is not None and req.status == "pending" and req.requester_id == team["buyer"].id
    assert db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=pr.id, action="moved_to_workflow").count() == 1
    r = client.post(f"{BASE}/{pr.id}/approve-po", json={"comment": "ok", "po_id": po.id}, headers=_h(team["a1"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert engine.latest_request(db, "p2p_purchase_order", po.id).status == "approved"


def test_a_po_released_before_the_engine_is_not_moved(client, db, team):
    pr, po, _ = _po_world(db, team)
    po.status = "issued"
    pr.status = "po_approved"     # approved on the old route long ago
    db.commit()
    assert p2p_approvals.po_request(db, pr.id)[1] is None
    from app.modules.p2p.routes.p2p_requests import _legacy_pos_in_flight
    assert _legacy_pos_in_flight(db, pr) == []


def test_approved_requisition_can_still_be_rejected_by_the_purchase_team_only(client, db, team):
    pr = _legacy_pr(db, team, status="approved")
    pr.approval_scheme = "engine"
    db.commit()
    # An approver without the purchase team role: refused with the reason.
    r = client.post(f"{BASE}/{pr.id}/reject", json={"reason": "Not needed"}, headers=_h(team["a1"]))
    assert r.status_code == 403 and "purchase team" in r.json()["detail"]
    # The purchase team without the Reject grant: refused.
    r = client.post(f"{BASE}/{pr.id}/reject", json={"reason": "Not needed"}, headers=_h(team["buyer"]))
    assert r.status_code == 403
    # With the grant a reason is mandatory, then it works.
    head = _user(db, BUYER + ["p2p:purchase_requisitions:reject"])
    assert client.post(f"{BASE}/{pr.id}/reject", json={}, headers=_h(head)).status_code == 422
    r = client.post(f"{BASE}/{pr.id}/reject", json={"reason": "Not needed"}, headers=_h(head))
    assert r.status_code == 200 and r.json()["status"] == "rejected"


def test_old_approval_helpers_are_gone():
    from app.modules.p2p.routes import p2p_requests as m
    for name in ("_approve_po_settings_scheme", "_check_approve_access", "_check_reject_access", "_check_po_reject_access",
                 "_check_po_approve_access", "po_approver_users"):
        assert not hasattr(m, name), name


def test_requisition_line_buyer_uses_the_item_category(monkeypatch):
    """The line-buyer call passes the item's type, category and id (Buyer responsibility)."""
    import inspect

    from app.modules.p2p.routes import p2p_requests as m
    src = inspect.getsource(m._sync_pr_lines)
    assert "resolve_line_buyer_id(db, master.item_type, master.category, item_id=master.id)" in src


def test_a_field_naming_an_unknown_choice_source_has_no_choices():
    """A field naming a source nobody registered simply has no choices."""
    tt = engine.TransactionType(key="t.x", module_key="p2p", subtab_key="purchase_orders", label="x", entity_type="x",
                                context_fields={"z": {"label": "Z", "type": "choice", "choices_from": "nope"}})
    assert engine.resolved_context_fields(None, tt)["z"].get("choices") is None
    with pytest.raises(HTTPException):
        engine._validate_stage_def({"name": "s", "approver_rule": "partner", "conditions": [{"field": "q", "op": "eq", "value": "1"}]}, tt)
