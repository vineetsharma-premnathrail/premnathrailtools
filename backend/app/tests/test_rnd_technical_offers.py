"""R&D Technical Offer on a requirement: draft → Word document → release by
the R&D head → CRM quotes against it (number/date copied from the offer),
revisions supersede, and released offers are frozen."""
from datetime import datetime, timezone

from app.modules.main.models.notification import Notification
from app.tests.quote_lines import quote_product  # noqa: F401 — autouse fixture
from app.tests.test_cov_crm_quotations_rnd import ITEM, auth, make_inquiry, make_user
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture
from app.tests.test_rnd_requirement_work import make_rnd_head


def join_offer_team(db, user, create=True):
    """R&D › Requirements › Technical Offer team (what the old R&D › Settings
    lists became), given through a role in Role & Permissions."""
    from app.modules.main.models.role import Role
    grants = ["rnd:requirements.offer_team:view"] + (["rnd:requirements.offer_team:create"] if create else [])
    role = Role(name=f"Offer team {user.id}", permissions=grants, is_active=True)
    db.add(role)
    user.roles.append(role)
    db.commit()

RND = "/api/v1/rnd/requirement-work"
CRM = "/api/v1/crm"


def _sent_inquiry(db, owner):
    inq = make_inquiry(db, owner, uid="INQ-2026-0042")
    inq.technical_offer_number = "TOR-2026-0042"
    inq.technical_offer_sent_at = datetime.now(timezone.utc)
    db.commit()
    return inq


def _word(client, offer_id, user):
    """Creating the offer already made its Word template."""
    resp = client.get(f"/api/v1/managed-documents/rnd_technical_offer/{offer_id}", headers=auth(user))
    assert resp.status_code == 200 and resp.json()["document"], resp.text


def test_technical_offer_release_and_quote_against_it(client, db, sp):
    bd = make_user(db, "to.bd@premnathrail.com")
    head = make_user(db, "to.head@premnathrail.com", role="admin", apps=("crm", "rnd"))
    inq = _sent_inquiry(db, bd)

    resp = client.post(f"{RND}/inquiry/{inq.id}/technical-offers", json={"title": "Rail Grinding Machine", "scope": "1 no. RGM"}, headers=auth(head))
    assert resp.status_code == 201, resp.text
    offer = resp.json()
    assert offer["offer_number"] == "TO-INQ-2026-0042" and offer["status"] == "draft"

    # A second series on the same requirement is refused — revise instead.
    assert client.post(f"{RND}/inquiry/{inq.id}/technical-offers", json={"title": "x"}, headers=auth(head)).status_code == 409
    # Drafts aren't quotable and CRM doesn't see them.
    assert client.get(f"{CRM}/inquiries/{inq.id}/technical-offers", headers=auth(bd)).json() == []
    bad = client.post(f"{CRM}/inquiries/{inq.id}/quotations", json={"items": [ITEM], "technical_offer_id": offer["id"]}, headers=auth(bd))
    assert bad.status_code == 422 and "draft" in bad.json()["detail"]

    # Release needs the Word document first.
    _word(client, offer["id"], head)
    released = client.post(f"{RND}/technical-offers/{offer['id']}/release", headers=auth(head))
    assert released.status_code == 200 and released.json()["status"] == "released"
    assert db.query(Notification).filter(Notification.user_id == bd.id).count() == 1

    # Released = frozen: no edit, no Word re-generation.
    assert client.patch(f"{RND}/technical-offers/{offer['id']}", json={"title": "y"}, headers=auth(head)).status_code == 409
    assert client.post(f"/api/v1/managed-documents/rnd_technical_offer/{offer['id']}?regenerate=true", headers=auth(head)).status_code == 409

    listed = client.get(f"{CRM}/inquiries/{inq.id}/technical-offers", headers=auth(bd)).json()
    assert [o["offer_number"] for o in listed] == ["TO-INQ-2026-0042"]
    q = client.post(f"{CRM}/inquiries/{inq.id}/quotations", json={"items": [ITEM], "technical_offer_id": offer["id"]}, headers=auth(bd))
    assert q.status_code == 201, q.text
    assert q.json()["technical_offer_number"] == "TO-INQ-2026-0042" and q.json()["technical_offer_date"] == offer["offer_date"]

    # Revise → R1 draft; releasing it supersedes the original. A blank reason is refused.
    blank = client.post(f"{RND}/technical-offers/{offer['id']}/revise", json={"reason": "   "}, headers=auth(head))
    assert blank.status_code == 422 and "being revised" in blank.json()["detail"]
    rev = client.post(f"{RND}/technical-offers/{offer['id']}/revise", json={"reason": "Customer changed gauge"}, headers=auth(head))
    assert rev.status_code == 201 and rev.json()["offer_number"] == "TO-INQ-2026-0042-R1"
    # R1 starts from R0's Word document (renumbered), not a blank template.
    assert client.get(f"/api/v1/managed-documents/rnd_technical_offer/{rev.json()['id']}", headers=auth(head)).json()["document"]
    assert client.post(f"{RND}/technical-offers/{rev.json()['id']}/release", headers=auth(head)).status_code == 200
    rows = client.get(f"{RND}/inquiry/{inq.id}/technical-offers", headers=auth(head)).json()
    assert [(o["offer_number"], o["status"]) for o in rows] == [("TO-INQ-2026-0042-R1", "released"), ("TO-INQ-2026-0042", "superseded")]
    assert rows[1]["quoted_in"] == [q.json()["quot_number"]]


