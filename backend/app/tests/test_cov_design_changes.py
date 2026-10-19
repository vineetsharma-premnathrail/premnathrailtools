"""Coverage: ECR → change board → ECN → department acknowledgements, plus
legacy (ECR-less) ECN rules, effectivity, BOM-affecting ECNs, permission
403s and real error messages."""
import pytest

from app.tests.test_cov_design_support import (
    API, YEAR, auth, bom_with_released, create_doc, fake_sharepoint, item, make_team, make_user, release, release_bom,
    released_doc, rev, set_team,
)

pytestmark = pytest.mark.usefixtures("fake_sharepoint")


@pytest.fixture
def team(db):
    t = make_team(db)
    t["prod"] = make_user(db, "cov.prod@premnathrail.com", apps=("design", "production"))
    t["qa"] = make_user(db, "cov.qa@premnathrail.com", apps=("design", "quality"))
    t["buyer"] = make_user(db, "cov.buyer@premnathrail.com", apps=("design", "p2p"))
    t["storekeeper"] = make_user(db, "cov.store@premnathrail.com", apps=("design", "store"))
    return t


def _ecr(client, team, items, who="prod", **extra):
    body = {"title": "Hole misaligned", "source": "production", "reason": "Bolt holes 2 mm off",
            "proposed_change": "Move holes", "items": items, **extra}
    return client.post(f"{API}/change-requests", json=body, headers=auth(team[who]))


def _approved_ecr(client, team, items, **extra):
    """ECR raised → impact (board = prod) → prod votes → head approves."""
    ecr = _ecr(client, team, items, **extra)
    assert ecr.status_code == 201, ecr.text
    ecr = ecr.json()
    r = client.post(f"{API}/change-requests/{ecr['id']}/impact",
                    json={"impact_summary": "Two frames in WIP", "board_member_ids": [team["prod"].id]}, headers=auth(team["author"]))
    assert r.status_code == 200, r.text
    assert client.post(f"{API}/change-requests/{ecr['id']}/vote", json={"vote": "approve"}, headers=auth(team["prod"])).status_code == 200
    r = client.post(f"{API}/change-requests/{ecr['id']}/decide", json={"decision": "approved"}, headers=auth(team["approver"]))
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def board(client, team):
    set_team(client, team, {"author": "designer", "checker": "reviewer", "approver": "head"})
    return team


# ---------------------------------------------------------------------------
# ECR raising + validation
# ---------------------------------------------------------------------------

def test_ecr_number_and_item_validation(client, board):
    team = board
    doc = released_doc(client, team)
    r = _ecr(client, team, [])
    assert r.status_code == 400 and "at least one released drawing or BOM" in r.json()["detail"]
    r = _ecr(client, team, [{"document_id": doc["id"], "bom_id": 1}])
    assert r.status_code == 400 and "pick exactly one per line" in r.json()["detail"]
    r = _ecr(client, team, [{"document_id": doc["id"]}, {"document_id": doc["id"]}])
    assert r.status_code == 400 and "listed twice" in r.json()["detail"]
    r = _ecr(client, team, [{"document_id": 99999}])
    assert r.status_code == 400 and "Drawing #99999 wasn't found" in r.json()["detail"]
    r = _ecr(client, team, [{"document_id": doc["id"]}], source="gossip")
    assert r.status_code == 400 and "'gossip' isn't a valid source" in r.json()["detail"]
    r = _ecr(client, team, [{"document_id": doc["id"]}], urgency="asap")
    assert r.status_code == 400 and "'asap' isn't a valid urgency" in r.json()["detail"]
    first = _ecr(client, team, [{"document_id": doc["id"]}]).json()
    second = _ecr(client, team, [{"document_id": doc["id"]}]).json()
    assert first["ecr_number"] == f"ECR-{YEAR}-0001" and second["ecr_number"] == f"ECR-{YEAR}-0002"
    assert first["raised_by_name"] == "cov.prod" and first["status"] == "open"


