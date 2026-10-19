"""Design / Electrical / Hydraulic & Pneumatic › Requirements — the
department side of an R&D requirement share (services/requirement_shares.py).

The department sees what R&D shared with it: the requirement (read-only, from
CRM), the files CRM sent with the Technical Offer Request, R&D's own
documents, and R&D's note. It answers once per share — feasible / feasible
with changes / not feasible, remarks and files. Gated per department on the
Permission Matrix (`<department>:requirements` view / edit), not on the R&D
app: department engineers usually have no R&D access.

Tasks, documents (with per-department visibility) and the discussion are
worked through /requirement-work and /requirement-discussion, which let a
shared department in (services/requirement_access.py).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permission_registry import can_perform
from app.core.permissions import ensure_tab_action
from app.db.session import get_db
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization
from app.modules.crm.models.tender import Tender
from app.modules.crm.services.requirement_movement import today_ist
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.rnd.models.requirement_work import RND_SHARE_RESPONSES, RndRequirementDocVisibility, RndRequirementShare
from app.modules.rnd.routes.requirement_work import REQ_DOC, _doc_dict, _name, _ref, _store_files
from app.modules.rnd.routes.requirements import requirement_summary
from app.modules.rnd.services import requirement_access as ra
from app.modules.rnd.services import requirement_shares as rs
from app.utils.notifications import notify_user
from app.utils.sharepoint import download_file_content, get_download_url

router = APIRouter(prefix="/department-requirements", tags=["R&D Requirements for Departments"])


def _record(db: Session, source: str, record_id: int):
    model = Inquiry if source == "inquiry" else Tender
    return db.query(model).filter(model.id == record_id, model.is_deleted == False).first()  # noqa: E712


def _share(db: Session, department: str, share_id: int) -> RndRequirementShare:
    share = db.query(RndRequirementShare).filter(RndRequirementShare.id == share_id).first()
    if not share or share.department != department:
        raise HTTPException(status_code=404, detail=f"This requirement wasn't shared with {rs.label(department)} (or the share was removed) — "
                                                    "open it from the Requirements list.")
    return share


def _shared_docs(db: Session, share: RndRequirementShare) -> list[dict]:
    """Files the department may open: what CRM sent with the Technical Offer
    Request, R&D's own requirement documents, and this department's replies.
    R&D task files, discussions and CRM-internal files stay with R&D."""
    docs = db.query(CrmDocument).filter(
        CrmDocument.related_module == share.source, CrmDocument.related_id == share.record_id, CrmDocument.is_deleted == False,  # noqa: E712
    ).order_by(CrmDocument.id.desc()).all()
    dept_share_ids = {s.id for s in db.query(RndRequirementShare.id).filter(
        RndRequirementShare.source == share.source, RndRequirementShare.record_id == share.record_id,
        RndRequirementShare.department == share.department).all()}
    vis = {v.document_id: v for v in db.query(RndRequirementDocVisibility).filter(
        RndRequirementDocVisibility.document_id.in_([d.id for d in docs if d.related_sub_module == REQ_DOC])).all()}
    out = []
    for d in docs:
        if d.related_sub_module == REQ_DOC:
            v = vis.get(d.id)
            # A department's own files stay with it unless it shows them to everyone.
            if v and not v.shared_with_all and v.department != share.department:
                continue
            group, context = "rnd", f"{ra.side_label(v.department if v else ra.RND)} document"
        elif d.related_sub_module == rs.SHARE_DOC and d.related_sub_id in dept_share_ids:
            group, context = "reply", f"{rs.label(share.department)} reply"
        elif d.shared_via_tor and d.related_sub_module not in (rs.SHARE_DOC, "rnd_task", "discussion", "rnd_request"):
            group = "crm"
            context = "Technical Offer Request" if (d.doc_category or "").lower().replace(" ", "_") == "technical_offer_request" else (d.doc_category or "Client document")
        else:
            continue
        out.append({**_doc_dict(d), "group": group, "context": context})
    return out


@router.get("/{department}")
async def list_shared(department: str, include_closed: bool = True, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rs.ensure_can_view(user, department)
    q = db.query(RndRequirementShare).filter(RndRequirementShare.department == department)
    if not include_closed:
        q = q.filter(RndRequirementShare.status == "open")
    shares = q.order_by(RndRequirementShare.id.desc()).all()
    rows = rs.serialize(db, shares)
    inquiries = {i.id: i for i in db.query(Inquiry).filter(Inquiry.id.in_([s.record_id for s in shares if s.source == "inquiry"])).all()}
    tenders = {t.id: t for t in db.query(Tender).filter(Tender.id.in_([s.record_id for s in shares if s.source == "tender"])).all()}
    orgs = {o.id: o.name for o in db.query(Organization).filter(
        Organization.id.in_({r.org_id for r in list(inquiries.values()) + list(tenders.values()) if r.org_id})).all()}
    out = []
    for row in rows:
        record = (inquiries if row["source"] == "inquiry" else tenders).get(row["record_id"])
        if not record or record.is_deleted:
            continue  # requirement deleted in CRM
        out.append({
            **row,
            "universal_id": record.universal_id, "offer_number": record.technical_offer_number,
            "title": (record.product if row["source"] == "inquiry" else record.tender_name) or record.universal_id,
            "org_name": orgs.get(record.org_id),
        })
    return out


@router.get("/{department}/{share_id}")
async def get_shared(department: str, share_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rs.ensure_can_view(user, department)
    share = _share(db, department, share_id)
    record = _record(db, share.source, share.record_id)
    if not record:
        raise HTTPException(status_code=404, detail="The CRM requirement behind this share was deleted, so it can't be opened any more.")
    history = db.query(RndRequirementShare).filter(
        RndRequirementShare.source == share.source, RndRequirementShare.record_id == share.record_id,
        RndRequirementShare.department == department, RndRequirementShare.id != share.id,
    ).order_by(RndRequirementShare.id.desc()).all()
    return {
        "share": rs.serialize(db, [share])[0],
        "requirement": requirement_summary(db, share.source, record),
        "documents": _shared_docs(db, share),
        "history": rs.serialize(db, history),
        "can_respond": share.status == "open" and can_perform(user, department, rs.TAB, "edit"),
    }


@router.post("/{department}/{share_id}/respond")
async def respond(
    department: str,
    share_id: int,
    response: str = Form(...),
    remarks: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rs.ensure_can_view(user, department)
    ensure_tab_action(user, department, rs.TAB, "edit")
    share = _share(db, department, share_id)
    if share.status != "open":
        raise HTTPException(status_code=409, detail="R&D sent a newer request for this requirement — answer that one (it's in your Requirements list)." if share.status == "replaced"
                            else f"{rs.label(department)} already replied ({rs.RESPONSE_LABELS.get(share.response or '', share.response)}). "
                                 "If something changed, ask the R&D head to share the requirement again.")
    if response not in RND_SHARE_RESPONSES:
        raise HTTPException(status_code=422, detail="Pick the reply: Feasible, Feasible with changes, or Not feasible.")
    remarks = (remarks or "").strip() or None
    if response != "feasible" and not remarks:
        raise HTTPException(status_code=422, detail=f"Explain in the remarks {'what has to change' if response == 'feasible_with_changes' else 'why it is not feasible'} — "
                                                    "R&D needs the reason to decide on the technical offer.")
    record = _record(db, share.source, share.record_id)
    if not record:
        raise HTTPException(status_code=404, detail="The CRM requirement behind this share was deleted, so it can't be answered.")
    await _store_files(db, source=share.source, record=record, files=files or [], sub_module=rs.SHARE_DOC, sub_id=share.id,
                       category=f"{department}_feasibility", user=user, folder=f"{department}-feasibility")
    share.status, share.response, share.response_remarks = "responded", response, remarks
    share.responded_by_id, share.responded_at = user.id, datetime.now(timezone.utc)
    ref = _ref(share.source, record)
    verdict = rs.RESPONSE_LABELS[response]
    late = " (after the due date)" if share.due_date and today_ist() > share.due_date else ""
    told = {share.shared_by_id, *ra.head_ids(db)}
    for uid in told:
        notify_user(db, uid, title=f"{rs.label(department)} replied on {ref}: {verdict}",
                    message=f"{_name(user)} ({rs.label(department)}) replied {verdict}{late}." + (f" {remarks}" if remarks else ""),
                    notification_type="rnd_requirement_share_replied", entity_type=f"rnd_req_{share.source}", entity_id=share.record_id)
    from app.modules.rnd.services import events as rnd_events
    rnd_events.requirement_event(
        db, "department_replied", share.source, share.record_id,
        title=f"{rs.label(department)} replied on {ref}: {verdict}",
        message=f"{_name(user)} ({rs.label(department)}) replied {verdict}{late}." + (f" {remarks}" if remarks else ""),
        actor=user, skip_user_ids={u for u in told if u}, background_tasks=background_tasks,
    )
    db.add(AuditLog(entity_type=f"rnd_req_{share.source}", entity_id=share.record_id, action="department_replied", module_key="rnd",
                    summary=f"{_name(user)} ({rs.label(department)}) replied {verdict} on {ref}{late}.", performed_by_id=user.id))
    db.commit()
    return await get_shared(department, share_id, db, user)


def _openable(db: Session, user: User, department: str, document_id: int) -> CrmDocument:
    rs.ensure_can_view(user, department)
    doc = db.query(CrmDocument).filter(CrmDocument.id == document_id, CrmDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail="This document was deleted — refresh the page.")
    shares = db.query(RndRequirementShare).filter(
        RndRequirementShare.source == doc.related_module, RndRequirementShare.record_id == doc.related_id,
        RndRequirementShare.department == department,
    ).all()
    if not shares or not any(d["id"] == doc.id for d in _shared_docs(db, shares[0])):
        raise HTTPException(status_code=403, detail=f"This file wasn't shared with {rs.label(department)}. Ask the R&D head to share the requirement "
                                                    "(or upload the file to R&D's documents) if you need it.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="File storage (SharePoint) isn't configured on the server, so files can't be opened. Ask IT to set SHAREPOINT_SITE_ID.")
    return doc


@router.get("/{department}/documents/{document_id}/content")
async def document_content(department: str, document_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = _openable(db, user, department, document_id)
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path or "")
    return Response(content=content, media_type=doc.mime_type or content_type,
                    headers={"Content-Disposition": f'inline; filename="{doc.file_name}"'})


@router.get("/{department}/documents/{document_id}/download-url")
async def document_download_url(department: str, document_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = _openable(db, user, department, document_id)
    return {"url": await get_download_url(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path or ""), "file_name": doc.file_name}
