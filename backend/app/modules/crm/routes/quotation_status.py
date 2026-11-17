"""Quotation status actions (SAP VA22 status / release): submit for approval,
withdraw, approve / reject / return (central approval engine), send to the
customer, record accepted / lost, admin correction. Content revisions stay on
PATCH /crm/inquiries/{id}/quotations/{qid} (routes/workflow.py) and put the
quotation back to draft. Every action exists twice, same behaviour: under
/crm/inquiries/{id}/quotations/... and under /crm/tenders/{id}/quotations/... (the tender's price bid).
Rules: crm/services/quotation_status.py."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.data_scope import ensure_in_scope
from app.core.permissions import require_feature_action
from app.db.session import get_db
from app.modules.crm.models.inquiry import Inquiry, Quotation
from app.modules.crm.models.tender import Tender
from app.modules.crm.access import STATUS_MONEY_FIELDS, blank, sees_quotation_prices
from app.modules.crm.routes.workflow import _ensure_not_ordered, quotation_out
from app.modules.crm.schemas.workflow import QuotationActionPayload
from app.modules.crm.services import quotation_parent as qparent
from app.modules.crm.services import quotation_status as qs
from app.modules.crm.services.quotation_parent import INQUIRY, TENDER
from app.modules.main.models.user import User
from app.modules.organization.services import approval_engine as engine

router = APIRouter(prefix="/crm", tags=["CRM - Quotation status"])

# Inquiries & Tenders › Quotations feature (core/features/crm.py): submit /
# withdraw = submit; send / accept / lost / reopen = edit (working the offer).
SUBMIT = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "submit"))
EDIT = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "edit"))


def _load(db: Session, kind: str, parent_id: int, quot_id: int, user: User, lock: bool = True) -> tuple[Inquiry | Tender, Quotation]:
    inquiry = qparent.load_live(db, kind, parent_id, user)
    quot = qparent.find_quotation(db, kind, parent_id, quot_id, lock=lock)
    return inquiry, quot


def _done(db: Session, quot: Quotation, user: User) -> dict:
    db.commit()
    db.refresh(quot)
    out = quotation_out(quot, user).model_dump()
    out["status_view"] = _status_view(db, quot, user)
    return out


def _status_view(db: Session, quot: Quotation, user: User) -> dict:
    view = qs.status_view(db, quot, user)
    if sees_quotation_prices(user):
        return view
    # The approval reasons quote the value / discount against the limits — drop them too.
    return {**blank(view, STATUS_MONEY_FIELDS), "approval_reasons": []}


@router.get("/quotations/{quot_id}")
async def quotation_link(quot_id: int, db: Session = Depends(get_db), user: User = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "view"))):
    """Link target (approval inbox / notifications): which inquiry or tender the quotation is on
    (exactly one of inquiry_id / tender_id is set)."""
    quot = db.get(Quotation, quot_id)
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found — it may have been deleted.")
    kind, parent = qparent.parent_of(db, quot)
    if not parent or parent.is_deleted:
        raise HTTPException(status_code=404, detail=(
            f"The {kind} of this quotation was deleted — restore it from the recycle bin to open the quotation."))
    ensure_in_scope(db, user, parent)
    return {"id": quot.id, "inquiry_id": quot.inquiry_id, "tender_id": quot.tender_id,
            "quot_number": quot.quot_number, "status": quot.status}


# Implementations take the parent kind ("inquiry" / "tender"); the routes below are thin wrappers.

def _status(db: Session, user: User, kind: str, parent_id: int, quot_id: int) -> dict:
    _inq, quot = _load(db, kind, parent_id, quot_id, user, lock=False)
    return _status_view(db, quot, user)


def _submit(db: Session, user: User, kind: str, parent_id: int, quot_id: int, background_tasks: BackgroundTasks) -> dict:
    inquiry, quot = _load(db, kind, parent_id, quot_id, user)
    qs.submit(db, quot, inquiry, user, background_tasks)
    return _done(db, quot, user)


def _withdraw(db: Session, user: User, kind: str, parent_id: int, quot_id: int) -> dict:
    inquiry, quot = _load(db, kind, parent_id, quot_id, user)
    qs.withdraw(db, quot, inquiry, user)
    return _done(db, quot, user)


def _decide(db: Session, kind: str, parent_id: int, quot_id: int, user: User, decision: str, comment: str | None) -> dict:
    _inq, quot = _load(db, kind, parent_id, quot_id, user)
    if quot.status != "submitted":
        raise HTTPException(status_code=409, detail=f"Quotation {quot.quot_number} is {qs.STATUS_LABEL.get(quot.status, quot.status)}, "
                                                    f"not awaiting approval — reload the {kind}.")
    req = engine.latest_request(db, qs.APPROVAL_ENTITY, quot.id)
    if req is None or req.status != "pending":
        raise HTTPException(status_code=409, detail=f"Quotation {quot.quot_number} has no open approval request — withdraw it and submit again.")
    if decision != "approve" and not (comment or "").strip():
        raise HTTPException(status_code=422, detail="Enter a reason — the quotation's creator sees it and revises the offer.")
    engine.decide(db, req.id, user, decision, comment)
    return _done(db, quot, user)


def _send(db: Session, user: User, kind: str, parent_id: int, quot_id: int, payload: QuotationActionPayload) -> dict:
    inquiry, quot = _load(db, kind, parent_id, quot_id, user)
    qs.send(db, quot, inquiry, user, payload.sent_on)
    return _done(db, quot, user)


def _accept(db: Session, user: User, kind: str, parent_id: int, quot_id: int, payload: QuotationActionPayload) -> dict:
    inquiry, quot = _load(db, kind, parent_id, quot_id, user)
    qs.accept(db, quot, inquiry, user, (payload.comment or "").strip() or None)
    return _done(db, quot, user)


def _lost(db: Session, user: User, kind: str, parent_id: int, quot_id: int, payload: QuotationActionPayload) -> dict:
    inquiry, quot = _load(db, kind, parent_id, quot_id, user)
    qs.mark_lost(db, quot, inquiry, user, payload.comment)
    return _done(db, quot, user)


def _reopen(db: Session, user: User, kind: str, parent_id: int, quot_id: int, payload: QuotationActionPayload) -> dict:
    inquiry, quot = _load(db, kind, parent_id, quot_id, user)
    _ensure_not_ordered(db, quot, "reopened")
    qs.reopen(db, quot, inquiry, user, payload.comment)
    return _done(db, quot, user)


APPROVE = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "approve"))
REJECT = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "reject"))
VIEW = Depends(require_feature_action("crm", "inquiries_tenders", "quotations", "view"))


# ── Inquiry quotations ──

@router.get("/inquiries/{inquiry_id}/quotations/{quot_id}/status")
async def quotation_status(inquiry_id: int, quot_id: int, db: Session = Depends(get_db), user: User = VIEW):
    return _status(db, user, INQUIRY, inquiry_id, quot_id)


@router.post("/inquiries/{inquiry_id}/quotations/{quot_id}/submit")
async def submit_quotation(inquiry_id: int, quot_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = SUBMIT):
    return _submit(db, user, INQUIRY, inquiry_id, quot_id, background_tasks)


@router.post("/inquiries/{inquiry_id}/quotations/{quot_id}/withdraw")
async def withdraw_quotation(inquiry_id: int, quot_id: int, db: Session = Depends(get_db), user: User = SUBMIT):
    return _withdraw(db, user, INQUIRY, inquiry_id, quot_id)


@router.post("/inquiries/{inquiry_id}/quotations/{quot_id}/approve")
async def approve_quotation(inquiry_id: int, quot_id: int, payload: QuotationActionPayload, db: Session = Depends(get_db), user: User = APPROVE):
    return _decide(db, INQUIRY, inquiry_id, quot_id, user, "approve", payload.comment)


@router.post("/inquiries/{inquiry_id}/quotations/{quot_id}/reject")
async def reject_quotation(inquiry_id: int, quot_id: int, payload: QuotationActionPayload, db: Session = Depends(get_db), user: User = REJECT):
    return _decide(db, INQUIRY, inquiry_id, quot_id, user, "reject", payload.comment)


@router.post("/inquiries/{inquiry_id}/quotations/{quot_id}/return")
async def return_quotation(inquiry_id: int, quot_id: int, payload: QuotationActionPayload, db: Session = Depends(get_db), user: User = APPROVE):
    return _decide(db, INQUIRY, inquiry_id, quot_id, user, "return", payload.comment)


@router.post("/inquiries/{inquiry_id}/quotations/{quot_id}/send")
async def send_quotation(inquiry_id: int, quot_id: int, payload: QuotationActionPayload, db: Session = Depends(get_db), user: User = EDIT):
    return _send(db, user, INQUIRY, inquiry_id, quot_id, payload)


@router.post("/inquiries/{inquiry_id}/quotations/{quot_id}/accept")
async def accept_quotation(inquiry_id: int, quot_id: int, payload: QuotationActionPayload, db: Session = Depends(get_db), user: User = EDIT):
    return _accept(db, user, INQUIRY, inquiry_id, quot_id, payload)


@router.post("/inquiries/{inquiry_id}/quotations/{quot_id}/lost")
async def lost_quotation(inquiry_id: int, quot_id: int, payload: QuotationActionPayload, db: Session = Depends(get_db), user: User = EDIT):
    return _lost(db, user, INQUIRY, inquiry_id, quot_id, payload)


@router.post("/inquiries/{inquiry_id}/quotations/{quot_id}/reopen")
async def reopen_quotation(inquiry_id: int, quot_id: int, payload: QuotationActionPayload, db: Session = Depends(get_db), user: User = EDIT):
    return _reopen(db, user, INQUIRY, inquiry_id, quot_id, payload)


# ── Tender quotations (the tender's price bid — same actions, same permissions) ──

@router.get("/tenders/{tender_id}/quotations/{quot_id}/status")
async def tender_quotation_status(tender_id: int, quot_id: int, db: Session = Depends(get_db), user: User = VIEW):
    return _status(db, user, TENDER, tender_id, quot_id)


@router.post("/tenders/{tender_id}/quotations/{quot_id}/submit")
async def submit_tender_quotation(tender_id: int, quot_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = SUBMIT):
    return _submit(db, user, TENDER, tender_id, quot_id, background_tasks)


@router.post("/tenders/{tender_id}/quotations/{quot_id}/withdraw")
async def withdraw_tender_quotation(tender_id: int, quot_id: int, db: Session = Depends(get_db), user: User = SUBMIT):
    return _withdraw(db, user, TENDER, tender_id, quot_id)


@router.post("/tenders/{tender_id}/quotations/{quot_id}/approve")
async def approve_tender_quotation(tender_id: int, quot_id: int, payload: QuotationActionPayload, db: Session = Depends(get_db), user: User = APPROVE):
    return _decide(db, TENDER, tender_id, quot_id, user, "approve", payload.comment)


@router.post("/tenders/{tender_id}/quotations/{quot_id}/reject")
async def reject_tender_quotation(tender_id: int, quot_id: int, payload: QuotationActionPayload, db: Session = Depends(get_db), user: User = REJECT):
    return _decide(db, TENDER, tender_id, quot_id, user, "reject", payload.comment)


@router.post("/tenders/{tender_id}/quotations/{quot_id}/return")
async def return_tender_quotation(tender_id: int, quot_id: int, payload: QuotationActionPayload, db: Session = Depends(get_db), user: User = APPROVE):
    return _decide(db, TENDER, tender_id, quot_id, user, "return", payload.comment)


@router.post("/tenders/{tender_id}/quotations/{quot_id}/send")
async def send_tender_quotation(tender_id: int, quot_id: int, payload: QuotationActionPayload, db: Session = Depends(get_db), user: User = EDIT):
    return _send(db, user, TENDER, tender_id, quot_id, payload)


@router.post("/tenders/{tender_id}/quotations/{quot_id}/accept")
async def accept_tender_quotation(tender_id: int, quot_id: int, payload: QuotationActionPayload, db: Session = Depends(get_db), user: User = EDIT):
    return _accept(db, user, TENDER, tender_id, quot_id, payload)


@router.post("/tenders/{tender_id}/quotations/{quot_id}/lost")
async def lost_tender_quotation(tender_id: int, quot_id: int, payload: QuotationActionPayload, db: Session = Depends(get_db), user: User = EDIT):
    return _lost(db, user, TENDER, tender_id, quot_id, payload)


@router.post("/tenders/{tender_id}/quotations/{quot_id}/reopen")
async def reopen_tender_quotation(tender_id: int, quot_id: int, payload: QuotationActionPayload, db: Session = Depends(get_db), user: User = EDIT):
    return _reopen(db, user, TENDER, tender_id, quot_id, payload)