def test_ecr_edit_rights_and_freeze(client, board):
    team = board
    doc = released_doc(client, team)
    ecr = _ecr(client, team, [{"document_id": doc["id"]}]).json()
    r = client.patch(f"{API}/change-requests/{ecr['id']}", json={"title": "Hijacked"}, headers=auth(team["qa"]))
    assert r.status_code == 403 and "Only the person who raised" in r.json()["detail"]
    r = client.patch(f"{API}/change-requests/{ecr['id']}", json={"items": []}, headers=auth(team["prod"]))
    assert r.status_code == 400 and "Keep at least one" in r.json()["detail"]
    # The head may edit someone else's ECR.
    r = client.patch(f"{API}/change-requests/{ecr['id']}", json={"title": "Hole misaligned on frame"}, headers=auth(team["approver"]))
    assert r.status_code == 200 and r.json()["title"] == "Hole misaligned on frame"
    client.post(f"{API}/change-requests/{ecr['id']}/impact", json={"impact_summary": "Minor"}, headers=auth(team["author"]))
    r = client.patch(f"{API}/change-requests/{ecr['id']}", json={"title": "Too late"}, headers=auth(team["prod"]))
    assert r.status_code == 409 and "can no longer be edited" in r.json()["detail"]


def test_impact_is_design_team_only_and_board_must_have_design(client, db, board):
    team = board
    doc = released_doc(client, team)
    ecr = _ecr(client, team, [{"document_id": doc["id"]}]).json()
    r = client.post(f"{API}/change-requests/{ecr['id']}/impact", json={"impact_summary": "I think it's fine"}, headers=auth(team["prod"]))
    assert r.status_code == 403 and "done by the Design team" in r.json()["detail"]
    crm = make_user(db, "cov.crm@premnathrail.com", apps=("crm",))
    r = client.post(f"{API}/change-requests/{ecr['id']}/impact",
                    json={"impact_summary": "Minor", "board_member_ids": [crm.id]}, headers=auth(team["author"]))
    assert r.status_code == 400 and "doesn't have access to the Design module" in r.json()["detail"]
    # Duplicate board ids collapse to one vote needed.
    r = client.post(f"{API}/change-requests/{ecr['id']}/impact",
                    json={"impact_summary": "Minor", "board_member_ids": [team["qa"].id, team["qa"].id]}, headers=auth(team["author"]))
    assert r.status_code == 200 and r.json()["votes_needed"] == 1


# ---------------------------------------------------------------------------
# Votes + decision
# ---------------------------------------------------------------------------

def test_vote_rules_and_revote_replaces(client, board):
    team = board
    doc = released_doc(client, team)
    ecr = _ecr(client, team, [{"document_id": doc["id"]}]).json()
    h = auth(team["qa"])
    r = client.post(f"{API}/change-requests/{ecr['id']}/vote", json={"vote": "approve"}, headers=h)
    assert r.status_code == 409 and "once the impact is checked" in r.json()["detail"]
    client.post(f"{API}/change-requests/{ecr['id']}/impact",
                json={"impact_summary": "Minor", "board_member_ids": [team["qa"].id, team["prod"].id]}, headers=auth(team["author"]))
    r = client.post(f"{API}/change-requests/{ecr['id']}/vote", json={"vote": "maybe"}, headers=h)
    assert r.status_code == 400 and "Approve, Reject or Defer" in r.json()["detail"]
    r = client.post(f"{API}/change-requests/{ecr['id']}/vote", json={"vote": "defer"}, headers=h)
    assert r.status_code == 400 and "Say why you vote to defer" in r.json()["detail"]
    client.post(f"{API}/change-requests/{ecr['id']}/vote", json={"vote": "defer", "comment": "Wait for trial"}, headers=h)
    r = client.post(f"{API}/change-requests/{ecr['id']}/vote", json={"vote": "approve"}, headers=h)
    body = r.json()
    assert body["votes_cast"] == 1 and len(body["votes"]) == 1 and body["votes"][0]["vote"] == "approve"
    board_view = {m["user_id"]: m["vote"] for m in body["board_members"]}
    assert board_view == {team["qa"].id: "approve", team["prod"].id: None}


