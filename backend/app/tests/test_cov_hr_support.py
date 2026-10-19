"""Shared helpers / fixtures for the test_cov_hr_* suites (no tests here).

Import with `from app.tests.test_cov_hr_support import *` so the autouse
fixtures (frozen IST clock) are active in the importing module."""
from datetime import date, datetime, time
from decimal import Decimal

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.models.leave import HrLeaveBalance, HrLeaveType
from app.modules.hr.models.masters import HrShift
from app.modules.hr.services.calendar import IST
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department

HR = "/api/v1/hr"

# Wednesday. Every HR "today" in the routes under test is pinned to this.
TODAY = date(2026, 10, 7)
NOW = datetime.combine(TODAY, time(9, 20)).replace(tzinfo=IST)

__all__ = [
    "HR", "TODAY", "NOW", "frozen_hr_clock", "make_user", "hdr", "make_branch", "make_dept", "make_profile",
    "make_leave_type", "make_balance", "make_shift", "Decimal",
]


@pytest.fixture(autouse=True)
def frozen_hr_clock(monkeypatch):
    for target in (
        "app.modules.hr.routes.leave.today_ist",
        "app.modules.hr.routes.attendance.today_ist",
        "app.modules.hr.routes.holidays.today_ist",
        "app.modules.hr.services.attendance.today_ist",
    ):
        monkeypatch.setattr(target, lambda: TODAY)
    monkeypatch.setattr("app.modules.hr.routes.attendance.now_ist", lambda: NOW)
    yield


def make_user(db, email, apps=("hr",), role="user", **fields):
    u = User(email=email, name=email.split("@")[0].replace(".", " ").title(), role=role, is_active=True,
             assigned_apps=list(apps))
    for k, v in fields.items():
        setattr(u, k, v)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def hdr(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def make_branch(db, code="P1", working_days="Mon-Sat", name=None):
    b = Branch(name=name or f"Plant {code}", code=code, status="active", working_days=working_days)
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


def make_dept(db, code="ENG", name="Engineering", branch_id=None, head_user_id=None):
    d = Department(code=code, name=name, branch_id=branch_id, head_user_id=head_user_id)
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


def make_profile(db, user, **fields):
    p = HrEmployeeProfile(user_id=user.id, employment_status=fields.pop("employment_status", "active"), **fields)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def make_leave_type(db, code="CL", name="Casual Leave", quota=12, **fields):
    lt = HrLeaveType(code=code, name=name, annual_quota=Decimal(str(quota)), **fields)
    db.add(lt)
    db.commit()
    db.refresh(lt)
    return lt


def make_balance(db, user, lt, year=2026, allotted=10, used=0, opening=0):
    b = HrLeaveBalance(user_id=user.id, leave_type_id=lt.id, year=year, opening=Decimal(str(opening)),
                       allotted=Decimal(str(allotted)), adjusted=Decimal("0"), used=Decimal(str(used)))
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


def make_shift(db, code="GEN", start=time(9, 0), end=time(17, 30), grace=10, branch_id=None, is_night=False):
    s = HrShift(code=code, name=f"{code} shift", start_time=start, end_time=end, grace_minutes=grace,
                branch_id=branch_id, is_night=is_night)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s
