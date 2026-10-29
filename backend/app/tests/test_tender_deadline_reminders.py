from datetime import date, datetime, timedelta

from app.modules.crm.models.organization import Organization
from app.modules.crm.models.tender import Tender
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.tasks.tender_deadline_reminders import NOTIFICATION_TYPE, run_tender_deadline_reminders

TODAY = date(2026, 11, 2)


def _user(db, email, name):
    u = User(email=email, name=name, role="user", is_active=True, assigned_apps=["crm"])
    db.add(u)
    db.commit()
    return u


def _tender(db, uid, **kw):
    org = Organization(name=f"Org {uid}")
    db.add(org)
    db.commit()
    t = Tender(universal_id=uid, org_id=org.id, tender_name=f"Tender {uid}", **kw)
    db.add(t)
    db.commit()
    return t


def _reminders(db, user_id):
    return db.query(Notification).filter(Notification.user_id == user_id, Notification.notification_type == NOTIFICATION_TYPE).count()


def test_reminds_creator_and_bd_owner_7_3_1_days_before_closing(db):
    creator = _user(db, "td_creator@premnathrail.com", "Tender Creator")
    owner = _user(db, "td_owner@premnathrail.com", "Asha Owner")
    t = _tender(db, "TD-1", created_by_id=creator.id, bd_owner="asha owner",
                closing_at=datetime.combine(TODAY + timedelta(days=7), datetime.min.time()).replace(hour=15))
    stats = run_tender_deadline_reminders(db, today=TODAY, send_email=False)
    assert stats["sent"] == 2
    assert _reminders(db, creator.id) == 1 and _reminders(db, owner.id) == 1
    # Same day again: no duplicate.
    assert run_tender_deadline_reminders(db, today=TODAY, send_email=False)["sent"] == 0
    # 5 days before: nothing; 3 and 1 day before: yes.
    assert run_tender_deadline_reminders(db, today=TODAY + timedelta(days=2), send_email=False)["sent"] == 0
    assert run_tender_deadline_reminders(db, today=TODAY + timedelta(days=4), send_email=False)["sent"] == 2
    assert run_tender_deadline_reminders(db, today=TODAY + timedelta(days=6), send_email=False)["sent"] == 2
    msg = db.query(Notification).filter(Notification.user_id == creator.id).first().message
    assert t.tender_name in msg and "03:00 PM" in msg


def test_falls_back_to_submission_date_and_skips_submitted(db):
    creator = _user(db, "td_creator2@premnathrail.com", "Creator Two")
    _tender(db, "TD-2", created_by_id=creator.id, submission_date=TODAY + timedelta(days=3))
    _tender(db, "TD-3", created_by_id=creator.id, submission_date=TODAY + timedelta(days=3), status="Tender Submitted")
    stats = run_tender_deadline_reminders(db, today=TODAY, send_email=False)
    assert stats["tenders"] == 1 and _reminders(db, creator.id) == 1
