"""CRM side of the CRM ↔ R&D channel (see crm/services/requirement_movement.py).

Only the lookup CRM needs to open a request lives here — the request itself is
created by the inquiry/tender technical-offer-request endpoints, and R&D
answers through rnd/routes/requirements.py.
"""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.data_scope import ensure_in_scope
from app.core.permissions import require_app_access, require_feature_action
from app.db.session import get_db
from app.modules.crm.access import parent_record
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.organization import Organization
from app.modules.crm.models.rnd_request import CrmRndRequest, CrmRndRequestQuery
from app.modules.crm.services import requirement_movement
from app.modules.main.models.user import User
from app.utils.sharepoint import build_sharepoint_folder_path, upload_file_to_sharepoint

MAX_REPLY_FILES = 10

router = APIRouter(prefix="/crm/rnd-requests", tags=["CRM - R&D Requests"])


@router.get("/assignees")
async def list_rnd_assignees(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    """(Lookup for the Technical Offer Request picker — any CRM user; sending the
    request itself needs Inquiries & Tenders › Edit.) Active users who can open R&D — the only people who could see and answer a request."""
    users = db.query(User).filter(User.is_active == True).order_by(User.name.asc()).all()  # noqa: E712
    return [
        {"id": u.id, "name": u.name or u.email, "email": u.email, "designation": getattr(u, "designation", None)}
        for u in users if "rnd" in u.get_apps()
    ]


@router.post("/{request_id}/queries/{query_id}/answer")
async def answer_rnd_query(
    request_id: int,
    query_id: int,
    answer: str | None = Form(None),
    channel: str | None = Form(None),
    due_date: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("crm", "inquiries_tenders", "send_tor", "create")),
):
    """"Reply to R&D": BD answers R&D's question on the SAME request (no re-send, no new revision).
    `answer` (10+ characters), `channel` (portal / phone / email / meeting), `due_date` (YYYY-MM-DD,
    today or later: R&D's new due date) and optional `files`. R&D is notified; its clock starts again.
    Needs Send Technical Requirement (TOR) to R&D › Create and the inquiry / tender inside the user's data scope."""
    req = db.query(CrmRndRequest).filter(CrmRndRequest.id == request_id).with_for_update().first()  # lock: a parallel R&D response / reply waits
    if not req:
        raise HTTPException(status_code=404, detail="This R&D request no longer exists — refresh the page.")
    record = parent_record(db, req.source, req.record_id)
    if record is None or getattr(record, "is_deleted", False):
        raise HTTPException(status_code=404, detail=f"The CRM {req.source} behind this request was deleted, so R&D's question can't be answered.")
    ensure_in_scope(db, user, record)
    query = db.query(CrmRndRequestQuery).filter(CrmRndRequestQuery.id == query_id, CrmRndRequestQuery.request_id == req.id).first()
    if not query:
        raise HTTPException(status_code=404, detail="This question isn't on this request (or was removed) — refresh the R&D tab.")
    files = [f for f in (files or []) if f and f.filename]
    if len(files) > MAX_REPLY_FILES:
        raise HTTPException(status_code=400, detail=(
            f"{len(files)} files attached — a reply to R&D takes at most {MAX_REPLY_FILES}. "
            "Zip the extra files together, or send the rest by email."))
    due = requirement_movement.parse_answer_date(due_date)
    if files and not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint isn't configured on the server, so documents can't be stored. Ask IT to set SHAREPOINT_SITE_ID, or reply without files.")
    requirement_movement.answer_query(db, req=req, query=query, record=record, user=user, answer=answer, channel=channel, due_date=due)
    if files:
        org = db.query(Organization).filter(Organization.id == record.org_id).first()
        folder_path = build_sharepoint_folder_path(
            user.name or user.email or "", org.name if org else "General",
            f"crm/{req.source}/{record.universal_id or record.id}/rnd-query", root_folder="CRM-media",
        )
        for f in files:
            # Two replies may carry files with the same name: the question id keeps them apart on SharePoint.
            f.filename = f"q{query.id}_{f.filename}"
            result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
            db.add(CrmDocument(
                related_module=req.source, related_id=record.id,
                related_sub_module=requirement_movement.QUERY_DOC_SUB_MODULE, related_sub_id=query.id,
                universal_id=record.universal_id, folder_type="technical_offer",
                doc_category="BD reply to R&D's question",
                file_name=result["name"], file_path=result["path"], sharepoint_path=result["path"],
                sharepoint_url=result.get("webUrl"), file_size=result.get("size"), mime_type=f.content_type,
                description=f"BD reply to R&D's question on {req.offer_number or 'the Technical Offer Request'}",
                uploaded_by_name=user.name or user.email, org_id=record.org_id, created_by_id=user.id,
                shared_via_tor=True,
            ))
    db.commit()
    return requirement_movement.serialize_requests(db, [req])[req.id]
