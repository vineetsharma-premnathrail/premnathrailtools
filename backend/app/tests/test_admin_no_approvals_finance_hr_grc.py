"""Owner decision 2026-11-04: in Finance, HR and Access Reviews a portal admin
never approves / unlocks / recertifies just because they are admin."""
import pytest
from fastapi import HTTPException

from app.auth.jwt_handler import create_access_token
from app.modules.accounts import access
from app.modules.accounts.models.period_close import PeriodClose
from app.modules.hr.models.attendance_period import HrAttendancePeriod
from app.modules.hr.services import approvals as hr_approvals
from app.modules.hr.services import period_lock
from app.modules.main.models.grc import AccessReview, AccessReviewLine
from app.modules.main.models.user import User
from app.modules.main.services import grc
from app.modules.organization.services import approval_engine as engine
from app.tests.test_cov_controls_finance import books  # noqa: F401 - fixture


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _admin(db, email="nap.admin@premnathrail.com", **kw):
    u = User(email=email, name=email.split("@")[0], role="admin", is_active=True, **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


# ---------------------------------------------------------------- Finance

def test_admin_not_named_does_not_approve_period_close_via_submit_process(books):
    db, admin = books["db"], _admin(books["db"])
    req = access.submit_process(db, access.KEY_PERIOD_CLOSE, entity_id=access.period_entity_id("2026-05"), actor=admin,
                                title="Close accounting period 2026-05", reference="2026-05",
                                context={"period": "2026-05", "notes": None})
    db.commit()
    assert req.status == "pending"
    assert db.query(PeriodClose).filter(PeriodClose.accounting_period == "2026-05").first() is None


def test_named_finance_manager_still_approves_in_one_click(books):
    db = books["db"]
    req = access.submit_process(db, access.KEY_PERIOD_CLOSE, entity_id=access.period_entity_id("2026-04"),
                                actor=books["checker"], title="Close accounting period 2026-04", reference="2026-04",
                                context={"period": "2026-04", "notes": None})
    db.commit()
    assert req.status == "approved"


def test_admin_gets_403_on_period_close_route_without_a_real_approve_grant(client, books):
    admin = _admin(books["db"], "nap.admin2@premnathrail.com")
    r = client.post("/api/v1/accounts/period-close/2026-03/close", headers=_h(admin), json={})
    assert r.status_code == 403, r.text


def test_admin_cannot_decide_a_pending_journal_in_the_engine(client, books):
    db, maker = books["db"], books["maker"]
    admin = _admin(db, "nap.admin3@premnathrail.com")
    gl = books["gl"]
    jid = client.post("/api/v1/accounts/journal-entries", headers=_h(maker), json={
        "posting_date": "2026-07-15", "posting_type": "adjustment", "description": "Audit fee",
        "lines": [{"gl_account_id": gl["5210"].id, "debit_amount": 5000},
                  {"gl_account_id": gl["2070"].id, "credit_amount": 5000}]}).json()["id"]
    assert client.post(f"/api/v1/accounts/journal-entries/{jid}/submit", headers=_h(maker)).status_code == 200
    # Post button (approve gate) and the engine decision both refuse the admin.
    assert client.post(f"/api/v1/accounts/journal-entries/{jid}/post", headers=_h(admin)).status_code == 403
    req = engine.latest_request(db, access.ET_JOURNAL, jid)
    assert req.status == "pending"
    assert not engine.can_act_on_entity(db, admin, access.ET_JOURNAL, jid)


# ---------------------------------------------------------------- HR

def test_hr_can_decide_engine_flag_is_false_for_unnamed_admin(books):
    db, admin = books["db"], _admin(books["db"], "nap.admin4@premnathrail.com")
    req = access.submit_process(db, access.KEY_PERIOD_CLOSE, entity_id=access.period_entity_id("2026-02"),
                                actor=books["clerk"], title="Close 2026-02", reference="2026-02", context={"period": "2026-02"})
    db.commit()
    assert req.status == "pending"
    assert hr_approvals.can_decide_engine(db, admin, req) is False


def test_admin_cannot_unlock_a_payroll_period(db):
    admin = _admin(db, "nap.admin5@premnathrail.com")
    period = HrAttendancePeriod(year=2026, month=9, branch_id=None, status="locked")
    db.add(period)
    db.commit()
    with pytest.raises(HTTPException) as e:
        period_lock.unlock(db, period, admin, "late leave")
    assert e.value.status_code == 403 and "Only a Partner can unlock a closed period" in e.value.detail
    assert period.status == "locked"


def test_partner_can_unlock_a_payroll_period(db):
    partner = User(email="nap.partner@premnathrail.com", name="Partner", role="user", is_active=True, is_partner=True)
    db.add(partner)
    period = HrAttendancePeriod(year=2026, month=8, branch_id=None, status="locked")
    db.add(period)
    db.commit()
    assert period_lock.unlock(db, period, partner, "late leave").status == "open"


# ---------------------------------------------------------------- Access reviews

def test_admin_cannot_recertify_own_access(db):
    admin = _admin(db, "nap.admin6@premnathrail.com")
    review = AccessReview(period="2026-Q4", status="open", started_by_id=admin.id)
    db.add(review)
    db.flush()
    line = AccessReviewLine(review_id=review.id, reviewer_id=admin.id, user_id=admin.id, kind="grant",
                            permission="store:issues:view", label="Store issues view")
    db.add(line)
    db.commit()
    with pytest.raises(HTTPException) as e:
        grc.decide_line(db, line, admin, "keep", None)
    assert e.value.status_code == 403 and "own access" in e.value.detail
    assert line.decision is None
