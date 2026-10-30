"""Product applications master. Retired (is_active=false), never deleted —
products already tagged with an application keep showing it."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.products.models.application import ProductApplication
from app.modules.products.models.product import product_application_links
from app.modules.products.schemas.application import (
    ProductApplicationCreate, ProductApplicationUpdate, ProductApplicationResponse,
)

router = APIRouter(prefix="/products/applications", tags=["Products"], dependencies=[Depends(require_tab_access("crm", "products"))])

# Applications are part of the one CRM › Products tab (2026-10-30).
_CAN_CREATE = require_tab_action("crm", "products", "create")
_CAN_EDIT = require_tab_action("crm", "products", "edit")


def _norm_code(code: str) -> str:
    c = (code or "").strip().upper()
    if not c or len(c) > 30:
        raise HTTPException(status_code=422, detail="Application code is required (up to 30 characters), e.g. OHE-INSP.")
    return c


def _counts(db: Session) -> dict[int, int]:
    rows = db.query(product_application_links.c.application_id, func.count()).group_by(product_application_links.c.application_id).all()
    return {app_id: n for app_id, n in rows}


def _out(row: ProductApplication, counts: dict[int, int]) -> ProductApplicationResponse:
    out = ProductApplicationResponse.model_validate(row)
    out.product_count = counts.get(row.id, 0)
    return out


@router.get("", response_model=list[ProductApplicationResponse])
async def list_applications(include_inactive: bool = False, db: Session = Depends(get_db)):
    q = db.query(ProductApplication)
    if not include_inactive:
        q = q.filter(ProductApplication.is_active.is_(True))
    counts = _counts(db)
    return [_out(r, counts) for r in q.order_by(ProductApplication.name).all()]


@router.post("", response_model=ProductApplicationResponse)
async def create_application(payload: ProductApplicationCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    code = _norm_code(payload.code)
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Application name is required, e.g. Overhead equipment (OHE) inspection.")
    existing = db.query(ProductApplication).filter(func.upper(ProductApplication.code) == code).first()
    if existing:
        hint = "edit it" if existing.is_active else "reactivate it from the list (it is retired)"
        raise HTTPException(status_code=409, detail=f"Application code '{code}' already exists ({existing.name}) — codes are unique; {hint} instead.")
    row = ProductApplication(code=code, name=name, description=(payload.description or "").strip() or None, created_by_id=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row, {})


@router.patch("/{application_id}", response_model=ProductApplicationResponse)
async def update_application(application_id: int, payload: ProductApplicationUpdate, db: Session = Depends(get_db), _user: User = Depends(_CAN_EDIT)):
    row = db.get(ProductApplication, application_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Application #{application_id} not found — it may have been removed; refresh the list.")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        data["name"] = (data["name"] or "").strip()
        if not data["name"]:
            raise HTTPException(status_code=422, detail="Application name can't be blank.")
    if "description" in data:
        data["description"] = (data["description"] or "").strip() or None
    if data.get("is_active") is None:
        data.pop("is_active", None)
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return _out(row, _counts(db))