def test_decide_rules_defer_reopen_and_admin_override(client, board):
    team = board
    doc = released_doc(client, team)
    ecr = _ecr(client, team, [{"document_id": doc["id"]}]).json()
    client.post(f"{API}/change-requests/{ecr['id']}/impact",
                json={"impact_summary": "Minor", "board_member_ids": [team["qa"].id]}, headers=auth(team["author"]))
    # A designer can't decide.
    r = client.post(f"{API}/change-requests/{ecr['id']}/decide", json={"decision": "approved"}, headers=auth(team["author"]))
    assert r.status_code == 403 and "Only the Design head" in r.json()["detail"]
    client.post(f"{API}/change-requests/{ecr['id']}/vote", json={"vote": "approve"}, headers=auth(team["qa"]))
    head = auth(team["approver"])
    r = client.post(f"{API}/change-requests/{ecr['id']}/decide", json={"decision": "postponed"}, headers=head)
    assert r.status_code == 400
    r = client.post(f"{API}/change-requests/{ecr['id']}/decide", json={"decision": "deferred"}, headers=head)
    assert r.status_code == 400 and "Give the reason the ECR is deferred" in r.json()["detail"]
    r = client.post(f"{API}/change-requests/{ecr['id']}/decide", json={"decision": "deferred", "comment": "After season"}, headers=head)
    assert r.status_code == 200 and r.json()["status"] == "deferred" and "reopen" in r.json()["allowed_actions"]
    r = client.post(f"{API}/change-requests/{ecr['id']}/reopen", headers=auth(team["author"]))
    assert r.status_code == 403 and "Only the Design head" in r.json()["detail"]
    r = client.post(f"{API}/change-requests/{ecr['id']}/reopen", headers=head)
    assert r.status_code == 200 and r.json()["status"] == "impact_checked" and r.json()["decided_by_name"] is None
    r = client.post(f"{API}/change-requests/{ecr['id']}/reopen", headers=head)
    assert r.status_code == 409 and "only a deferred ECR" in r.json()["detail"]

    # Admin may decide even while board votes are missing.
    other = _ecr(client, team, [{"document_id": doc["id"]}]).json()
    client.post(f"{API}/change-requests/{other['id']}/impact",
                json={"impact_summary": "Minor", "board_member_ids": [team["qa"].id]}, headers=auth(team["author"]))
    r = client.post(f"{API}/change-requests/{other['id']}/decide", json={"decision": "rejected", "comment": "Not worth it"}, headers=auth(team["admin"]))
    assert r.status_code == 200 and r.json()["status"] == "rejected"


def test_withdraw_rules(client, board):
    team = board
    doc = released_doc(client, team)
    ecr = _ecr(client, team, [{"document_id": doc["id"]}]).json()
    r = client.post(f"{API}/change-requests/{ecr['id']}/withdraw", json={"comment": "nope"}, headers=auth(team["approver"]))
    assert r.status_code == 403 and "Only the person who raised" in r.json()["detail"]
    r = client.post(f"{API}/change-requests/{ecr['id']}/withdraw", json={"comment": "Duplicate of another"}, headers=auth(team["prod"]))
    assert r.status_code == 200 and r.json()["status"] == "withdrawn"
    r = client.post(f"{API}/change-requests/{ecr['id']}/withdraw", json={"comment": "Again"}, headers=auth(team["prod"]))
    assert r.status_code == 409 and "only an undecided ECR" in r.json()["detail"]


# ---------------------------------------------------------------------------
# ECR → ECN
# ---------------------------------------------------------------------------

def test_ecn_from_ecr_maps_fields_and_is_one_off(client, board):
    team = board
    doc = released_doc(client, team)
    ecr = _ecr(client, team, [{"document_id": doc["id"], "note": "Move holes 2 mm"}], urgency="critical").json()
    r = client.post(f"{API}/change-requests/{ecr['id']}/ecn", json={}, headers=auth(team["approver"]))
    assert r.status_code == 409 and "only an approved ECR becomes an ECN" in r.json()["detail"]

    ecr = _approved_ecr(client, team, [{"document_id": doc["id"], "note": "Move holes 2 mm"}], urgency="critical")
    r = client.post(f"{API}/change-requests/{ecr['id']}/ecn", json={}, headers=auth(team["author"]))
    assert r.status_code == 403 and "Only the Design head" in r.json()["detail"]
    r = client.post(f"{API}/change-requests/{ecr['id']}/ecn", json={"effectivity_type": "serial"}, headers=auth(team["approver"]))
    assert r.status_code == 400 and "first serial number" in r.json()["detail"]
    r = client.post(f"{API}/change-requests/{ecr['id']}/ecn", json={"effectivity_type": "date", "effectivity_date": "31-12-2026"}, headers=auth(team["approver"]))
    assert r.status_code == 400 and "isn't a valid date (use YYYY-MM-DD)" in r.json()["detail"]
    r = client.post(f"{API}/change-requests/{ecr['id']}/ecn", json={"stock_disposition": "sell"}, headers=auth(team["approver"]))
    assert r.status_code == 400 and "'sell' isn't a valid disposition" in r.json()["detail"]
    r = client.post(f"{API}/change-requests/{ecr['id']}/ecn", json={"effectivity_type": "serial", "effectivity_serial": "TU-0042"}, headers=auth(team["approver"]))
    assert r.status_code == 200, r.text
    assert r.json()["ecn_number"] == f"ECN-{YEAR}-0001"
    ecn = client.get(f"{API}/change-notices/{r.json()['id']}", headers=auth(team["approver"])).json()
    assert ecn["status"] == "approved" and ecn["reason"] == "manufacturing_issue" and ecn["priority"] == "urgent"
    assert ecn["approver_name"] == "cov.approver" and ecn["ecr_number"] == ecr["ecr_number"]
    assert ecn["documents"][0]["change_description"] == "Move holes 2 mm"
    assert ecn["documents"][0]["implementation_status"] == "pending"
    r = client.post(f"{API}/change-requests/{ecr['id']}/ecn", json={}, headers=auth(team["approver"]))
    assert r.status_code == 409 and f"already has {ecn['ecn_number']}" in r.json()["detail"]
    detail = client.get(f"{API}/change-requests/{ecr['id']}", headers=auth(team["approver"])).json()
    assert detail["ecn_number"] == ecn["ecn_number"] and "create_ecn" not in detail["allowed_actions"]


