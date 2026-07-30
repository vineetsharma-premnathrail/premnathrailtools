from datetime import date, timedelta

from app.modules.main.models.user import User
from app.modules.crm.models.activity import Activity
from app.modules.crm.models.organization import Organization
from app.modules.main.models.notification import Notification
from app.tasks.followup_reminders import (
    _send_activity_followup_reminders,
    DUE_TODAY,
    DUE_TOMORROW,
)


def make_user(db, email, name):
    user = User(email=email, name=name, role="user", is_active=True, assigned_apps=["crm"])
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_org(db, name="Dalmia Cement"):
    org = Organization(name=name)
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def make_activity(db, org, assigned_to=None, created_by_id=None, next_followup=None, status="Open", activity_type="Introduction"):
    activity = Activity(
        org_id=org.id, assigned_to=assigned_to, created_by_id=created_by_id,
        next_followup=next_followup, status=status, activity_type=activity_type,
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return activity


def test_notifies_assigned_user_on_due_today(db):
    org = make_org(db)
    assignee = make_user(db, "assignee1@premnathrail.com", "Subhanshu Soni")
    creator = make_user(db, "creator1@premnathrail.com", "Someone Else")
    make_activity(db, org, assigned_to="Subhanshu Soni", created_by_id=creator.id, next_followup=date.today())

    _send_activity_followup_reminders(db)

    notes = db.query(Notification).filter(Notification.user_id == assignee.id).all()
    assert len(notes) == 1
    assert notes[0].notification_type == DUE_TODAY
    assert "today" in notes[0].title.lower()


def test_notifies_assigned_user_on_due_tomorrow(db):
    org = make_org(db)
    assignee = make_user(db, "assignee2@premnathrail.com", "Ravi Kumar")
    creator = make_user(db, "creator2@premnathrail.com", "Someone Else")
    make_activity(db, org, assigned_to="Ravi Kumar", created_by_id=creator.id, next_followup=date.today() + timedelta(days=1))

    _send_activity_followup_reminders(db)

    notes = db.query(Notification).filter(Notification.user_id == assignee.id).all()
    assert len(notes) == 1
    assert notes[0].notification_type == DUE_TOMORROW
    assert "tomorrow" in notes[0].title.lower()


def test_falls_back_to_creator_when_assigned_to_name_does_not_match_any_user(db):
    org = make_org(db)
    creator = make_user(db, "creator3@premnathrail.com", "The Creator")
    make_activity(db, org, assigned_to="Nonexistent Person", created_by_id=creator.id, next_followup=date.today())

    _send_activity_followup_reminders(db)

    notes = db.query(Notification).filter(Notification.user_id == creator.id).all()
    assert len(notes) == 1


def test_falls_back_to_creator_when_assigned_to_is_blank(db):
    org = make_org(db)
    creator = make_user(db, "creator4@premnathrail.com", "The Creator Four")
    make_activity(db, org, assigned_to=None, created_by_id=creator.id, next_followup=date.today())

    _send_activity_followup_reminders(db)

    notes = db.query(Notification).filter(Notification.user_id == creator.id).all()
    assert len(notes) == 1


def test_no_notification_when_not_due(db):
    org = make_org(db)
    creator = make_user(db, "creator5@premnathrail.com", "Far Future")
    make_activity(db, org, created_by_id=creator.id, next_followup=date.today() + timedelta(days=5))

    _send_activity_followup_reminders(db)

    assert db.query(Notification).count() == 0


def test_no_notification_for_non_open_activity(db):
    org = make_org(db)
    creator = make_user(db, "creator6@premnathrail.com", "Closed Activity")
    make_activity(db, org, created_by_id=creator.id, next_followup=date.today(), status="Done")

    _send_activity_followup_reminders(db)

    assert db.query(Notification).count() == 0


def test_no_duplicate_notification_if_run_twice_same_day(db):
    org = make_org(db)
    creator = make_user(db, "creator7@premnathrail.com", "Run Twice")
    make_activity(db, org, created_by_id=creator.id, next_followup=date.today())

    _send_activity_followup_reminders(db)
    _send_activity_followup_reminders(db)

    assert db.query(Notification).filter(Notification.user_id == creator.id).count() == 1


def test_notification_mentions_organization_name(db):
    org = make_org(db, "Dalmia Cement")
    creator = make_user(db, "creator8@premnathrail.com", "Org Mention")
    make_activity(db, org, created_by_id=creator.id, next_followup=date.today())

    _send_activity_followup_reminders(db)

    note = db.query(Notification).filter(Notification.user_id == creator.id).first()
    assert "Dalmia Cement" in note.message


def test_assigned_to_match_is_case_insensitive(db):
    org = make_org(db)
    assignee = make_user(db, "assignee9@premnathrail.com", "Subhanshu Soni")
    creator = make_user(db, "creator9@premnathrail.com", "Someone Else")
    make_activity(db, org, assigned_to="subhanshu soni", created_by_id=creator.id, next_followup=date.today())

    _send_activity_followup_reminders(db)

    assert db.query(Notification).filter(Notification.user_id == assignee.id).count() == 1
