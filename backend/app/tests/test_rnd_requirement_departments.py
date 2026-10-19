"""R&D requirement worked on together with the departments it is shared with:
shared departments see every department's tasks, anyone who can open the
requirement gives tasks to people in R&D or a shared department (the
assignee's department head is told), each department decides whether its
uploaded documents are visible to the others, and departments post in the
discussion as their own side."""
from datetime import date, timedelta

from app.core.config import settings
from app.modules.main.models.notification import Notification
from app.modules.organization.models.department import Department
from app.modules.rnd.routes import requirement_work as work_routes
from app.tests.test_cov_crm_quotations_rnd import auth, make_user, tor_env  # noqa: F401 — fixture
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture
from app.tests.test_rnd_requirement_work import _setup

RND = "/api/v1/rnd"
WORK = f"{RND}/requirement-work"


def _share(client, inq, head, *departments):
    resp = client.post(f"{WORK}/inquiry/{inq.id}/shares", json={"departments": list(departments), "note": "Check the platform fit"}, headers=auth(head))
    assert resp.status_code == 200, resp.text


def _task(client, inq, by, to, department, title="Panel layout"):
    due = (date.today() + timedelta(days=3)).isoformat()
    return client.post(f"{WORK}/inquiry/{inq.id}/tasks",
                       data={"title": title, "assigned_to_id": str(to.id), "due_date": due, "department": department},
                       headers=auth(by))


def _fake_upload(monkeypatch):
    counter = iter(range(1, 1000))

    async def upload(site, path, f):
        n = next(counter)
        return {"name": f.filename, "path": f"{path}/{n}-{f.filename}", "webUrl": f"https://sp/{n}", "size": 10}

    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "site-1")
    monkeypatch.setattr(work_routes, "upload_file_to_sharepoint", upload)


def test_department_works_on_shared_requirement(client, db, tor_env):
    _, head, eng, _, inq = _setup(client, db)
    designer = make_user(db, "d.designer@premnathrail.com", apps=("design",))

    # Not shared yet: the designer can't open it, and nobody can give Design a task on it.
    assert client.get(f"{WORK}/inquiry/{inq.id}/tasks", headers=auth(designer)).status_code == 403
    resp = _task(client, inq, head, designer, "design")
    assert resp.status_code == 422 and "isn't shared with Design" in resp.json()["detail"]

    _share(client, inq, head, "design")
    access = client.get(f"{WORK}/inquiry/{inq.id}/my-access", headers=auth(designer)).json()
    assert access == {"view": True, "download": True, "upload": True, "respond": False, "is_head": False, "create_technical_offer": False, "departments": ["design"]}

    # Anyone who can open it assigns across departments — a designer to R&D, R&D to Design.
    assert _task(client, inq, designer, eng, "rnd", title="Load calc").status_code == 200
    assert _task(client, inq, eng, designer, "design").status_code == 200
    # …but the person must belong to the department picked.
    resp = _task(client, inq, head, eng, "design")
    assert resp.status_code == 400 and "can't open Design › Requirements" in resp.json()["detail"]

    # Everyone sees every department's tasks.
    for who in (designer, eng, head):
        rows = client.get(f"{WORK}/inquiry/{inq.id}/tasks", headers=auth(who)).json()
        assert sorted((t["title"], t["department"]) for t in rows) == [("Load calc", "rnd"), ("Panel layout", "design")]

    people = client.get(f"{WORK}/inquiry/{inq.id}/assignees", headers=auth(designer)).json()
    assert {(p["id"], p["department"]) for p in people} >= {(eng.id, "rnd"), (designer.id, "design")}


def test_assignee_department_head_is_told(client, db, tor_env):
    _, head, _, _, inq = _setup(client, db)
    design_head = make_user(db, "d.head@premnathrail.com", apps=("design",))
    designer = make_user(db, "d.member@premnathrail.com", apps=("design",))
    designer.department = "Design"
    db.add(Department(name="Design", code="DES", head_user_id=design_head.id))
    db.commit()
    _share(client, inq, head, "design")

    assert _task(client, inq, head, designer, "design").status_code == 200
    told = db.query(Notification).filter(Notification.notification_type == "rnd_task_assigned_head").all()
    assert [n.user_id for n in told] == [design_head.id]
    # Department people open it from their own Requirements page, not R&D's.
    assigned = db.query(Notification).filter(Notification.notification_type == "rnd_task_assigned", Notification.user_id == designer.id).one()
    assert assigned.entity_type == "design_rnd_requirement"


def test_department_decides_document_visibility(client, db, tor_env, monkeypatch):
    _fake_upload(monkeypatch)
    _, head, eng, _, inq = _setup(client, db)
    designer = make_user(db, "v.designer@premnathrail.com", apps=("design",))
    electrician = make_user(db, "v.electric@premnathrail.com", apps=("electrical",))
    _share(client, inq, head, "design", "electrical")

    # Uploading for a department you aren't in is refused.
    resp = client.post(f"{WORK}/inquiry/{inq.id}/documents", data={"department": "electrical"},
                       files={"files": ("a.pdf", b"x", "application/pdf")}, headers=auth(designer))
    assert resp.status_code == 403 and "you belong to: Design" in resp.json()["detail"]

    resp = client.post(f"{WORK}/inquiry/{inq.id}/documents", data={"department": "design", "visibility": "own"},
                       files={"files": ("draft.pdf", b"x", "application/pdf")}, headers=auth(designer))
    assert resp.status_code == 200, resp.text
    doc = resp.json()[0]
    assert doc["department"] == "design" and doc["shared_with_all"] is False

    def names(user):
        return [d["name"] for d in client.get(f"{WORK}/inquiry/{inq.id}/all-documents", headers=auth(user)).json() if d["group"] == "dept"]

    assert names(designer) == ["draft.pdf"]
    assert names(electrician) == [] and names(head) == []
    assert client.get(f"{WORK}/documents/{doc['id']}/download-url", headers=auth(electrician)).status_code == 403
    # Only Design changes it; once shown to everyone, every department sees it.
    assert client.patch(f"{WORK}/documents/{doc['id']}/visibility", json={"shared_with_all": True}, headers=auth(eng)).status_code == 403
    assert client.patch(f"{WORK}/documents/{doc['id']}/visibility", json={"shared_with_all": True}, headers=auth(designer)).status_code == 200
    assert names(electrician) == ["draft.pdf"] and names(head) == ["draft.pdf"]


def test_department_posts_in_discussion(client, db, tor_env):
    _, head, _, _, inq = _setup(client, db)
    designer = make_user(db, "c.designer@premnathrail.com", apps=("design",))
    url = f"/api/v1/requirement-discussion/inquiry/{inq.id}"
    assert client.post(url, data={"side": "design", "body": "Fits?"}, headers=auth(designer)).status_code == 403
    _share(client, inq, head, "design")
    resp = client.post(url, data={"side": "design", "body": "Fits with a 20 mm spacer."}, headers=auth(designer))
    assert resp.status_code == 200, resp.text
    assert resp.json()["side"] == "design"
    # Posting as a department you aren't in is refused.
    assert client.post(url, data={"side": "electrical", "body": "x"}, headers=auth(designer)).status_code == 403
