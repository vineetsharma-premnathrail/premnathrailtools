"""Coverage: CRM inquiry/tender lifecycle and stage transitions, organizations
and contacts, follow-ups (activities), soft-delete cascades and the
creator-or-admin / app-access 403s. Complements test_crm.py (which covers the
basic create/get/duplicate cases) without repeating it."""
from datetime import date, timedelta

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User

API = "/api/v1/crm"


def make_user(db, email, role="user", apps=("crm",), grants=None):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps))
    if grants is not None:
        user.granular_permissions = list(grants)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def make_org(client, user, name="Northern Railway", **extra):
    resp = client.post(f"{API}/organizations", json={"org_scope": "domestic", "org_type": "Customer", "name": name, **extra}, headers=auth(user))
    assert resp.status_code == 201, resp.text
    return resp.json()


def make_contact(client, user, org_id, name="Primary Contact", **extra):
    resp = client.post(f"{API}/organizations/{org_id}/contacts", json={"name": name, **extra}, headers=auth(user))
    assert resp.status_code == 201, resp.text
    return resp.json()


def make_inquiry(client, user, org_id, **extra):
    contact = make_contact(client, user, org_id, name=f"Contact {extra.get('product', 'x')}")
    resp = client.post(f"{API}/inquiries", json={"org_id": org_id, "org_contact_id": contact["id"], "lead_source": "Direct", **extra}, headers=auth(user))
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture
def ctx(client, db):
    owner = make_user(db, "bd.owner@premnathrail.com")
    other = make_user(db, "bd.other@premnathrail.com")
    admin = make_user(db, "crm.admin@premnathrail.com", role="admin", apps=())
    org = make_org(client, owner)
    return {"owner": owner, "other": other, "admin": admin, "org": org}


# ---------------------------------------------------------------------------
# App gate — every CRM router requires the 'crm' module
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("method,path", [
    ("get", "/inquiries"), ("get", "/tenders"), ("get", "/activities"), ("get", "/organizations/contacts/all"),
    ("get", "/dashboard"), ("get", "/rnd-requests/assignees"), ("get", "/activities/team-members"),
    ("get", "/documents?related_module=inquiry&related_id=1"),
])
def test_every_crm_list_route_requires_crm_app(client, db, method, path):
    outsider = make_user(db, "store.only@premnathrail.com", apps=("store",))
    resp = getattr(client, method)(f"{API}{path}", headers=auth(outsider))
    assert resp.status_code == 403, (path, resp.text)
    assert "crm" in resp.json()["detail"].lower()  # detail names the CRM module / crm:<tab> grant


def test_unauthenticated_request_is_401(client, db):
    assert client.get(f"{API}/inquiries").status_code == 401


def test_admin_without_assigned_apps_passes_app_gate(client, ctx):
    assert client.get(f"{API}/inquiries", headers=auth(ctx["admin"])).status_code == 200


# ---------------------------------------------------------------------------
# Inquiry lifecycle
# ---------------------------------------------------------------------------

def test_inquiry_universal_ids_are_sequential_per_day(client, ctx):
    a = make_inquiry(client, ctx["owner"], ctx["org"]["id"], product="A")
    b = make_inquiry(client, ctx["owner"], ctx["org"]["id"], product="B")
    today = date.today().strftime("%Y%m%d")
    assert a["universal_id"] == f"INQ-{today}-0001"
    assert b["universal_id"] == f"INQ-{today}-0002"
    assert a["current_stage"] == "Requirement Received" and a["priority"] == "Medium"


def test_inquiry_create_validates_org_and_contact(client, db, ctx):
    owner = ctx["owner"]
    other_org = make_org(client, owner, name="Central Railway")
    foreign_contact = make_contact(client, owner, other_org["id"], name="Wrong org contact")
    resp = client.post(f"{API}/inquiries", json={"org_id": ctx["org"]["id"], "org_contact_id": foreign_contact["id"], "lead_source": "Direct"}, headers=auth(owner))
    assert resp.status_code == 422 and "does not belong" in resp.json()["detail"]

    resp = client.post(f"{API}/inquiries", json={"org_id": 98765, "org_contact_id": foreign_contact["id"], "lead_source": "Direct"}, headers=auth(owner))
    assert resp.status_code == 404 and resp.json()["detail"] == "Customer Organization not found"

    # A contact and lead source are mandatory on an inquiry.
    assert client.post(f"{API}/inquiries", json={"org_id": ctx["org"]["id"], "lead_source": "Direct"}, headers=auth(owner)).status_code == 422
    assert client.post(f"{API}/inquiries", json={"org_id": ctx["org"]["id"], "org_contact_id": foreign_contact["id"]}, headers=auth(owner)).status_code == 422


def test_inquiry_on_soft_deleted_org_is_rejected(client, ctx):
    org = make_org(client, ctx["owner"], name="Gone Org")
    contact = make_contact(client, ctx["owner"], org["id"])
    assert client.delete(f"{API}/organizations/{org['id']}", headers=auth(ctx["owner"])).status_code == 204
    resp = client.post(f"{API}/inquiries", json={"org_id": org["id"], "org_contact_id": contact["id"], "lead_source": "Direct"}, headers=auth(ctx["owner"]))
    assert resp.status_code == 404