def test_bom_ecn_needs_released_bom_revision_then_acknowledgement_fallback(client, db, board):
    team = board
    product, part = item(db, "MT-COV-0100", "Frame"), item(db, "MT-COV-0101", "Plate")
    bom = bom_with_released(client, team, product, [{"store_item_id": part.id, "quantity": 2}])
    ecr = _approved_ecr(client, team, [{"bom_id": bom["id"]}])
    ecn_id = client.post(f"{API}/change-requests/{ecr['id']}/ecn", json={}, headers=auth(team["approver"])).json()["id"]

    r = client.post(f"{API}/change-notices/{ecn_id}/implement", headers=auth(team["approver"]))
    assert r.status_code == 409 and bom["bom_number"] in r.json()["detail"] and "no revision raised yet" in r.json()["detail"]
    d = client.post(f"{API}/boms/{bom['id']}/revisions", json={"change_summary": "Plate qty 3", "ecn_id": ecn_id}, headers=auth(team["author"]))
    assert d.status_code == 201, d.text
    r1 = next(x for x in d.json()["revisions"] if x["revision_label"] == "R1")
    assert r1["ecn_number"]
    r = client.post(f"{API}/change-notices/{ecn_id}/implement", headers=auth(team["approver"]))
    assert r.status_code == 409 and "R1 is draft" in r.json()["detail"]
    release_bom(client, team, r1["id"])
    # Someone not involved can't mark it implemented.
    r = client.post(f"{API}/change-notices/{ecn_id}/implement", headers=auth(team["checker"]))
    assert r.status_code == 403 and "Only the person who raised" in r.json()["detail"]
    r = client.post(f"{API}/change-notices/{ecn_id}/implement", headers=auth(team["approver"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "implemented" and body["boms"][0]["implementation_status"] == "released"
    # No project on the ECN → no project acknowledgement.
    assert {a["department"] for a in body["acknowledgements"]} == {"production", "purchase", "store", "quality"}

    # No acknowledgers named in Settings → holders of that department's app may acknowledge.
    r = client.post(f"{API}/change-notices/{ecn_id}/acknowledge", json={"department": "purchase"}, headers=auth(team["prod"]))
    assert r.status_code == 403 and "Purchase" in r.json()["detail"]
    r = client.post(f"{API}/change-notices/{ecn_id}/acknowledge", json={"department": "project"}, headers=auth(team["admin"]))
    assert r.status_code == 400 and "isn't waiting on 'project'" in r.json()["detail"]
    for who, dept in (("buyer", "purchase"), ("prod", "production"), ("qa", "quality")):
        assert client.post(f"{API}/change-notices/{ecn_id}/acknowledge", json={"department": dept}, headers=auth(team[who])).status_code == 200
    r = client.post(f"{API}/change-notices/{ecn_id}/acknowledge", json={"department": "production"}, headers=auth(team["prod"]))
    assert r.status_code == 409 and "Production already acknowledged" in r.json()["detail"]
    r = client.post(f"{API}/change-notices/{ecn_id}/acknowledge", json={"department": "store"}, headers=auth(team["storekeeper"]))
    assert r.status_code == 200 and r.json()["status"] == "closed" and r.json()["acknowledged_count"] == 4


# ---------------------------------------------------------------------------
# Legacy ECN (no ECR)
# ---------------------------------------------------------------------------

def test_legacy_ecn_validation_and_rights(client, db, team):
    doc = released_doc(client, team)
    h = auth(team["other"])
    r = client.post(f"{API}/change-notices", json={"title": "Self approve", "approver_id": team["other"].id}, headers=h)
    assert r.status_code == 400 and "can't approve an ECN you're raising" in r.json()["detail"]
    crm = make_user(db, "cov.crm@premnathrail.com", apps=("crm",))
    r = client.post(f"{API}/change-notices", json={"title": "Outsider approve", "approver_id": crm.id}, headers=h)
    assert r.status_code == 400 and "doesn't have access to the Design module" in r.json()["detail"]
    r = client.post(f"{API}/change-notices", json={"title": "Bad reason", "reason": "whim"}, headers=h)
    assert r.status_code == 400 and "'whim' isn't a valid reason" in r.json()["detail"]
    r = client.post(f"{API}/change-notices", json={"title": "Twice", "documents": [{"document_id": doc["id"]}, {"document_id": doc["id"]}]}, headers=h)
    assert r.status_code == 400 and "listed twice" in r.json()["detail"]

    ecn = client.post(f"{API}/change-notices", json={"title": "Thicker gusset", "documents": [{"document_id": doc["id"]}],
                                                    "effectivity_type": "date"}, headers=h).json()
    assert ecn["ecn_number"] == f"ECN-{YEAR}-0001" and set(ecn["allowed_actions"]) >= {"edit", "submit", "cancel", "delete"}
    r = client.patch(f"{API}/change-notices/{ecn['id']}", json={"title": "Hijack"}, headers=auth(team["author"]))
    assert r.status_code == 403 and "Only the person who raised" in r.json()["detail"]
    client.patch(f"{API}/change-notices/{ecn['id']}", json={"approver_id": team["approver"].id}, headers=h)
    # Date effectivity without a date blocks submission.
    r = client.post(f"{API}/change-notices/{ecn['id']}/submit", headers=h)
    assert r.status_code == 400 and "give the date the change takes effect" in r.json()["detail"]
    client.patch(f"{API}/change-notices/{ecn['id']}", json={"effectivity_date": "2026-12-01"}, headers=h)
    assert client.post(f"{API}/change-notices/{ecn['id']}/submit", headers=h).status_code == 200
    r = client.delete(f"{API}/change-notices/{ecn['id']}", headers=h)
    assert r.status_code == 409 and "Cancel it instead" in r.json()["detail"]
    r = client.post(f"{API}/change-notices/{ecn['id']}/approve", json={}, headers=auth(team["checker"]))
    assert r.status_code == 403 and "waiting on cov.approver" in r.json()["detail"]
    # With a team set up, a designer who didn't raise it can't cancel it
    # (with no team everyone acts as Design head, who may cancel).
    set_team(client, team, {"author": "designer", "other": "designer", "approver": "head"})
    r = client.post(f"{API}/change-notices/{ecn['id']}/cancel", json={"reason": "Not needed"}, headers=auth(team["author"]))
    assert r.status_code == 403 and "the Design head or an admin" in r.json()["detail"]
    r = client.post(f"{API}/change-notices/{ecn['id']}/cancel", json={"reason": "Not needed"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"


def test_ecn_cannot_list_obsolete_document(client, team):
    doc = released_doc(client, team)
    client.post(f"{API}/documents/{doc['id']}/obsolete", json={"reason": "Withdrawn"}, headers=auth(team["author"]))
    r = client.post(f"{API}/change-notices", json={"title": "Change obsolete", "documents": [{"document_id": doc["id"]}]}, headers=auth(team["other"]))
    assert r.status_code == 400 and "is obsolete" in r.json()["detail"] and doc["doc_number"] in r.json()["detail"]


def test_effectivity_rights_and_freeze(client, board):
    team = board
    doc = released_doc(client, team)
    ecr = _approved_ecr(client, team, [{"document_id": doc["id"]}])
    ecn_id = client.post(f"{API}/change-requests/{ecr['id']}/ecn", json={}, headers=auth(team["approver"])).json()["id"]
    r = client.patch(f"{API}/change-notices/{ecn_id}/effectivity", json={"effectivity_type": "next_order"}, headers=auth(team["author"]))
    assert r.status_code == 403 and "Only the Design head" in r.json()["detail"]
    r = client.patch(f"{API}/change-notices/{ecn_id}/effectivity", json={"wip_disposition": "melt"}, headers=auth(team["approver"]))
    assert r.status_code == 400 and "'melt' isn't a valid disposition" in r.json()["detail"]
    r = client.patch(f"{API}/change-notices/{ecn_id}/effectivity", json={"effectivity_type": "next_order", "stock_disposition": "use_up"}, headers=auth(team["approver"]))
    assert r.status_code == 200 and r.json()["effectivity_type"] == "next_order" and r.json()["stock_disposition"] == "use_up"

    d = client.post(f"{API}/documents/{doc['id']}/revisions", json={
        "change_summary": "Holes moved", "ecn_id": ecn_id, "reviewer_id": team["checker"].id, "approver_id": team["approver"].id,
    }, headers=auth(team["author"])).json()
    release(client, team, rev(d, "R1")["id"])
    assert client.post(f"{API}/change-notices/{ecn_id}/implement", headers=auth(team["approver"])).status_code == 200
    r = client.patch(f"{API}/change-notices/{ecn_id}/effectivity", json={"effectivity_type": "immediate"}, headers=auth(team["approver"]))
    assert r.status_code == 409 and "effectivity is fixed once the ECN is released" in r.json()["detail"]
    # A revision can't be raised under an implemented ECN.
    r = client.post(f"{API}/documents/{doc['id']}/revisions", json={"change_summary": "More", "ecn_id": ecn_id}, headers=auth(team["author"]))
    assert r.status_code == 400 and "implemented" in r.json()["detail"]


def test_named_acknowledgers_override_app_holders(client, board):
    team = board
    client.put(f"{API}/settings", json={"ecn_acknowledger_ids": {"production": [team["qa"].id]}}, headers=auth(team["approver"]))
    r = client.put(f"{API}/settings", json={"ecn_acknowledger_ids": {"marketing": [team["qa"].id]}}, headers=auth(team["approver"]))
    assert r.status_code == 400 and "Unknown department(s): marketing" in r.json()["detail"]
    doc = released_doc(client, team)
    ecr = _approved_ecr(client, team, [{"document_id": doc["id"]}])
    ecn_id = client.post(f"{API}/change-requests/{ecr['id']}/ecn", json={}, headers=auth(team["approver"])).json()["id"]
    d = client.post(f"{API}/documents/{doc['id']}/revisions", json={
        "change_summary": "Holes moved", "ecn_id": ecn_id, "reviewer_id": team["checker"].id, "approver_id": team["approver"].id,
    }, headers=auth(team["author"])).json()
    release(client, team, rev(d, "R1")["id"])
    client.post(f"{API}/change-notices/{ecn_id}/implement", headers=auth(team["approver"]))
    # Production app holder is NOT the named acknowledger → refused.
    r = client.post(f"{API}/change-notices/{ecn_id}/acknowledge", json={"department": "production"}, headers=auth(team["prod"]))
    assert r.status_code == 403
    r = client.post(f"{API}/change-notices/{ecn_id}/acknowledge", json={"department": "production", "remarks": "Routing updated"}, headers=auth(team["qa"]))
    assert r.status_code == 200
    ack = next(a for a in r.json()["acknowledgements"] if a["department"] == "production")
    assert ack["acknowledged_by_name"] == "cov.qa" and ack["remarks"] == "Routing updated"


@pytest.mark.xfail(
    reason="BUG: PATCH /design/change-notices/{id} with an explicit null effectivity_type / stock_disposition is "
           "written straight onto NOT NULL columns (only reason/priority are null-guarded) -> IntegrityError 500 "
           "instead of a 400 — app/modules/design/routes/change_notices.py:344",
    strict=True,
)
def test_ecn_patch_null_effectivity_is_a_400(client, team):
    ecn = client.post(f"{API}/change-notices", json={"title": "Null effectivity"}, headers=auth(team["other"])).json()
    r = client.patch(f"{API}/change-notices/{ecn['id']}", json={"effectivity_type": None}, headers=auth(team["other"]))
    assert r.status_code == 400
