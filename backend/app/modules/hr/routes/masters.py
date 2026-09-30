"""HR & Administration — designations, grades and shifts masters.

Owner: Agent A. Every endpoint here is HR-management only
(`Depends(require_hr)`). Masters are never hard-deleted while something
still points at them — the DELETE endpoints refuse with a 409 that says what
uses the row and suggests deactivating instead."""
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.hr.models.masters import HrGrade, HrDesignation, HrShift
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.models.lifecycle import HrLifecycleEvent
from app.modules.hr.models.attendance import HrAttendance
from app.modules.hr.schemas.masters import (
    HrGradeCreate, HrGradeUpdate, HrGradeResponse,
    HrDesignationCreate, HrDesignationUpdate, HrDesignationResponse,
    HrShiftCreate, HrShiftUpdate, HrShiftResponse,
    HrLookupOption, HrLookupUser, HrLookupsResponse,
)
from app.modules.hr.services.access import require_hr

router = APIRouter(prefix="/hr/masters", tags=["HR"])


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _count_by(db: Session, column) -> dict[int, int]:
    rows = db.query(column, func.count()).filter(column.isnot(None)).group_by(column).all()
    return {k: v for k, v in rows}


# =================================================================== Lookups

@router.get("/lookups", response_model=HrLookupsResponse)
async def get_lookups(
    include_inactive: bool = Query(False, description="Also return inactive masters and deactivated users"),
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    """Dropdown data for every HR form: departments, plants, designations,
    grades, shifts and people (for manager / handover pickers)."""
    depts = db.query(Department).order_by(Department.name).all()
    branches = db.query(Branch).order_by(Branch.name).all()
    desig_q = db.query(HrDesignation)
    grade_q = db.query(HrGrade)
    shift_q = db.query(HrShift)
    user_q = db.query(User)
    if not include_inactive:
        desig_q = desig_q.filter(HrDesignation.is_active.is_(True))
        grade_q = grade_q.filter(HrGrade.is_active.is_(True))
        shift_q = shift_q.filter(HrShift.is_active.is_(True))
        user_q = user_q.filter(User.is_active.is_(True))
    return HrLookupsResponse(
        departments=[HrLookupOption(id=d.id, name=d.name, code=d.code) for d in depts],
        branches=[HrLookupOption(id=b.id, name=b.name, code=b.code, is_active=(b.status or "active") == "active") for b in branches],
        designations=[HrLookupOption(id=d.id, name=d.name, code=d.code, is_active=d.is_active) for d in desig_q.order_by(HrDesignation.name).all()],
        grades=[HrLookupOption(id=g.id, name=g.name, code=g.code, is_active=g.is_active) for g in grade_q.order_by(HrGrade.level, HrGrade.code).all()],
        shifts=[HrLookupOption(id=s.id, name=s.name, code=s.code, is_active=s.is_active) for s in shift_q.order_by(HrShift.start_time).all()],
        users=[
            HrLookupUser(id=u.id, name=u.name, email=u.email, designation=u.designation, department=u.department, is_active=u.is_active)
            for u in user_q.order_by(User.name).all()
        ],
    )


# =================================================================== Grades

def _grade_response(g: HrGrade, counts: dict[int, int] | None = None) -> HrGradeResponse:
    return HrGradeResponse.model_validate(g).model_copy(update={"employee_count": (counts or {}).get(g.id, 0)})


def _ensure_grade_unique(db: Session, code: str | None, exclude_id: int | None = None) -> None:
    if not code:
        return
    q = db.query(HrGrade).filter(func.upper(HrGrade.code) == code.upper())
    if exclude_id:
        q = q.filter(HrGrade.id != exclude_id)
    clash = q.first()
    if clash:
        raise HTTPException(
            status_code=409,
            detail=f"Grade code '{code}' is already used by grade '{clash.name}'. Pick a different code, or edit that grade instead.",
        )


@router.get("/grades", response_model=list[HrGradeResponse])
async def list_grades(
    include_inactive: bool = Query(True),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    q = db.query(HrGrade)
    if not include_inactive:
        q = q.filter(HrGrade.is_active.is_(True))
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.filter(or_(HrGrade.code.ilike(like), HrGrade.name.ilike(like)))
    counts = _count_by(db, HrEmployeeProfile.grade_id)
    return [_grade_response(g, counts) for g in q.order_by(HrGrade.level, HrGrade.code).all()]


@router.post("/grades", response_model=HrGradeResponse, status_code=201)
async def create_grade(payload: HrGradeCreate, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    _ensure_grade_unique(db, payload.code)
    grade = HrGrade(**payload.model_dump())
    db.add(grade)
    db.commit()
    db.refresh(grade)
    return _grade_response(grade)


@router.patch("/grades/{grade_id}", response_model=HrGradeResponse)
async def update_grade(grade_id: int, payload: HrGradeUpdate, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    grade = db.get(HrGrade, grade_id)
    if not grade:
        raise HTTPException(status_code=404, detail=f"Grade #{grade_id} does not exist. It may have been deleted — refresh the list.")
    data = payload.model_dump(exclude_unset=True)
    for key in ("code", "name", "level", "is_active"):
        if key in data and data[key] is None:
            raise HTTPException(status_code=422, detail=f"Grade {key.replace('_', ' ')} cannot be cleared. Enter a value or leave the field unchanged.")
    _ensure_grade_unique(db, data.get("code"), exclude_id=grade.id)
    for k, v in data.items():
        setattr(grade, k, v)
    db.commit()
    db.refresh(grade)
    return _grade_response(grade, _count_by(db, HrEmployeeProfile.grade_id))


@router.delete("/grades/{grade_id}")
async def delete_grade(grade_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    grade = db.get(HrGrade, grade_id)
    if not grade:
        raise HTTPException(status_code=404, detail=f"Grade #{grade_id} does not exist. It may already have been deleted — refresh the list.")
    uses = []
    n = db.query(HrEmployeeProfile).filter(HrEmployeeProfile.grade_id == grade_id).count()
    if n:
        uses.append(_plural(n, "employee profile"))
    n = db.query(HrDesignation).filter(HrDesignation.grade_id == grade_id).count()
    if n:
        uses.append(_plural(n, "designation"))
    n = db.query(HrLifecycleEvent).filter(or_(HrLifecycleEvent.from_grade_id == grade_id, HrLifecycleEvent.to_grade_id == grade_id)).count()
    if n:
        uses.append(_plural(n, "lifecycle event"))
    if uses:
        raise HTTPException(
            status_code=409,
            detail=f"Grade '{grade.code}' can't be deleted because it is used by {', '.join(uses)}. Deactivate it instead so it can't be picked for anyone new, while history stays intact.",
        )
    db.delete(grade)
    db.commit()
    return {"ok": True}


# =================================================================== Designations

def _designation_response(db: Session, d: HrDesignation, counts: dict[int, int] | None = None,
                          depts: dict[int, str] | None = None, grades: dict[int, HrGrade] | None = None) -> HrDesignationResponse:
    dept_name = None
    grade = None
    if d.department_id:
        if depts is not None:
            dept_name = depts.get(d.department_id)
        else:
            dept = db.get(Department, d.department_id)
            dept_name = dept.name if dept else None
    if d.grade_id:
        grade = grades.get(d.grade_id) if grades is not None else db.get(HrGrade, d.grade_id)
    return HrDesignationResponse.model_validate(d).model_copy(update={
        "department_name": dept_name,
        "grade_name": grade.name if grade else None,
        "grade_code": grade.code if grade else None,
        "employee_count": (counts or {}).get(d.id, 0),
    })


def _validate_designation_refs(db: Session, department_id: int | None, grade_id: int | None) -> None:
    if department_id and not db.get(Department, department_id):
        raise HTTPException(status_code=422, detail=f"Department #{department_id} does not exist. Pick a department from the list, or leave it blank if the designation applies to every department.")
    if grade_id:
        g = db.get(HrGrade, grade_id)
        if not g:
            raise HTTPException(status_code=422, detail=f"Grade #{grade_id} does not exist. Pick a grade from the list or leave it blank.")
        if not g.is_active:
            raise HTTPException(status_code=422, detail=f"Grade '{g.code}' is deactivated. Pick an active grade, or reactivate '{g.code}' under Masters > Grades first.")


def _ensure_designation_unique(db: Session, name: str | None, code: str | None, exclude_id: int | None = None) -> None:
    if name:
        q = db.query(HrDesignation).filter(func.lower(HrDesignation.name) == name.lower())
        if exclude_id:
            q = q.filter(HrDesignation.id != exclude_id)
        clash = q.first()
        if clash:
            raise HTTPException(status_code=409, detail=f"A designation named '{clash.name}' already exists (code {clash.code}). Use that one, or give this designation a different name.")
    if code:
        q = db.query(HrDesignation).filter(func.upper(HrDesignation.code) == code.upper())
        if exclude_id:
            q = q.filter(HrDesignation.id != exclude_id)
        clash = q.first()
        if clash:
            raise HTTPException(status_code=409, detail=f"Designation code '{code}' is already used by '{clash.name}'. Pick a different code.")


@router.get("/designations", response_model=list[HrDesignationResponse])
async def list_designations(
    include_inactive: bool = Query(True),
    department_id: int | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    q = db.query(HrDesignation)
    if not include_inactive:
        q = q.filter(HrDesignation.is_active.is_(True))
    if department_id:
        q = q.filter(HrDesignation.department_id == department_id)
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.filter(or_(HrDesignation.name.ilike(like), HrDesignation.code.ilike(like)))
    counts = _count_by(db, HrEmployeeProfile.designation_id)
    depts = {d.id: d.name for d in db.query(Department).all()}
    grades = {g.id: g for g in db.query(HrGrade).all()}
    return [_designation_response(db, d, counts, depts, grades) for d in q.order_by(HrDesignation.name).all()]


@router.post("/designations", response_model=HrDesignationResponse, status_code=201)
async def create_designation(payload: HrDesignationCreate, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    _ensure_designation_unique(db, payload.name, payload.code)
    _validate_designation_refs(db, payload.department_id, payload.grade_id)
    d = HrDesignation(**payload.model_dump())
    db.add(d)
    db.commit()
    db.refresh(d)
    return _designation_response(db, d)


@router.patch("/designations/{designation_id}", response_model=HrDesignationResponse)
async def update_designation(designation_id: int, payload: HrDesignationUpdate, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    d = db.get(HrDesignation, designation_id)
    if not d:
        raise HTTPException(status_code=404, detail=f"Designation #{designation_id} does not exist. It may have been deleted — refresh the list.")
    data = payload.model_dump(exclude_unset=True)
    for key in ("code", "name", "is_active"):
        if key in data and data[key] is None:
            raise HTTPException(status_code=422, detail=f"Designation {key.replace('_', ' ')} cannot be cleared. Enter a value or leave the field unchanged.")
    _ensure_designation_unique(db, data.get("name"), data.get("code"), exclude_id=d.id)
    new_grade = data.get("grade_id") if "grade_id" in data and data.get("grade_id") != d.grade_id else None
    _validate_designation_refs(db, data.get("department_id"), new_grade)
    renamed = "name" in data and data["name"] != d.name
    for k, v in data.items():
        setattr(d, k, v)
    if renamed:
        # Keep the mirrored free-text User.designation in step for everyone
        # who holds this designation (see services/employee_sync).
        user_ids = [uid for (uid,) in db.query(HrEmployeeProfile.user_id).filter(HrEmployeeProfile.designation_id == d.id).all()]
        for u in db.query(User).filter(User.id.in_(user_ids)).all() if user_ids else []:
            u.designation = d.name
    db.commit()
    db.refresh(d)
    return _designation_response(db, d, _count_by(db, HrEmployeeProfile.designation_id))


@router.delete("/designations/{designation_id}")
async def delete_designation(designation_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    d = db.get(HrDesignation, designation_id)
    if not d:
        raise HTTPException(status_code=404, detail=f"Designation #{designation_id} does not exist. It may already have been deleted — refresh the list.")
    uses = []
    n = db.query(HrEmployeeProfile).filter(HrEmployeeProfile.designation_id == designation_id).count()
    if n:
        uses.append(_plural(n, "employee profile"))
    n = db.query(HrLifecycleEvent).filter(or_(HrLifecycleEvent.from_designation_id == designation_id, HrLifecycleEvent.to_designation_id == designation_id)).count()
    if n:
        uses.append(_plural(n, "lifecycle event"))
    if uses:
        raise HTTPException(
            status_code=409,
            detail=f"Designation '{d.name}' can't be deleted because it is used by {', '.join(uses)}. Deactivate it instead — current holders keep it, but it can't be picked for anyone new.",
        )
    db.delete(d)
    db.commit()
    return {"ok": True}


# =================================================================== Shifts

def _shift_hours(start, end) -> Decimal:
    s = start.hour * 60 + start.minute
    e = end.hour * 60 + end.minute
    minutes = e - s if e > s else (24 * 60 - s) + e
    return (Decimal(minutes) / Decimal(60)).quantize(Decimal("0.01"))


def _shift_response(s: HrShift, counts: dict[int, int] | None = None, branches: dict[int, str] | None = None, db: Session | None = None) -> HrShiftResponse:
    branch_name = None
    if s.branch_id:
        if branches is not None:
            branch_name = branches.get(s.branch_id)
        elif db is not None:
            b = db.get(Branch, s.branch_id)
            branch_name = b.name if b else None
    return HrShiftResponse.model_validate(s).model_copy(update={"branch_name": branch_name, "employee_count": (counts or {}).get(s.id, 0)})


def _ensure_shift_unique(db: Session, code: str | None, exclude_id: int | None = None) -> None:
    if not code:
        return
    q = db.query(HrShift).filter(func.upper(HrShift.code) == code.upper())
    if exclude_id:
        q = q.filter(HrShift.id != exclude_id)
    clash = q.first()
    if clash:
        raise HTTPException(status_code=409, detail=f"Shift code '{code}' is already used by shift '{clash.name}'. Pick a different code.")


def _validate_shift(db: Session, start, end, branch_id: int | None, branch_changed: bool) -> None:
    if start == end:
        raise HTTPException(status_code=422, detail="Shift start and end time are the same. Enter the time the shift ends (for a night shift, an end time earlier than the start is fine — it means the next morning).")
    if branch_id and branch_changed and not db.get(Branch, branch_id):
        raise HTTPException(status_code=422, detail=f"Plant #{branch_id} does not exist. Pick a plant from the list, or leave it blank if the shift applies at every plant.")


@router.get("/shifts", response_model=list[HrShiftResponse])
async def list_shifts(
    include_inactive: bool = Query(True),
    branch_id: int | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    q = db.query(HrShift)
    if not include_inactive:
        q = q.filter(HrShift.is_active.is_(True))
    if branch_id:
        q = q.filter(or_(HrShift.branch_id == branch_id, HrShift.branch_id.is_(None)))
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.filter(or_(HrShift.code.ilike(like), HrShift.name.ilike(like)))
    counts = _count_by(db, HrEmployeeProfile.shift_id)
    branches = {b.id: b.name for b in db.query(Branch).all()}
    return [_shift_response(s, counts, branches) for s in q.order_by(HrShift.start_time, HrShift.code).all()]


@router.post("/shifts", response_model=HrShiftResponse, status_code=201)
async def create_shift(payload: HrShiftCreate, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    _ensure_shift_unique(db, payload.code)
    _validate_shift(db, payload.start_time, payload.end_time, payload.branch_id, True)
    data = payload.model_dump()
    if data.get("working_hours") is None:
        data["working_hours"] = _shift_hours(payload.start_time, payload.end_time)
    if data.get("is_night") is None:
        data["is_night"] = payload.end_time < payload.start_time
    s = HrShift(**data)
    db.add(s)
    db.commit()
    db.refresh(s)
    return _shift_response(s, db=db)


@router.patch("/shifts/{shift_id}", response_model=HrShiftResponse)
async def update_shift(shift_id: int, payload: HrShiftUpdate, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    s = db.get(HrShift, shift_id)
    if not s:
        raise HTTPException(status_code=404, detail=f"Shift #{shift_id} does not exist. It may have been deleted — refresh the list.")
    data = payload.model_dump(exclude_unset=True)
    for key in ("code", "name", "start_time", "end_time", "grace_minutes", "is_active", "is_night"):
        if key in data and data[key] is None:
            raise HTTPException(status_code=422, detail=f"Shift {key.replace('_', ' ')} cannot be cleared. Enter a value or leave the field unchanged.")
    _ensure_shift_unique(db, data.get("code"), exclude_id=s.id)
    start = data.get("start_time", s.start_time)
    end = data.get("end_time", s.end_time)
    _validate_shift(db, start, end, data.get("branch_id"), "branch_id" in data and data.get("branch_id") != s.branch_id)
    times_changed = "start_time" in data or "end_time" in data
    for k, v in data.items():
        setattr(s, k, v)
    if times_changed and "working_hours" not in data:
        s.working_hours = _shift_hours(start, end)
    if times_changed and "is_night" not in data:
        s.is_night = end < start
    db.commit()
    db.refresh(s)
    return _shift_response(s, _count_by(db, HrEmployeeProfile.shift_id), db=db)


@router.delete("/shifts/{shift_id}")
async def delete_shift(shift_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    s = db.get(HrShift, shift_id)
    if not s:
        raise HTTPException(status_code=404, detail=f"Shift #{shift_id} does not exist. It may already have been deleted — refresh the list.")
    uses = []
    n = db.query(HrEmployeeProfile).filter(HrEmployeeProfile.shift_id == shift_id).count()
    if n:
        uses.append(_plural(n, "employee profile"))
    n = db.query(HrAttendance).filter(HrAttendance.shift_id == shift_id).count()
    if n:
        uses.append(_plural(n, "attendance record"))
    if uses:
        raise HTTPException(
            status_code=409,
            detail=f"Shift '{s.code}' can't be deleted because it is used by {', '.join(uses)}. Deactivate it instead so it can't be assigned to anyone new; past attendance keeps pointing at it.",
        )
    db.delete(s)
    db.commit()
    return {"ok": True}
