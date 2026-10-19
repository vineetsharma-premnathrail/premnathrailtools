"""Deleting a WBS that others wait for re-points them (MS Project style);
cancelling one names who waits and how to fix it."""
from app.modules.projects.models.milestone import PmProjectMilestone
from app.tests.test_pm_department_workflow import API, activate, add_milestone, add_task, auth, s  # noqa: F401  (s is a fixture)


def test_delete_repoints_dependents(client, db, s):
    design = add_milestone(client, s, title="Mechanical design — GA, drawings & BOM")
    purchase = add_milestone(client, s, days=40, title="Purchase", start_rule="after_step_started", depends_on_milestone_id=design["id"])
    r = client.delete(f"{API}/projects/{s['project']['id']}/milestones/{design['id']}", headers=auth(s["partner"]))
    assert r.status_code == 200, r.text
    assert "'Purchase' waited for it" in r.json()["message"]
    db.expire_all()
    p = db.get(PmProjectMilestone, purchase["id"])
    assert (p.start_rule, p.depends_on_milestone_id) == ("after_previous", None)
    hist = client.get(f"{API}/projects/{s['project']['id']}/history", headers=auth(s["partner"]))
    if hist.status_code == 200:
        assert "now starts after all steps above" in hist.text


def test_cancel_names_who_waits(client, db, s):
    design = add_milestone(client, s, title="Mechanical design")
    add_milestone(client, s, days=40, title="Purchase", start_rule="after_step_done", depends_on_milestone_id=design["id"])
    activate(client, s)
    add_task(client, s, design)
    r = client.post(f"{API}/projects/{s['project']['id']}/milestones/{design['id']}/cancel",
                    headers=auth(s["partner"]), json={"reason": "scope change"})
    assert r.status_code == 409
    assert "'Purchase' waits for 'Mechanical design'" in r.json()["detail"] and "change 'Starts'" in r.json()["detail"]
