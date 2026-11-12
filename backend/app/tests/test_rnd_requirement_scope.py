"""R&D › Requirements follow the R&D data scope (owner, 2026-11-12): an R&D person
with "Own + assigned" sees only the requirements they hold or gave a task on, and
only those tasks; Department or wider (and the R&D head) sees every requirement."""
from app.tests.test_cov_crm_quotations_rnd import auth, make_inquiry, make_user, send_tor, tor_env  # noqa: F401 — fixture
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture
from app.tests.test_rnd_requirement_work import RND, WORK, _new_task, make_rnd_head


def _scoped(db, user, level):
    user.data_access_scopes = {"rnd": level}
    db.commit()
    return user


def test_assigned_scope_sees_only_task_requirements(client, db, tor_env):
    bd = make_user(db, "sc.bd@premnathrail.com")
    head = make_user(db, "sc.head@premnathrail.com", apps=("rnd",))
    eng = _scoped(db, make_user(db, "sc.eng@premnathrail.com", apps=("rnd",)), "assigned")
    peer = _scoped(db, make_user(db, "sc.peer@premnathrail.com", apps=("rnd",)), "assigned")
    wide = _scoped(db, make_user(db, "sc.wide@premnathrail.com", apps=("rnd",)), "department")
    make_rnd_head(db, head)
    inq1 = make_inquiry(db, bd, uid="INQ-20261112-0001")
    inq2 = make_inquiry(db, bd, uid="INQ-20261112-0002")
    for inq in (inq1, inq2):
        assert send_tor(client, inq.id, bd).status_code == 200
        assert client.post(f"{RND}/requirements/inquiry/{inq.id}/accept", json={}, headers=auth(head)).status_code == 200

    def listed(user):
        return sorted(r["record_id"] for r in client.get(f"{RND}/requirements", headers=auth(user)).json())

    # No task yet: the assigned-scope engineer sees nothing and can't open either requirement.
    assert listed(eng) == []
    resp = client.get(f"{RND}/requirements/inquiry/{inq1.id}", headers=auth(eng))
    assert resp.status_code == 403 and "Own + assigned" in resp.json()["detail"]
    assert listed(head) == listed(wide) == sorted([inq1.id, inq2.id])

    mine = _new_task(client, inq1, head, eng).json()["id"]
    peers = _new_task(client, inq1, head, peer).json()["id"]

    assert listed(eng) == [inq1.id]
    assert client.get(f"{RND}/requirements/inquiry/{inq1.id}", headers=auth(eng)).status_code == 200
    assert client.get(f"{RND}/requirements/inquiry/{inq2.id}", headers=auth(eng)).status_code == 403
    # Inside the requirement: only their own task, while the head and a wide scope see both.
    assert [t["id"] for t in client.get(f"{WORK}/inquiry/{inq1.id}/tasks", headers=auth(eng)).json()] == [mine]
    assert sorted(t["id"] for t in client.get(f"{WORK}/inquiry/{inq1.id}/tasks", headers=auth(head)).json()) == sorted([mine, peers])
    assert sorted(t["id"] for t in client.get(f"{WORK}/inquiry/{inq1.id}/tasks", headers=auth(wide)).json()) == sorted([mine, peers])

    # The task's own page (R&D › R&D Tasks › task): the assignee opens their task without the requirement.
    page = client.get(f"{WORK}/tasks/{mine}/detail", headers=auth(eng))
    assert page.status_code == 200, page.text
    body = page.json()
    assert [t["id"] for t in body["tasks"]] == [mine]
    assert body["parent"]["kind"] == "requirement" and body["parent"]["id"] == inq1.id
    assert body["can_manage"] is False and body["can_open_parent"] is True
    # Someone else's task stays closed to them; the head opens any task.
    resp = client.get(f"{WORK}/tasks/{peers}/detail", headers=auth(eng))
    assert resp.status_code == 403 and "isn't yours" in resp.json()["detail"]
    assert client.get(f"{WORK}/tasks/{peers}/detail", headers=auth(head)).json()["can_manage"] is True