def test_inquiry_with_followup_date_opens_a_followup_activity(client, ctx):
    due = (date.today() + timedelta(days=3)).isoformat()
    inq = make_inquiry(client, ctx["owner"], ctx["org"]["id"], next_followup_date=due, followup_assigned_to="Ravi")
    acts = client.get(f"{API}/activities?related_module=inquiry&related_id={inq['id']}", headers=auth(ctx["owner"])).json()
    assert len(acts) == 1
    act = acts[0]
    assert act["activity_type"] == "Follow-up" and act["next_followup"] == due and act["assigned_to"] == "Ravi"
    assert act["related_label"] == inq["universal_id"] and act["org_name"] == "Northern Railway"


def test_inquiry_without_followup_date_creates_no_activity(client, ctx):
    inq = make_inquiry(client, ctx["owner"], ctx["org"]["id"])
    assert client.get(f"{API}/activities?related_module=inquiry&related_id={inq['id']}", headers=auth(ctx["owner"])).json() == []


def test_inquiry_edit_writes_one_spec_revision_per_save(client, ctx):
    inq = make_inquiry(client, ctx["owner"], ctx["org"]["id"], product="Brake", quantity=2)
    h = auth(ctx["owner"])
    client.patch(f"{API}/inquiries/{inq['id']}", json={"product": "Brake v2", "quantity": 4}, headers=h)
    client.patch(f"{API}/inquiries/{inq['id']}", json={"requirement_desc": "Needs RDSO approval"}, headers=h)
    # A save that changes nothing records nothing.
    client.patch(f"{API}/inquiries/{inq['id']}", json={"requirement_desc": "Needs RDSO approval"}, headers=h)
    revs = client.get(f"{API}/inquiries/{inq['id']}/spec-revisions", headers=h).json()
    assert [r["revision_id"] for r in revs] == ["Rev-2", "Rev-1"]  # newest first
    first = {c["field"]: (c["old"], c["new"]) for c in revs[1]["changes"]}
    assert first == {"product": ("Brake", "Brake v2"), "quantity": (2.0, 4)}
    assert revs[0]["performed_by"] == "bd.owner"


def test_info_tab_revisions_only_count_requirement_text_edits(client, ctx):
    inq = make_inquiry(client, ctx["owner"], ctx["org"]["id"], product="Brake")
    h = auth(ctx["owner"])
    client.patch(f"{API}/inquiries/{inq['id']}", json={"product": "Brake v2"}, headers=h)
    client.patch(f"{API}/inquiries/{inq['id']}", json={"product_spec": "BG 1676", "quantity": 3}, headers=h)
    client.patch(f"{API}/inquiries/{inq['id']}", json={"project_details": "Phase 1"}, headers=h)
    url = f"{API}/inquiries/{inq['id']}/spec-revisions"
    assert len(client.get(url, headers=h).json()) == 3  # Timeline still sees every edit
    revs = client.get(url, params={"requirement_only": True}, headers=h).json()
    assert [r["revision_id"] for r in revs] == ["Rev-2", "Rev-1"]
    assert [c["field"] for c in revs[1]["changes"]] == ["product_spec"]  # quantity dropped
    assert [c["field"] for c in revs[0]["changes"]] == ["project_details"]


def test_stage_change_via_patch_is_logged_separately_from_spec(client, ctx):
    inq = make_inquiry(client, ctx["owner"], ctx["org"]["id"])
    h = auth(ctx["owner"])
    client.patch(f"{API}/inquiries/{inq['id']}", json={"current_stage": "Requirement Qualified"}, headers=h)
    assert client.get(f"{API}/inquiries/{inq['id']}/spec-revisions", headers=h).json() == []
    stages = client.get(f"{API}/inquiries/{inq['id']}/stages", headers=h).json()
    assert [s["stage"] for s in stages] == ["Inquiry created", "Stage updated"]
    assert stages[1]["notes"] == "Moved to Requirement Qualified"
    # Same stage again → no new log entry.
    client.patch(f"{API}/inquiries/{inq['id']}", json={"current_stage": "Requirement Qualified"}, headers=h)
    assert len(client.get(f"{API}/inquiries/{inq['id']}/stages", headers=h).json()) == 2


def test_add_inquiry_stage_enforces_fixed_stage_list(client, ctx):
    inq = make_inquiry(client, ctx["owner"], ctx["org"]["id"])
    h = auth(ctx["owner"])
    bad = client.post(f"{API}/inquiries/{inq['id']}/stages", json={"stage": "Teleported"}, headers=h)
    assert bad.status_code == 422 and "Invalid stage" in bad.json()["detail"] and "Negotiation" in bad.json()["detail"]
    # Post-PO stages were trimmed from CRM (plan section 5).
    assert client.post(f"{API}/inquiries/{inq['id']}/stages", json={"stage": "Manufacturing"}, headers=h).status_code == 422

    for stage in ("Requirement Qualified", "Quotation Sent", "Negotiation", "Order Received"):
        resp = client.post(f"{API}/inquiries/{inq['id']}/stages", json={"stage": stage, "notes": f"at {stage}"}, headers=h)
        assert resp.status_code == 201, resp.text
        assert resp.json()["universal_id"] == inq["universal_id"] and resp.json()["entered_by_name"] == "bd.owner"
    assert client.get(f"{API}/inquiries/{inq['id']}", headers=h).json()["current_stage"] == "Order Received"
    stages = [s["stage"] for s in client.get(f"{API}/inquiries/{inq['id']}/stages", headers=h).json()]
    assert stages == ["Inquiry created", "Requirement Qualified", "Quotation Sent", "Negotiation", "Order Received"]


