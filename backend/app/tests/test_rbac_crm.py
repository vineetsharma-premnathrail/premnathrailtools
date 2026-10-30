"""RBAC for CRM: tab/action gates (crm:<tab>:<action>, deny by default) and
the company delete rule (Delete on the tab AND you created the record).
Users here are built WITHOUT assigned_apps, so they get the real roles +
deny-by-default behaviour driven only by granular_permissions."""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User

API = "/api/v1/crm"


def make_user(db, email, grants, role="user"):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True, granular_permissions=list(grants))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


FULL = ["crm:*:*"]
VIEW_ONLY = ["crm:organizations:view", "crm:inquiries_tenders:view", "crm:dashboard:view"]
WITH_DELETE = [
    "crm:organizations:view", "crm:organizations:create", "crm:organizations:edit", "crm:organizations:delete",
    "crm:inquiries_tenders:view", "crm:inquiries_tenders:create", "crm:inquiries_tenders:edit",
    "crm:inquiries_tenders:delete",
]


def make_org(client, user, name):
    resp = client.post(f"{API}/organizations", json={"org_scope": "domestic", "org_type": "Customer", "name": name}, headers=auth(user))
    assert resp.status_code == 201, resp.text
    return resp.json()


def make_inquiry(client, user, org_id):
    c = client.post(f"{API}/organizations/{org_id}/contacts", json={"name": f"Contact {user.id}"}, headers=auth(user))
    assert c.status_code == 201, c.text
    resp = client.post(f"{API}/inquiries", json={"org_id": org_id, "org_contact_id": c.json()["id"], "lead_source": "Direct"},
                       headers=auth(user))
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_view_only_user_can_read_but_not_write(client, db):
    owner = make_user(db, "crm.full@premnathrail.com", FULL)
    viewer = make_user(db, "crm.viewer@premnathrail.com", VIEW_ONLY)
    org = make_org(client, owner, "Viewer Test Org")
    inq = make_inquiry(client, owner, org["id"])
    h = auth(viewer)

    assert client.get(f"{API}/organizations", headers=h).status_code == 200
    assert client.get(f"{API}/organizations/{org['id']}/detail", headers=h).status_code == 200
    assert client.get(f"{API}/inquiries/{inq['id']}", headers=h).status_code == 200
    assert client.get(f"{API}/dashboard", headers=h).status_code == 200

    r = client.post(f"{API}/organizations", json={"org_scope": "domestic", "org_type": "Customer", "name": "Nope"}, headers=h)
    assert r.status_code == 403 and "'Create' permission on CRM › Customer Organizations" in r.json()["detail"], r.text
    r = client.patch(f"{API}/organizations/{org['id']}", json={"city": "Delhi"}, headers=h)
    assert r.status_code == 403 and "'Edit' permission on CRM › Customer Organizations" in r.json()["detail"], r.text
    r = client.delete(f"{API}/organizations/{org['id']}", headers=h)
    assert r.status_code == 403 and "'Delete' permission on CRM › Customer Organizations" in r.json()["detail"], r.text

    r = client.post(f"{API}/inquiries", json={"org_id": org["id"], "lead_source": "Direct"}, headers=h)
    assert r.status_code == 403, r.text
    r = client.patch(f"{API}/inquiries/{inq['id']}", json={"priority": "Urgent"}, headers=h)
    assert r.status_code == 403, r.text
    assert client.delete(f"{API}/inquiries/{inq['id']}", headers=h).status_code == 403
    assert client.post(f"{API}/products", json={"name": "Widget"}, headers=h).status_code == 403
    assert client.get(f"{API}/exports/organizations", headers=h).status_code == 403
    assert client.get(f"{API}/settings", headers=h).status_code == 403


def test_no_crm_grants_is_denied(client, db):
    outsider = make_user(db, "crm.none@premnathrail.com", ["store:*:*"])
    assert client.get(f"{API}/inquiries", headers=auth(outsider)).status_code == 403
    assert client.get(f"{API}/dashboard", headers=auth(outsider)).status_code == 403


def test_finance_user_can_use_organization_picker(client, db):
    owner = make_user(db, "crm.full2@premnathrail.com", FULL)
    make_org(client, owner, "Picker Org")
    fin = make_user(db, "fin.only@premnathrail.com", ["accounts:*:*"])
    r = client.get(f"{API}/organizations", headers=auth(fin))
    assert r.status_code == 200 and any(o["name"] == "Picker Org" for o in r.json())


def test_delete_needs_grant_and_ownership(client, db):
    alice = make_user(db, "crm.alice@premnathrail.com", WITH_DELETE)
    bob = make_user(db, "crm.bob@premnathrail.com", WITH_DELETE)
    alice_org = make_org(client, alice, "Alice Org")
    bob_org = make_org(client, bob, "Bob Org")
    alice_inq = make_inquiry(client, alice, alice_org["id"])

    # Can't delete someone else's record even with Delete.
    r = client.delete(f"{API}/organizations/{alice_org['id']}", headers=auth(bob))
    assert r.status_code == 403 and "created yourself" in r.json()["detail"], r.text
    r = client.delete(f"{API}/inquiries/{alice_inq['id']}", headers=auth(bob))
    assert r.status_code == 403 and "created yourself" in r.json()["detail"], r.text

    # Can delete own.
    assert client.delete(f"{API}/inquiries/{alice_inq['id']}", headers=auth(alice)).status_code == 204
    assert client.delete(f"{API}/organizations/{bob_org['id']}", headers=auth(bob)).status_code == 204


def test_follow_up_delete_is_owner_checked(client, db):
    alice = make_user(db, "crm.alice2@premnathrail.com", WITH_DELETE)
    bob = make_user(db, "crm.bob2@premnathrail.com", WITH_DELETE)
    org = make_org(client, alice, "Followup Org")
    r = client.post(f"{API}/activities", json={"org_id": org["id"], "related_module": "organization",
                                               "related_id": org["id"], "subject": "Call"}, headers=auth(alice))
    assert r.status_code == 201, r.text
    act = r.json()
    assert client.delete(f"{API}/activities/{act['id']}", headers=auth(bob)).status_code == 403
    assert client.delete(f"{API}/activities/{act['id']}", headers=auth(alice)).status_code == 200
