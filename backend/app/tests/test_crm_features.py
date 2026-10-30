"""CRM features (core/features/crm.py): an uncustomised role keeps what the
tab gave it; a customised one gets only its feature ids — sub-tabs, the
Send-TOR / stage actions and the Prices & margins switch (values blanked)."""
from app.tests.test_rbac_crm import API, auth, make_inquiry, make_org, make_user

WORKER = ["crm:organizations:view", "crm:organizations:create", "crm:organizations:edit",
          "crm:inquiries_tenders:view", "crm:inquiries_tenders:create", "crm:inquiries_tenders:edit"]
# Same tab grants, but Inquiries & Tenders customised: timeline only (no prices,
# documents, follow-ups, discussion, stage, TOR, quotations).
CUSTOMISED = WORKER + ["crm:inquiries_tenders.timeline:view"]


def _inquiry_with_value(client, owner):
    org = make_org(client, owner, f"Feature Org {owner.id}")
    inq = make_inquiry(client, owner, org["id"])
    r = client.patch(f"{API}/inquiries/{inq['id']}", json={"expected_value": 125000}, headers=auth(owner))
    assert r.status_code == 200 and r.json()["expected_value"] == 125000, r.text
    return inq


def test_uncustomised_role_keeps_tab_access(client, db):
    worker = make_user(db, "crm.feat.worker@premnathrail.com", WORKER)
    inq = _inquiry_with_value(client, worker)
    h = auth(worker)
    assert client.get(f"{API}/inquiries/{inq['id']}", headers=h).json()["expected_value"] == 125000
    assert client.get(f"{API}/inquiries/{inq['id']}/quotations", headers=h).status_code == 200
    assert client.get(f"{API}/activities", params={"related_module": "inquiry", "related_id": inq["id"]}, headers=h).status_code == 200
    assert client.get(f"{API}/inquiries/{inq['id']}/audit", headers=h).status_code == 200
    r = client.patch(f"{API}/inquiries/{inq['id']}", json={"current_stage": "Requirement Qualified"}, headers=h)
    assert r.status_code == 200, r.text


def test_customised_role_gets_only_its_features(client, db):
    owner = make_user(db, "crm.feat.owner@premnathrail.com", ["crm:*:*"])
    inq = _inquiry_with_value(client, owner)
    limited = make_user(db, "crm.feat.limited@premnathrail.com", CUSTOMISED)
    h = auth(limited)

    body = client.get(f"{API}/inquiries/{inq['id']}", headers=h).json()
    assert body["expected_value"] is None  # Prices & margins not granted -> blanked
    listed = [i for i in client.get(f"{API}/inquiries", headers=h).json() if i["id"] == inq["id"]]
    assert listed and listed[0]["expected_value"] is None

    assert client.get(f"{API}/inquiries/{inq['id']}/audit", headers=h).status_code == 200  # timeline granted
    r = client.get(f"{API}/inquiries/{inq['id']}/quotations", headers=h)
    assert r.status_code == 403 and "'View' permission on CRM › Inquiries & Tenders › Quotations" in r.json()["detail"], r.text
    r = client.get(f"{API}/activities", params={"related_module": "inquiry", "related_id": inq["id"]}, headers=h)
    assert r.status_code == 403 and "'View' permission on CRM › Inquiries & Tenders › Follow-ups" in r.json()["detail"], r.text
    r = client.get(f"{API}/documents", params={"related_module": "inquiry", "related_id": inq["id"]}, headers=h)
    assert r.status_code == 403 and "'View' permission on CRM › Inquiries & Tenders › Documents" in r.json()["detail"], r.text
    r = client.post(f"{API}/inquiries/{inq['id']}/technical-offer-request", json={}, headers=h)
    assert r.status_code == 403 and "'Create' permission on CRM › Inquiries & Tenders › Send Technical Requirement (TOR) to R&D" in r.json()["detail"], r.text


def test_hidden_money_is_not_wiped_by_a_save(client, db):
    owner = make_user(db, "crm.feat.owner2@premnathrail.com", CUSTOMISED)
    full = make_user(db, "crm.feat.full2@premnathrail.com", ["crm:*:*"])
    org = make_org(client, owner, "Feature Org Save")
    inq = make_inquiry(client, owner, org["id"])
    # The creator without Prices saves the form with expected_value = null: ignored.
    r = client.patch(f"{API}/inquiries/{inq['id']}", json={"priority": "Urgent", "expected_value": None}, headers=auth(owner))
    assert r.status_code == 200, r.text
    r = client.patch(f"{API}/inquiries/{inq['id']}", json={"expected_value": 99}, headers=auth(owner))
    assert r.status_code == 200
    assert client.get(f"{API}/inquiries/{inq['id']}", headers=auth(full)).json()["expected_value"] is None
    # A stage move needs Move pipeline stage › Edit.
    r = client.patch(f"{API}/inquiries/{inq['id']}", json={"current_stage": "Requirement Qualified"}, headers=auth(owner))
    assert r.status_code == 403 and "'Edit' permission on CRM › Inquiries & Tenders › Move pipeline stage" in r.json()["detail"], r.text


def test_inquiry_received_role_event(client, db):
    """crm.inquiry_received reaches a subscribed role member once (the CRM
    broadcast leaves them out), never the actor."""
    from app.modules.main.models.notification import Notification
    from app.modules.main.models.role import Role
    from app.modules.main.models.user import User

    role = Role(name="BD leads", permissions=["crm:inquiries_tenders:view", "crm:organizations:view"],
                notification_events={"crm.inquiry_received": ["bell"]})
    db.add(role)
    db.flush()
    lead = User(email="crm.feat.lead@premnathrail.com", name="crm.feat.lead", role="user", is_active=True)
    lead.roles = [role]
    db.add(lead)
    db.commit()
    owner = make_user(db, "crm.feat.owner3@premnathrail.com", ["crm:*:*"])
    org = make_org(client, owner, "Event Org")
    inq = make_inquiry(client, owner, org["id"])

    rows = db.query(Notification).filter(Notification.user_id == lead.id, Notification.entity_id == inq["id"],
                                         Notification.entity_type == "inquiry").all()
    assert [r.notification_type for r in rows] == ["crm_ev_inquiry_received"], [r.notification_type for r in rows]
    assert not db.query(Notification).filter(Notification.user_id == owner.id,
                                             Notification.notification_type == "crm_ev_inquiry_received").first()
