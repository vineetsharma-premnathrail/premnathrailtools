import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import require_app_access
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.crm.models.inquiry import Inquiry, InquiryTask, InquiryApproval, Quotation, QuotationLineItem
from app.modules.crm.models.organization import Organization as OrgModel
from app.modules.crm.models.tender import Tender, TenderTask, TenderCompetitor
from app.modules.crm.models.purchase_order import PurchaseOrder
from app.modules.crm.models.discussion import CrmDiscussion
from app.modules.crm.schemas.workflow import (
    TaskCreate, TaskUpdate, InquiryTaskResponse, TenderTaskResponse,
    ApprovalCreate, ApprovalUpdate, InquiryApprovalResponse,
    QuotationCreate, QuotationUpdate, QuotationResponse,
    PurchaseOrderCreate, PurchaseOrderUpdate, PurchaseOrderResponse,
    CompetitorCreate, CompetitorUpdate, TenderCompetitorResponse,
    DiscussionCreate, DiscussionResponse,
)
from app.modules.crm.reports.quotation_pdf import build_quotation_pdf

router = APIRouter(prefix="/crm", tags=["CRM - Workflow"])


def _can_modify(record, user: User) -> bool:
    return user.role == "admin" or record.created_by_id == user.id


# ── Inquiry Tasks ────────────────────────────────────────────────────────

@router.get("/inquiries/{inquiry_id}/tasks", response_model=list[InquiryTaskResponse])
async def list_inquiry_tasks(inquiry_id: int, db: Session = Depends(get_db), _user: User = Depends(require_app_access("crm"))):
    return db.query(InquiryTask).filter(InquiryTask.inquiry_id == inquiry_id, InquiryTask.is_deleted == False).order_by(InquiryTask.id.desc()).all()  # noqa: E712


@router.post("/inquiries/{inquiry_id}/tasks", response_model=InquiryTaskResponse, status_code=201)
async def create_inquiry_task(inquiry_id: int, payload: TaskCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    if not db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=404, detail="Inquiry not found")
    task = InquiryTask(**payload.model_dump(), inquiry_id=inquiry_id, created_by_id=user.id)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.patch("/inquiries/{inquiry_id}/tasks/{task_id}", response_model=InquiryTaskResponse)