def test_only_creator_or_admin_moves_inquiry_stage_or_edits_or_deletes(client, ctx):
    inq = make_inquiry(client, ctx["owner"], ctx["org"]["id"])
    other, admin = auth(ctx["other"]), auth(ctx["admin"])
    resp = client.post(f"{API}/inquiries/{inq['id']}/stages", json={"stage": "Negotiation"}, headers=other)
    assert resp.status_code == 403 and "change this inquiry's stage" in resp.json()["detail"]
    resp = client.patch(f"{API}/inquiries/{inq['id']}", json={"product": "x"}, headers=other)
    assert resp.status_code == 403 and "edit this inquiry" in resp.json()["detail"]
    resp = client.delete(f"{API}/inquiries/{inq['id']}", headers=other)
    assert resp.status_code == 403 and "created yourself" in resp.json()["detail"]
    # Read access is open to every CRM user.
    assert client.get(f"{API}/inquiries/{inq['id']}", headers=other).status_code == 200
    assert client.post(f"{API}/inquiries/{inq['id']}/stages", json={"stage": "Quotation Sent"}, headers=admin).status_code == 201


def test_inquiry_delete_soft_deletes_its_followups_only(client, ctx):
    h = auth(ctx["owner"])
    due = (date.today() + timedelta(days=1)).isoformat()
    keep = make_inquiry(client, ctx["owner"], ctx["org"]["id"], product="Keep", next_followup_date=due)
    drop = make_inquiry(client, ctx["owner"], ctx["org"]["id"], product="Drop", next_followup_date=due)
    assert client.delete(f"{API}/inquiries/{drop['id']}", headers=h).status_code == 204

    assert client.get(f"{API}/inquiries/{drop['id']}", headers=h).status_code == 404
    assert client.patch(f"{API}/inquiries/{drop['id']}", json={"product": "z"}, headers=h).status_code == 404
    assert client.delete(f"{API}/inquiries/{drop['id']}", headers=h).status_code == 404
    listed = [i["id"] for i in client.get(f"{API}/inquiries", headers=h).json()]
    assert listed == [keep["id"]]
    acts = client.get(f"{API}/activities", headers=h).json()
    assert [a["related_id"] for a in acts] == [keep["id"]]
    audit = [a["action"] for a in client.get(f"{API}/inquiries/{drop['id']}/audit", headers=h).json()]
    assert audit == ["created", "deleted"]
    # The organization is untouched.
    assert client.get(f"{API}/organizations/{ctx['org']['id']}", headers=h).status_code == 200


def test_inquiry_list_filters(client, ctx):
    h = auth(ctx["owner"])
    other_org = make_org(client, ctx["owner"], name="Konkan Railway")
    a = make_inquiry(client, ctx["owner"], ctx["org"]["id"], product="Rail grinder", status="Requirement Received")
    b = make_inquiry(client, ctx["owner"], other_org["id"], product="Tamping unit", status="Closed - Ordered")
    assert [i["id"] for i in client.get(f"{API}/inquiries?status=Closed - Ordered", headers=h).json()] == [b["id"]]
    assert [i["id"] for i in client.get(f"{API}/inquiries?org_id={ctx['org']['id']}", headers=h).json()] == [a["id"]]
    assert [i["id"] for i in client.get(f"{API}/inquiries?search=grinder", headers=h).json()] == [a["id"]]
    # Search also matches the organization name.
    assert [i["id"] for i in client.get(f"{API}/inquiries?search=Konkan", headers=h).json()] == [b["id"]]
    rows = client.get(f"{API}/inquiries", headers=h).json()
    assert {r["created_by_name"] for r in rows} == {"bd.owner"}


def test_inquiry_additional_items_are_full_replace(client, ctx):
    h = auth(ctx["owner"])
    inq = make_inquiry(client, ctx["owner"], ctx["org"]["id"], additional_items=[{"product": "A", "quantity": 1}, {"product": "B", "quantity": 2}])
    assert [i["product"] for i in inq["additional_items"]] == ["A", "B"]
    resp = client.patch(f"{API}/inquiries/{inq['id']}", json={"additional_items": [{"product": "C", "quantity": 5}]}, headers=h)
    assert [i["product"] for i in resp.json()["additional_items"]] == ["C"]


def test_inquiry_update_rejects_contact_of_another_org(client, ctx):
    owner = ctx["owner"]
    inq = make_inquiry(client, owner, ctx["org"]["id"])
    other_org = make_org(client, owner, name="Eastern Railway")
    foreign = make_contact(client, owner, other_org["id"], name="Foreign")
    resp = client.patch(f"{API}/inquiries/{inq['id']}", json={"org_contact_id": foreign["id"]}, headers=auth(owner))
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Tender lifecycle
# ---------------------------------------------------------------------------

