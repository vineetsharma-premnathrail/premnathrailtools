"""HR & Administration — holiday calendar.

Owner: Agent C. Everyone can view the calendar (`get_current_user`);
creating, editing, bulk-adding and copying need the hr app (`require_hr`).
`branch_id` NULL means the holiday applies at every plant."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.models.branch import Branch
from app.modules.hr.models.holiday import HrHoliday
from app.modules.hr.schemas.holiday import (
    HrHolidayBulkPayload,
    HrHolidayCopyPayload,
    HrHolidayCreate,
    HrHolidayResponse,
    HrHolidayUpdate,
)
from app.modules.hr.services.access import is_hr, require_hr
from app.modules.hr.services.calendar import CalendarCache, today_ist
from app.modules.hr.services.leave import fmt_date

router = APIRouter(prefix="/hr/holidays", tags=["HR"])


def _branch_names(db: Session) -> dict[int, str]:
    return {b.id: b.name for b in db.query(Branch.id, Branch.name).all()}


def _resp(h: HrHoliday, branches: dict[int, str]) -> HrHolidayResponse:
    return HrHolidayResponse.model_validate(h).model_copy(update={
        "branch_name": branches.get(h.branch_id) if h.branch_id else None,
        "weekday": h.holiday_date.strftime("%A"),
    })


def _duplicate(db: Session, d: date, branch_id: int | None, name: str, exclude_id: int | None = None) -> HrHoliday | None:
    q = db.query(HrHoliday).filter(HrHoliday.holiday_date == d, HrHoliday.name.ilike(name.strip()))
    q = q.filter(HrHoliday.branch_id.is_(None)) if branch_id is None else q.filter(HrHoliday.branch_id == branch_id)
    if exclude_id:
        q = q.filter(HrHoliday.id != exclude_id)
    return q.first()


def _check_branch(db: Session, branch_id: int | None, branches: dict[int, str]) -> None:
    if branch_id is not None and branch_id not in branches:
        raise HTTPException(status_code=400, detail=f"Plant #{branch_id} doesn't exist. Pick a plant from the list, or leave it empty for all plants.")


@router.get("/branches")
async def holiday_branches(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    """Plants for the calendar filter (any logged-in user)."""
    return [{"id": b.id, "name": b.name} for b in db.query(Branch.id, Branch.name).order_by(Branch.name).all()]


@router.get("", response_model=list[HrHolidayResponse])
async def list_holidays(
    year: int | None = Query(None),
    branch_id: int | None = Query(None, description="Holidays that apply at this plant (plant-specific + all-plant)"),
    only_all_plants: bool = Query(False),
    holiday_type: str | None = Query(None),
    include_inactive: bool = Query(False),
    mine: bool = Query(False, description="Holidays that apply at the caller's own plant"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    year = year or today_ist().year
    q = db.query(HrHoliday).filter(HrHoliday.year == year)
    if mine:
        branch_id = CalendarCache(db).context(user).branch_id
        q = q.filter(or_(HrHoliday.branch_id.is_(None), HrHoliday.branch_id == branch_id)) if branch_id else q.filter(HrHoliday.branch_id.is_(None))
    elif only_all_plants:
        q = q.filter(HrHoliday.branch_id.is_(None))
    elif branch_id:
        q = q.filter(or_(HrHoliday.branch_id.is_(None), HrHoliday.branch_id == branch_id))
    if holiday_type:
        q = q.filter(HrHoliday.holiday_type == holiday_type)
    if not (include_inactive and is_hr(user)):
        q = q.filter(HrHoliday.is_active.is_(True))
    branches = _branch_names(db)
    return [_resp(h, branches) for h in q.order_by(HrHoliday.holiday_date.asc(), HrHoliday.name.asc()).all()]


@router.post("", response_model=HrHolidayResponse)
async def create_holiday(payload: HrHolidayCreate, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    branches = _branch_names(db)
    _check_branch(db, payload.branch_id, branches)
    name = payload.name.strip()
    if _duplicate(db, payload.holiday_date, payload.branch_id, name):
        where = branches.get(payload.branch_id, "all plants") if payload.branch_id else "all plants"
        raise HTTPException(status_code=409, detail=f"'{name}' on {fmt_date(payload.holiday_date)} is already in the calendar for {where}. Edit the existing entry instead.")
    h = HrHoliday(**payload.model_dump(), year=payload.holiday_date.year)
    h.name = name
    db.add(h)
    db.commit()
    db.refresh(h)
    return _resp(h, branches)


@router.post("/bulk")
async def bulk_create_holidays(payload: HrHolidayBulkPayload, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    """Adds every valid row; duplicates and bad rows are reported, not fatal."""
    branches = _branch_names(db)
    created: list[HrHoliday] = []
    skipped: list[dict] = []
    seen: set[tuple[date, int | None, str]] = set()
    for i, row in enumerate(payload.rows, start=1):
        name = row.name.strip()
        key = (row.holiday_date, row.branch_id, name.lower())
        if row.branch_id is not None and row.branch_id not in branches:
            skipped.append({"row": i, "name": name, "reason": f"Plant #{row.branch_id} doesn't exist."})
            continue
        if key in seen:
            skipped.append({"row": i, "name": name, "reason": "Same date, plant and name appears twice in this list."})
            continue
        seen.add(key)
        if _duplicate(db, row.holiday_date, row.branch_id, name):
            skipped.append({"row": i, "name": name, "reason": f"Already in the calendar on {fmt_date(row.holiday_date)}."})
            continue
        h = HrHoliday(**row.model_dump(), year=row.holiday_date.year)
        h.name = name
        db.add(h)
        created.append(h)
    db.commit()
    for h in created:
        db.refresh(h)
    return {"created": [_resp(h, branches) for h in created], "skipped": skipped}


@router.post("/copy")
async def copy_year(payload: HrHolidayCopyPayload, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    """Copies a year's holidays to another year on the same day and month
    (29 Feb becomes 28 Feb). Festivals follow the lunar calendar, so their
    dates must be reviewed after copying."""
    if payload.from_year == payload.to_year:
        raise HTTPException(status_code=400, detail="The source and target year are the same. Pick a different target year.")
    q = db.query(HrHoliday).filter(HrHoliday.year == payload.from_year, HrHoliday.is_active.is_(True))
    if payload.branch_id:
        q = q.filter(or_(HrHoliday.branch_id.is_(None), HrHoliday.branch_id == payload.branch_id))
    if payload.include_types:
        q = q.filter(HrHoliday.holiday_type.in_(payload.include_types))
    source = q.order_by(HrHoliday.holiday_date).all()
    if not source:
        raise HTTPException(status_code=404, detail=f"There are no active holidays in {payload.from_year} to copy. Add {payload.from_year}'s holidays first, or pick another year.")
    created = skipped = 0
    needs_review: list[str] = []
    for h in source:
        m, d = h.holiday_date.month, h.holiday_date.day
        if m == 2 and d == 29:
            d = 28
        new_date = date(payload.to_year, m, d)
        if _duplicate(db, new_date, h.branch_id, h.name):
            skipped += 1
            continue
        db.add(HrHoliday(
            holiday_date=new_date, name=h.name, holiday_type=h.holiday_type, branch_id=h.branch_id,
            year=payload.to_year, description=h.description, is_active=True,
        ))
        created += 1
        if h.holiday_type in ("festival", "restricted", "optional"):
            needs_review.append(f"{h.name} ({fmt_date(new_date)})")
    db.commit()
    return {"created": created, "skipped": skipped, "needs_review": needs_review}


@router.patch("/{holiday_id}", response_model=HrHolidayResponse)
async def update_holiday(holiday_id: int, payload: HrHolidayUpdate, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    h = db.get(HrHoliday, holiday_id)
    if not h:
        raise HTTPException(status_code=404, detail=f"Holiday #{holiday_id} doesn't exist. Refresh the calendar — it may have been deleted.")
    branches = _branch_names(db)
    data = payload.model_dump(exclude_unset=True)
    if "branch_id" in data:
        _check_branch(db, data["branch_id"], branches)
    for k in ("holiday_date", "name", "holiday_type", "is_active"):
        if k in data and data[k] is None:
            data.pop(k)
    new_date = data.get("holiday_date", h.holiday_date)
    new_branch = data.get("branch_id", h.branch_id)
    new_name = (data.get("name") or h.name).strip()
    if _duplicate(db, new_date, new_branch, new_name, exclude_id=h.id):
        raise HTTPException(status_code=409, detail=f"'{new_name}' on {fmt_date(new_date)} already exists for that plant. Change the date, name or plant.")
    for k, v in data.items():
        setattr(h, k, v)
    h.name = new_name
    h.year = h.holiday_date.year
    db.commit()
    db.refresh(h)
    return _resp(h, branches)


@router.delete("/{holiday_id}")
async def delete_holiday(holiday_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    h = db.get(HrHoliday, holiday_id)
    if not h:
        raise HTTPException(status_code=404, detail=f"Holiday #{holiday_id} doesn't exist. Refresh the calendar — it may already be deleted.")
    db.delete(h)
    db.commit()
    return {"ok": True}
