from datetime import date
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.users import require_admin
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.branch_address import BranchAddress
from app.modules.organization.models.branch_user_assignment import BranchUserAssignment
from app.modules.organization.models.branch_document import BranchDocument
from app.modules.organization.models.department import Department
from app.modules.organization.models.company import Company
from app.modules.organization.models.cost_center import CostCenter
from app.modules.organization.schemas.branch import (
    BranchCreate, BranchUpdate, BranchResponse, PLANT_STATUSES,
    BranchAddressCreate, BranchAddressUpdate, BranchAddressResponse,
    BranchUserAssignmentCreate, BranchUserAssignmentUpdate, BranchUserAssignmentResponse,
    BranchDocumentResponse,
)
from app.utils.sharepoint import (
    upload_file_to_sharepoint, sanitize_folder_name, delete_file_from_sharepoint, download_file_content,
)

router = APIRouter(prefix="/organization/branches", tags=["Organization"])


def _validate_status(status: str | None) -> None:
    if status is not None and status not in PLANT_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {', '.join(PLANT_STATUSES)}")


def _to_response(branch: Branch, db: Session) -> BranchResponse:
    company = db.query(Company).filter(Company.id == branch.company_id).first() if branch.company_id else None
    head = db.query(User).filter(User.id == branch.head_user_id).first() if branch.head_user_id else None
    manager = db.query(User).filter(User.id == branch.manager_user_id).first() if branch.manager_user_id else None
    warehouse_name = None
    if branch.default_warehouse_id:
        from app.modules.store.models.location import StoreLocation  # local import avoids a cross-module cycle at startup
        wh = db.query(StoreLocation).filter(StoreLocation.id == branch.default_warehouse_id).first()
        warehouse_name = wh.name if wh else None
    cost_center_name = None
    if branch.default_cost_center_id:
        cc = db.query(CostCenter).filter(CostCenter.id == branch.default_cost_center_id).first()
        cost_center_name = cc.name if cc else None
    return BranchResponse.model_validate(branch).model_copy(
        update={
            "company_name": company.name if company else None,
            "head_user_name": head.name if head else None,
            "manager_user_name": manager.name if manager else None,
            "default_warehouse_name": warehouse_name,
            "default_cost_center_name": cost_center_name,
        }
    )


def _get_branch_or_404(branch_id: int, db: Session) -> Branch:
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Plant not found")
    return branch