def make_tender(client, user, org_id, **extra):
    resp = client.post(f"{API}/tenders", json={"org_id": org_id, "lead_source": "GeM", **extra}, headers=auth(user))
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_tender_ids_defaults_and_submission_activity(client, ctx):
    sub = (date.today() + timedelta(days=10)).isoformat()
    t = make_tender(client, ctx["owner"], ctx["org"]["id"], tender_number="NR-1", submission_date=sub)
    assert t["universal_id"] == f"TND-{date.today().strftime('%Y%m%d')}-0001"
    assert t["current_stage"] == "Tender Published" and t["status"] == "Requirement Received" and t["currency"] == "INR"
    acts = client.get(f"{API}/activities?related_module=tender&related_id={t['id']}", headers=auth(ctx["owner"])).json()
    assert len(acts) == 1 and acts[0]["activity_type"] == "Submission" and acts[0]["next_followup"] == sub


def test_tender_create_validates_contact_org(client, ctx):
    other_org = make_org(client, ctx["owner"], name="South Central")
    foreign = make_contact(client, ctx["owner"], other_org["id"])
    resp = client.post(f"{API}/tenders", json={"org_id": ctx["org"]["id"], "org_contact_id": foreign["id"], "lead_source": "GeM"}, headers=auth(ctx["owner"]))
    assert resp.status_code == 422 and "does not belong" in resp.json()["detail"]


def test_tender_number_can_be_reused_after_delete(client, ctx):
    h = auth(ctx["owner"])
    t = make_tender(client, ctx["owner"], ctx["org"]["id"], tender_number="NR-9", railway_zone="NR", division="DLI")
    assert client.delete(f"{API}/tenders/{t['id']}", headers=h).status_code == 204
    make_tender(client, ctx["owner"], ctx["org"]["id"], tender_number="NR-9", railway_zone="NR", division="DLI")


def test_tender_stage_transitions(client, ctx):
    h = auth(ctx["owner"])
    t = make_tender(client, ctx["owner"], ctx["org"]["id"])
    bad = client.post(f"{API}/tenders/{t['id']}/stages", json={"stage": "Quotation Sent"}, headers=h)  # an inquiry stage, not a tender one
    assert bad.status_code == 422 and "Bid Submitted" in bad.json()["detail"]
    for stage in ("Documents Downloaded", "Participate Decision", "Bid Submitted", "Awarded / Lost"):
        assert client.post(f"{API}/tenders/{t['id']}/stages", json={"stage": stage}, headers=h).status_code == 201
    assert client.get(f"{API}/tenders/{t['id']}", headers=h).json()["current_stage"] == "Awarded / Lost"
    stages = [s["stage"] for s in client.get(f"{API}/tenders/{t['id']}/stages", headers=h).json()]
    assert stages[0] == "Tender created" and stages[-1] == "Awarded / Lost"
    resp = client.post(f"{API}/tenders/{t['id']}/stages", json={"stage": "Bid Submitted"}, headers=auth(ctx["other"]))
    assert resp.status_code == 403 and "change this tender's stage" in resp.json()["detail"]


def test_tender_patch_spec_revision_excludes_stage(client, ctx):
    h = auth(ctx["owner"])
    t = make_tender(client, ctx["owner"], ctx["org"]["id"], tender_value=100.0)
    client.patch(f"{API}/tenders/{t['id']}", json={"tender_value": 250.0, "current_stage": "Bid Submitted"}, headers=h)
    revs = client.get(f"{API}/tenders/{t['id']}/spec-revisions", headers=h).json()
    assert len(revs) == 1 and [c["field"] for c in revs[0]["changes"]] == ["tender_value"]
    stages = client.get(f"{API}/tenders/{t['id']}/stages", headers=h).json()
    assert stages[-1]["stage"] == "Stage updated" and stages[-1]["notes"] == "Moved to Bid Submitted"


def test_tender_owner_rules_and_soft_delete(client, ctx):
    t = make_tender(client, ctx["owner"], ctx["org"]["id"])
    resp = client.patch(f"{API}/tenders/{t['id']}", json={"tender_name": "x"}, headers=auth(ctx["other"]))
    assert resp.status_code == 403 and "edit this tender" in resp.json()["detail"]
    resp = client.delete(f"{API}/tenders/{t['id']}", headers=auth(ctx["other"]))
    assert resp.status_code == 403 and "created yourself" in resp.json()["detail"]
    assert client.delete(f"{API}/tenders/{t['id']}", headers=auth(ctx["admin"])).status_code == 204
    assert client.get(f"{API}/tenders/{t['id']}", headers=auth(ctx["owner"])).status_code == 404
    assert client.get(f"{API}/tenders", headers=auth(ctx["owner"])).json() == []


def test_tender_search_and_status_filter(client, ctx):
    h = auth(ctx["owner"])
    a = make_tender(client, ctx["owner"], ctx["org"]["id"], tender_name="Rail flaw detector", status="Tender Published")
    b = make_tender(client, ctx["owner"], ctx["org"]["id"], tender_name="Track trolley", status="Tender Cancelled")
    assert [x["id"] for x in client.get(f"{API}/tenders?search=flaw", headers=h).json()] == [a["id"]]
    assert [x["id"] for x in client.get(f"{API}/tenders?status=Tender Cancelled", headers=h).json()] == [b["id"]]


