"""R&D task due / overdue reminders (modules/rnd/tasks/task_reminders.py, owner 2026-11-05)."""
from datetime import date, timedelta

from app.modules.main.models.notification import Notification
from app.modules.rnd.models.requirement_work import RndRequirementTask
from app.modules.rnd.tasks import task_reminders as tr
from app.tests.test_cov_crm_quotations_rnd import tor_env  # noqa: F401 — fixture
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture
from app.tests.test_rnd_intake import _accept, _setup, _task


def _notes(db, user, ntype):
    db.expire_all()
    return db.query(Notification).filter(Notification.user_id == user.id, Notification.notification_type == ntype).all()


def _open_task(client, db, tor_env):  # noqa: F811
    bd, head, member, inq = _setup(client, db)
    assert _accept(client, inq, head).status_code == 200
    r = _task(client, inq, head, member)
    assert r.status_code in (200, 201), r.text
    task = db.query(RndRequirementTask).filter(RndRequirementTask.assigned_to_id == member.id).one()
    return head, member, task


# The job runs on the real date and dedups on the notifications' real created_at,
# so these tests move the task's due date around today instead of moving "today".
def _due(db, task, days_from_today):
    task.due_date = date.today() + timedelta(days=days_from_today)
    db.commit()


def _age_notes(db, ntype, days):
    for n in db.query(Notification).filter(Notification.notification_type == ntype).all():
        n.created_at = n.created_at - timedelta(days=days)
    db.commit()


def test_due_tomorrow_and_today_go_to_the_assignee_once(client, db, tor_env):  # noqa: F811
    head, member, task = _open_task(client, db, tor_env)
    today = date.today()
    _due(db, task, 1)
    assert tr.run_task_reminders(db, today) == 1
    db.commit()  # each scheduled run commits
    assert tr.run_task_reminders(db, today) == 0  # same day: not again
    db.commit()
    assert len(_notes(db, member, tr.DUE_SOON)) == 1 and _notes(db, head, tr.DUE_SOON) == []
    _due(db, task, 0)
    assert tr.run_task_reminders(db, today) == 1
    db.commit()
    assert len(_notes(db, member, tr.DUE_TODAY)) == 1


def test_overdue_daily_to_assignee_and_escalated_after_two_days(client, db, tor_env):  # noqa: F811
    head, member, task = _open_task(client, db, tor_env)
    today = date.today()
    _due(db, task, -1)  # 1 day overdue: assignee only
    tr.run_task_reminders(db, today)
    db.commit()
    assert len(_notes(db, member, tr.OVERDUE)) == 1 and _notes(db, head, tr.OVERDUE_ESCALATED) == []

    _age_notes(db, tr.OVERDUE, 1)  # that was yesterday
    _due(db, task, -2)  # 2 days overdue: assignee again + giver / R&D head
    tr.run_task_reminders(db, today)
    db.commit()
    assert len(_notes(db, member, tr.OVERDUE)) == 2
    esc = _notes(db, head, tr.OVERDUE_ESCALATED)  # head gave the task and is the R&D head: one notice
    assert len(esc) == 1 and "2 days overdue" in esc[0].message

    _age_notes(db, tr.OVERDUE_ESCALATED, 1)  # a day later: no new escalation (every 3 days)
    tr.run_task_reminders(db, today)
    db.commit()
    assert len(_notes(db, head, tr.OVERDUE_ESCALATED)) == 1
    _age_notes(db, tr.OVERDUE_ESCALATED, 2)  # 3 days after the first: escalated again
    tr.run_task_reminders(db, today)
    db.commit()
    assert len(_notes(db, head, tr.OVERDUE_ESCALATED)) == 2


def test_submitted_or_future_tasks_get_nothing(client, db, tor_env):  # noqa: F811
    head, member, task = _open_task(client, db, tor_env)
    _due(db, task, 5)
    assert tr.run_task_reminders(db, date.today()) == 0
    task.status = "submitted"
    _due(db, task, -4)
    assert tr.run_task_reminders(db, date.today()) == 0


def test_types_are_registered_with_teams_by_default():
    import app.core.events.direct_scheduled  # noqa: F401 — registers the types
    from app.core.notification_events import direct_spec
    for t in (tr.DUE_SOON, tr.DUE_TODAY, tr.OVERDUE, tr.OVERDUE_ESCALATED):
        hit = direct_spec(t)
        assert hit is not None and "teams" in hit[1]["default_channels"]