def test_release_is_head_only(client, db, sp):
    bd = make_user(db, "to2.bd@premnathrail.com")
    head = make_user(db, "to2.head@premnathrail.com", role="admin", apps=("crm", "rnd"))
    inq = _sent_inquiry(db, bd)
    offer = client.post(f"{RND}/inquiry/{inq.id}/technical-offers", json={"title": "RRV"}, headers=auth(head)).json()
    # A CRM-only user isn't on the requirement side at all.
    assert client.post(f"{RND}/technical-offers/{offer['id']}/release", headers=auth(bd)).status_code == 403
    assert client.delete(f"{RND}/technical-offers/{offer['id']}", headers=auth(head)).status_code == 200


def test_only_ticked_members_create_offers_from_the_tor(client, db, sp):
    """Head ticks who may create; "New Technical Offer" needs only the TOR —
    subject and scope come from the requirement, the rest is written in Word."""
    bd = make_user(db, "to3.bd@premnathrail.com")
    head = make_user(db, "to3.head@premnathrail.com", apps=("rnd",))
    writer = make_user(db, "to3.writer@premnathrail.com", apps=("rnd",))
    other = make_user(db, "to3.other@premnathrail.com", apps=("rnd",))
    viewer = make_user(db, "to3.viewer@premnathrail.com", apps=("rnd",))
    inq = _sent_inquiry(db, bd)
    make_rnd_head(db, head)
    join_offer_team(db, writer)
    join_offer_team(db, viewer, create=False)

    denied = client.post(f"{RND}/inquiry/{inq.id}/technical-offers", headers=auth(other))
    assert denied.status_code == 403 and "Technical Offer team" in denied.json()["detail"]
    assert client.get(f"{RND}/technical-offers/tor-options", headers=auth(other)).status_code == 403
    assert client.get("/api/v1/rnd/settings", headers=auth(other)).json()["can_create_technical_offer"] is False

    options = client.get(f"{RND}/technical-offers/tor-options", headers=auth(writer)).json()
    assert [(o["tor_number"], o["offer_number"]) for o in options] == [("TOR-2026-0042", None)]
    offer = client.post(f"{RND}/inquiry/{inq.id}/technical-offers", headers=auth(writer))
    assert offer.status_code == 201, offer.text
    assert offer.json()["title"] == "RRV" and offer.json()["technical_details"] == "BG 1676"
    _word(client, offer.json()["id"], writer)
    assert client.get(f"{RND}/technical-offers/tor-options", headers=auth(writer)).json()[0]["offer_number"] == "TO-INQ-2026-0042"
    # Creating isn't releasing — that stays with the head.
    assert client.post(f"{RND}/technical-offers/{offer.json()['id']}/release", headers=auth(writer)).status_code == 403
    # "Can see Technical Offers" — sees the requirement and its offer, can't create or change.
    assert client.get("/api/v1/rnd/settings", headers=auth(viewer)).json()["can_create_technical_offer"] is False
    seen = client.get(f"{RND}/inquiry/{inq.id}/technical-offers", headers=auth(viewer))
    assert seen.status_code == 200 and [o["offer_number"] for o in seen.json()] == ["TO-INQ-2026-0042"]
    assert client.get(f"{RND}/inquiry/{inq.id}/technical-offers", headers=auth(other)).status_code == 403
    assert client.patch(f"{RND}/technical-offers/{offer.json()['id']}", json={"title": "x"}, headers=auth(viewer)).status_code == 403


