"""Small batch lookups used to fill display names on HR responses without
N+1 queries (leave / attendance / holidays)."""
from __future__ import annotations

from typing import Iterable

from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.hr.models.employee_profile import HrEmployeeProfile


def users_by_id(db: Session, ids: Iterable[int | None]) -> dict[int, User]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return {u.id: u for u in db.query(User).filter(User.id.in_(wanted)).all()}


def profiles_by_user(db: Session, user_ids: Iterable[int | None]) -> dict[int, HrEmployeeProfile]:
    wanted = {i for i in user_ids if i}
    if not wanted:
        return {}
    return {p.user_id: p for p in db.query(HrEmployeeProfile).filter(HrEmployeeProfile.user_id.in_(wanted)).all()}


def branch_names(db: Session) -> dict[int, str]:
    return {b.id: b.name for b in db.query(Branch.id, Branch.name).all()}


def department_names(db: Session) -> dict[int, str]:
    return {d.id: d.name for d in db.query(Department.id, Department.name).all()}


def user_department_name(user: User | None, profile: HrEmployeeProfile | None, depts: dict[int, str]) -> str | None:
    if profile and profile.department_id and profile.department_id in depts:
        return depts[profile.department_id]
    return user.department if user else None
