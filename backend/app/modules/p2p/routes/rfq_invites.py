"""Emailed RFQs (2026-10-22): pick the vendors, the system emails each one
the RFQ with a quote-by date; vendors reply by email; the buyer records each
reply as a line quotation (with the vendor's PDF) and the comparison ranks
L1, L2, L3 … automatically.

    GET  /p2p/rfqs/{id}/invites                      invited vendors, email + quote status
    PUT  /p2p/rfqs/{id}/invites                      draft: vendors, quote-by date, note to vendors
    POST /p2p/rfqs/{id}/invites/add                  locked: invite more vendors (emailed at once)
    POST /p2p/rfqs/{id}/invites/send                 (re)send every unsent / failed email
    POST /p2p/rfqs/{id}/invites/{invite_id}/resend   one vendor again (after fixing its email)
    POST /p2p/rfqs/{id}/invites/remind               reminder to every vendor that hasn't quoted
    GET  /p2p/rfqs/{id}/line-quotations/{vq_id}/files   the vendor's quotation PDFs
    POST /p2p/rfqs/{id}/line-quotations/{vq_id}/files   attach them
"""
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import ensure_feature_action
from app.db.session import get_db
from app.modules.accounts.models.vendor import Vendor
from app.modules.main.models.user import User
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_attachment import RFQAttachment
from app.modules.p2p.models.rfq_invite import RFQVendorInvite
from app.modules.p2p.models.vendor_quotation import VendorQuotation
from app.modules.p2p.rfq_mail import send_invite
from app.modules.p2p.routes.rfq import (
    _assert_editable, _get_rfq_or_404, _purchase_tab, _write_audit, ensure_rfq_owner, ensure_rfq_readable,
)
from app.modules.p2p.schemas.rfq import RFQAttachmentResponse
from app.utils.sharepoint import build_sharepoint_folder_path, upload_file_to_sharepoint

router = APIRouter(prefix="/p2p/rfqs", tags=["P2P - RFQ by email"])


class InviteSetPayload(BaseModel):
    vendor_ids: list[int] = Field(default_factory=list)
    quote_due_date: date | None = None
    invite_message: str | None = None


class InviteAddPayload(BaseModel):
    vendor_ids: list[int] = Field(min_length=1)


def _vendors_or_400(db: Session, ids: list[int]) -> list[Vendor]:
    ids = list(dict.fromkeys(ids))
    vendors = {v.id: v for v in db.query(Vendor).filter(Vendor.id.in_(ids)).all()} if ids else {}
    missing = [i for i in ids if i not in vendors]
    if missing:
        raise HTTPException(status_code=400, detail=f"Vendor(s) #{', #'.join(map(str, missing))} are not in the vendor master — refresh the page and pick again.")
    inactive = [v.name for v in vendors.values() if v.status != "active"]
    if inactive:
        raise HTTPException(status_code=400, detail=f"{', '.join(inactive)} {'is' if len(inactive) == 1 else 'are'} not Active in the vendor master, so "
                                                    "they can't be asked to quote. Set them Active in Procurement › Vendors or pick others.")
    no_email = [v.name for v in vendors.values() if not (v.contact_email or "").strip()]
    if no_email:
        raise HTTPException(status_code=400, detail=f"No email in the vendor master for {', '.join(no_email)} — the RFQ is sent by email. "
                                                    "Add the contact email under Procurement › Vendors, then try again.")
    return [vendors[i] for i in ids]


def _row(inv: RFQVendorInvite, quoted: dict[int, VendorQuotation], due: date | None) -> dict:
    vq = quoted.get(inv.vendor_id)
    if vq is not None:
        status = "quoted"
    elif inv.email_status != "sent":
        status = "not_sent"
    elif due and date.today() > due:
        status = "overdue"
    else:
        status = "waiting"
    return {
        "id": inv.id, "vendor_id": inv.vendor_id, "vendor_name": inv.vendor_name, "email": inv.email,
        "email_status": inv.email_status, "sent_at": inv.sent_at, "send_error": inv.send_error,
        "reminder_sent_at": inv.reminder_sent_at, "quote_status": status,
        "vendor_quotation_id": vq.id if vq else None, "quoted_price": vq.quoted_price if vq else None,
    }


def _invites(db: Session, rfq_id: int) -> list[RFQVendorInvite]:
    return db.query(RFQVendorInvite).filter(RFQVendorInvite.rfq_id == rfq_id).order_by(RFQVendorInvite.id).all()


def _quoted(db: Session, rfq_id: int) -> dict[int, VendorQuotation]:
    return {vq.vendor_id: vq for vq in db.query(VendorQuotation).filter(VendorQuotation.rfq_id == rfq_id).all() if vq.vendor_id}


def _rows(db: Session, rfq: RFQ) -> list[dict]:
    quoted = _quoted(db, rfq.id)
    return [_row(i, quoted, rfq.quote_due_date) for i in _invites(db, rfq.id)]


async def send_invites(db: Session, rfq: RFQ, invites: list[RFQVendorInvite], user: User | None, reminder: bool = False) -> None:
    """Email each invite (refreshing its address from the vendor master) and
    record the outcome on the row. Commits."""
    pr = db.get(P2PRequest, rfq.p2p_request_id)
    # Sent from the mailbox of whoever sends it now; the daily reminder job
    # (no user) sends from the buyer who raised the RFQ.
    buyer = user if user is not None else (db.get(User, rfq.created_by_id) if rfq.created_by_id else None)
    now = datetime.now(timezone.utc)
    for inv in invites:
        vendor = db.get(Vendor, inv.vendor_id)
        if vendor is not None:
            inv.email = (vendor.contact_email or "").strip() or None
            inv.vendor_name = vendor.name
        ok, err = await send_invite(db, rfq, pr, inv, buyer, vendor.contact_name if vendor else None, reminder=reminder)
        if reminder:
            if ok:
                inv.reminder_sent_at = now
        else:
            inv.email_status = "sent" if ok else "failed"
            inv.sent_at = now if ok else inv.sent_at
        inv.send_error = None if ok else err
        if user is not None:
            what = "reminder" if reminder else "RFQ email"
            _write_audit(db, rfq.id, f"{'reminder' if reminder else 'invite'}_{'sent' if ok else 'failed'}", user,
                         summary=f"{what} to {inv.vendor_name} ({inv.email or 'no email'}) " + ("sent." if ok else f"failed: {err}"))
    db.commit()


@router.get("/{rfq_id}/invites")
def list_invites(rfq_id: int, db: Session = Depends(get_db), user: User = Depends(_purchase_tab("rfq", "view"))):
    rfq = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_readable(db, rfq, user)
    return {"quote_due_date": rfq.quote_due_date, "invite_message": rfq.invite_message, "invites": _rows(db, rfq)}


@router.put("/{rfq_id}/invites")
def set_invites(rfq_id: int, payload: InviteSetPayload, db: Session = Depends(get_db), user: User = Depends(_purchase_tab("rfq", "edit"))):
    """While the RFQ is a draft: who gets it, the quote-by date and the note."""
    rfq = _get_rfq_or_404(db, rfq_id, user)
    _assert_editable(rfq, user)
    if rfq.status != "draft":
        raise HTTPException(status_code=409, detail="This RFQ was already sent — use “Invite more vendors” to add someone.")
    if payload.quote_due_date and payload.quote_due_date < date.today():
        raise HTTPException(status_code=400, detail="The quote-by date is in the past — pick today or a later date.")
    vendors = _vendors_or_400(db, payload.vendor_ids)
    for inv in _invites(db, rfq.id):
        db.delete(inv)
    db.flush()
    for v in vendors:
        db.add(RFQVendorInvite(rfq_id=rfq.id, vendor_id=v.id, vendor_name=v.name, email=(v.contact_email or "").strip(),
                               created_by_id=user.id))
    rfq.quote_due_date = payload.quote_due_date
    rfq.invite_message = (payload.invite_message or "").strip() or None
    db.commit()
    return {"quote_due_date": rfq.quote_due_date, "invite_message": rfq.invite_message, "invites": _rows(db, rfq)}


@router.post("/{rfq_id}/invites/add")
async def add_invites(rfq_id: int, payload: InviteAddPayload, db: Session = Depends(get_db), user: User = Depends(_purchase_tab("rfq", "edit"))):
    """After the RFQ went out: ask more vendors (they are emailed at once)."""
    rfq = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_owner(db, rfq, user, "invite vendors to")
    if rfq.status != "locked":
        raise HTTPException(status_code=409, detail="Pick vendors on the draft RFQ form — this one hasn't been sent yet.")
    have = {i.vendor_id for i in _invites(db, rfq.id)}
    vendors = [v for v in _vendors_or_400(db, payload.vendor_ids) if v.id not in have]
    if not vendors:
        raise HTTPException(status_code=400, detail="Every vendor you picked has already been asked to quote on this RFQ.")
    new = [RFQVendorInvite(rfq_id=rfq.id, vendor_id=v.id, vendor_name=v.name, email=(v.contact_email or "").strip(), created_by_id=user.id)
           for v in vendors]
    db.add_all(new)
    db.flush()
    await send_invites(db, rfq, new, user)
    return {"quote_due_date": rfq.quote_due_date, "invite_message": rfq.invite_message, "invites": _rows(db, rfq)}


@router.post("/{rfq_id}/invites/send")
async def send_pending(rfq_id: int, db: Session = Depends(get_db), user: User = Depends(_purchase_tab("rfq", "edit"))):
    rfq = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_owner(db, rfq, user, "email the vendors of")
    if rfq.status != "locked":
        raise HTTPException(status_code=409, detail="Save the RFQ first — saving sends it to the vendors.")
    pending = [i for i in _invites(db, rfq.id) if i.email_status != "sent"]
    if not pending:
        raise HTTPException(status_code=400, detail="Every vendor on this RFQ has already been emailed. Use Resend for one vendor or Remind for all who haven't quoted.")
    await send_invites(db, rfq, pending, user)
    return {"quote_due_date": rfq.quote_due_date, "invite_message": rfq.invite_message, "invites": _rows(db, rfq)}


@router.post("/{rfq_id}/invites/{invite_id}/resend")
async def resend_invite(rfq_id: int, invite_id: int, db: Session = Depends(get_db), user: User = Depends(_purchase_tab("rfq", "edit"))):
    rfq = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_owner(db, rfq, user, "email the vendors of")
    if rfq.status != "locked":
        raise HTTPException(status_code=409, detail="Save the RFQ first — saving sends it to the vendors.")
    inv = db.query(RFQVendorInvite).filter(RFQVendorInvite.id == invite_id, RFQVendorInvite.rfq_id == rfq.id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="That vendor isn't on this RFQ any more — refresh the page.")
    await send_invites(db, rfq, [inv], user)
    return {"quote_due_date": rfq.quote_due_date, "invite_message": rfq.invite_message, "invites": _rows(db, rfq)}


@router.post("/{rfq_id}/invites/remind")
async def remind_invites(rfq_id: int, db: Session = Depends(get_db), user: User = Depends(_purchase_tab("rfq", "edit"))):
    rfq = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_owner(db, rfq, user, "remind the vendors of")
    quoted = _quoted(db, rfq.id)
    waiting = [i for i in _invites(db, rfq.id) if i.email_status == "sent" and i.vendor_id not in quoted]
    if not waiting:
        raise HTTPException(status_code=400, detail="Nobody to remind — every emailed vendor has quoted (or the RFQ wasn't emailed yet).")
    await send_invites(db, rfq, waiting, user, reminder=True)
    return {"quote_due_date": rfq.quote_due_date, "invite_message": rfq.invite_message, "invites": _rows(db, rfq)}


def _vq_or_404(db: Session, rfq: RFQ, vq_id: int) -> VendorQuotation:
    vq = db.query(VendorQuotation).filter(VendorQuotation.id == vq_id, VendorQuotation.rfq_id == rfq.id).first()
    if not vq:
        raise HTTPException(status_code=404, detail="That quotation isn't on this RFQ — refresh the page.")
    return vq


@router.get("/{rfq_id}/line-quotations/{vq_id}/files", response_model=list[RFQAttachmentResponse])
def list_quote_files(rfq_id: int, vq_id: int, db: Session = Depends(get_db), user: User = Depends(_purchase_tab("rfq", "view"))):
    rfq = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_readable(db, rfq, user)
    _vq_or_404(db, rfq, vq_id)
    return db.query(RFQAttachment).filter(RFQAttachment.rfq_id == rfq.id, RFQAttachment.vendor_quotation_id == vq_id).all()


@router.post("/{rfq_id}/line-quotations/{vq_id}/files", response_model=list[RFQAttachmentResponse])
async def upload_quote_files(rfq_id: int, vq_id: int, files: list[UploadFile] = File(...), db: Session = Depends(get_db),
                             user: User = Depends(_purchase_tab("rfq", "edit"))):
    """The vendor's quotation (PDF from their email) on their recorded quote."""
    ensure_feature_action(user, "p2p", "rfq", "vendor_quotes", "create")
    rfq = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_owner(db, rfq, user, "attach quotation files to")
    vq = _vq_or_404(db, rfq, vq_id)
    files = [f for f in files if f and f.filename]
    if not files:
        raise HTTPException(status_code=400, detail="Choose the vendor's quotation file to upload.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="File storage (SharePoint) isn't configured on the server — ask the portal administrator to set SHAREPOINT_SITE_ID.")
    folder = build_sharepoint_folder_path(user.name or user.email or "", "rfq", rfq.rfq_number)
    saved = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, f)
        att = RFQAttachment(rfq_id=rfq.id, vendor_tier="Q", vendor_name=vq.vendor_name, vendor_id=vq.vendor_id,
                            vendor_quotation_id=vq.id, filename=result["name"], content_type=f.content_type,
                            size=result["size"], sharepoint_path=result["path"], sharepoint_url=result.get("webUrl"),
                            created_by_id=user.id)
        db.add(att)
        saved.append(att)
    _write_audit(db, rfq.id, "quote_file_added", user,
                 summary=f"{user.name or user.email} attached {len(saved)} quotation file(s) from {vq.vendor_name}.")
    db.commit()
    for a in saved:
        db.refresh(a)
    return saved