def test_tender_update_rejects_duplicate_number(client, ctx):
    h = auth(ctx["owner"])
    make_tender(client, ctx["owner"], ctx["org"]["id"], tender_number="T-1", railway_zone="NR", division="DLI")
    t2 = make_tender(client, ctx["owner"], ctx["org"]["id"], tender_number="T-2", railway_zone="NR", division="DLI")
    resp = client.patch(f"{API}/tenders/{t2['id']}", json={"tender_number": "T-1"}, headers=h)
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Organizations & contacts
# ---------------------------------------------------------------------------

def test_org_codes_are_sequential_per_year(client, ctx):
    second = make_org(client, ctx["owner"], name="Western Railway")
    year = date.today().year
    assert ctx["org"]["org_code"] == f"ORG-{year}-0001"
    assert second["org_code"] == f"ORG-{year}-0002"


def test_org_name_clash_is_case_insensitive_and_email_unique(client, ctx):
    h = auth(ctx["owner"])
    resp = client.post(f"{API}/organizations", json={"org_scope": "domestic", "org_type": "Customer", "name": "  northern railway "}, headers=h)
    assert resp.status_code == 409 and "name already exists" in resp.json()["detail"]
    make_org(client, ctx["owner"], name="Org Mail", official_email="tenders@nr.gov.in")
    resp = client.post(f"{API}/organizations", json={"org_scope": "domestic", "org_type": "Customer", "name": "Org Mail 2", "official_email": "TENDERS@nr.gov.in"}, headers=h)
    assert resp.status_code == 409 and "Official Email" in resp.json()["detail"]


def test_org_requires_type_and_valid_gst(client, ctx):
    h = auth(ctx["owner"])
    assert client.post(f"{API}/organizations", json={"org_type": "  ", "name": "No Type"}, headers=h).status_code == 422
    assert client.post(f"{API}/organizations", json={"org_scope": "domestic", "org_type": "Customer", "name": "Bad GST", "gst_number": "NOTAGST"}, headers=h).status_code == 422


def test_org_update_rejects_gst_and_email_of_another_org(client, ctx):
    h = auth(ctx["owner"])
    make_org(client, ctx["owner"], name="Holder", gst_number="27ABCDE1234F1Z5", official_email="a@holder.in")
    resp = client.patch(f"{API}/organizations/{ctx['org']['id']}", json={"gst_number": "27ABCDE1234F1Z5"}, headers=h)
    assert resp.status_code == 409 and "GST" in resp.json()["detail"]
    resp = client.patch(f"{API}/organizations/{ctx['org']['id']}", json={"official_email": "A@holder.in"}, headers=h)
    assert resp.status_code == 409 and "Official Email" in resp.json()["detail"]


def test_org_rename_to_existing_name_is_rejected(client, ctx):
    make_org(client, ctx["owner"], name="Duplicate Target")
    resp = client.patch(f"{API}/organizations/{ctx['org']['id']}", json={"name": "Duplicate Target"}, headers=auth(ctx["owner"]))
    assert resp.status_code == 409


def test_gst_of_deleted_org_gives_real_error(client, ctx):
    h = auth(ctx["owner"])
    gone = make_org(client, ctx["owner"], name="Deleted GST Holder", gst_number="07AAACN1234Q1Z2")
    assert client.delete(f"{API}/organizations/{gone['id']}", headers=h).status_code == 204
    resp = client.post(f"{API}/organizations", json={"org_scope": "domestic", "org_type": "Customer", "name": "New GST Holder", "gst_number": "07AAACN1234Q1Z2"}, headers=h)
    assert resp.status_code == 409
    assert "GST" in resp.json()["detail"]


def test_org_delete_by_creator_cascades_everything(client, ctx):
    h = auth(ctx["owner"])
    org = ctx["org"]
    due = (date.today() + timedelta(days=2)).isoformat()
    inq = make_inquiry(client, ctx["owner"], org["id"], next_followup_date=due)
    t = make_tender(client, ctx["owner"], org["id"], submission_date=due)
    direct = client.post(f"{API}/activities", json={"activity_type": "Call", "org_id": org["id"], "remarks": "intro call"}, headers=h).json()

    resp = client.delete(f"{API}/organizations/{org['id']}", headers=auth(ctx["other"]))
    assert resp.status_code == 403 and "created yourself" in resp.json()["detail"]
    # An organization with live inquiries / tenders isn't deleted with them any more:
    # they are deleted one by one first (a Sales / R&D-linked one can't be).
    resp = client.delete(f"{API}/organizations/{org['id']}", headers=h)
    assert resp.status_code == 409 and "still has inquiries / tenders" in resp.json()["detail"]
    assert client.delete(f"{API}/inquiries/{inq['id']}", headers=h).status_code in (200, 204)
    assert client.delete(f"{API}/tenders/{t['id']}", headers=h).status_code in (200, 204)
    assert client.delete(f"{API}/organizations/{org['id']}", headers=h).status_code == 204

    assert client.get(f"{API}/inquiries/{inq['id']}", headers=h).status_code == 404
    assert client.get(f"{API}/tenders/{t['id']}", headers=h).status_code == 404
    assert client.get(f"{API}/activities", headers=h).json() == []
    assert client.patch(f"{API}/activities/{direct['id']}", json={"remarks": "x"}, headers=h).status_code == 404
    assert client.get(f"{API}/organizations/{org['id']}/detail", headers=h).status_code == 404
    # A soft-deleted org's name is free again.
    assert client.post(f"{API}/organizations", json={"org_scope": "domestic", "org_type": "Customer", "name": org["name"]}, headers=h).status_code == 201


