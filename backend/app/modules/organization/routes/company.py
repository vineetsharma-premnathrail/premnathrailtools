from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.users import require_admin
from app.modules.organization.models.company import Company
from app.modules.organization.schemas.company import CompanyCreate, CompanyUpdate, CompanyResponse

router = APIRouter(prefix="/organization/companies", tags=["Organization"])


@router.get("", response_model=list[CompanyResponse])
async def list_companies(
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    return db.query(Company).order_by(Company.name.asc()).all()


@router.post("", response_model=CompanyResponse)
async def create_company(
    payload: CompanyCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    company = Company(**payload.model_dump())
    db.add(company)
    db.commit()
    db.refresh(company)
    return company


@router.patch("/{company_id}", response_model=CompanyResponse)
async def update_company(
    company_id: int,
    payload: CompanyUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(company, field, val)
    db.commit()
    db.refresh(company)
    return company


@router.delete("/{company_id}", status_code=204)
async def delete_company(
    company_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    db.delete(company)
    db.commit()
