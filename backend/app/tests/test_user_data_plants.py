"""Plants for the "Multiple plants" data scope are picked in the user's Data Access tab (2026-11-20).

They are stored as branch assignments, so data_scope.user_branch_ids keeps working; unticking ends the
row today (kept for history) and the person's own branch is always included.
"""
from app.core.data_scope import user_branch_ids
from app.modules.organization.models.branch_user_assignment import BranchUserAssignment
from app.tests.test_cov_hr_support import hdr, make_branch, make_user


def test_data_plants_set_and_unset_drive_multi_plant_scope(client, db):
    admin = make_user(db, "plants.admin@premnathrail.com", role="admin")
    home, p2, p3 = make_branch(db, "H1"), make_branch(db, "P2"), make_branch(db, "P3")
    target = make_user(db, "plants.target@premnathrail.com", branch_id=home.id)
    url = f"/api/v1/users/{target.id}/data-plants"

    r = client.put(url, headers=hdr(admin), json={"plant_ids": [p2.id, p3.id, home.id]})
    assert r.status_code == 200, r.text
    assert r.json() == {"home_branch_id": home.id, "plant_ids": sorted([p2.id, p3.id])}
    db.expire_all()
    assert user_branch_ids(db, target, "multi_plant") == {home.id, p2.id, p3.id}

    r = client.put(url, headers=hdr(admin), json={"plant_ids": [p3.id]})
    assert r.status_code == 200, r.text
    assert r.json()["plant_ids"] == [p3.id]
    db.expire_all()
    assert user_branch_ids(db, target, "multi_plant") == {home.id, p3.id}
    ended = db.query(BranchUserAssignment).filter(BranchUserAssignment.user_id == target.id, BranchUserAssignment.branch_id == p2.id).one()
    assert ended.status == "inactive" and ended.effective_to is not None  # kept for history

    assert client.get(url, headers=hdr(admin)).json()["plant_ids"] == [p3.id]


def test_data_plants_needs_data_access_edit_and_real_plants(client, db):
    admin = make_user(db, "plants.admin2@premnathrail.com", role="admin")
    plain = make_user(db, "plants.plain@premnathrail.com")
    target = make_user(db, "plants.target2@premnathrail.com")
    url = f"/api/v1/users/{target.id}/data-plants"
    assert client.put(url, headers=hdr(plain), json={"plant_ids": []}).status_code == 403
    r = client.put(url, headers=hdr(admin), json={"plant_ids": [999999]})
    assert r.status_code == 422 and "no longer exists" in r.json()["detail"]