def test_org_delete_leaves_activity_of_inquiry_moved_to_another_org(client, ctx):
    """An activity's org_id is a creation-time snapshot; if its inquiry now
    belongs to another live org, deleting the old org must not take it."""
    h = auth(ctx["owner"])
    new_org = make_org(client, ctx["owner"], name="New Home")
    due = (date.today() + timedelta(days=2)).isoformat()
    inq = make_inquiry(client, ctx["owner"], ctx["org"]["id"], next_followup_date=due)
    new_contact = make_contact(client, ctx["owner"], new_org["id"], name="New Home Contact")
    moved = client.patch(f"{API}/inquiries/{inq['id']}", json={"org_id": new_org["id"], "org_contact_id": new_contact["id"]}, headers=h)
    assert moved.status_code == 200, moved.text
    assert client.delete(f"{API}/organizations/{ctx['org']['id']}", headers=h).status_code == 204
    acts = client.get(f"{API}/activities?org_id={new_org['id']}", headers=h).json()
    assert [a["related_id"] for a in acts] == [inq["id"]]


def test_contact_duplicate_mobile_and_email_within_org(client, ctx):
    h = auth(ctx["owner"])
    org_id = ctx["org"]["id"]
    first = make_contact(client, ctx["owner"], org_id, name="A", mobile="9876543210", email="a@nr.in")
    resp = client.post(f"{API}/organizations/{org_id}/contacts", json={"name": "B", "mobile": " 9876543210 "}, headers=h)
    assert resp.status_code == 409 and resp.json()["detail"] == "Contact Person Mobile is duplicated"
    resp = client.post(f"{API}/organizations/{org_id}/contacts", json={"name": "C", "email": "A@NR.IN"}, headers=h)
    assert resp.status_code == 409 and resp.json()["detail"] == "Contact Person Email is duplicated"
    # The same person may sit on a different organization.
    other_org = make_org(client, ctx["owner"], name="Other")
    make_contact(client, ctx["owner"], other_org["id"], name="A again", mobile="9876543210")
    # Editing a contact to its own number is not a duplicate.
    assert client.patch(f"{API}/organizations/{org_id}/contacts/{first['id']}", json={"mobile": "9876543210"}, headers=h).status_code == 200


def test_contact_list_validators(client, ctx):
    h = auth(ctx["owner"])
    org_id = ctx["org"]["id"]
    resp = client.post(f"{API}/organizations/{org_id}/contacts", json={"name": "D", "additional_emails": ["x@a.in", "X@a.in"]}, headers=h)
    assert resp.status_code == 422 and "Duplicate email" in resp.text
    resp = client.post(f"{API}/organizations/{org_id}/contacts", json={"name": "E", "additional_mobiles": ["1", "1"]}, headers=h)
    assert resp.status_code == 422 and "Duplicate phone" in resp.text


def test_contact_scoped_to_its_org_and_owner(client, ctx):
    h = auth(ctx["owner"])
    org_id = ctx["org"]["id"]
    contact = make_contact(client, ctx["owner"], org_id)
    other_org = make_org(client, ctx["owner"], name="Other Org")
    assert client.patch(f"{API}/organizations/{other_org['id']}/contacts/{contact['id']}", json={"name": "x"}, headers=h).status_code == 404
    assert client.post(f"{API}/organizations/99999/contacts", json={"name": "x"}, headers=h).status_code == 404
    resp = client.delete(f"{API}/organizations/{org_id}/contacts/{contact['id']}", headers=auth(ctx["other"]))
    assert resp.status_code == 403 and "delete this contact" in resp.json()["detail"]
    assert client.delete(f"{API}/organizations/{org_id}/contacts/{contact['id']}", headers=auth(ctx["admin"])).status_code == 200


def test_org_duplicates_endpoint_requires_crm(client, db):
    outsider = make_user(db, "nocrm.dup@premnathrail.com", apps=())
    assert client.get(f"{API}/organizations/duplicates", headers=auth(outsider)).status_code == 403


@pytest.mark.xfail(strict=True, reason=(
    "BUG: CRM Permission Matrix sub-tabs (crm:organizations / crm:inquiries_tenders, core/permission_registry.py:35-41) "
    "are never enforced server-side — no CRM route uses require_tab_access, so a user granted only "
    "crm:dashboard:view still lists organizations (crm/routes/organizations.py:50)"))
def test_permission_matrix_restricts_crm_subtabs(client, db):
    limited = make_user(db, "dash.only@premnathrail.com", grants=["crm:dashboard:view"])
    assert client.get(f"{API}/dashboard", headers=auth(limited)).status_code == 200
    assert client.get(f"{API}/organizations", headers=auth(limited)).status_code == 403


# ---------------------------------------------------------------------------
# Follow-ups (activities)
# ---------------------------------------------------------------------------

