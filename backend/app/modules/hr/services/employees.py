"""Business logic for the HR employee master: list/query, profile upsert,
reporting-line validation, directory and org chart.

The User row stays the source of truth for reporting manager and date of
joining; department / designation / plant live on the HR profile and are
mirrored back onto User by employee_sync.apply_org_fields."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, aliased

from app.core.config import settings
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.hr.models.employee_profile import HrEmployeeProfile, PII_FIELDS
from app.modules.hr.models.masters import HrDesignation, HrGrade, HrShift
from app.modules.hr.schemas.employee_profile import (
    HrEmployeeProfileResponse, HrEmployeeProfileUpdate, HrEmployeeListItem, HrDirectoryEntry,
)
from app.modules.hr.services.employee_sync import apply_org_fields

# Shared/generic mailboxes that exist in Azure but aren't people — mirrors
# _EXCLUDED_MAILBOX_LOCAL_PARTS in app/modules/main/routes/users.py.
_EXCLUDED_MAILBOX_LOCAL_PARTS = ("accounts", "corporate", "info", "prpl", "pew.research", "service")

# Fields on the profile the employee may change themself.
SELF_EDITABLE_FIELDS = (
    "personal_email", "personal_phone", "current_address", "permanent_address",
    "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relation",
    "blood_group", "marital_status",
)

SORT_FIELDS = ("name", "employee_code", "department", "designation", "branch", "date_of_joining", "employment_status", "email")


def people_filter():
    """SQL filter that keeps real employees: our own tenant domain (when
    DOMAIN_EMAIL is set) and not a known shared mailbox."""
    conds = [func.lower(func.split_part(User.email, "@", 1)).notin_(_EXCLUDED_MAILBOX_LOCAL_PARTS)]
    domain = (settings.DOMAIN_EMAIL or "").strip().lstrip("@").lower()
    if domain:
        conds.append(func.lower(User.email).like(f"%@{domain}"))
    return and_(*conds)


# ------------------------------------------------------------------ list

def list_employees(
    db: Session, *, search: str | None, department_id: int | None, branch_id: int | None,
    designation_id: int | None, employment_status: str | None, employment_type: str | None,
    has_profile: bool | None, user_status: str, manager_id: int | None,
    sort: str, order: str, page: int, page_size: int,
):
    P = HrEmployeeProfile
    Mgr = aliased(User)
    branch_expr = func.coalesce(P.branch_id, User.branch_id)
    dept_name = func.coalesce(Department.name, User.department)
    desig_name = func.coalesce(HrDesignation.name, User.designation)

    q = (
        db.query(User, P, dept_name.label("dept_name"), desig_name.label("desig_name"), Branch.name.label("branch_name"),
                 Mgr.name.label("mgr_name"), HrGrade.name.label("grade_name"))
        .outerjoin(P, P.user_id == User.id)
        .outerjoin(Department, Department.id == P.department_id)
        .outerjoin(HrDesignation, HrDesignation.id == P.designation_id)
        .outerjoin(HrGrade, HrGrade.id == P.grade_id)
        .outerjoin(Branch, Branch.id == branch_expr)
        .outerjoin(Mgr, Mgr.id == User.reporting_manager_id)
        .filter(people_filter())
    )

    if user_status == "active":
        q = q.filter(User.is_active.is_(True))
    elif user_status == "inactive":
        q = q.filter(User.is_active.is_(False))

    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.filter(or_(User.name.ilike(like), User.email.ilike(like), P.employee_code.ilike(like)))
    if department_id:
        dept = db.get(Department, department_id)
        cond = P.department_id == department_id
        if dept:
            # Users without an HR profile still carry the legacy text department.
            cond = or_(cond, and_(P.id.is_(None), func.lower(User.department) == dept.name.lower()))
        q = q.filter(cond)
    if branch_id:
        q = q.filter(branch_expr == branch_id)
    if designation_id:
        q = q.filter(P.designation_id == designation_id)
    if employment_status:
        q = q.filter(P.employment_status == employment_status)
    if employment_type:
        q = q.filter(P.employment_type == employment_type)
    if has_profile is True:
        q = q.filter(P.id.isnot(None))
    elif has_profile is False:
        q = q.filter(P.id.is_(None))
    if manager_id:
        q = q.filter(User.reporting_manager_id == manager_id)

    total = q.order_by(None).count()

    sort_map = {
        "name": func.lower(User.name),
        "email": func.lower(User.email),
        "employee_code": P.employee_code,
        "department": func.lower(dept_name),
        "designation": func.lower(desig_name),
        "branch": func.lower(Branch.name),
        "date_of_joining": User.date_of_joining,
        "employment_status": P.employment_status,
    }
    col = sort_map.get(sort, sort_map["name"])
    col = col.desc().nullslast() if order == "desc" else col.asc().nullslast()
    rows = q.order_by(col, User.id).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for u, p, dname, desname, bname, mname, gname in rows:
        items.append(HrEmployeeListItem(
            user_id=u.id, has_profile=p is not None, name=u.name, email=u.email, is_active=u.is_active,
            profile_photo_url=u.profile_photo_url,
            employee_code=p.employee_code if p else None,
            department_id=p.department_id if p else None, department_name=dname,
            designation_id=p.designation_id if p else None, designation_name=desname,
            grade_name=gname,
            branch_id=(p.branch_id if p and p.branch_id else u.branch_id), branch_name=bname,
            reporting_manager_id=u.reporting_manager_id, reporting_manager_name=mname,
            date_of_joining=u.date_of_joining,
            employment_type=p.employment_type if p else None,
            employment_status=p.employment_status if p else None,
            probation_end_date=p.probation_end_date if p else None,
        ))

    base = db.query(User).filter(people_filter(), User.is_active.is_(True))
    total_users = base.count()
    with_profile = base.join(P, P.user_id == User.id).count()
    return items, total, total_users, with_profile


# ------------------------------------------------------------------ detail

def get_profile(db: Session, user_id: int) -> HrEmployeeProfile | None:
    return db.query(HrEmployeeProfile).filter(HrEmployeeProfile.user_id == user_id).first()


# Profile fields only HR sees — never sent to the employee's own /me view.
HR_ONLY_PROFILE_FIELDS = ("notes", "org_fields_locked")


def build_profile_response(
    db: Session, user: User, profile: HrEmployeeProfile | None, *, include_hr_fields: bool = True,
) -> HrEmployeeProfileResponse:
    """`include_hr_fields=False` (the employee's own /me view) drops the
    HR-internal notes and the Azure-sync lock flag from the response."""
    manager = db.get(User, user.reporting_manager_id) if user.reporting_manager_id else None
    data: dict = {
        "user_id": user.id, "has_profile": profile is not None, "profile_id": profile.id if profile else None,
        "name": user.name, "email": user.email, "phone": user.phone, "is_active": user.is_active, "role": user.role,
        "profile_photo_url": user.profile_photo_url, "office_location": user.office_location,
        "reporting_manager_id": user.reporting_manager_id,
        "reporting_manager_name": manager.name if manager else None,
        "reporting_manager_email": manager.email if manager else None,
        "date_of_joining": user.date_of_joining,
        "user_department": user.department, "user_designation": user.designation,
        "direct_reports_count": db.query(User).filter(User.reporting_manager_id == user.id, User.is_active.is_(True)).count(),
        "department_name": user.department, "designation_name": user.designation,
        "branch_id": user.branch_id,
    }
    if profile:
        for col in (
            "employee_code", "department_id", "designation_id", "grade_id", "shift_id", "employment_type",
            "employment_status", "probation_end_date", "confirmation_date", "date_of_exit", "exit_reason",
            "work_location", "org_fields_locked", "notes", "created_at", "updated_at", *PII_FIELDS,
        ):
            data[col] = getattr(profile, col)
        if not include_hr_fields:
            for col in HR_ONLY_PROFILE_FIELDS:
                data.pop(col, None)
        if profile.branch_id:
            data["branch_id"] = profile.branch_id
        if profile.department_id:
            d = db.get(Department, profile.department_id)
            data["department_name"] = d.name if d else None
        if profile.designation_id:
            d = db.get(HrDesignation, profile.designation_id)
            data["designation_name"] = d.name if d else None
        if profile.grade_id:
            g = db.get(HrGrade, profile.grade_id)
            data["grade_name"] = g.name if g else None
            data["grade_code"] = g.code if g else None
        if profile.shift_id:
            s = db.get(HrShift, profile.shift_id)
            data["shift_name"] = f"{s.name} ({s.start_time.strftime('%H:%M')}–{s.end_time.strftime('%H:%M')})" if s else None
    if data.get("branch_id"):
        b = db.get(Branch, data["branch_id"])
        data["branch_name"] = b.name if b else None
    return HrEmployeeProfileResponse(**data)


# ------------------------------------------------------------------ validation

def validate_manager(db: Session, employee: User, manager_id: int) -> User:
    """Reject self-management and reporting loops, explaining the chain."""
    if manager_id == employee.id:
        raise HTTPException(
            status_code=422,
            detail=f"{employee.name} can't be their own reporting manager. Pick the person they actually report to, or leave Reporting Manager empty.",
        )
    manager = db.get(User, manager_id)
    if not manager:
        raise HTTPException(status_code=422, detail=f"Reporting manager #{manager_id} does not exist. Pick the manager from the list.")
    if not manager.is_active:
        raise HTTPException(
            status_code=422,
            detail=f"{manager.name} is deactivated in the portal, so they can't approve anything for {employee.name}. Pick an active manager.",
        )
    chain = [manager]
    seen = {manager.id}
    cur = manager
    while cur.reporting_manager_id:
        if cur.reporting_manager_id == employee.id:
            path = " → ".join(u.name for u in chain) + f" → {employee.name}"
            raise HTTPException(
                status_code=422,
                detail=(
                    f"{manager.name} can't be {employee.name}'s manager because {manager.name} already reports up to "
                    f"{employee.name} ({path}). That would create a reporting loop. Change {manager.name}'s manager "
                    f"first, or pick someone else."
                ),
            )
        if cur.reporting_manager_id in seen or len(chain) > 100:
            break  # an existing loop elsewhere in the chain — not caused by this change
        seen.add(cur.reporting_manager_id)
        nxt = db.get(User, cur.reporting_manager_id)
        if not nxt:
            break
        chain.append(nxt)
        cur = nxt
    return manager


def _check_ref(db: Session, model, ref_id: int | None, label: str, master_hint: str, check_active: bool) -> None:
    if not ref_id:
        return
    row = db.get(model, ref_id)
    if not row:
        raise HTTPException(status_code=422, detail=f"{label} #{ref_id} does not exist. Pick a {label.lower()} from the list.")
    if check_active and hasattr(row, "is_active") and not row.is_active:
        raise HTTPException(
            status_code=422,
            detail=f"{label} '{getattr(row, 'name', ref_id)}' is deactivated. Pick an active {label.lower()}, or reactivate it under {master_hint} first.",
        )


def prefill_new_profile(db: Session, user: User, profile: HrEmployeeProfile) -> None:
    """Seed a brand-new profile from the legacy User fields so creating it
    never loses information the older modules already rely on."""
    if user.department:
        dept = db.query(Department).filter(func.lower(Department.name) == user.department.strip().lower()).first()
        if dept:
            profile.department_id = dept.id
    if user.designation:
        desig = db.query(HrDesignation).filter(func.lower(HrDesignation.name) == user.designation.strip().lower()).first()
        if desig:
            profile.designation_id = desig.id
    if user.branch_id:
        profile.branch_id = user.branch_id


def upsert_profile(db: Session, target: User, payload: HrEmployeeProfileUpdate, actor: User) -> HrEmployeeProfile:
    """Create or partially update `target`'s HR profile. Does not commit."""
    data = payload.model_dump(exclude_unset=True)
    profile = get_profile(db, target.id)
    is_new = profile is None

    # --- User-owned fields
    if "reporting_manager_id" in data:
        mid = data.pop("reporting_manager_id")
        if mid:
            validate_manager(db, target, mid)
        target.reporting_manager_id = mid
    if "date_of_joining" in data:
        target.date_of_joining = data.pop("date_of_joining")

    # --- references (only validate "active" for a value that is changing)
    def changed(field):
        return field in data and (is_new or getattr(profile, field) != data[field])

    if "department_id" in data:
        _check_ref(db, Department, data["department_id"], "Department", "Organization > Departments", False)
    if changed("designation_id"):
        _check_ref(db, HrDesignation, data["designation_id"], "Designation", "HR > Masters > Designations", True)
    if changed("grade_id"):
        _check_ref(db, HrGrade, data["grade_id"], "Grade", "HR > Masters > Grades", True)
    if changed("shift_id"):
        _check_ref(db, HrShift, data["shift_id"], "Shift", "HR > Masters > Shifts", True)
    if "branch_id" in data:
        _check_ref(db, Branch, data["branch_id"], "Plant", "Organization > Plants", False)

    if data.get("employee_code"):
        clash = (
            db.query(HrEmployeeProfile, User.name)
            .join(User, User.id == HrEmployeeProfile.user_id)
            .filter(func.upper(HrEmployeeProfile.employee_code) == data["employee_code"].upper(), HrEmployeeProfile.user_id != target.id)
            .first()
        )
        if clash:
            raise HTTPException(
                status_code=409,
                detail=f"Employee code '{data['employee_code']}' is already assigned to {clash[1]}. Each employee needs a unique code — check the code, or change {clash[1]}'s code first.",
            )

    for key in ("employment_status", "org_fields_locked"):
        if key in data and data[key] is None:
            raise HTTPException(status_code=422, detail=f"{key.replace('_', ' ').capitalize()} cannot be cleared. Pick a value.")

    # --- exits / rehires only through HR > Lifecycle, which deactivates the
    # account, revokes sessions and hands over approvals (see exit_guard.py).
    current_status = profile.employment_status if profile else "active"
    if "employment_status" in data and data["employment_status"] != current_status and "exited" in (current_status, data["employment_status"]):
        if current_status == "exited":
            detail = (
                f"{target.name} has exited, and a rehire must go through HR > Lifecycle > New > Joining so the portal "
                "account is re-activated properly. Raise a joining event instead of changing the status here."
            )
        else:
            detail = (
                f"Exits must go through HR > Lifecycle > New > Exit so {target.name}'s portal account is deactivated, their "
                "sessions are signed out and their approvals are handed over. Raise an exit event instead of setting 'Exited' here."
            )
        raise HTTPException(status_code=422, detail=detail)
    if "date_of_exit" in data and data["date_of_exit"] and current_status != "exited" and (is_new or profile.date_of_exit != data["date_of_exit"]):
        raise HTTPException(
            status_code=422,
            detail=(
                f"{target.name} hasn't exited, so a Date of Exit can't be set here. Raise an exit event in HR > Lifecycle > New > Exit "
                "— it records the last working day when the exit is completed."
            ),
        )

    if is_new:
        profile = HrEmployeeProfile(user_id=target.id, created_by_id=actor.id, employment_status="active", org_fields_locked=True)
        prefill_new_profile(db, target, profile)
        db.add(profile)

    for k, v in data.items():
        if is_new and v is None and k in ("department_id", "designation_id", "branch_id"):
            continue  # keep what prefill matched from the legacy User fields
        setattr(profile, k, v)
    profile.updated_by_id = actor.id

    # --- cross-field date checks
    doj = target.date_of_joining
    for field, label in (("probation_end_date", "Probation end date"), ("confirmation_date", "Confirmation date"), ("date_of_exit", "Date of exit")):
        val = getattr(profile, field)
        if doj and val and val < doj:
            raise HTTPException(
                status_code=422,
                detail=f"{label} ({val.strftime('%d-%m-%Y')}) is before the date of joining ({doj.strftime('%d-%m-%Y')}). Fix one of the two dates.",
            )
    if profile.employment_status == "exited" and not profile.date_of_exit:
        raise HTTPException(
            status_code=422,
            detail="Employment status 'Exited' needs a Date of Exit. Enter the last working day, or run a proper exit from HR > Lifecycle > New > Exit.",
        )
    if profile.employment_status == "probation" and not profile.probation_end_date:
        raise HTTPException(
            status_code=422,
            detail="Employment status 'Probation' needs a Probation End Date so HR gets reminded before it ends. Enter the date.",
        )

    db.flush()
    apply_org_fields(db, target, profile)
    return profile


# ------------------------------------------------------------------ directory

def directory_entries(db: Session, search: str | None = None, department: str | None = None) -> list[HrDirectoryEntry]:
    P = HrEmployeeProfile
    rows = (
        db.query(User, func.coalesce(HrDesignation.name, User.designation), func.coalesce(Department.name, User.department), Branch.name)
        .outerjoin(P, P.user_id == User.id)
        .outerjoin(Department, Department.id == P.department_id)
        .outerjoin(HrDesignation, HrDesignation.id == P.designation_id)
        .outerjoin(Branch, Branch.id == func.coalesce(P.branch_id, User.branch_id))
        .filter(User.is_active.is_(True), people_filter(), or_(P.id.is_(None), P.employment_status != "exited"))
    )
    if search and search.strip():
        like = f"%{search.strip()}%"
        rows = rows.filter(or_(User.name.ilike(like), HrDesignation.name.ilike(like), User.designation.ilike(like), Department.name.ilike(like), User.department.ilike(like)))
    if department and department.strip():
        rows = rows.filter(func.lower(func.coalesce(Department.name, User.department)) == department.strip().lower())
    return [
        HrDirectoryEntry(id=u.id, name=u.name, designation=desig, department=dept, branch=branch,
                         manager_id=u.reporting_manager_id, profile_photo_url=u.profile_photo_url)
        for u, desig, dept, branch in rows.order_by(func.lower(User.name)).all()
    ]


def org_chart(db: Session) -> tuple[list[HrDirectoryEntry], list[int]]:
    nodes = directory_entries(db)
    ids = {n.id for n in nodes}
    for n in nodes:
        if n.manager_id not in ids:
            n.manager_id = None  # manager exited/inactive -> show as a top-level node
    # break any pre-existing loops so the tree always renders
    by_id = {n.id: n for n in nodes}
    for n in nodes:
        seen = {n.id}
        cur = n
        while cur.manager_id is not None:
            if cur.manager_id in seen:
                cur.manager_id = None
                break
            seen.add(cur.manager_id)
            cur = by_id[cur.manager_id]
    roots = [n.id for n in nodes if n.manager_id is None]
    return nodes, roots
