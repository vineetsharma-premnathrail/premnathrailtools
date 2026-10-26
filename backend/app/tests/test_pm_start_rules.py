"""PM milestones: start rules (parallel / overlapping steps); new projects
start with no milestones."""
from datetime import timedelta

from app.modules.projects.models.milestone import PmProjectMilestone
from app.tests.test_pm_department_workflow import API, TODAY, activate, auth, make_user, s  # noqa: F401
from app.tests.test_pm_team_sequence_chat import t  # noqa: F401 — fixture


def add(client, s, title, days, lead, **extra):
    r = client.post(f"{API}/projects/{s['project']['id']}/milestones", headers=auth(s["pm"]), json={
        "title": title, "department_id": s["dept"].id, "lead_user_id": lead.id,
        "target_date": str(TODAY + timedelta(days=days)), "deliverable": "Signed GA drawing + BOM", **extra,
    })
    assert r.status_code == 200, r.text
    return r.json()


def _task(client, s, m, who):
    r = client.post(f"{API}/pm-work/milestones/{m['id']}/tasks", headers=auth(s["lead"]), json={
        "title": f"work on {m['title']}", "assignee_id": who.id, "due_date": str(TODAY + timedelta(days=5))})
    assert r.status_code == 200, r.text
    return r.json()


def test_parallel_and_overlap_rules(client, db, t):  # noqa: F811
    design = add(client, t, "Design", 30, t["lead"])
    elec = add(client, t, "Electrical", 30, t["lead"], start_rule="with_previous")
    purchase = add(client, t, "Purchase", 40, t["lead"], start_rule="after_step_started", depends_on_milestone_id=design["id"])
    qc = add(client, t, "Quality", 50, t["lead"])
    rows = {m["title"]: m for m in client.get(f"{API}/projects/{t['project']['id']}/milestones", headers=auth(t["pm"])).json()}
    assert not rows["Electrical"]["is_locked"]  # parallel with step 1
    assert rows["Purchase"]["is_locked"] and "to start" in rows["Purchase"]["waiting_reason"]
    assert rows["Quality"]["is_locked"]

    activate(client, t)
    h = auth(t["asst"])
    # Electrical can start right away, in parallel with Design.
    e = _task(client, t, elec, t["asst"])
    assert client.post(f"{API}/pm-work/tasks/{e['id']}/start", headers=h).status_code == 200
    # Purchase waits until Design has started — then it may overlap.
    p = _task(client, t, purchase, t["asst"])
    r = client.post(f"{API}/pm-work/tasks/{p['id']}/start", headers=h)
    assert r.status_code == 409 and "to start" in r.json()["detail"]
    d = _task(client, t, design, t["asst"])
    assert client.post(f"{API}/pm-work/tasks/{d['id']}/start", headers=h).status_code == 200
    assert client.post(f"{API}/pm-work/tasks/{p['id']}/start", headers=h).status_code == 200
    # Quality still waits for everything above to be achieved.
    q = _task(client, t, qc, t["asst"])
    assert client.post(f"{API}/pm-work/tasks/{q['id']}/start", headers=h).status_code == 409


def test_chosen_step_rule_needs_the_step(client, t):  # noqa: F811
    r = client.post(f"{API}/projects/{t['project']['id']}/milestones", headers=auth(t["pm"]), json={
        "title": "X", "department_id": t["dept"].id, "lead_user_id": t["lead"].id, "target_date": str(TODAY + timedelta(days=5)),
        "deliverable": "Signed GA drawing + BOM", "start_rule": "after_step_done"})
    assert r.status_code == 422 and "pick that step" in r.json()["detail"]


def test_new_project_starts_without_milestones(client, db, t):  # noqa: F811
    r = client.post(f"{API}/projects", headers=auth(t["partner"]), json={
        "name": "RRV for metro", "client_name": "DMRC", "customer_po_ref": "PO-D", "sales_order_ref": "SO-D", "start_date": str(TODAY),
        "target_handover_date": str(TODAY + timedelta(days=200))})
    assert r.status_code == 200, r.text
    assert db.query(PmProjectMilestone).filter_by(project_id=r.json()["id"]).count() == 0
