"""Project Management review fixes (2026-10-07): project cancel cascades to
open milestones/tasks, delete rules for cancelled milestones, accept/reject
locked on closed projects, Documents-route record locks, non-ASCII download
names, submitted-milestone reminders and On-hold freezing cancel/delete."""
from datetime import timedelta

from app.modules.main.models.notification import Notification
from app.modules.projects.models.document import PmProjectDocument
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.task import PmProjectTask
from app.modules.projects.routes import documents as documents_routes
from app.tests.test_pm_department_workflow import (  # noqa: F401  (s is a fixture)
    API, TODAY, activate, add_milestone, add_task, auth, notes, s,
)


def _transition(client, s, action, **extra):
    return client.post(f"{API}/projects/{s['project']['id']}/transition", headers=auth(s["pm"]), json={"action": action, **extra})


def _finish_and_submit(client, s, m):
    task = add_task(client, s, m, due_date=str(TODAY + timedelta(days=2)))
    h = auth(s["member"])
    assert client.post(f"{API}/pm-work/tasks/{task['id']}/start", headers=h).status_code == 200
    assert client.post(f"{API}/pm-work/tasks/{task['id']}/complete", headers=h, json={"note": "Delivered drawing DWG-12 rev A"}).status_code == 200
    r = client.post(f"{API}/pm-work/milestones/{m['id']}/submit", headers=auth(s["head"]), json={"submission_note": "GA DWG-12 rev A"})
    assert r.status_code == 200, r.text
    return task


def _doc(db, s, **extra):
    fields = {"doc_type": "other", "title": "Evidence", "file_name": "ga.pdf", "file_path": "p/ga.pdf",
              "sharepoint_path": "p/ga.pdf", "uploaded_by_id": s["pm"].id, **extra}
    doc = PmProjectDocument(project_id=s["project"]["id"], **fields)
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def test_cancelling_project_closes_open_milestones_and_tasks(client, db, s):
    m = add_milestone(client, s)
    activate(client, s)
    task = add_task(client, s, m)
    r = _transition(client, s, "cancel", reason="Order withdrawn by customer")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    db.expire_all()
    ms = db.get(PmProjectMilestone, m["id"])
    t = db.get(PmProjectTask, task["id"])
    assert ms.status == "cancelled" and ms.cancel_reason == "Project cancelled: Order withdrawn by customer"
    assert t.status == "cancelled" and t.cancel_reason == "Project cancelled: Order withdrawn by customer"
    # People were collected before the cascade, so they are still told.
    assert notes(db, s["member"], "pm_project_cancel") == 1
    assert notes(db, s["head"], "pm_project_cancel") == 1


def test_delete_project_with_only_cancelled_milestones_says_cancel_instead(client, db, s):
    pid = s["project"]["id"]
    m = add_milestone(client, s)
    # The partner created the project, so only they may delete it (company rule).
    # Adding the first WBS releases the project, so it can't be deleted at all.
    released = client.delete(f"{API}/projects/{pid}", headers=auth(s["partner"]))
    assert released.status_code == 409 and "Only projects still in Planning can be deleted" in released.json()["detail"]
    # A Planning project that still has WBS elements (legacy data) is told to remove them first.
    from app.modules.projects.models.project import PmProject
    db.get(PmProject, pid).status = "planning"
    db.commit()
    live = client.delete(f"{API}/projects/{pid}", headers=auth(s["partner"]))
    assert live.status_code == 409 and "Delete its WBS elements first" in live.json()["detail"]
    r = client.post(f"{API}/projects/{pid}/milestones/{m['id']}/cancel", headers=auth(s["pm"]), json={"reason": "Not needed"})
    assert r.status_code == 200, r.text
    only_cancelled = client.delete(f"{API}/projects/{pid}", headers=auth(s["partner"]))
    assert only_cancelled.status_code == 409
    assert "kept for history" in only_cancelled.json()["detail"] and "Cancel project" in only_cancelled.json()["detail"]


def test_accept_and_reject_refused_once_project_is_cancelled(client, db, s):
    pid = s["project"]["id"]
    m = add_milestone(client, s)
    activate(client, s)
    _finish_and_submit(client, s, m)
    # Put the milestone back to submitted after the cancel, to prove the project check alone refuses it.
    assert _transition(client, s, "cancel", reason="Order withdrawn").status_code == 200
    db.query(PmProjectMilestone).filter(PmProjectMilestone.id == m["id"]).update({"status": "submitted"})
    db.commit()
    acc = client.post(f"{API}/projects/{pid}/milestones/{m['id']}/accept", headers=auth(s["pm"]), json={})
    assert acc.status_code == 409 and "Cancelled" in acc.json()["detail"]
    rej = client.post(f"{API}/projects/{pid}/milestones/{m['id']}/reject", headers=auth(s["pm"]), json={"reason": "x"})
    assert rej.status_code == 409


