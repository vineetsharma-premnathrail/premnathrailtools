"""CRM data scope (core/data_scope.py): which organizations / inquiries /
tenders / follow-ups a user sees. Organization-wide is the default (no role
scope); a role's data_scopes["crm"] or the user's personal override narrows it."""
from app.auth.jwt_handler import create_access_token
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization
from app.modules.crm.models.tender import Tender
from app.modules.main.models.role import Role
from app.modules.main.models.user import User

API = "/api/v1/crm"
FULL = ["crm:*:*"]


def _user(db, email, name, grants=FULL, role="user"):
    user = User(email=email, name=name, role=role, is_active=True, granular_permissions=list(grants))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def _seed(db):
    """Alice and Bob each own an organization with an inquiry and a tender;
    Bob's second inquiry names Alice as BD owner."""
    alice = _user(db, "ds.alice@premnathrail.com", "Alice Rao")
    bob = _user(db, "ds.bob@premnathrail.com", "Bob Shah")
    rows = {}
    for u in (alice, bob):
        org = Organization(name=f"Org of {u.name}", created_by_id=u.id)
        db.add(org)
        db.flush()
        inq = Inquiry(universal_id=f"INQ-DS-{u.id}", org_id=org.id, created_by_id=u.id, bd_owner=u.name)
        tnd = Tender(universal_id=f"TND-DS-{u.id}", org_id=org.id, created_by_id=u.id, bd_owner=u.name)
        db.add_all([inq, tnd])
        db.flush()
        rows[u.id] = {"org": org.id, "inq": inq.id, "tnd": tnd.id}
    assigned = Inquiry(universal_id="INQ-DS-ASSIGNED", org_id=rows[bob.id]["org"], created_by_id=bob.id,
                       bd_owner="alice rao")  # name match is case-insensitive
    db.add(assigned)
    db.commit()
    rows["assigned_inq"] = assigned.id
    return alice, bob, rows


def _ids(resp):
    assert resp.status_code == 200, resp.text
    return {r["id"] for r in resp.json()}


def _narrow(db, user, level):
    role = Role(name=f"CRM {level} {user.id}", permissions=FULL, data_scopes={"crm": level})
    db.add(role)
    db.commit()
    user.roles = [role]
    db.commit()


def test_own_scope_limits_lists_records_and_children(client, db):
    alice, bob, rows = _seed(db)
    _narrow(db, alice, "own")
    h = _auth(alice)
    mine, theirs = rows[alice.id], rows[bob.id]

    assert _ids(client.get(f"{API}/inquiries", headers=h)) == {mine["inq"]}
    assert _ids(client.get(f"{API}/tenders", headers=h)) == {mine["tnd"]}
    assert _ids(client.get(f"{API}/organizations", headers=h)) == {mine["org"]}
    # Dropdown lookup mode stays organization-wide.
    assert {mine["org"], theirs["org"]} <= _ids(client.get(f"{API}/organizations", params={"picker": True}, headers=h))

    assert client.get(f"{API}/inquiries/{mine['inq']}", headers=h).status_code == 200
    r = client.get(f"{API}/inquiries/{theirs['inq']}", headers=h)
    assert r.status_code == 403 and "outside your data access" in r.json()["detail"] and "Own records" in r.json()["detail"]
    # Children are checked against the parent record.
    r = client.get(f"{API}/inquiries/{theirs['inq']}/quotations", headers=h)
    assert r.status_code == 403, r.text
    assert client.get(f"{API}/inquiries/{mine['inq']}/quotations", headers=h).status_code == 200
    assert client.get(f"{API}/inquiries/{theirs['inq']}/stages", headers=h).status_code == 403
    assert client.get(f"{API}/tenders/{theirs['tnd']}", headers=h).status_code == 403
    assert client.get(f"{API}/organizations/{theirs['org']}/detail", headers=h).status_code == 403
    assert client.get(f"{API}/documents", params={"related_module": "inquiry", "related_id": theirs["inq"]},
                      headers=h).status_code == 403
    assert client.get(f"{API}/activities", params={"related_module": "tender", "related_id": theirs["tnd"]},
                      headers=h).status_code == 403
    r = client.patch(f"{API}/inquiries/{theirs['inq']}", json={"priority": "High"}, headers=h)
    assert r.status_code == 403 and "outside your data access" in r.json()["detail"]


def test_assigned_scope_sees_inquiry_where_user_is_bd_owner(client, db):
    alice, bob, rows = _seed(db)
    _narrow(db, alice, "assigned")
    h = _auth(alice)

    assert _ids(client.get(f"{API}/inquiries", headers=h)) == {rows[alice.id]["inq"], rows["assigned_inq"]}
    assert client.get(f"{API}/inquiries/{rows['assigned_inq']}", headers=h).status_code == 200
    assert client.get(f"{API}/inquiries/{rows[bob.id]['inq']}", headers=h).status_code == 403
    # Bob's organization is one Alice works (she is BD owner on an inquiry there).
    assert _ids(client.get(f"{API}/organizations", headers=h)) == {rows[alice.id]["org"], rows[bob.id]["org"]}
    assert _ids(client.get(f"{API}/tenders", headers=h)) == {rows[alice.id]["tnd"]}


def test_organization_wide_default_sees_everything(client, db):
    alice, bob, rows = _seed(db)
    h = _auth(alice)  # no role scope → organization-wide
    assert _ids(client.get(f"{API}/inquiries", headers=h)) == {rows[alice.id]["inq"], rows[bob.id]["inq"], rows["assigned_inq"]}
    assert _ids(client.get(f"{API}/tenders", headers=h)) == {rows[alice.id]["tnd"], rows[bob.id]["tnd"]}
    assert client.get(f"{API}/inquiries/{rows[bob.id]['inq']}", headers=h).status_code == 200
    d = client.get(f"{API}/dashboard", headers=h).json()
    assert (d["total_organizations"], d["total_inquiries"], d["total_tenders"]) == (2, 3, 2)


def test_dashboard_counts_are_scoped_and_override_wins(client, db):
    alice, bob, rows = _seed(db)
    alice.data_access_scopes = {"crm": "own"}  # personal override, no role needed
    db.commit()
    d = client.get(f"{API}/dashboard", headers=_auth(alice)).json()
    assert (d["total_organizations"], d["total_inquiries"], d["total_tenders"]) == (1, 1, 1)
    assert {i["id"] for i in d["recent_inquiries"]} == {rows[alice.id]["inq"]}

    alice.data_access_scopes = {"crm": "organization"}
    db.commit()
    d = client.get(f"{API}/dashboard", headers=_auth(alice)).json()
    assert (d["total_organizations"], d["total_inquiries"], d["total_tenders"]) == (2, 3, 2)