def test_followup_overdue_and_due_today_filters(client, ctx):
    h = auth(ctx["owner"])
    org_id = ctx["org"]["id"]
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    today = date.today().isoformat()
    overdue = client.post(f"{API}/activities", json={"org_id": org_id, "next_followup": yesterday, "subject": "late"}, headers=h).json()
    closed_late = client.post(f"{API}/activities", json={"org_id": org_id, "next_followup": yesterday, "status": "Closed"}, headers=h).json()
    due_today = client.post(f"{API}/activities", json={"org_id": org_id, "next_followup": today}, headers=h).json()
    assert [a["id"] for a in client.get(f"{API}/activities?overdue=true", headers=h).json()] == [overdue["id"]]
    assert [a["id"] for a in client.get(f"{API}/activities?due_today=true", headers=h).json()] == [due_today["id"]]
    assert [a["id"] for a in client.get(f"{API}/activities?status=Closed", headers=h).json()] == [closed_late["id"]]


def test_followup_mom_revision_bumps_only_on_printed_fields(client, ctx):
    h = auth(ctx["owner"])
    act = client.post(f"{API}/activities", json={"org_id": ctx["org"]["id"], "subject": "Review", "remarks": "r1"}, headers=h).json()
    assert act["mom_revision"] == 0
    act = client.patch(f"{API}/activities/{act['id']}", json={"status": "Closed"}, headers=h).json()
    assert act["mom_revision"] == 0  # status is not printed on the MoM
    act = client.patch(f"{API}/activities/{act['id']}", json={"remarks": "r2"}, headers=h).json()
    assert act["mom_revision"] == 1
    act = client.patch(f"{API}/activities/{act['id']}", json={"remarks": "r2"}, headers=h).json()
    assert act["mom_revision"] == 1  # unchanged value
    act = client.patch(f"{API}/activities/{act['id']}", json={"mom_items": [{"observation": "o", "action_plan": "a"}]}, headers=h).json()
    assert act["mom_revision"] == 1  # mom_items is not in MOM_FIELDS
    assert act["mom_items"] == [{"observation": "o", "action_plan": "a", "responsibility": None, "target_date": None}]


def test_followup_owner_rules(client, ctx):
    act = client.post(f"{API}/activities", json={"org_id": ctx["org"]["id"]}, headers=auth(ctx["owner"])).json()
    resp = client.patch(f"{API}/activities/{act['id']}", json={"remarks": "x"}, headers=auth(ctx["other"]))
    assert resp.status_code == 403 and "edit this activity" in resp.json()["detail"]
    resp = client.delete(f"{API}/activities/{act['id']}", headers=auth(ctx["other"]))
    assert resp.status_code == 403 and "created yourself" in resp.json()["detail"]
    assert client.delete(f"{API}/activities/{act['id']}", headers=auth(ctx["admin"])).status_code == 200
    assert client.delete(f"{API}/activities/{act['id']}", headers=auth(ctx["admin"])).status_code == 404
    assert client.patch(f"{API}/activities/999", json={"remarks": "x"}, headers=auth(ctx["admin"])).status_code == 404


def test_followup_contact_details_and_search(client, ctx):
    h = auth(ctx["owner"])
    c1 = make_contact(client, ctx["owner"], ctx["org"]["id"], name="Mr Sharma", designation="SSE", mobile="111")
    c2 = make_contact(client, ctx["owner"], ctx["org"]["id"], name="Ms Rao")
    act = client.post(f"{API}/activities", json={"org_id": ctx["org"]["id"], "org_contact_id": c1["id"], "contact_ids": [c2["id"], c1["id"]], "remarks": "discussed axle counter"}, headers=h).json()
    assert act["contact_names"] == ["Ms Rao", "Mr Sharma"]
    assert [d["name"] for d in act["contact_details"]] == ["Ms Rao", "Mr Sharma"]
    assert act["created_by_name"] == "bd.owner"
    assert [a["id"] for a in client.get(f"{API}/activities?search=axle", headers=h).json()] == [act["id"]]
    assert client.get(f"{API}/activities?search=nothing-matches", headers=h).json() == []


def test_team_members_lists_active_users_only(client, db, ctx):
    gone = make_user(db, "left.company@premnathrail.com")
    gone.is_active = False
    db.commit()
    names = [u["name"] for u in client.get(f"{API}/activities/team-members", headers=auth(ctx["owner"])).json()]
    assert "bd.owner" in names and "left.company" not in names


# ---------------------------------------------------------------------------
# PATCH validates stage / status / organization like create does
# ---------------------------------------------------------------------------

def test_inquiry_patch_rejects_unknown_stage_and_status(client, ctx):
    inq = make_inquiry(client, ctx["owner"], ctx["org"]["id"])
    h = auth(ctx["owner"])
    bad = client.patch(f"{API}/inquiries/{inq['id']}", json={"current_stage": "Teleported"}, headers=h)
    assert bad.status_code == 422 and "not a valid inquiry stage" in bad.json()["detail"] and "Negotiation" in bad.json()["detail"]
    bad = client.patch(f"{API}/inquiries/{inq['id']}", json={"status": "Won"}, headers=h)
    assert bad.status_code == 422 and "Closed - Ordered" in bad.json()["detail"]
    ok = client.patch(f"{API}/inquiries/{inq['id']}", json={"status": "Quotation Sent", "current_stage": "Quotation Sent"}, headers=h)
    assert ok.status_code == 200 and ok.json()["status"] == "Quotation Sent"


