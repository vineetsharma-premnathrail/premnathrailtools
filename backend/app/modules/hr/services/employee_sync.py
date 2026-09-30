"""Keeps the User row in step with the HR-owned employee profile.

Older modules still read free-text User fields (P2P department-head routing
matches on User.department by exact string), so whenever HR changes a
profile's department / designation / plant, call `apply_org_fields` in the
same transaction. User.reporting_manager_id and User.date_of_joining stay
on User and are the single source of truth for manager and DOJ — they are
not copied anywhere.

`org_fields_locked` (default true on a profile) stops Azure login and the
admin "Sync Azure Users" action from overwriting department, designation,
reporting manager and plant — see `is_org_locked` and its callers in
app/modules/main/routes/auth.py, app/modules/main/routes/users.py and
app/modules/organization/services/provisioning.py.
"""
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.organization.models.department import Department
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.models.masters import HrDesignation


def apply_org_fields(db: Session, user: User, profile: HrEmployeeProfile) -> None:
    """Mirror the profile's org fields onto `user`. Does not commit.

    - User.department  = Department.name     (when profile.department_id is set)
    - User.designation = HrDesignation.name  (when profile.designation_id is set)
    - User.branch_id   = profile.branch_id   (when profile.branch_id is set)

    A NULL id on the profile leaves the User field as it is, so creating a
    half-filled profile never wipes the legacy department text that P2P
    routing depends on. When creating a profile, pre-fill department_id by
    matching User.department against Department.name."""
    if profile.department_id:
        dept = db.get(Department, profile.department_id)
        if dept:
            user.department = dept.name
    if profile.designation_id:
        desig = db.get(HrDesignation, profile.designation_id)
        if desig:
            user.designation = desig.name
    if profile.branch_id:
        user.branch_id = profile.branch_id


def is_org_locked(db: Session, user_id: int | None) -> bool:
    """True if HR owns this user's org fields, so Azure sync must not touch
    department, designation, reporting_manager_id or branch_id."""
    if not user_id:
        return False
    locked = (
        db.query(HrEmployeeProfile.org_fields_locked)
        .filter(HrEmployeeProfile.user_id == user_id)
        .scalar()
    )
    return bool(locked)
