from datetime import date
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.modules.main.routes.users import require_admin
from app.modules.main.models.user import User
from app.modules.organization.models.company import Company
from app.modules.organization.models.company_address import CompanyAddress
from app.modules.organization.models.company_contact import CompanyContact
from app.modules.organization.models.company_financial_year import CompanyFinancialYear
from app.modules.organization.models.company_document import CompanyDocument
from app.modules.organization.schemas.company import (
    CompanyUpdate, CompanyResponse,
    CompanyAddressCreate, CompanyAddressUpdate, CompanyAddressResponse,
    CompanyContactCreate, CompanyContactUpdate, CompanyContactResponse,
    CompanyFinancialYearCreate, CompanyFinancialYearUpdate, CompanyFinancialYearResponse,
    CompanyDocumentResponse,
)
from app.utils.sharepoint import (
    upload_file_to_sharepoint, sanitize_folder_name, delete_file_from_sharepoint, download_file_content,
)

router = APIRouter(prefix="/organization/company", tags=["Organization - Company Info"])


def _get_company(db: Session) -> Company:
    company = db.query(Company).order_by(Company.id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company info has not been set up yet")
    return company


@router.get("", response_model=CompanyResponse)
async def get_company_info(
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Single-tenant deployments keep exactly one companies row — this is the
    org's own master info (used on letterheads, invoices, etc.), not a list
    of external companies."""
    return _get_company(db)


@router.patch("", response_model=CompanyResponse)
async def update_company_info(
    payload: CompanyUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    company = _get_company(db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(company, field, value)
    db.commit()
    db.refresh(company)
    return company


# ---------------------------------------------------------------------------
# Addresses
# ---------------------------------------------------------------------------

@router.get("/addresses", response_model=list[CompanyAddressResponse])
async def list_addresses(db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    company = _get_company(db)
    return db.query(CompanyAddress).filter(CompanyAddress.company_id == company.id).order_by(CompanyAddress.id).all()


@router.post("/addresses", response_model=CompanyAddressResponse)
async def create_address(payload: CompanyAddressCreate, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    company = _get_company(db)
    if payload.is_primary:
        db.query(CompanyAddress).filter(CompanyAddress.company_id == company.id).update({"is_primary": False})
    address = CompanyAddress(company_id=company.id, **payload.model_dump())
    db.add(address)
    db.commit()
    db.refresh(address)
    return address


@router.patch("/addresses/{address_id}", response_model=CompanyAddressResponse)
async def update_address(address_id: int, payload: CompanyAddressUpdate, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    company = _get_company(db)
    address = db.query(CompanyAddress).filter(CompanyAddress.id == address_id, CompanyAddress.company_id == company.id).first()
    if not address:
        raise HTTPException(status_code=404, detail="Address not found")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_primary"):
        db.query(CompanyAddress).filter(CompanyAddress.company_id == company.id, CompanyAddress.id != address_id).update({"is_primary": False})
    for field, value in data.items():
        setattr(address, field, value)
    db.commit()
    db.refresh(address)
    return address


@router.delete("/addresses/{address_id}")
async def delete_address(address_id: int, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    company = _get_company(db)
    address = db.query(CompanyAddress).filter(CompanyAddress.id == address_id, CompanyAddress.company_id == company.id).first()
    if not address:
        raise HTTPException(status_code=404, detail="Address not found")
    db.delete(address)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Contacts
# ---------------------------------------------------------------------------

@router.get("/contacts", response_model=list[CompanyContactResponse])
async def list_contacts(db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    company = _get_company(db)
    return db.query(CompanyContact).filter(CompanyContact.company_id == company.id).order_by(CompanyContact.id).all()


@router.post("/contacts", response_model=CompanyContactResponse)
async def create_contact(payload: CompanyContactCreate, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    company = _get_company(db)
    if payload.is_primary:
        db.query(CompanyContact).filter(CompanyContact.company_id == company.id).update({"is_primary": False})
    contact = CompanyContact(company_id=company.id, **payload.model_dump())
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


@router.patch("/contacts/{contact_id}", response_model=CompanyContactResponse)
async def update_contact(contact_id: int, payload: CompanyContactUpdate, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    company = _get_company(db)
    contact = db.query(CompanyContact).filter(CompanyContact.id == contact_id, CompanyContact.company_id == company.id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_primary"):
        db.query(CompanyContact).filter(CompanyContact.company_id == company.id, CompanyContact.id != contact_id).update({"is_primary": False})
    for field, value in data.items():
        setattr(contact, field, value)
    db.commit()
    db.refresh(contact)
    return contact


@router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: int, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    company = _get_company(db)
    contact = db.query(CompanyContact).filter(CompanyContact.id == contact_id, CompanyContact.company_id == company.id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.delete(contact)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Financial Years
# ---------------------------------------------------------------------------

@router.get("/financial-years", response_model=list[CompanyFinancialYearResponse])
async def list_financial_years(db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    company = _get_company(db)
    return db.query(CompanyFinancialYear).filter(CompanyFinancialYear.company_id == company.id).order_by(CompanyFinancialYear.start_date.desc()).all()


@router.post("/financial-years", response_model=CompanyFinancialYearResponse)
async def create_financial_year(payload: CompanyFinancialYearCreate, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    company = _get_company(db)
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="End date must be on or after the start date")
    fy = CompanyFinancialYear(company_id=company.id, **payload.model_dump())
    db.add(fy)
    db.commit()
    db.refresh(fy)
    return fy


@router.patch("/financial-years/{fy_id}", response_model=CompanyFinancialYearResponse)
async def update_financial_year(fy_id: int, payload: CompanyFinancialYearUpdate, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    company = _get_company(db)
    fy = db.query(CompanyFinancialYear).filter(CompanyFinancialYear.id == fy_id, CompanyFinancialYear.company_id == company.id).first()
    if not fy:
        raise HTTPException(status_code=404, detail="Financial year not found")
    data = payload.model_dump(exclude_unset=True)
    start = data.get("start_date", fy.start_date)
    end = data.get("end_date", fy.end_date)
    if end < start:
        raise HTTPException(status_code=400, detail="End date must be on or after the start date")
    for field, value in data.items():
        setattr(fy, field, value)
    db.commit()
    db.refresh(fy)
    return fy


@router.delete("/financial-years/{fy_id}")
async def delete_financial_year(fy_id: int, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    company = _get_company(db)
    fy = db.query(CompanyFinancialYear).filter(CompanyFinancialYear.id == fy_id, CompanyFinancialYear.company_id == company.id).first()
    if not fy:
        raise HTTPException(status_code=404, detail="Financial year not found")
    db.delete(fy)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

@router.get("/documents", response_model=list[CompanyDocumentResponse])
async def list_documents(db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    company = _get_company(db)
    return db.query(CompanyDocument).filter(CompanyDocument.company_id == company.id).order_by(CompanyDocument.id.desc()).all()


@router.post("/documents", response_model=CompanyDocumentResponse)
async def upload_document(
    file: UploadFile = File(...),
    document_type: str = Form(...),
    document_name: str = Form(...),
    document_number: str | None = Form(None),
    issue_date: date | None = Form(None),
    expiry_date: date | None = Form(None),
    issuing_authority: str | None = Form(None),
    description: str | None = Form(None),
    confidentiality: str | None = Form(None),
    tags: str | None = Form(None),
    remarks: str | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")
    company = _get_company(db)

    folder_path = f"{sanitize_folder_name(settings.SHAREPOINT_FOLDER or 'ERP-media')}/company-documents"
    result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, file)

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None

    document = CompanyDocument(
        company_id=company.id,
        document_type=document_type,
        document_name=document_name,
        document_number=document_number,
        issue_date=issue_date,
        expiry_date=expiry_date,
        issuing_authority=issuing_authority,
        filename=result["name"],
        content_type=file.content_type,
        size=result["size"],
        sharepoint_path=result["path"],
        sharepoint_url=result.get("webUrl"),
        description=description,
        confidentiality=confidentiality,
        tags=tag_list,
        remarks=remarks,
        created_by_id=user.id,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.get("/documents/{document_id}/content")
async def get_document_content(document_id: int, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    company = _get_company(db)
    document = db.query(CompanyDocument).filter(CompanyDocument.id == document_id, CompanyDocument.company_id == company.id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, document.sharepoint_path or "")
    return Response(
        content=content,
        media_type=document.content_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{document.filename}"'},
    )


@router.delete("/documents/{document_id}")
async def delete_document(document_id: int, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    company = _get_company(db)
    document = db.query(CompanyDocument).filter(CompanyDocument.id == document_id, CompanyDocument.company_id == company.id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if settings.SHAREPOINT_SITE_ID and document.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, document.sharepoint_path)
        except HTTPException:
            pass
    db.delete(document)
    db.commit()
    return {"ok": True}
