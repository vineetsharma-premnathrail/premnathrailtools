"""CRM › Customer Organizations › Engagements (2026-10-27)."""
from datetime import date, timedelta

from app.tests.test_crm import auth_header, make_user

ORGS = "/api/v1/crm/organizations"


def _org_with_contact(client, user, name="Engage Org"):
    org = client.post(ORGS, json={"org_scope": "domestic", "org_type": "Customer", "name": name}, headers=auth_header(user)).json()
    c = client.post(f"{ORGS}/{org['id']}/contacts", json={"name": "Rajesh", "mobile": "9000000001"}, headers=auth_header(user))
    assert c.status_code == 201, c.text
    return org, c.json()


def _body(contact_id, **kw):
    return {"org_contact_id": contact_id, "engagement_date": str(date.today()), "engagement_type": "meeting",
            "summary": "Discussed next year's RRV plan", "outcome": "future_requirement", **kw}


def test_log_list_edit_delete_engagement(client, db):
    owner = make_user(db, "eng.owner@premnathrail.com")
    other = make_user(db, "eng.other@premnathrail.com")
    org, contact = _org_with_contact(client, owner)

    # Anyone may log on any (shared) organization.
    r = client.post(f"{ORGS}/{org['id']}/engagements", json=_body(contact["id"]), headers=auth_header(other))
    assert r.status_code == 201, r.text
    e = r.json()
    assert e["contact_name"] == "Rajesh" and e["outcome_label"] == "Future Requirement" and e["can_edit"] is True

    rows = client.get(f"{ORGS}/{org['id']}/engagements", headers=auth_header(owner)).json()
    assert [x["id"] for x in rows] == [e["id"]] and rows[0]["can_edit"] is False

    # Only the person who logged it edits / deletes it.
    assert client.patch(f"/api/v1/crm/engagements/{e['id']}", json=_body(contact["id"], outcome="inquiry_required"),
                        headers=auth_header(owner)).status_code == 403
    r = client.patch(f"/api/v1/crm/engagements/{e['id']}", json=_body(contact["id"], outcome="inquiry_required"), headers=auth_header(other))
    assert r.status_code == 200 and r.json()["outcome"] == "inquiry_required", r.text
    assert client.delete(f"/api/v1/crm/engagements/{e['id']}", headers=auth_header(owner)).status_code == 403
    assert client.delete(f"/api/v1/crm/engagements/{e['id']}", headers=auth_header(other)).status_code == 200
    assert client.get(f"{ORGS}/{org['id']}/engagements", headers=auth_header(owner)).json() == []


def test_engagement_validation(client, db):
    u = make_user(db, "eng.val@premnathrail.com")
    org, contact = _org_with_contact(client, u, "Engage Val Org")
    other_org, other_contact = _org_with_contact(client, u, "Other Val Org")
    url = f"{ORGS}/{org['id']}/engagements"
    h = auth_header(u)
    assert "contact" in client.post(url, json=_body(other_contact["id"]), headers=h).json()["detail"]
    assert client.post(url, json=_body(contact["id"], engagement_type="email"), headers=h).status_code == 422
    assert client.post(url, json=_body(contact["id"], outcome="maybe"), headers=h).status_code == 422
    assert client.post(url, json=_body(contact["id"], summary="  "), headers=h).status_code == 422
    future = str(date.today() + timedelta(days=2))
    assert client.post(url, json=_body(contact["id"], engagement_date=future), headers=h).status_code == 422
    early = str(date.today() - timedelta(days=1))
    assert client.post(url, json=_body(contact["id"], next_followup_date=early), headers=h).status_code == 422
    assert client.post(url, json=_body(contact["id"], next_followup_date=future), headers=h).status_code == 201