@router.get("", response_model=list[BranchResponse])
async def list_branches(
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    branches = db.query(Branch).order_by(Branch.name.asc()).all()
    return [_to_response(b, db) for b in branches]


@router.post("", response_model=BranchResponse, status_code=201)
async def create_branch(
    payload: BranchCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    _validate_status(payload.status)
    if db.query(Branch).filter(Branch.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"Plant code '{payload.code}' already exists")
    branch = Branch(**payload.model_dump())
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return _to_response(branch, db)


@router.get("/{branch_id}", response_model=BranchResponse)
async def get_branch(
    branch_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    branch = _get_branch_or_404(branch_id, db)
    return _to_response(branch, db)


@router.patch("/{branch_id}", response_model=BranchResponse)
async def update_branch(
    branch_id: int,
    payload: BranchUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    _validate_status(payload.status)
    branch = _get_branch_or_404(branch_id, db)
    if payload.code and payload.code != branch.code:
        if db.query(Branch).filter(Branch.code == payload.code, Branch.id != branch_id).first():
            raise HTTPException(status_code=409, detail=f"Plant code '{payload.code}' already exists")
    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(branch, field, val)
    db.commit()
    db.refresh(branch)
    return _to_response(branch, db)


@router.delete("/{branch_id}", status_code=204)
async def delete_branch(
    branch_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    branch = _get_branch_or_404(branch_id, db)
    user_count = db.query(User).filter(User.branch_id == branch_id).count()
    dept_count = db.query(Department).filter(Department.branch_id == branch_id).count()
    if user_count or dept_count:
        parts = []
        if user_count:
            parts.append(f"{user_count} user(s)")
        if dept_count:
            parts.append(f"{dept_count} department(s)")
        raise HTTPException(status_code=409, detail=f"Cannot delete plant — {' and '.join(parts)} still assigned to it.")
    db.delete(branch)
    db.commit()


# ---------------------------------------------------------------------------
# Addresses
# ---------------------------------------------------------------------------

@router.get("/{branch_id}/addresses", response_model=list[BranchAddressResponse])
async def list_branch_addresses(branch_id: int, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    _get_branch_or_404(branch_id, db)
    return db.query(BranchAddress).filter(BranchAddress.branch_id == branch_id).order_by(BranchAddress.id).all()


@router.post("/{branch_id}/addresses", response_model=BranchAddressResponse)
async def create_branch_address(branch_id: int, payload: BranchAddressCreate, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    _get_branch_or_404(branch_id, db)
    if payload.is_primary:
        db.query(BranchAddress).filter(BranchAddress.branch_id == branch_id).update({"is_primary": False})
    address = BranchAddress(branch_id=branch_id, **payload.model_dump())
    db.add(address)
    db.commit()
    db.refresh(address)
    return address


@router.patch("/{branch_id}/addresses/{address_id}", response_model=BranchAddressResponse)
async def update_branch_address(branch_id: int, address_id: int, payload: BranchAddressUpdate, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    address = db.query(BranchAddress).filter(BranchAddress.id == address_id, BranchAddress.branch_id == branch_id).first()
    if not address:
        raise HTTPException(status_code=404, detail="Address not found")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_primary"):
        db.query(BranchAddress).filter(BranchAddress.branch_id == branch_id, BranchAddress.id != address_id).update({"is_primary": False})
    for field, value in data.items():
        setattr(address, field, value)
    db.commit()
    db.refresh(address)
    return address


@router.delete("/{branch_id}/addresses/{address_id}")
async def delete_branch_address(branch_id: int, address_id: int, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    address = db.query(BranchAddress).filter(BranchAddress.id == address_id, BranchAddress.branch_id == branch_id).first()
    if not address:
        raise HTTPException(status_code=404, detail="Address not found")
    db.delete(address)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# User Assignments
# ---------------------------------------------------------------------------

def _assignment_to_response(a: BranchUserAssignment, db: Session) -> BranchUserAssignmentResponse:
    user = db.query(User).filter(User.id == a.user_id).first()
    dept = db.query(Department).filter(Department.id == a.department_id).first() if a.department_id else None
    return BranchUserAssignmentResponse.model_validate(a).model_copy(
        update={"user_name": user.name if user else None, "department_name": dept.name if dept else None}
    )


@router.get("/{branch_id}/user-assignments", response_model=list[BranchUserAssignmentResponse])
async def list_branch_user_assignments(branch_id: int, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    _get_branch_or_404(branch_id, db)
    assignments = db.query(BranchUserAssignment).filter(BranchUserAssignment.branch_id == branch_id).order_by(BranchUserAssignment.id).all()
    return [_assignment_to_response(a, db) for a in assignments]


@router.post("/{branch_id}/user-assignments", response_model=BranchUserAssignmentResponse)
async def create_branch_user_assignment(branch_id: int, payload: BranchUserAssignmentCreate, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    _get_branch_or_404(branch_id, db)
    if payload.is_primary_branch:
        db.query(BranchUserAssignment).filter(
            BranchUserAssignment.user_id == payload.user_id, BranchUserAssignment.is_primary_branch == True  # noqa: E712
        ).update({"is_primary_branch": False})
    assignment = BranchUserAssignment(branch_id=branch_id, **payload.model_dump())
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return _assignment_to_response(assignment, db)


@router.patch("/{branch_id}/user-assignments/{assignment_id}", response_model=BranchUserAssignmentResponse)
async def update_branch_user_assignment(branch_id: int, assignment_id: int, payload: BranchUserAssignmentUpdate, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    assignment = db.query(BranchUserAssignment).filter(BranchUserAssignment.id == assignment_id, BranchUserAssignment.branch_id == branch_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_primary_branch"):
        db.query(BranchUserAssignment).filter(
            BranchUserAssignment.user_id == (data.get("user_id") or assignment.user_id),
            BranchUserAssignment.id != assignment_id,
            BranchUserAssignment.is_primary_branch == True,  # noqa: E712
        ).update({"is_primary_branch": False})
    for field, value in data.items():
        setattr(assignment, field, value)
    db.commit()
    db.refresh(assignment)
    return _assignment_to_response(assignment, db)


@router.delete("/{branch_id}/user-assignments/{assignment_id}")
async def delete_branch_user_assignment(branch_id: int, assignment_id: int, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    assignment = db.query(BranchUserAssignment).filter(BranchUserAssignment.id == assignment_id, BranchUserAssignment.branch_id == branch_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    db.delete(assignment)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

@router.get("/{branch_id}/documents", response_model=list[BranchDocumentResponse])
async def list_branch_documents(branch_id: int, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    _get_branch_or_404(branch_id, db)
    return db.query(BranchDocument).filter(BranchDocument.branch_id == branch_id).order_by(BranchDocument.id.desc()).all()


@router.post("/{branch_id}/documents", response_model=BranchDocumentResponse)
async def upload_branch_document(
    branch_id: int,
    file: UploadFile = File(...),
    document_type: str = Form(...),
    document_name: str = Form(...),
    document_number: str | None = Form(None),
    issue_date: date | None = Form(None),
    expiry_date: date | None = Form(None),
    issuing_authority: str | None = Form(None),
    version: str | None = Form(None),
    status: str | None = Form(None),
    confidentiality: str | None = Form(None),
    tags: str | None = Form(None),
    remarks: str | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    branch = _get_branch_or_404(branch_id, db)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    folder_path = f"{sanitize_folder_name(settings.SHAREPOINT_FOLDER or 'ERP-media')}/branch-documents/{sanitize_folder_name(branch.name)}"
    result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, file)

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None

    document = BranchDocument(
        branch_id=branch_id,
        document_type=document_type,
        document_name=document_name,
        document_number=document_number,
        issue_date=issue_date,
        expiry_date=expiry_date,
        issuing_authority=issuing_authority,
        version=version,
        status=status,
        filename=result["name"],
        content_type=file.content_type,
        size=result["size"],
        sharepoint_path=result["path"],
        sharepoint_url=result.get("webUrl"),
        confidentiality=confidentiality,
        tags=tag_list,
        remarks=remarks,
        created_by_id=user.id,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.get("/{branch_id}/documents/{document_id}/content")
async def get_branch_document_content(branch_id: int, document_id: int, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    document = db.query(BranchDocument).filter(BranchDocument.id == document_id, BranchDocument.branch_id == branch_id).first()
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


@router.delete("/{branch_id}/documents/{document_id}")
async def delete_branch_document(branch_id: int, document_id: int, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    document = db.query(BranchDocument).filter(BranchDocument.id == document_id, BranchDocument.branch_id == branch_id).first()
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