def test_send_to_head_lock_and_revision_request(client, db, sp):
    """Maker-checker: the creator sends the draft to the R&D head (frozen), the
    head returns or approves it; after release the creator asks for a revision
    and the head approves (new draft for the requester) or declines."""
    bd = make_user(db, "to4.bd@premnathrail.com")
    head = make_user(db, "to4.head@premnathrail.com", apps=("rnd",))
    writer = make_user(db, "to4.writer@premnathrail.com", apps=("rnd",))
    inq = _sent_inquiry(db, bd)
    make_rnd_head(db, head)
    join_offer_team(db, writer)
    offer = client.post(f"{RND}/inquiry/{inq.id}/technical-offers", headers=auth(writer)).json()
    oid = offer["id"]
    _word(client, oid, writer)

    sent = client.post(f"{RND}/technical-offers/{oid}/submit", headers=auth(writer))
    assert sent.status_code == 200 and sent.json()["status"] == "submitted", sent.text
    assert db.query(Notification).filter(Notification.user_id == head.id).count() >= 1
    # Locked: no edits, no Word changes, and CRM can't quote it yet.
    assert client.patch(f"{RND}/technical-offers/{oid}", json={"title": "x"}, headers=auth(writer)).status_code == 409
    assert client.post(f"/api/v1/managed-documents/rnd_technical_offer/{oid}?regenerate=true", headers=auth(writer)).status_code == 409
    assert client.get(f"{CRM}/inquiries/{inq.id}/technical-offers", headers=auth(bd)).json() == []
    # Only the head returns / approves.
    assert client.post(f"{RND}/technical-offers/{oid}/return", json={"reason": "x"}, headers=auth(writer)).status_code == 403
    back = client.post(f"{RND}/technical-offers/{oid}/return", json={"reason": "Add the axle-load deviation"}, headers=auth(head))
    assert back.status_code == 200 and back.json()["status"] == "draft" and back.json()["returned_reason"] == "Add the axle-load deviation"
    assert client.patch(f"{RND}/technical-offers/{oid}", json={"title": "RRV 1676"}, headers=auth(writer)).status_code == 200
    client.post(f"{RND}/technical-offers/{oid}/submit", headers=auth(writer))
    ok = client.post(f"{RND}/technical-offers/{oid}/release", headers=auth(head))
    assert ok.status_code == 200 and ok.json()["status"] == "released"

    # After release a creator can't revise directly — they ask; the head decides.
    assert client.post(f"{RND}/technical-offers/{oid}/revise", json={"reason": "x"}, headers=auth(writer)).status_code == 403
    asked = client.post(f"{RND}/technical-offers/{oid}/request-revision", json={"reason": "Customer wants MG"}, headers=auth(writer))
    assert asked.status_code == 200 and asked.json()["revision_request"]["reason"] == "Customer wants MG"
    assert client.post(f"{RND}/technical-offers/{oid}/request-revision", json={"reason": "again"}, headers=auth(writer)).status_code == 409
    no_note = client.post(f"{RND}/technical-offers/{oid}/revision-request/decide", json={"approve": False}, headers=auth(head))
    assert no_note.status_code == 422
    declined = client.post(f"{RND}/technical-offers/{oid}/revision-request/decide", json={"approve": False, "note": "Not needed"}, headers=auth(head))
    assert declined.status_code == 200 and declined.json()["revision_request"] is None
    client.post(f"{RND}/technical-offers/{oid}/request-revision", json={"reason": "Customer wants MG"}, headers=auth(writer))
    approved = client.post(f"{RND}/technical-offers/{oid}/revision-request/decide", json={"approve": True}, headers=auth(head))
    assert approved.status_code == 200, approved.text
    r1 = approved.json()
    assert r1["offer_number"] == "TO-INQ-2026-0042-R1" and r1["status"] == "draft" and r1["created_by"] and r1["revision_reason"] == "Customer wants MG"
    # The requester edits the new revision.
    assert client.patch(f"{RND}/technical-offers/{r1['id']}", json={"title": "RRV MG"}, headers=auth(writer)).status_code == 200