def test_documents_route_keeps_locked_evidence_and_closed_task_files(client, db, s, monkeypatch):
    monkeypatch.setattr(documents_routes.settings, "SHAREPOINT_SITE_ID", "")
    pid = s["project"]["id"]
    m = add_milestone(client, s)
    activate(client, s)
    task = _finish_and_submit(client, s, m)
    ev = _doc(db, s, milestone_id=m["id"])
    tf = _doc(db, s, task_id=task["id"])
    plain = _doc(db, s)
    r = client.delete(f"{API}/projects/{pid}/documents/{ev.id}", headers=auth(s["pm"]))
    assert r.status_code == 409 and "kept as a record" in r.json()["detail"]
    r = client.delete(f"{API}/projects/{pid}/documents/{tf.id}", headers=auth(s["pm"]))
    assert r.status_code == 409 and "Done" in r.json()["detail"]
    assert client.delete(f"{API}/projects/{pid}/documents/{plain.id}", headers=auth(s["pm"])).status_code == 200


def test_download_with_non_ascii_file_name(client, db, s, monkeypatch):
    async def fake_download(site_id, path):
        return b"%PDF-1.4", "application/pdf"
    monkeypatch.setattr(documents_routes.settings, "SHAREPOINT_SITE_ID", "site")
    monkeypatch.setattr(documents_routes, "download_file_content", fake_download)
    doc = _doc(db, s, file_name='Quote ₹ “final” – रेल.pdf')
    r = client.get(f"{API}/projects/{s['project']['id']}/documents/{doc.id}/content", headers=auth(s["pm"]))
    assert r.status_code == 200, r.text
    cd = r.headers["content-disposition"]
    assert "filename*=UTF-8''" in cd and 'filename="Quote  final  .pdf"' in cd
    assert r.headers["x-content-type-options"] == "nosniff"


def test_submitted_milestone_reminds_owner_not_department(client, db, s):
    from app.tasks.pm_reminders import run_pm_reminders
    m = add_milestone(client, s, days=5)
    activate(client, s)
    _finish_and_submit(client, s, m)
    db.expire_all()
    run_pm_reminders(db, TODAY + timedelta(days=15))
    db.commit()
    assert notes(db, s["pm"], "pm_milestone_awaiting_acceptance") == 1
    assert notes(db, s["head"], "pm_milestone_overdue") == 0
    assert notes(db, s["partner"], "pm_milestone_overdue_escalated") == 0

    # Dedup compares against the real send date, so check it on today's run.
    db.query(Notification).filter(Notification.notification_type == "pm_milestone_awaiting_acceptance").delete()
    db.commit()
    run_pm_reminders(db, TODAY)
    db.commit()
    # A second run on the same day (e.g. scheduler restart) sends nothing new.
    run_pm_reminders(db, TODAY)
    db.commit()
    assert notes(db, s["pm"], "pm_milestone_awaiting_acceptance") == 1


def test_on_hold_freezes_task_cancel_and_delete(client, db, s):
    m = add_milestone(client, s)
    activate(client, s)
    task = add_task(client, s, m)
    assert _transition(client, s, "hold", reason="Customer payment").status_code == 200
    r = client.post(f"{API}/pm-work/tasks/{task['id']}/cancel", headers=auth(s["head"]), json={"reason": "x"})
    assert r.status_code == 409 and "on hold" in r.json()["detail"]
    r = client.delete(f"{API}/pm-work/tasks/{task['id']}", headers=auth(s["head"]))
    assert r.status_code == 409 and "on hold" in r.json()["detail"]


def test_on_hold_freezes_evidence_and_task_file_delete(client, db, s, monkeypatch):
    monkeypatch.setattr(documents_routes.settings, "SHAREPOINT_SITE_ID", "")
    pid = s["project"]["id"]
    m = add_milestone(client, s)
    activate(client, s)
    task = add_task(client, s, m)
    ev = _doc(db, s, milestone_id=m["id"])
    tf = _doc(db, s, task_id=task["id"])
    plain = _doc(db, s)
    assert _transition(client, s, "hold", reason="Customer payment").status_code == 200
    for doc in (ev, tf):
        r = client.delete(f"{API}/pm-work/files/{doc.id}", headers=auth(s["pm"]))
        assert r.status_code == 409 and "on hold" in r.json()["detail"], r.text
        r = client.delete(f"{API}/projects/{pid}/documents/{doc.id}", headers=auth(s["pm"]))
        assert r.status_code == 409 and "on hold" in r.json()["detail"], r.text
    # Plain project documents are not work, so they stay deletable.
    assert client.delete(f"{API}/projects/{pid}/documents/{plain.id}", headers=auth(s["pm"])).status_code == 200