def test_inquiry_patch_keeps_unchanged_legacy_stage(client, ctx, db):
    from app.modules.crm.models.inquiry import Inquiry
    inq = make_inquiry(client, ctx["owner"], ctx["org"]["id"])
    row = db.get(Inquiry, inq["id"])
    row.current_stage = "Manufacturing"  # legacy post-PO value already stored
    db.commit()
    resp = client.patch(f"{API}/inquiries/{inq['id']}", json={"current_stage": "Manufacturing", "product": "x"}, headers=auth(ctx["owner"]))
    assert resp.status_code == 200, resp.text


def test_inquiry_patch_validates_org_and_contact(client, ctx):
    inq = make_inquiry(client, ctx["owner"], ctx["org"]["id"])
    h = auth(ctx["owner"])
    other_org = make_org(client, ctx["owner"], name="Western Railway")
    foreign = make_contact(client, ctx["owner"], other_org["id"])
    resp = client.patch(f"{API}/inquiries/{inq['id']}", json={"org_contact_id": foreign["id"]}, headers=h)
    assert resp.status_code == 422 and "belongs to Western Railway" in resp.json()["detail"]
    assert "also pick one of its contacts" in resp.json()["detail"]
    resp = client.patch(f"{API}/inquiries/{inq['id']}", json={"org_id": 99999}, headers=h)
    assert resp.status_code == 404 and "Organization #99999 was not found or is in the recycle bin" in resp.json()["detail"]
    resp = client.patch(f"{API}/inquiries/{inq['id']}", json={"org_id": other_org["id"], "org_contact_id": foreign["id"]}, headers=h)
    assert resp.status_code == 200 and resp.json()["org_id"] == other_org["id"]


def test_tender_patch_rejects_unknown_status_and_stage(client, ctx):
    h = auth(ctx["owner"])
    t = make_tender(client, ctx["owner"], ctx["org"]["id"])
    bad = client.patch(f"{API}/tenders/{t['id']}", json={"status": "Active"}, headers=h)
    assert bad.status_code == 422 and "Tender Cancelled" in bad.json()["detail"]
    bad = client.patch(f"{API}/tenders/{t['id']}", json={"current_stage": "Negotiation"}, headers=h)
    assert bad.status_code == 422 and "not a valid tender stage" in bad.json()["detail"]
    other_org = make_org(client, ctx["owner"], name="Eastern Railway")
    foreign = make_contact(client, ctx["owner"], other_org["id"])
    resp = client.patch(f"{API}/tenders/{t['id']}", json={"org_contact_id": foreign["id"]}, headers=h)
    assert resp.status_code == 422
    ok = client.patch(f"{API}/tenders/{t['id']}", json={"status": "Tender Submitted"}, headers=h)
    assert ok.status_code == 200 and ok.json()["status"] == "Tender Submitted"


# ---------------------------------------------------------------------------
# Contact delete is refused while records still use it
# ---------------------------------------------------------------------------

def test_delete_contact_in_use_returns_409_with_reason(client, ctx):
    h = auth(ctx["owner"])
    inq = make_inquiry(client, ctx["owner"], ctx["org"]["id"], product="Guard")
    contact_id = inq["org_contact_id"]
    resp = client.delete(f"{API}/organizations/{ctx['org']['id']}/contacts/{contact_id}", headers=h)
    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"]
    assert "Contact Guard" in detail and inq["universal_id"] in detail and "Change the contact" in detail
    # Once nothing points at it the delete goes through.
    other = make_contact(client, ctx["owner"], ctx["org"]["id"], name="Replacement")
    assert client.patch(f"{API}/inquiries/{inq['id']}", json={"org_contact_id": other["id"]}, headers=h).status_code == 200
    assert client.delete(f"{API}/organizations/{ctx['org']['id']}/contacts/{contact_id}", headers=h).status_code == 200


def test_delete_contact_used_by_followup_and_tender_returns_409(client, ctx):
    h = auth(ctx["owner"])
    c = make_contact(client, ctx["owner"], ctx["org"]["id"], name="Tender Person")
    t = make_tender(client, ctx["owner"], ctx["org"]["id"], org_contact_id=c["id"])
    client.post(f"{API}/activities", json={"org_id": ctx["org"]["id"], "org_contact_id": c["id"]}, headers=h)
    resp = client.delete(f"{API}/organizations/{ctx['org']['id']}/contacts/{c['id']}", headers=h)
    assert resp.status_code == 409
    assert t["universal_id"] in resp.json()["detail"] and "1 follow-up" in resp.json()["detail"]


def test_due_today_followups_only_lists_open(client, ctx):
    h = auth(ctx["owner"])
    today = date.today().isoformat()
    org_id = ctx["org"]["id"]
    client.post(f"{API}/activities", json={"org_id": org_id, "next_followup": today, "status": "Open"}, headers=h)
    client.post(f"{API}/activities", json={"org_id": org_id, "next_followup": today, "status": "Closed"}, headers=h)
    client.post(f"{API}/activities", json={"org_id": org_id, "next_followup": today, "status": "Hold"}, headers=h)
    listed = client.get(f"{API}/activities?due_today=true", headers=h).json()
    assert [a["status"] for a in listed] == ["Open"]
