"""Business logic for the HR employee master: list/query, profile upsert,
reporting-line validation, directory and org chart.

The User row stays the source of truth for reporting manager and date of
joining; department / designation / plant live on the HR profile and are
mirrored back onto User by employee_sync.apply_org_fields."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, true
from sqlalchemy.orm import Session, aliased

from app.core.config import settings
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.organization.services.department_membership import members_condition, user_department
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
    sort: str, order: str, page: int, page_size: int, scope=None, worker_scope=None,
    worker_type: str | None = None,
):
    """Every portal user left-joined with their HR profile, plus the people
    with no portal account (profile with user_id NULL) — one full outer join.
    `scope` / `worker_scope`: optional SQL filters on User rows / on profiles
    without an account (services/approvals.employee_scope_filter /
    worker_scope_filter)."""
    P = HrEmployeeProfile
    Mgr = aliased(User)
    no_login = User.id.is_(None)
    branch_expr = func.coalesce(P.branch_id, User.branch_id)
    dept_name = func.coalesce(Department.name, User.department)
    desig_name = func.coalesce(HrDesignation.name, User.designation)
    name_expr = func.coalesce(User.name, P.full_name)
    manager_expr = func.coalesce(User.reporting_manager_id, P.reporting_manager_id)
    doj_expr = func.coalesce(User.date_of_joining, P.date_of_joining)

    q = (
        db.query(User, P, dept_name.label("dept_name"), desig_name.label("desig_name"), Branch.name.label("branch_name"),
                 Mgr.name.label("mgr_name"), HrGrade.name.label("grade_name"))
        .select_from(User)
        .join(P, P.user_id == User.id, full=True)
        .outerjoin(Department, Department.id == P.department_id)
        .outerjoin(HrDesignation, HrDesignation.id == P.designation_id)
        .outerjoin(HrGrade, HrGrade.id == P.grade_id)
        .outerjoin(Branch, Branch.id == branch_expr)
        .outerjoin(Mgr, Mgr.id == manager_expr)
        .filter(or_(no_login, people_filter()))
    )
    if scope is not None or worker_scope is not None:
        q = q.filter(or_(
            and_(User.id.isnot(None), scope if scope is not None else true()),
            and_(no_login, worker_scope if worker_scope is not None else true()),
        ))

    # Without an account, "active" means not exited in HR.
    if user_status == "active":
        q = q.filter(or_(User.is_active.is_(True), and_(no_login, P.employment_status != "exited")))
    elif user_status == "inactive":
        q = q.filter(or_(User.is_active.is_(False), and_(no_login, P.employment_status == "exited")))

    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.filter(or_(name_expr.ilike(like), User.email.ilike(like), P.employee_code.ilike(like), P.contractor_name.ilike(like)))
    if department_id:
        dept = db.get(Department, department_id)
        cond = P.department_id == department_id
        if dept:
            # Users without an HR profile still carry the legacy text department.
            cond = or_(cond, and_(P.id.is_(None), members_condition(dept)))
        q = q.filter(cond)
    if branch_id:
        q = q.filter(branch_expr == branch_id)
    if designation_id:
        q = q.filter(P.designation_id == designation_id)
    if employment_status:
        q = q.filter(P.employment_status == employment_status)
    if employment_type:
        q = q.filter(P.employment_type == employment_type)
    if worker_type:
        # A portal user with no HR profile yet counts as office staff.
        q = q.filter(or_(P.worker_type == "office", P.id.is_(None)) if worker_type == "office" else P.worker_type == worker_type)
    if has_profile is True:
        q = q.filter(P.id.isnot(None))
    elif has_profile is False:
        q = q.filter(P.id.is_(None))
    if manager_id:
        q = q.filter(manager_expr == manager_id)

    total = q.order_by(None).count()

    sort_map = {
        "name": func.lower(name_expr),
        "email": func.lower(User.email),
        "employee_code": P.employee_code,
        "department": func.lower(dept_name),
        "designation": func.lower(desig_name),
        "branch": func.lower(Branch.name),
        "date_of_joining": doj_expr,
        "employment_status": P.employment_status,
    }
    col = sort_map.get(sort, sort_map["name"])
    col = col.desc().nullslast() if order == "desc" else col.asc().nullslast()
    rows = q.order_by(col, User.id, P.id).offset((page - 1) * page_size).limit(page_size).all()

    from app.modules.hr.services import workforce_rules as rules

    uploaded = uploaded_documents(db, [(u.id if u else None, p.id) for u, p, *_ in rows if p is not None])
    items = []
    for u, p, dname, desname, bname, mname, gname in rows:
        items.append(HrEmployeeListItem(
            user_id=u.id if u else None, profile_id=p.id if p else None,
            has_profile=p is not None, has_login=u is not None,
            worker_type=p.worker_type if p else "office", contractor_name=p.contractor_name if p else None,
            name=(u.name if u else p.full_name) or "—", email=u.email if u else None,
            is_active=u.is_active if u else p.employment_status != "exited",
            profile_photo_url=u.profile_photo_url if u else None,
            employee_code=p.employee_code if p else None,
            department_id=p.department_id if p else None, department_name=dname,
            designation_id=p.designation_id if p else None, designation_name=desname,
            grade_name=gname,
            branch_id=(p.branch_id if p and p.branch_id else (u.branch_id if u else None)), branch_name=bname,
            reporting_manager_id=u.reporting_manager_id if u else p.reporting_manager_id, reporting_manager_name=mname,
            date_of_joining=u.date_of_joining if u else p.date_of_joining,
            employment_type=p.employment_type if p else None,
            employment_status=p.employment_status if p else None,
            probation_end_date=p.probation_end_date if p else None,
            contract_end_date=p.contract_end_date if p else None,
            record_status=rules.record_status(p, u is not None, u, uploaded[(u.id if u else None, p.id)])[0] if p else None,
        ))

    base = db.query(User).filter(people_filter(), User.is_active.is_(True))
    if scope is not None:
        base = base.filter(scope)
    total_users = base.count()
    with_profile = base.join(P, P.user_id == User.id).count()
    workers = db.query(P).filter(P.user_id.is_(None), P.employment_status != "exited")
    if worker_scope is not None:
        workers = workers.filter(worker_scope)
    without_login = workers.count()
    return items, total, total_users + without_login, with_profile + without_login, without_login


# ------------------------------------------------------------------ detail

def get_profile(db: Session, user_id: int) -> HrEmployeeProfile | None:
    return db.query(HrEmployeeProfile).filter(HrEmployeeProfile.user_id == user_id).first()


# Profile fields only HR sees — never sent to the employee's own /me view.
HR_ONLY_PROFILE_FIELDS = ("notes", "org_fields_locked")


# Dynamic workforce form fields copied straight from the profile.
FORM_COLS = (
    "worker_type", "contractor_name", "contractor_worker_id", "contractor_contact_person", "contractor_contact_phone",
    "contractor_agreement_ref", "contract_start_date", "contract_end_date", "portal_access", "work_email",
    "attendance_policy", "weekly_off", "ot_eligible", "medical_fitness_date", "safety_induction_date",
    "exit_clearance_done", "is_draft", "probation_status", "contractor_verification", "portal_role_id",
    "safety_induction_status", "medical_clearance_status",
)


_VERIFY_RANK = {"verified": 3, "pending": 2, "rejected": 1}


def uploaded_documents(db: Session, pairs: list[tuple[int | None, int | None]]) -> dict[tuple[int | None, int | None], dict[str, str]]:
    """Per (user_id, profile_id) owner: document type → best verification
    status of its files (verified > pending > rejected). One query for a whole
    list page."""
    from app.modules.main.models.user_document import UserDocument

    user_ids = {u for u, _ in pairs if u}
    profile_ids = {p for u, p in pairs if p and not u}
    out: dict[tuple[int | None, int | None], dict[str, str]] = {pair: {} for pair in pairs}
    if not user_ids and not profile_ids:
        return out
    conds = []
    if user_ids:
        conds.append(UserDocument.user_id.in_(user_ids))
    if profile_ids:
        conds.append(and_(UserDocument.user_id.is_(None), UserDocument.hr_profile_id.in_(profile_ids)))
    by_user: dict[int, dict[str, str]] = {}
    by_profile: dict[int, dict[str, str]] = {}
    for uid, pid, key, state in db.query(UserDocument.user_id, UserDocument.hr_profile_id, UserDocument.checklist_key,
                                         UserDocument.verification_status).filter(
            UserDocument.checklist_key.isnot(None), or_(*conds)).all():
        bucket = by_user.setdefault(uid, {}) if uid else by_profile.setdefault(pid, {})
        state = state or "pending"
        if _VERIFY_RANK[state] > _VERIFY_RANK.get(bucket.get(key, ""), 0):
            bucket[key] = state
    for u, p in pairs:
        out[(u, p)] = by_user.get(u, {}) if u else by_profile.get(p, {})
    return out


def _form_fields(db: Session, profile: HrEmployeeProfile, user: User | None) -> dict:
    from app.modules.hr.services import workforce_rules as rules

    data = {c: getattr(profile, c) for c in FORM_COLS}
    owner = (user.id if user else None, profile.id)
    uploaded = uploaded_documents(db, [owner])[owner]
    data["documents_received"] = sorted(k for k, v in uploaded.items() if v == "verified")
    data["record_status"], data["missing_fields"] = rules.record_status(profile, user is not None, user, uploaded)
    data["login_status"] = ("linked" if user is not None else "pending_first_sign_in" if profile.portal_access and profile.work_email
                            else "not_required" if not profile.portal_access else "not_provisioned")
    if profile.portal_role_id:
        from app.modules.main.models.role import Role

        role = db.get(Role, profile.portal_role_id)
        data["portal_role_name"] = role.name if role else None
    for attr, key in (("created_by_id", "created_by_name"), ("updated_by_id", "updated_by_name")):
        uid = getattr(profile, attr)
        u = db.get(User, uid) if uid else None
        data[key] = u.name if u else None
    return data


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
            "employee_code", "department_id", "designation_id", "grade_id", "shift_id", "cost_center_id", "employment_type",
            "employment_status", "probation_end_date", "confirmation_date", "date_of_exit", "exit_reason",
            "work_location", "org_fields_locked", "notes", "created_at", "updated_at", *PII_FIELDS,
        ):
            data[col] = getattr(profile, col)
        data["lock_version"] = getattr(profile, "lock_version", None)  # SM12
        data.update(_form_fields(db, profile, user))
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


def build_worker_response(db: Session, profile: HrEmployeeProfile) -> HrEmployeeProfileResponse:
    """Full record of an employee with no portal account (HR only)."""
    data: dict = {
        "user_id": None, "has_profile": True, "has_login": False, "profile_id": profile.id,
        "name": profile.full_name or "—", "is_active": profile.employment_status != "exited",
        "reporting_manager_id": profile.reporting_manager_id, "date_of_joining": profile.date_of_joining,
        "lock_version": getattr(profile, "lock_version", None),
    }
    data.update(_form_fields(db, profile, None))
    for col in (
        "employee_code", "department_id", "designation_id", "grade_id", "shift_id",
        "cost_center_id", "employment_type", "employment_status", "probation_end_date", "confirmation_date", "date_of_exit",
        "exit_reason", "work_location", "org_fields_locked", "notes", "created_at", "updated_at", "branch_id", *PII_FIELDS,
    ):
        data[col] = getattr(profile, col)
    if profile.reporting_manager_id:
        m = db.get(User, profile.reporting_manager_id)
        data["reporting_manager_name"] = m.name if m else None
        data["reporting_manager_email"] = m.email if m else None
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
    if profile.branch_id:
        b = db.get(Branch, profile.branch_id)
        data["branch_name"] = b.name if b else None
    return HrEmployeeProfileResponse(**data)


# ------------------------------------------------------------------ validation

def check_code_unique(db: Session, code: str, own_profile_id: int | None) -> None:
    P = HrEmployeeProfile
    q = (
        db.query(P, User.name)
        .outerjoin(User, User.id == P.user_id)
        .filter(func.upper(P.employee_code) == code.upper())
    )
    if own_profile_id:
        q = q.filter(P.id != own_profile_id)
    clash = q.first()
    if clash:
        who = clash[1] or clash[0].full_name or f"profile #{clash[0].id}"
        raise HTTPException(
            status_code=409,
            detail=f"Employee code '{code}' is already assigned to {who}. Each employee needs a unique code — check the code, or change {who}'s code first.",
        )

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
    dept = user_department(db, user)
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
    # Portal access / work email only provision records without an account; this one has one.
    for key in ("portal_access", "work_email", "full_name", "portal_role_id", "link_user_id"):
        data.pop(key, None)
    profile = get_profile(db, target.id)
    is_new = profile is None
    enforce = _enforce_required(profile, target)

    # --- User-owned fields
    if "reporting_manager_id" in data:
        mid = data.pop("reporting_manager_id")
        if mid:
            validate_manager(db, target, mid)
        old_mid = target.reporting_manager_id
        target.reporting_manager_id = mid
        if mid != old_mid:
            # Pending requests follow the employee to the new manager.
            from app.modules.hr.services.lifecycle import reroute_pending_requests
            reroute_pending_requests(db, target.id, old_mid, mid, actor)
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
    if "cost_center_id" in data or ("branch_id" in data and profile is not None and profile.cost_center_id):
        from app.modules.hr.services.assignments import validate_cost_center

        cc_id = data["cost_center_id"] if "cost_center_id" in data else profile.cost_center_id
        plant = data["branch_id"] if "branch_id" in data else ((profile.branch_id if profile else None) or target.branch_id)
        if "cost_center_id" not in data or changed("cost_center_id") or "branch_id" in data:
            validate_cost_center(db, cc_id, plant)

    if data.get("employee_code"):
        check_code_unique(db, data["employee_code"], profile.id if profile else None)
    if "worker_type" in data and data["worker_type"] is None:
        raise HTTPException(status_code=422, detail="Worker type cannot be cleared. Pick Office staff, Factory / workshop or Contract labour.")

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
    finalize_record(db, profile, target.name, target, enforce=enforce)

    db.flush()
    apply_org_fields(db, target, profile)
    return profile


def next_workforce_id(db: Session) -> str:
    """Next free WF-00001-style Workforce ID."""
    codes = db.query(HrEmployeeProfile.employee_code).filter(HrEmployeeProfile.employee_code.like("WF-%")).all()
    nums = [int(c[3:]) for (c,) in codes if c and c[3:].isdigit()]
    return f"WF-{(max(nums) + 1 if nums else 1):05d}"


def _enforce_required(profile: HrEmployeeProfile | None, user: User | None) -> bool:
    """Required fields are enforced on a new record and on one that is already
    complete (so it can't slip back). An older record that never had them can
    still be edited — it simply stays Incomplete, listing what is missing."""
    from app.modules.hr.services import workforce_rules as rules

    return profile is None or (not profile.is_draft and not rules.missing(profile, user is not None, "required", user))


def finalize_record(db: Session, profile: HrEmployeeProfile, name: str | None, user: User | None = None,
                    enforce: bool = True) -> None:
    """Checks every save runs once the payload is applied. `user` = the
    linked portal account (None for a record without one). A draft skips
    the required-field rules, never the consistency checks."""
    from app.modules.hr.services import workforce_rules as rules
    from app.modules.hr.services.calendar import today_ist

    who = name or "this person"
    if not profile.worker_type:
        profile.worker_type = "office"  # column default only lands at INSERT, after these checks
    if not profile.employee_code:
        profile.employee_code = next_workforce_id(db)
    if profile.contract_start_date and profile.contract_end_date and profile.contract_end_date < profile.contract_start_date:
        raise HTTPException(
            status_code=422,
            detail=f"Contract end date ({profile.contract_end_date:%d-%m-%Y}) is before its start date ({profile.contract_start_date:%d-%m-%Y}). Fix one of the two dates.",
        )
    if profile.date_of_exit and profile.employment_status not in ("notice", "exited"):
        raise HTTPException(
            status_code=422,
            detail=f"A Last Working Day is set but {who}'s status is '{profile.employment_status}'. Set the status to On Notice or Exited, or clear the date.",
        )
    if profile.is_draft:
        return
    problem = rules.age_problem(profile, today_ist())  # legal hard stop, on every save
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    if not enforce:
        return
    gaps = rules.missing(profile, user is not None, "required", user)
    if gaps:
        kind = rules.WORKER_TYPES.get(profile.worker_type or "office", "this worker type")
        raise HTTPException(
            status_code=422,
            detail=f"These fields are required for {kind} and are empty: {', '.join(gaps)}. Fill them in, "
                   "or use Save as Draft to finish the record later.",
        )


def get_worker(db: Session, profile_id: int) -> HrEmployeeProfile:
    profile = db.get(HrEmployeeProfile, profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail=f"Employee record #{profile_id} does not exist. It may have been removed — go back to the Employees list and refresh.")
    if profile.user_id is not None:
        raise HTTPException(
            status_code=409,
            detail="This employee has a portal account, so their record is managed from their account page. Open them from the Employees list.",
        )
    return profile


def upsert_worker(db: Session, profile: HrEmployeeProfile | None, payload, actor: User) -> HrEmployeeProfile:
    """Create (profile None) or partially update an employee with no portal
    account. Does not commit. Unlike account holders, exits are recorded
    here directly — there is no account to deactivate or approvals to hand over."""
    data = payload.model_dump(exclude_unset=True)
    link_user_id = data.pop("link_user_id", None)
    if link_user_id:
        # Linking to an existing account: its email is the work email.
        account = db.get(User, link_user_id)
        if account is None:
            raise HTTPException(status_code=422, detail=f"User #{link_user_id} doesn't exist — pick the account from the list.")
        data["portal_access"] = True
        data["work_email"] = account.email
    is_new = profile is None
    enforce = _enforce_required(profile, None)
    name = data.get("full_name") or (profile.full_name if profile else None)

    if "full_name" in data and not data["full_name"]:
        raise HTTPException(status_code=422, detail="Full name cannot be cleared. Enter the employee's name.")
    for key in ("employment_status", "org_fields_locked", "worker_type"):
        if key in data and data[key] is None:
            raise HTTPException(status_code=422, detail=f"{key.replace('_', ' ').capitalize()} cannot be cleared. Pick a value.")

    if data.get("reporting_manager_id"):
        m = db.get(User, data["reporting_manager_id"])
        if not m:
            raise HTTPException(status_code=422, detail=f"Reporting manager #{data['reporting_manager_id']} does not exist. Pick the manager from the list.")
        if not m.is_active and (is_new or profile.reporting_manager_id != m.id):
            raise HTTPException(status_code=422, detail=f"{m.name} is deactivated in the portal. Pick an active supervisor / manager for {name}.")

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
    if "cost_center_id" in data or ("branch_id" in data and profile is not None and profile.cost_center_id):
        from app.modules.hr.services.assignments import validate_cost_center

        cc_id = data["cost_center_id"] if "cost_center_id" in data else profile.cost_center_id
        plant = data["branch_id"] if "branch_id" in data else (profile.branch_id if profile else None)
        if "cost_center_id" not in data or changed("cost_center_id") or "branch_id" in data:
            validate_cost_center(db, cc_id, plant)
    if data.get("employee_code"):
        check_code_unique(db, data["employee_code"], profile.id if profile else None)

    if is_new:
        profile = HrEmployeeProfile(user_id=None, created_by_id=actor.id, employment_status="active", org_fields_locked=True)
        db.add(profile)
    for k, v in data.items():
        setattr(profile, k, v)
    if not profile.portal_access:
        profile.work_email = None
    profile.updated_by_id = actor.id

    doj = profile.date_of_joining
    for field, label in (("probation_end_date", "Probation end date"), ("confirmation_date", "Confirmation date"), ("date_of_exit", "Date of exit")):
        val = getattr(profile, field)
        if doj and val and val < doj:
            raise HTTPException(
                status_code=422,
                detail=f"{label} ({val.strftime('%d-%m-%Y')}) is before the date of joining ({doj.strftime('%d-%m-%Y')}). Fix one of the two dates.",
            )
    finalize_record(db, profile, profile.full_name, enforce=enforce)
    db.flush()
    # Portal provisioning: link to the account now if it exists, else at its first sign-in.
    if profile.portal_access and not profile.is_draft:
        from app.modules.hr.services.workforce_link import check_role, link, validate_work_email

        role = check_role(db, profile.portal_role_id, actor)
        if profile.work_email:
            account = validate_work_email(db, profile)
            if account is not None:
                link(db, profile, account, role, actor)
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
