from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User


def make_user(db, email, role="user", assigned_apps=None):
    apps = ["crm"] if assigned_apps is None else assigned_apps
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=apps)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def make_org(client, user, name="Activity Org"):
    return client.post("/api/v1/crm/organizations", json={"name": name}, headers=auth_header(user)).json()


def make_inquiry(client, user, org_id):
    return client.post("/api/v1/crm/inquiries", json={"org_id": org_id}, headers=auth_header(user)).json()


def make_contact(client, user, org_id, name="Ravi Kumar"):
    return client.post(f"/api/v1/crm/organizations/{org_id}/contacts", json={"name": name}, headers=auth_header(user)).json()


def test_org_activities_include_inquiry_activities_with_stale_org_id(client, db):
    """Regression test: an Activity's own org_id is stamped at creation time
    and can drift from the truth if its parent Inquiry is later reassigned to
    a different Organization. The Organization's Activities tab must still
    show the activity by following the Inquiry's *current* org_id, not the
    Activity's stale snapshot."""
    user = make_user(db, "actorg1@premnathrail.com")
    org_a = make_org(client, user, "Org A")
    org_b = make_org(client, user, "Org B")
    inquiry = make_inquiry(client, user, org_a["id"])

    activity = client.post(
        "/api/v1/crm/activities",
        json={"org_id": org_a["id"], "related_module": "inquiry", "related_id": inquiry["id"]},
        headers=auth_header(user),
    ).json()
    assert activity["org_id"] == org_a["id"]

    # Reassign the inquiry to Org B without touching the activity row —
    # simulates the drift that causes the bug.
    client.patch(f"/api/v1/crm/inquiries/{inquiry['id']}", json={"org_id": org_b["id"]}, headers=auth_header(user))

    # Org A's Activities tab (activity.org_id still points here) still finds it.
    org_a_activities = client.get("/api/v1/crm/activities", params={"org_id": org_a["id"]}, headers=auth_header(user)).json()
    assert any(a["id"] == activity["id"] for a in org_a_activities)

    # Org B's Activities tab (the inquiry's *current* org) must also find it,
    # even though activity.org_id was never updated.
    org_b_activities = client.get("/api/v1/crm/activities", params={"org_id": org_b["id"]}, headers=auth_header(user)).json()
    assert any(a["id"] == activity["id"] for a in org_b_activities)


def test_activity_response_includes_contact_names_and_related_label(client, db):
    user = make_user(db, "actorg2@premnathrail.com")
    org = make_org(client, user, "Org With Contact")
    contact = make_contact(client, user, org["id"])
    inquiry = make_inquiry(client, user, org["id"])

    activity = client.post(
        "/api/v1/crm/activities",
        json={
            "org_id": org["id"],
            "org_contact_id": contact["id"],
            "related_module": "inquiry",
            "related_id": inquiry["id"],
        },
        headers=auth_header(user),
    ).json()

    assert activity["contact_names"] == [contact["name"]]
    assert activity["related_label"] == inquiry["universal_id"]

    # Same enrichment on the list endpoint, not just the create response.
    listed = client.get("/api/v1/crm/activities", params={"org_id": org["id"]}, headers=auth_header(user)).json()
    listed_activity = next(a for a in listed if a["id"] == activity["id"])
    assert listed_activity["contact_names"] == [contact["name"]]
    assert listed_activity["related_label"] == inquiry["universal_id"]