async def update_inquiry_task(inquiry_id: int, task_id: int, payload: TaskUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    task = db.query(InquiryTask).filter(InquiryTask.id == task_id, InquiryTask.inquiry_id == inquiry_id, InquiryTask.is_deleted == False).first()  # noqa: E712
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _can_modify(task, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this task.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/inquiries/{inquiry_id}/tasks/{task_id}")
async def delete_inquiry_task(inquiry_id: int, task_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    task = db.query(InquiryTask).filter(InquiryTask.id == task_id, InquiryTask.inquiry_id == inquiry_id, InquiryTask.is_deleted == False).first()  # noqa: E712
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _can_modify(task, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can delete this task.")
    task.is_deleted = True
    task.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Task deleted"}


# ── Tender Tasks ─────────────────────────────────────────────────────────

@router.get("/tenders/{tender_id}/tasks", response_model=list[TenderTaskResponse])
async def list_tender_tasks(tender_id: int, db: Session = Depends(get_db), _user: User = Depends(require_app_access("crm"))):
    return db.query(TenderTask).filter(TenderTask.tender_id == tender_id, TenderTask.is_deleted == False).order_by(TenderTask.id.desc()).all()  # noqa: E712


@router.post("/tenders/{tender_id}/tasks", response_model=TenderTaskResponse, status_code=201)
async def create_tender_task(tender_id: int, payload: TaskCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    if not db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=404, detail="Tender not found")
    task = TenderTask(**payload.model_dump(), tender_id=tender_id, created_by_id=user.id)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.patch("/tenders/{tender_id}/tasks/{task_id}", response_model=TenderTaskResponse)
async def update_tender_task(tender_id: int, task_id: int, payload: TaskUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    task = db.query(TenderTask).filter(TenderTask.id == task_id, TenderTask.tender_id == tender_id, TenderTask.is_deleted == False).first()  # noqa: E712
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _can_modify(task, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this task.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/tenders/{tender_id}/tasks/{task_id}")
async def delete_tender_task(tender_id: int, task_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    task = db.query(TenderTask).filter(TenderTask.id == task_id, TenderTask.tender_id == tender_id, TenderTask.is_deleted == False).first()  # noqa: E712
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _can_modify(task, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can delete this task.")
    task.is_deleted = True
    task.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Task deleted"}


# ── Inquiry Approvals ────────────────────────────────────────────────────

@router.get("/inquiries/{inquiry_id}/approvals", response_model=list[InquiryApprovalResponse])
async def list_inquiry_approvals(inquiry_id: int, db: Session = Depends(get_db), _user: User = Depends(require_app_access("crm"))):
    return db.query(InquiryApproval).filter(InquiryApproval.inquiry_id == inquiry_id).order_by(InquiryApproval.id.desc()).all()


@router.post("/inquiries/{inquiry_id}/approvals", response_model=InquiryApprovalResponse, status_code=201)
async def create_inquiry_approval(inquiry_id: int, payload: ApprovalCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    if not db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=404, detail="Inquiry not found")
    approval = InquiryApproval(**payload.model_dump(), inquiry_id=inquiry_id, created_by_id=user.id, created_at=datetime.now(timezone.utc))
    db.add(approval)
    db.commit()
    db.refresh(approval)
    return approval


@router.patch("/inquiries/{inquiry_id}/approvals/{approval_id}", response_model=InquiryApprovalResponse)
async def update_inquiry_approval(inquiry_id: int, approval_id: int, payload: ApprovalUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    approval = db.query(InquiryApproval).filter(InquiryApproval.id == approval_id, InquiryApproval.inquiry_id == inquiry_id).first()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    if not _can_modify(approval, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this approval.")
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(approval, field, value)
    if updates.get("status") in ("Approved", "Rejected"):
        approval.approved_by_id = user.id
        approval.approved_by_name = user.name or user.email
        approval.approved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(approval)
    return approval


@router.delete("/inquiries/{inquiry_id}/approvals/{approval_id}")
async def delete_inquiry_approval(inquiry_id: int, approval_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    approval = db.query(InquiryApproval).filter(InquiryApproval.id == approval_id, InquiryApproval.inquiry_id == inquiry_id).first()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    if not _can_modify(approval, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can delete this approval.")
    db.delete(approval)
    db.commit()
    return {"message": "Approval deleted"}


# ── Quotations ───────────────────────────────────────────────────────────

@router.get("/inquiries/{inquiry_id}/quotations", response_model=list[QuotationResponse])
async def list_quotations(inquiry_id: int, db: Session = Depends(get_db), _user: User = Depends(require_app_access("crm"))):
    return db.query(Quotation).filter(Quotation.inquiry_id == inquiry_id).order_by(Quotation.id.desc()).all()


def _next_quot_number(db: Session, inquiry: Inquiry) -> str:
    # Every quotation row is its own "quote lineage" now — revisions mutate the row in place
    # (see update_quotation) instead of creating a new one, so this is a simple running count.
    seq = db.query(Quotation).filter(Quotation.inquiry_id == inquiry.id).count() + 1
    suffix = inquiry.universal_id.split("INQ-")[-1] if inquiry.universal_id else str(inquiry.id)
    return f"QT-{suffix}-{seq:02d}"


# Fields a revision is allowed to touch (top-level; line-item unit_price is handled
# separately below). Anything else about a quotation is fixed once created — a bigger change
# means creating a new quotation for the inquiry instead.
QUOTATION_REVISION_FIELDS = {"payment_terms", "valid_until", "delivery_time"}


def _write_quotation_revision(db: Session, quot_id: int, user: User, old_vals: dict, new_vals: dict):
    db.add(AuditLog(
        entity_type="quotation_revision", entity_id=quot_id, action="revision",
        old_value=json.dumps(old_vals, default=str), new_value=json.dumps(new_vals, default=str),
        summary=f"{user.name or user.email} revised: {', '.join(new_vals.keys())}.",
        performed_by_id=user.id,
    ))


@router.post("/inquiries/{inquiry_id}/quotations", response_model=QuotationResponse, status_code=201)
async def create_quotation(inquiry_id: int, payload: QuotationCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    quot_number = _next_quot_number(db, inquiry)
    data = payload.model_dump(exclude={"items"})
    if data.get("quotation_type") == "Export":
        for item in payload.items:
            item.gst_percent = None
    quot = Quotation(
        **data, inquiry_id=inquiry_id, quot_number=quot_number, quot_number_base=quot_number, revision_number=0,
        created_by_id=user.id, created_at=datetime.now(timezone.utc),
    )
    quot.items = [QuotationLineItem(**item.model_dump(), sort_order=i) for i, item in enumerate(payload.items)]
    db.add(quot)
    db.commit()
    db.refresh(quot)
    return quot


@router.patch("/inquiries/{inquiry_id}/quotations/{quot_id}", response_model=QuotationResponse)
async def update_quotation(inquiry_id: int, quot_id: int, payload: QuotationUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    quot = db.query(Quotation).filter(Quotation.id == quot_id, Quotation.inquiry_id == inquiry_id).first()
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if not _can_modify(quot, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can revise this quotation.")

    updates = payload.model_dump(exclude_unset=True, exclude={"items"})
    old_vals: dict = {}
    new_vals: dict = {}
    for field, value in updates.items():
        if field in QUOTATION_REVISION_FIELDS and str(getattr(quot, field, None)) != str(value):
            old_vals[field] = getattr(quot, field, None)
            new_vals[field] = value
        setattr(quot, field, value)

    if payload.items:
        items_by_id = {it.id: it for it in quot.items}
        for upd in payload.items:
            item = items_by_id.get(upd.id)
            if not item or upd.unit_price is None or item.unit_price == upd.unit_price:
                continue
            old_vals[f"item_{item.id}_unit_price"] = f"{item.description or 'Item'}: {item.unit_price}"
            new_vals[f"item_{item.id}_unit_price"] = f"{item.description or 'Item'}: {upd.unit_price}"
            item.unit_price = upd.unit_price
            item.subtotal = (item.quantity or 0) * upd.unit_price
            item.total = item.subtotal * (1 + (item.gst_percent or 0) / 100) if quot.quotation_type != "Export" else item.subtotal

    if new_vals:
        quot.revision_number += 1
        quot.quot_number = f"{quot.quot_number_base or quot.quot_number}-r{quot.revision_number}"
        _write_quotation_revision(db, quot.id, user, old_vals, new_vals)

    db.commit()
    db.refresh(quot)
    return quot


@router.get("/inquiries/{inquiry_id}/quotations/{quot_id}/revisions")
async def list_quotation_revisions(inquiry_id: int, quot_id: int, db: Session = Depends(get_db), _user: User = Depends(require_app_access("crm"))):
    quot = db.query(Quotation).filter(Quotation.id == quot_id, Quotation.inquiry_id == inquiry_id).first()
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "quotation_revision", AuditLog.entity_id == quot_id
    ).order_by(AuditLog.performed_at.asc()).all()
    user_ids = {log.performed_by_id for log in logs if log.performed_by_id}
    user_map: dict[int, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            user_map[u.id] = u.name or u.email or f"User #{u.id}"
    result = []
    for seq, log in enumerate(logs, start=1):
        old_vals = json.loads(log.old_value) if log.old_value else {}
        new_vals = json.loads(log.new_value) if log.new_value else {}
        result.append({
            "id": log.id,
            "revision_id": f"r{seq}",
            "performed_by": user_map.get(log.performed_by_id, "System") if log.performed_by_id else "System",
            "performed_at": log.performed_at.isoformat() if log.performed_at else None,
            "changes": [
                {"field": f, "old": old_vals.get(f), "new": new_vals.get(f)}
                for f in new_vals.keys()
            ],
        })
    result.reverse()
    return result


@router.get("/inquiries/{inquiry_id}/quotations/{quot_id}/pdf")
async def download_quotation_pdf(inquiry_id: int, quot_id: int, db: Session = Depends(get_db), _user: User = Depends(require_app_access("crm"))):
    quot = db.query(Quotation).filter(Quotation.id == quot_id, Quotation.inquiry_id == inquiry_id).first()
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id).first()
    org = db.query(OrgModel).filter(OrgModel.id == inquiry.org_id).first() if inquiry else None
    client_address_parts = [p for p in [org.address if org else None, org.city if org else None, org.state if org else None, org.pin_code if org else None] if p]
    ctx = {
        "quot_number": quot.quot_number,
        "revision_number": quot.revision_number,
        "quotation_type": quot.quotation_type,
        "gst_type": quot.gst_type,
        "quote_date": quot.quote_date.isoformat() if quot.quote_date else None,
        "technical_offer_number": quot.technical_offer_number,
        "technical_offer_date": quot.technical_offer_date.isoformat() if quot.technical_offer_date else None,
        "client_name": quot.client_name,
        "client_address": ", ".join(client_address_parts) or None,
        "client_gst_number": org.gst_number if org else None,
        "client_contact_name": quot.client_contact_name,
        "client_contact_email": quot.client_contact_email,
        "client_contact_phone": quot.client_contact_phone,
        "valid_until": quot.valid_until.isoformat() if quot.valid_until else None,
        "delivery_time": quot.delivery_time,
        "payment_terms": quot.payment_terms,
        "notes": quot.notes,
        "discount": getattr(quot, "discount", None),
        "discount_type": getattr(quot, "discount_type", None),
        "quote_conditions": getattr(quot, "quote_conditions", None),
        "currency_symbol": "$" if quot.quotation_type == "Export" else "Rs.",
        "items": [
            {
                "description": item.description,
                "model_number": item.model_number,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "gst_percent": item.gst_percent,
                "subtotal": item.subtotal,
                "total": item.total,
            }
            for item in quot.items
        ],
    }
    buf = build_quotation_pdf(ctx)
    filename = f"{quot.quot_number or f'Quotation-{quot.id}'}.pdf"
    return Response(
        content=buf.getvalue(), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/inquiries/{inquiry_id}/quotations/{quot_id}")
async def delete_quotation(inquiry_id: int, quot_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    quot = db.query(Quotation).filter(Quotation.id == quot_id, Quotation.inquiry_id == inquiry_id).first()
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can delete this quotation.")
    db.delete(quot)
    db.commit()
    return {"message": "Quotation deleted"}


# ── Purchase Orders (shared by Inquiry & Tender) ────────────────────────

@router.get("/inquiries/{inquiry_id}/purchase-orders", response_model=list[PurchaseOrderResponse])
async def list_inquiry_pos(inquiry_id: int, db: Session = Depends(get_db), _user: User = Depends(require_app_access("crm"))):
    return db.query(PurchaseOrder).filter(PurchaseOrder.inquiry_id == inquiry_id).order_by(PurchaseOrder.id.desc()).all()


@router.post("/inquiries/{inquiry_id}/purchase-orders", response_model=PurchaseOrderResponse, status_code=201)
async def create_inquiry_po(inquiry_id: int, payload: PurchaseOrderCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    if not db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=404, detail="Inquiry not found")
    po = PurchaseOrder(**payload.model_dump(exclude={"inquiry_id", "tender_id"}), inquiry_id=inquiry_id, created_by_id=user.id, created_at=datetime.now(timezone.utc))
    db.add(po)
    db.commit()
    db.refresh(po)
    return po


@router.get("/tenders/{tender_id}/purchase-orders", response_model=list[PurchaseOrderResponse])
async def list_tender_pos(tender_id: int, db: Session = Depends(get_db), _user: User = Depends(require_app_access("crm"))):
    return db.query(PurchaseOrder).filter(PurchaseOrder.tender_id == tender_id).order_by(PurchaseOrder.id.desc()).all()


@router.post("/tenders/{tender_id}/purchase-orders", response_model=PurchaseOrderResponse, status_code=201)
async def create_tender_po(tender_id: int, payload: PurchaseOrderCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    if not db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=404, detail="Tender not found")
    po = PurchaseOrder(**payload.model_dump(exclude={"inquiry_id", "tender_id"}), tender_id=tender_id, created_by_id=user.id, created_at=datetime.now(timezone.utc))
    db.add(po)
    db.commit()
    db.refresh(po)
    return po


@router.patch("/purchase-orders/{po_id}", response_model=PurchaseOrderResponse)
async def update_purchase_order(po_id: int, payload: PurchaseOrderUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if not _can_modify(po, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this purchase order.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(po, field, value)
    db.commit()
    db.refresh(po)
    return po


@router.delete("/purchase-orders/{po_id}")
async def delete_purchase_order(po_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can delete this purchase order.")
    db.delete(po)
    db.commit()
    return {"message": "Purchase order deleted"}


# ── Tender Competitors ───────────────────────────────────────────────────

@router.get("/tenders/{tender_id}/competitors", response_model=list[TenderCompetitorResponse])
async def list_tender_competitors(tender_id: int, db: Session = Depends(get_db), _user: User = Depends(require_app_access("crm"))):
    return db.query(TenderCompetitor).filter(TenderCompetitor.tender_id == tender_id, TenderCompetitor.is_deleted == False).order_by(TenderCompetitor.id.desc()).all()  # noqa: E712


@router.post("/tenders/{tender_id}/competitors", response_model=TenderCompetitorResponse, status_code=201)
async def create_tender_competitor(tender_id: int, payload: CompetitorCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    if not db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=404, detail="Tender not found")
    comp = TenderCompetitor(**payload.model_dump(), tender_id=tender_id, created_by_id=user.id)
    db.add(comp)
    db.commit()
    db.refresh(comp)
    return comp


@router.patch("/tenders/{tender_id}/competitors/{comp_id}", response_model=TenderCompetitorResponse)
async def update_tender_competitor(tender_id: int, comp_id: int, payload: CompetitorUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    comp = db.query(TenderCompetitor).filter(TenderCompetitor.id == comp_id, TenderCompetitor.tender_id == tender_id, TenderCompetitor.is_deleted == False).first()  # noqa: E712
    if not comp:
        raise HTTPException(status_code=404, detail="Competitor not found")
    if not _can_modify(comp, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this competitor entry.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(comp, field, value)
    db.commit()
    db.refresh(comp)
    return comp


@router.delete("/tenders/{tender_id}/competitors/{comp_id}")
async def delete_tender_competitor(tender_id: int, comp_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    comp = db.query(TenderCompetitor).filter(TenderCompetitor.id == comp_id, TenderCompetitor.tender_id == tender_id, TenderCompetitor.is_deleted == False).first()  # noqa: E712
    if not comp:
        raise HTTPException(status_code=404, detail="Competitor not found")
    if not _can_modify(comp, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can delete this competitor entry.")
    comp.is_deleted = True
    comp.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Competitor deleted"}


# ── Discussions (inquiry & tender) ───────────────────────────────────────

@router.get("/inquiries/{inquiry_id}/discussions", response_model=list[DiscussionResponse])
async def list_inquiry_discussions(inquiry_id: int, db: Session = Depends(get_db), _user: User = Depends(require_app_access("crm"))):
    return db.query(CrmDiscussion).filter(
        CrmDiscussion.related_module == "inquiry", CrmDiscussion.related_id == inquiry_id
    ).order_by(CrmDiscussion.created_at.asc()).all()


@router.post("/inquiries/{inquiry_id}/discussions", response_model=DiscussionResponse, status_code=201)
async def create_inquiry_discussion(inquiry_id: int, payload: DiscussionCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    inquiry = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    msg = CrmDiscussion(
        **payload.model_dump(), related_module="inquiry", related_id=inquiry_id, universal_id=inquiry.universal_id,
        sent_by_id=user.id, sent_by_name=user.name or user.email, created_at=datetime.now(timezone.utc),
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


@router.get("/tenders/{tender_id}/discussions", response_model=list[DiscussionResponse])
async def list_tender_discussions(tender_id: int, db: Session = Depends(get_db), _user: User = Depends(require_app_access("crm"))):
    return db.query(CrmDiscussion).filter(
        CrmDiscussion.related_module == "tender", CrmDiscussion.related_id == tender_id
    ).order_by(CrmDiscussion.created_at.asc()).all()


@router.post("/tenders/{tender_id}/discussions", response_model=DiscussionResponse, status_code=201)
async def create_tender_discussion(tender_id: int, payload: DiscussionCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("crm"))):
    tender = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first()  # noqa: E712
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    msg = CrmDiscussion(
        **payload.model_dump(), related_module="tender", related_id=tender_id, universal_id=tender.universal_id,
        sent_by_id=user.id, sent_by_name=user.name or user.email, created_at=datetime.now(timezone.utc),
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg
