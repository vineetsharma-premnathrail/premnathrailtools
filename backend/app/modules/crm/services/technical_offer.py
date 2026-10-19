"""Technical Offer Request (TOR) document — shared by the Inquiry and Tender
"Send Technical Requirement to R&D" flows.

The TOR is a managed Word document (main/services/managed_documents.py): the
BD owner must create it (and may edit it in Word Online) before sending. The
draft's revision is the number of the upcoming send (previous sends + 1), so
every send starts from a fresh draft and a sent draft is never re-used.

On send the PDF that is emailed and stored is SharePoint's PDF of that Word
file; sending without a draft for this send is refused.
"""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.data_scope import ensure_in_scope
from app.core.permissions import ensure_feature_action
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.services import managed_documents
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.tender import Tender
from app.modules.crm.models.organization import Organization, OrgContact
from app.modules.crm.reports.technical_offer_docx import build_technical_offer_docx
from app.modules.crm.services.requirement_movement import ACTION as SENT_ACTION

ENTITY = {"inquiry": "crm_tor_inquiry", "tender": "crm_tor_tender"}
_MODELS = {"inquiry": Inquiry, "tender": Tender}
_PREFIX = {"inquiry": "INQ-", "tender": "TND-"}

# Internal Documents category the sent TOR is filed under (CRM Documents tab).
DOC_CATEGORY = "Technical Offer Request"


def offer_number(module: str, record) -> str:
    suffix = record.universal_id.split(_PREFIX[module])[-1] if record.universal_id else str(record.id)
    return f"TOR-{suffix}"


def send_revision(db: Session, module: str, record_id: int) -> int:
    """1 for the first send, 2 for the first re-send, …"""
    sent = db.query(AuditLog).filter(
        AuditLog.entity_type == f"{module}_tor", AuditLog.entity_id == record_id, AuditLog.action == SENT_ACTION,
    ).count()
    return sent + 1


def build_context(db: Session, module: str, record, user: User, now: datetime | None = None) -> tuple[dict, Organization | None]:
    now = now or datetime.now(timezone.utc)
    org = db.query(Organization).filter(Organization.id == record.org_id).first()
    contact = db.query(OrgContact).filter(OrgContact.id == record.org_contact_id).first() if record.org_contact_id else None
    ctx = {
        "offer_number": offer_number(module, record), "universal_id": record.universal_id,
        "org_name": org.name if org else None, "org_type": org.org_type if org else None,
        "org_address": org.address if org else None, "org_gst_number": org.gst_number if org else None,
        "org_city": org.city if org else None, "org_state": org.state if org else None,
        "contact_name": contact.name if contact else None, "contact_designation": contact.designation if contact else None,
        "contact_department": contact.department if contact else None, "contact_mobile": contact.mobile if contact else None,
        "contact_email": contact.email if contact else None,
        "raised_by": user.name or user.email,
        "raised_at": now.strftime("%d %b %Y, %I:%M %p"),
    }
    if module == "inquiry":
        ctx.update({
            "product_category": record.product_category, "product": record.product,
            "quantity_display": f"{record.quantity:g}" if record.quantity is not None else None,
            "required_delivery_date": record.required_delivery_date.strftime("%d %b %Y") if record.required_delivery_date else None,
            "delivery_location": record.delivery_location, "warranty_req": record.warranty_req,
            "inspection_req": record.inspection_req, "product_spec": record.product_spec,
            "requirement_desc": record.requirement_desc, "project_details": record.project_details,
        })
    else:
        ctx.update({
            "project_details": record.tender_authority,
            "product_category": record.tender_category, "product": record.tender_name,
            "quantity_display": f"{record.currency} {record.tender_value:,.2f}" if record.tender_value is not None else None,
            "inspection_req": None, "product_spec": None, "requirement_desc": record.reason_no_participate,
        })
    return ctx, org


async def send_pdf(db: Session, module: str, record, ctx: dict) -> tuple[bytes, bool]:
    """(pdf bytes, edited_in_word) — the PDF of this send's Word draft. The
    draft is mandatory: CRM creates (and optionally edits) the document first,
    then sends, so R&D always gets exactly the document CRM reviewed."""
    revision = send_revision(db, module, record.id)
    draft = managed_documents.active_for_revision(db, ENTITY[module], record.id, revision)
    if not draft:
        raise HTTPException(
            status_code=400,
            detail="Create the Technical Offer Word document first (\"Create Word\" in this dialog), review or edit it, then press Send. "
                   + ("This is a re-send, so it needs a fresh document for the current requirement." if revision > 1 else ""),
        )
    return await managed_documents.current_pdf(draft), True


def _loader(module: str):
    model = _MODELS[module]
    label = module.capitalize()

    def load(db: Session, record_id: int, user: User, modify: bool) -> managed_documents.DocumentTarget:
        record = db.query(model).filter(model.id == record_id, model.is_deleted == False).first()  # noqa: E712
        if not record:
            raise HTTPException(status_code=404, detail=f"{label} not found or deleted — refresh the page.")
        ensure_in_scope(db, user, record)
        # The TOR Word draft is part of "Send Technical Requirement (TOR) to R&D".
        if modify:
            ensure_feature_action(user, "crm", "inquiries_tenders", "send_tor", "create")
        else:
            ensure_feature_action(user, "crm", "inquiries_tenders", "send_tor", "view")
        number = offer_number(module, record)
        return managed_documents.DocumentTarget(
            entity_id=record.id, revision=send_revision(db, module, record.id),
            title=f"Technical Offer Request {number}",
            folder=managed_documents.sharepoint_folder("CRM-TechnicalOffers", record.universal_id or f"{module}-{record.id}"),
            filename_stem=managed_documents.safe_filename(number),
            build_docx=lambda: build_technical_offer_docx(build_context(db, module, record, user)[0]).getvalue(),
        )
    return load


for _module, _entity in ENTITY.items():
    managed_documents.register(managed_documents.DocumentAdapter(entity_type=_entity, app="crm", load=_loader(_module),
        view_grant="crm:inquiries_tenders.send_tor:view", edit_grant="crm:inquiries_tenders.send_tor:create"))
