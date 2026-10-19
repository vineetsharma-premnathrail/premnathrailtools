"""Design module phases 2-4 (plan of 2026-10-06): customer approval before
release, team roles and viewer visibility, review checklists, engineering
BOMs with release checks / explosion / where-used, ECR → change board →
ECN with acknowledgements, design requests, library, settings, reports
and the daily reminders. SharePoint is replaced by an in-memory store."""
from datetime import date, timedelta

import pytest

from app.core.config import settings
from app.modules.store.models.item import StoreItem
from app.tests.test_design import API, auth, create_doc, make_user, release, rev, upload


@pytest.fixture(autouse=True)
def fake_sharepoint(monkeypatch):
    store: dict[str, bytes] = {}

    async def up(site_id, folder_path, upload_file):
        data = upload_file.file.read()
        path = f"{folder_path}/{upload_file.filename}"
        store[path] = data
        return {"name": upload_file.filename, "path": path, "webUrl": f"https://sp.example/{path}", "size": len(data)}

    async def down(site_id, file_path):
        return store[file_path], "application/octet-stream"

    async def delete(site_id, file_path):
        store.pop(file_path, None)

    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "test-site")
    for mod in ("app.modules.design.routes.revisions", "app.modules.design.files"):
        monkeypatch.setattr(f"{mod}.upload_file_to_sharepoint", up)
        monkeypatch.setattr(f"{mod}.download_file_content", down)
        monkeypatch.setattr(f"{mod}.delete_file_from_sharepoint", delete)
    monkeypatch.setattr("app.modules.design.routes.documents.delete_file_from_sharepoint", delete)
    return store


@pytest.fixture
def team(db):
    return {
        "author": make_user(db, "author@premnathrail.com"),
        "checker": make_user(db, "checker@premnathrail.com"),
        "approver": make_user(db, "approver@premnathrail.com"),
        "other": make_user(db, "other@premnathrail.com"),
        "admin": make_user(db, "admin@premnathrail.com", role="admin"),
        "prod": make_user(db, "prod@premnathrail.com", apps=("design", "production")),
        "qa": make_user(db, "qa@premnathrail.com", apps=("design", "quality")),
    }


def item(db, code, name=None, status="active"):
    it = StoreItem(item_code=code, item_name=name or code, uom="NOS", status=status)
    db.add(it)
    db.commit()
    db.refresh(it)
    return it


def set_team(client, team, roles):
    body = {"team": [{"user_id": team[k].id, "role": r} for k, r in roles.items()]}
    r = client.put(f"{API}/settings", json=body, headers=auth(team["admin"]))
    assert r.status_code == 200, r.text
    return r.json()


def release_bom(client, team, revision_id, expect=200):
    h = auth(team["author"])
    r = client.post(f"{API}/boms/revisions/{revision_id}/submit", json={"reviewer_id": team["checker"].id, "approver_id": team["approver"].id}, headers=h)
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/boms/revisions/{revision_id}/review", json={"decision": "pass"}, headers=auth(team["checker"]))
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/boms/revisions/{revision_id}/approve", json={"decision": "pass"}, headers=auth(team["approver"]))
    assert r.status_code == expect, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Customer approval
# ---------------------------------------------------------------------------

def test_customer_approval_gates_release(client, team):
    doc = create_doc(client, team, customer_approval_required=True, customer_name=None)
    r0 = rev(doc, "R0")["id"]
    detail = release(client, team, r0)
    assert detail["display_status"] == "approved"
    assert rev(detail, "R0")["status"] == "approved"

    # Release is refused until the customer has approved.
    r = client.post(f"{API}/revisions/{r0}/release", json={}, headers=auth(team["approver"]))
    assert r.status_code == 409 and "customer" in r.json()["detail"]

    h = auth(team["approver"])
    sub = client.post(f"{API}/submissions", json={"customer_name": "RDSO Lucknow", "lines": [{"revision_id": r0}]}, headers=h)
    assert sub.status_code == 201, sub.text
    sub = sub.json()
    assert sub["submission_number"].startswith("TRN-") and sub["status"] == "draft"
    # The same revision can't sit on two open submissions.
    r = client.post(f"{API}/submissions", json={"customer_name": "X", "lines": [{"revision_id": r0}]}, headers=h)
    assert r.status_code == 409

    r = client.post(f"{API}/submissions/{sub['id']}/send", json={}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "sent" and r.json()["response_due_date"]
    line_id = r.json()["lines"][0]["id"]

    r = client.post(f"{API}/submissions/{sub['id']}/response", json={
        "response_date": date.today().isoformat(), "lines": [{"line_id": line_id, "response": "approved_with_comments"}],
    }, headers=h)
    assert r.status_code == 400 and "comments" in r.json()["detail"]
    r = client.post(f"{API}/submissions/{sub['id']}/response", json={
        "response_date": date.today().isoformat(), "lines": [{"line_id": line_id, "response": "approved_with_comments", "comment": "Add weld symbol"}],
    }, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "closed" and body["open_comments"] == 1 and body["comments"][0]["status"] == "open"

    r = client.post(f"{API}/revisions/{r0}/release", json={}, headers=auth(team["approver"]))
    assert r.status_code == 200, r.text
    assert r.json()["display_status"] == "released"
    assert r.json()["submissions"][0]["response"] == "approved_with_comments"


def test_customer_rejection_freezes_revision_and_allows_next(client, team):
    doc = create_doc(client, team, customer_approval_required=True)
    r0 = rev(doc, "R0")["id"]
    release(client, team, r0)
    h = auth(team["admin"])
    sub = client.post(f"{API}/submissions", json={"customer_name": "ICF", "lines": [{"revision_id": r0}]}, headers=h).json()
    sent = client.post(f"{API}/submissions/{sub['id']}/send", json={}, headers=h).json()
    r = client.post(f"{API}/submissions/{sub['id']}/response", json={
        "response_date": date.today().isoformat(), "lines": [{"line_id": sent["lines"][0]["id"], "response": "rejected", "comment": "Wrong bolt grade"}],
    }, headers=h)
    assert r.status_code == 200
    d = client.get(f"{API}/documents/{doc['id']}", headers=auth(team["author"])).json()
    assert rev(d, "R0")["status"] == "customer_rejected" and d["display_status"] == "customer_rejected"
    assert "new_revision" in d["allowed_actions"]
    r = client.post(f"{API}/documents/{doc['id']}/revisions", json={"change_summary": "Bolt grade 8.8 per customer"}, headers=auth(team["author"]))
    assert r.status_code == 201 and rev(r.json(), "R1")["status"] == "draft"


# ---------------------------------------------------------------------------
# Team roles + viewers
# ---------------------------------------------------------------------------

def test_team_roles_and_viewer_visibility(client, team):
    released_doc = create_doc(client, team, title="Released one")
    release(client, team, rev(released_doc, "R0")["id"])
    draft_doc = create_doc(client, team, title="Draft one")

    # A team needs a head.
    r = client.put(f"{API}/settings", json={"team": [{"user_id": team["author"].id, "role": "designer"}]}, headers=auth(team["admin"]))
    assert r.status_code == 400 and "head" in r.json()["detail"]
    set_team(client, team, {"author": "designer", "checker": "reviewer", "approver": "head"})

    viewer = auth(team["prod"])
    me = client.get(f"{API}/settings/me", headers=viewer).json()
    assert me["role"] == "viewer" and not me["is_team"]
    numbers = {d["doc_number"] for d in client.get(f"{API}/documents", headers=viewer).json()}
    assert released_doc["doc_number"] in numbers and draft_doc["doc_number"] not in numbers
    assert client.get(f"{API}/documents/{draft_doc['id']}", headers=viewer).status_code == 404
    seen = client.get(f"{API}/documents/{released_doc['id']}", headers=viewer).json()
    assert seen["viewer_only"] and set(seen["allowed_actions"]) == {"comment", "raise_ecr"}

    r = client.post(f"{API}/documents", json={"title": "Sneaky", "document_type": "ga_drawing"}, headers=viewer)
    assert r.status_code == 403 and "Design team" in r.json()["detail"]

    # Only a head may be named approver once the team exists.
    r = client.post(f"{API}/documents", json={"title": "Bracket", "document_type": "part_drawing", "approver_id": team["checker"].id}, headers=auth(team["author"]))
    assert r.status_code == 400 and "Design head" in r.json()["detail"]
    # Settings default approver is pre-filled.
    client.put(f"{API}/settings", json={"default_approver_id": team["approver"].id}, headers=auth(team["approver"]))
    d = client.post(f"{API}/documents", json={"title": "Bracket", "document_type": "part_drawing"}, headers=auth(team["author"])).json()
    assert rev(d, "R0")["approver_id"] == team["approver"].id
    # Designers can't change settings.
    assert client.put(f"{API}/settings", json={"review_overdue_days": 3}, headers=auth(team["author"])).status_code == 403


# ---------------------------------------------------------------------------
# Checklists
# ---------------------------------------------------------------------------

def test_review_checklist_required_to_pass(client, team):
    h = auth(team["admin"])
    cl = client.post(f"{API}/library/checklists", json={
        "name": "GA check", "document_type": "ga_drawing", "items": [{"text": "Title block complete"}, {"text": "Tolerances shown"}],
    }, headers=h)
    assert cl.status_code == 201, cl.text
    items = cl.json()["items"]
    assert client.post(f"{API}/library/checklists", json={"name": "dup", "document_type": "ga_drawing", "items": [{"text": "xx"}]}, headers=h).status_code == 409

    doc = create_doc(client, team)
    r0 = rev(doc, "R0")["id"]
    upload(client, team["author"], r0)
    client.post(f"{API}/revisions/{r0}/submit", json={}, headers=auth(team["author"]))
    d = client.get(f"{API}/documents/{doc['id']}", headers=auth(team["checker"])).json()
    assert d["checklist"]["name"] == "GA check"

    hc = auth(team["checker"])
    r = client.post(f"{API}/revisions/{r0}/review", json={"decision": "pass", "checklist": [{"checklist_item_id": items[0]["id"], "result": "ok"}]}, headers=hc)
    assert r.status_code == 400 and "1 left" in r.json()["detail"]
    r = client.post(f"{API}/revisions/{r0}/review", json={"decision": "pass", "checklist": [
        {"checklist_item_id": items[0]["id"], "result": "ok"}, {"checklist_item_id": items[1]["id"], "result": "not_ok"}]}, headers=hc)
    assert r.status_code == 400 and "Not OK" in r.json()["detail"]
    r = client.post(f"{API}/revisions/{r0}/review", json={"decision": "pass", "checklist": [
        {"checklist_item_id": items[0]["id"], "result": "ok"}, {"checklist_item_id": items[1]["id"], "result": "na", "remark": "No machining"}]}, headers=hc)
    assert r.status_code == 200, r.text
    assert len(rev(r.json(), "R0")["review_results"]) == 2


# ---------------------------------------------------------------------------
# BOMs
# ---------------------------------------------------------------------------

def test_bom_release_checks_explosion_where_used(client, db, team):
    product, sub, bolt = item(db, "MT-MEC-0001", "Tamping unit"), item(db, "MT-MEC-0002", "Gearbox"), item(db, "MT-HWF-0001", "M12 bolt")
    dead = item(db, "MT-HWF-0099", "Old washer", status="inactive")
    h = auth(team["author"])
    gear_dwg = create_doc(client, team, title="Gearbox drawing", document_type="assembly_drawing")

    # Sub-assembly BOM, released.
    gb = client.post(f"{API}/boms", json={"product_item_id": sub.id, "title": "Gearbox", "lines": [{"store_item_id": bolt.id, "quantity": 4}]}, headers=h)
    assert gb.status_code == 201, gb.text
    gb = gb.json()
    assert gb["bom_number"].startswith("BOM-")
    release_bom(client, team, gb["revisions"][0]["id"])

    # Top BOM with a new-item request, an inactive item and an unreleased drawing → can't release.
    top = client.post(f"{API}/boms", json={"product_item_id": product.id, "title": "Tamping unit", "lines": [
        {"store_item_id": sub.id, "quantity": 2, "document_id": gear_dwg["id"], "make_buy": "make"},
        {"new_item_name": "Special spacer", "new_item_spec": "EN8, 20 mm", "quantity": 8},
        {"store_item_id": dead.id, "quantity": 1},
    ]}, headers=h).json()
    rid = top["revisions"][0]["id"]
    lines = top["revisions"][0]["lines"]
    assert lines[1]["release_blocker"] and "item code" in lines[1]["release_blocker"]
    blocked = release_bom(client, team, rid, expect=409)
    assert "can't be released" in blocked["detail"]

    # Fix: link the new item, drop the inactive one, release the drawing.
    spacer = item(db, "MT-MEC-0003", "Special spacer")
    reqs = client.get(f"{API}/boms/new-item-requests", headers=h).json()
    assert reqs == [] or all(r["bom_id"] == top["id"] for r in reqs)  # top is in approval now, so not listed as draft-open
    client.post(f"{API}/boms/revisions/{rid}/approve", json={"decision": "return", "comment": "Fix blockers"}, headers=auth(team["approver"]))
    r = client.patch(f"{API}/boms/revisions/{rid}", json={"lines": [
        {"store_item_id": sub.id, "quantity": 2, "document_id": gear_dwg["id"], "make_buy": "make"},
        {"store_item_id": spacer.id, "quantity": 8},
    ]}, headers=h)
    assert r.status_code == 200, r.text
    release(client, team, rev(gear_dwg, "R0")["id"])
    detail = release_bom(client, team, rid)
    assert detail["display_status"] == "released"
    assert detail["revisions"][0]["lines"][0]["document_revision_label"] == "R0"
    assert detail["revisions"][0]["lines"][0]["sub_bom_number"] == gb["bom_number"]

    explosion = client.get(f"{API}/boms/{top['id']}/explosion", headers=h).json()
    bolts = [row for row in explosion if row["item_code"] == "MT-HWF-0001"]
    assert bolts and bolts[0]["level"] == 2 and bolts[0]["total_quantity"] == 8
    csv_ = client.get(f"{API}/boms/{top['id']}/export", headers=h)
    assert csv_.status_code == 200 and "MT-HWF-0001" in csv_.content.decode("utf-8-sig")

    wu = client.get(f"{API}/where-used", params={"store_item_id": bolt.id}, headers=h).json()
    assert [b["bom_number"] for b in wu["boms"]] == [gb["bom_number"]]
    wu = client.get(f"{API}/where-used", params={"document_id": gear_dwg["id"]}, headers=h).json()
    assert wu["boms"][0]["bom_number"] == top["bom_number"]

    # New revision copies the released lines; the released BOM can't be edited.
    r = client.patch(f"{API}/boms/revisions/{rid}", json={"change_summary": "x"}, headers=h)
    assert r.status_code == 409 and "never edited" in r.json()["detail"]
    nxt = client.post(f"{API}/boms/{top['id']}/revisions", json={"change_summary": "Quantity change"}, headers=h).json()
    assert len(nxt["revisions"][0]["lines"]) == 2 and nxt["display_status"] == "revising"
    assert client.delete(f"{API}/boms/{top['id']}", headers=h).status_code == 409


# ---------------------------------------------------------------------------
# ECR → ECN
# ---------------------------------------------------------------------------

def test_ecr_board_ecn_acknowledge_close(client, db, team):
    set_team(client, team, {"author": "designer", "checker": "reviewer", "approver": "head"})
    client.put(f"{API}/settings", json={
        "change_board_member_ids": [team["prod"].id, team["qa"].id],
        "ecn_acknowledger_ids": {"production": [team["prod"].id], "quality": [team["qa"].id],
                                 "purchase": [team["admin"].id], "store": [team["admin"].id]},
    }, headers=auth(team["approver"]))
    doc = create_doc(client, team, approver_id=team["approver"].id)
    release(client, team, rev(doc, "R0")["id"])
    draft_only = create_doc(client, team, title="Unreleased", approver_id=team["approver"].id)

    viewer = auth(team["prod"])
    r = client.post(f"{API}/change-requests", json={
        "title": "Hole misaligned", "source": "production", "reason": "Bolt holes 2 mm off", "proposed_change": "Move holes",
        "items": [{"document_id": draft_only["id"]}],
    }, headers=viewer)
    assert r.status_code == 400 and "no ECR is needed" in r.json()["detail"]
    ecr = client.post(f"{API}/change-requests", json={
        "title": "Hole misaligned", "source": "production", "urgency": "high", "reason": "Bolt holes 2 mm off",
        "proposed_change": "Move holes", "items": [{"document_id": doc["id"]}],
    }, headers=viewer)
    assert ecr.status_code == 201, ecr.text
    ecr = ecr.json()
    assert ecr["ecr_number"].startswith("ECR-") and ecr["status"] == "open"
    assert "items" in ecr and ecr["items"][0]["number"] == doc["doc_number"]

    head = auth(team["approver"])
    assert client.post(f"{API}/change-requests/{ecr['id']}/decide", json={"decision": "approved"}, headers=head).status_code == 409
    r = client.post(f"{API}/change-requests/{ecr['id']}/impact", json={"impact_summary": "2 machines in WIP"}, headers=auth(team["author"]))
    assert r.status_code == 200 and r.json()["status"] == "impact_checked" and r.json()["votes_needed"] == 2

    assert client.post(f"{API}/change-requests/{ecr['id']}/vote", json={"vote": "approve"}, headers=auth(team["author"])).status_code == 403
    client.post(f"{API}/change-requests/{ecr['id']}/vote", json={"vote": "approve"}, headers=viewer)
    r = client.post(f"{API}/change-requests/{ecr['id']}/decide", json={"decision": "approved"}, headers=head)
    assert r.status_code == 409 and "haven't voted" in r.json()["detail"]
    assert client.post(f"{API}/change-requests/{ecr['id']}/vote", json={"vote": "reject"}, headers=auth(team["qa"])).status_code == 400
    client.post(f"{API}/change-requests/{ecr['id']}/vote", json={"vote": "approve", "comment": "ok"}, headers=auth(team["qa"]))
    r = client.post(f"{API}/change-requests/{ecr['id']}/decide", json={"decision": "approved"}, headers=head)
    assert r.status_code == 200 and "create_ecn" in r.json()["allowed_actions"]

    r = client.post(f"{API}/change-requests/{ecr['id']}/ecn", json={"effectivity_type": "date"}, headers=head)
    assert r.status_code == 400 and "date" in r.json()["detail"]
    r = client.post(f"{API}/change-requests/{ecr['id']}/ecn", json={"effectivity_type": "next_order", "stock_disposition": "rework"}, headers=head)
    assert r.status_code == 200, r.text
    ecn_id = r.json()["id"]
    ecn = client.get(f"{API}/change-notices/{ecn_id}", headers=head).json()
    assert ecn["status"] == "approved" and ecn["ecr_number"] == ecr["ecr_number"]

    d = client.post(f"{API}/documents/{doc['id']}/revisions", json={
        "change_summary": "Holes moved", "ecn_id": ecn_id, "reviewer_id": team["checker"].id, "approver_id": team["approver"].id,
    }, headers=auth(team["author"])).json()
    release(client, team, rev(d, "R1")["id"])
    r = client.post(f"{API}/change-notices/{ecn_id}/implement", headers=head)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "implemented"
    depts = {a["department"] for a in body["acknowledgements"]}
    assert depts == {"production", "purchase", "store", "quality"}

    r = client.post(f"{API}/change-notices/{ecn_id}/acknowledge", json={"department": "production"}, headers=auth(team["qa"]))
    assert r.status_code == 403
    for user, dept in ((team["prod"], "production"), (team["qa"], "quality"), (team["admin"], "purchase")):
        assert client.post(f"{API}/change-notices/{ecn_id}/acknowledge", json={"department": dept}, headers=auth(user)).status_code == 200
    r = client.post(f"{API}/change-notices/{ecn_id}/acknowledge", json={"department": "store", "remarks": "Old stock tagged"}, headers=auth(team["admin"]))
    assert r.status_code == 200 and r.json()["status"] == "closed"

    reg = client.get(f"{API}/reports/change-register", headers=head).json()
    assert reg["rows"][0]["ecn_number"] == ecn["ecn_number"]


# ---------------------------------------------------------------------------
# Requests, library, reports, reminders
# ---------------------------------------------------------------------------

def test_design_request_revision_flag(client, team):
    h = auth(team["other"])
    req = client.post(f"{API}/requests", json={
        "title": "Ballast cleaner conveyor", "source": "bd", "requirement": "Conveyor 1200 mm wide, 400 t/h",
        "lead_designer_id": team["author"].id, "due_date": (date.today() - timedelta(days=1)).isoformat(),
    }, headers=h)
    assert req.status_code == 201, req.text
    req = req.json()
    assert req["request_number"].startswith("DRQ-") and req["is_overdue"]
    r = client.post(f"{API}/requests/{req['id']}/revise", json={"requirement": "Conveyor 1400 mm wide, 500 t/h", "change_note": "Customer revised capacity"}, headers=h)
    assert r.status_code == 200 and r.json()["changed_since_review"] and len(r.json()["history"]) == 2
    r = client.post(f"{API}/requests/{req['id']}/acknowledge", headers=auth(team["author"]))
    assert r.status_code == 200 and not r.json()["changed_since_review"]
    r = client.post(f"{API}/requests/{req['id']}/status", json={"action": "accept"}, headers=auth(team["admin"]))
    assert r.status_code == 200 and r.json()["status"] == "accepted"
    doc = create_doc(client, team, design_request_id=req["id"])
    detail = client.get(f"{API}/requests/{req['id']}", headers=h).json()
    assert detail["deliverables"][0]["number"] == doc["doc_number"]
    rows = client.get(f"{API}/requests", headers=h).json()
    assert rows[0]["id"] == req["id"]


def test_request_resume_returns_to_held_status(client, team):
    """Hold → resume puts the request back where it was: one held while still
    open must not jump to in progress without being accepted."""
    h, head = auth(team["other"]), auth(team["admin"])
    req = client.post(f"{API}/requests", json={
        "title": "Tamper cab frame", "source": "bd", "requirement": "Cab frame for UNO tamper",
        "lead_designer_id": team["author"].id,
    }, headers=h).json()
    status = f"{API}/requests/{req['id']}/status"
    assert client.post(status, json={"action": "hold", "reason": "Waiting for customer"}, headers=head).json()["status"] == "on_hold"
    assert client.post(status, json={"action": "resume"}, headers=head).json()["status"] == "open"
    assert client.post(status, json={"action": "accept"}, headers=head).json()["status"] == "accepted"
    assert client.post(status, json={"action": "hold", "reason": "Customer paused"}, headers=head).json()["status"] == "on_hold"
    assert client.post(status, json={"action": "resume"}, headers=head).json()["status"] == "accepted"
    assert client.post(status, json={"action": "start"}, headers=head).json()["status"] == "in_progress"
    assert client.post(status, json={"action": "hold", "reason": "Paused"}, headers=head).json()["status"] == "on_hold"
    assert client.post(status, json={"action": "resume"}, headers=head).json()["status"] == "in_progress"


def test_library_reports_dashboard_and_reminders(client, db, team):
    h = auth(team["admin"])
    std = client.post(f"{API}/library/standards", json={"body": "RDSO", "code": "RDSO/2007/CG-01", "title": "Bogie design", "version": "Rev 2"}, headers=h)
    assert std.status_code == 201, std.text
    assert client.post(f"{API}/library/standards", json={"body": "RDSO", "code": "rdso/2007/cg-01", "title": "dup", "version": "Rev 2"}, headers=h).status_code == 409
    doc = create_doc(client, team, standard_id=std.json()["id"])
    assert doc["standard_label"].startswith("RDSO/2007/CG-01")
    assert client.delete(f"{API}/library/standards/{std.json()['id']}", headers=h).status_code == 409
    it = item(db, "MT-ELE-0001", "Contactor")
    assert client.post(f"{API}/library/approved-makes", json={"store_item_id": it.id, "make": "Siemens"}, headers=h).status_code == 201
    part = client.post(f"{API}/library/standard-parts", json={"store_item_id": it.id, "discipline": "electrical"}, headers=h)
    assert part.status_code == 201 and part.json()["approved_makes"] == ["Siemens"]
    t = client.post(f"{API}/library/templates", data={"kind": "title_block", "name": "A1 title block"},
                    files={"file": ("tb.pdf", b"%PDF-1.7 tb", "application/pdf")}, headers=h)
    assert t.status_code == 201, t.text
    assert client.get(f"{API}/library/templates/{t.json()['id']}/file", headers=h).status_code == 200

    for path in ("dashboard", "my-tasks", "my-work", "milestones", "reports/customer-approvals", "reports/milestones",
                 "reports/workload", "reports/first-time-right", f"reports/revision-history?document_id={doc['id']}",
                 "reports/master-document-list", "settings", "lookups/customers", "lookups/released-documents",
                 "lookups/awaiting-customer", "lookups/boms", "lookups/standards"):
        r = client.get(f"{API}/{path}", headers=h)
        assert r.status_code == 200, f"{path}: {r.text}"

    from app.tasks.design_reminders import run_design_reminders
    client.post(f"{API}/requests", json={"title": "Late", "requirement": "Something late",
                                         "due_date": (date.today() - timedelta(days=3)).isoformat()}, headers=h)
    client.put(f"{API}/settings", json={"default_approver_id": team["approver"].id}, headers=h)
    db.expire_all()  # the job runs in its own fresh session in production
    assert run_design_reminders(db, date.today()) >= 1
    db.commit()
    assert run_design_reminders(db, date.today()) == 0  # deduped
