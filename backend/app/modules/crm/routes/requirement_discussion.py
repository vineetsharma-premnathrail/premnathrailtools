"""Discussion thread on a requirement sent to R&D — shared by CRM (Inquiry /
Tender detail) and R&D (Requirements detail). Messages can @mention people
(they get a bell notification) and carry attachments, which are filed as CRM
documents flagged shared_via_tor so R&D users without CRM access can open
them through /crm/documents/{id}/content. BD can also pick the record's own
Client / Internal documents; those are shared as pointers to the same file.

Opens only once the record is sent to R&D (technical_offer_sent_at set).
Access: CRM side needs the 'crm' app; R&D side needs the 'rnd' app + the
Requirements sub-tab and only sees records actually sent to R&D. Departments
the R&D head shared the requirement with (Design / Electrical / Hydraulic &
Pneumatic, `<department>:requirements` view) take part as their own side."""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from app.core.notify_rules import fire_rule
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.data_scope import ensure_in_scope
import app.modules.crm.access  # noqa: F401 — registers the CRM data-scope models
from app.core.permission_registry import can_view_tab
from app.core.permissions import ensure_feature_action
from app.db.session import get_db
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization
from app.modules.crm.models.requirement_comment import CrmRequirementComment
from app.modules.crm.models.tender import Tender
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.utils.notifications import notify_user
from app.utils.sharepoint import build_sharepoint_folder_path, upload_file_to_sharepoint

router = APIRouter(prefix="/requirement-discussion", tags=["CRM ↔ R&D Discussion"])

Source = Literal["inquiry", "tender"]
Side = Literal["crm", "rnd", "design", "electrical", "hydraulic"]
DEPT_SIDES = ("design", "electrical", "hydraulic")
SIDE_NAMES = {"crm": "BD", "rnd": "R&D", "design": "Design", "electrical": "Electrical", "hydraulic": "Hydraulic & Pneumatic"}

MAX_FILES = 10
MAX_BODY = 5000
DOC_SUB_MODULE = "discussion"


def _has_side(user: User, side: str) -> bool:
    if user.role == "admin":
        return True
    apps = user.get_apps()
    if side == "crm":
        return can_view_tab(user, "crm", "inquiries_tenders")
    if side in DEPT_SIDES:
        return can_view_tab(user, side, "requirements")
    return "rnd" in apps and can_view_tab(user, "rnd", "requirements")


def _record(db: Session, source: str, record_id: int, user: User, side: str):
    if not _has_side(user, side):
        where = "CRM › Inquiries & Tenders" if side == "crm" else f"{SIDE_NAMES[side]} › Requirements"
        raise HTTPException(status_code=403, detail=f"You don't have access to {where}, so you can't open this discussion — ask an admin.")
    model = Inquiry if source == "inquiry" else Tender
    record = db.query(model).filter(model.id == record_id, model.is_deleted == False).first()  # noqa: E712
    if not record:
        raise HTTPException(status_code=404, detail=f"This {source} no longer exists in CRM (it may have been deleted) — refresh the page.")
    if not record.technical_offer_sent_at:
        # The discussion opens only once BD has sent the Technical Requirement to R&D.
        if side == "crm":
            raise HTTPException(status_code=409, detail=f"The discussion opens after this {source} is sent to R&D — click "
                                                        "\"Send Technical Requirement to R&D\" on the record first.")
        raise HTTPException(status_code=404, detail=f"This {source} hasn't been sent to R&D, so there's no R&D discussion for it.")
    if side == "crm":
        # CRM data scope applies to the BD side; the R&D side is governed by R&D › Requirements.
        ensure_feature_action(user, "crm", "inquiries_tenders", "discussion", "view")
        ensure_in_scope(db, user, record)
    else:
        # R&D: only the head(s) and people the head opened this requirement to;
        # a department only once the requirement is shared with it.
        from app.modules.rnd.services import requirement_access as ra  # rnd imports crm models
        if side == "rnd":
            # R&D › Requirements › Discussion (core/features/rnd.py).
            ensure_feature_action(user, "rnd", "requirements", "discussion", "view")
        access = ra.ensure(db, user, source, record_id, "view")
        if side in DEPT_SIDES and side not in access["departments"]:
            raise HTTPException(status_code=403, detail=f"This requirement isn't shared with {SIDE_NAMES[side]}, so {SIDE_NAMES[side]} can't open its discussion. "
                                                        "The R&D head shares it from the requirement's Milestones tab › Departments.")
    return record


FOLDER_NAMES = {"client": "Client", "internal": "Internal"}


def _record_documents(db: Session, source: str, record, side: str, document_ids: str) -> list[CrmDocument]:
    """The record's own Client / Internal documents picked to send with a
    message (BD side only — R&D can't see the CRM Documents tab)."""
    if not document_ids.strip():
        return []
    if side != "crm":
        raise HTTPException(status_code=403, detail="Only the BD (CRM) side can share documents from the record's Documents tab — attach the file instead.")
    try:
        wanted = list(dict.fromkeys(int(x) for x in document_ids.split(",") if x.strip()))
    except ValueError:
        raise HTTPException(status_code=422, detail="The picked documents list is invalid — remove them and pick again.") from None
    docs = {d.id: d for d in db.query(CrmDocument).filter(
        CrmDocument.id.in_(wanted), CrmDocument.related_module == source, CrmDocument.related_id == record.id,
        CrmDocument.folder_type.in_(tuple(FOLDER_NAMES)), CrmDocument.is_deleted == False,  # noqa: E712
    ).all()}
    if len(docs) != len(wanted):
        raise HTTPException(status_code=422, detail=f"A picked document was deleted or isn't a Client / Internal document of this {source} — "
                                                    "refresh the page and pick again.")
    return [docs[i] for i in wanted]


# Who can be tagged: the people actually IN these departments (Organization ›
# Department), not everyone holding CRM / R&D access — module access put HR,
# Fluids etc. in the list (2026-10-19). Department name -> side tag.
TAGGABLE_DEPARTMENTS = {"r&d": "rnd", "business development": "crm"}


def _people(db: Session) -> list[tuple[User, str]]:
    """(user, side) for every active member of the R&D and Business Development departments."""
    from app.modules.organization.services.department_membership import user_department

    out = []
    for u in db.query(User).filter(User.is_active == True).order_by(User.name).all():  # noqa: E712
        dept = user_department(db, u)
        name = (dept.name if dept else (u.department or "")).strip().lower()
        if name in TAGGABLE_DEPARTMENTS:
            out.append((u, TAGGABLE_DEPARTMENTS[name]))
    return out


def _serialize(db: Session, comments: list[CrmRequirementComment], user: User) -> list[dict]:
    if not comments:
        return []
    ids = [c.id for c in comments]
    user_ids = {c.author_id for c in comments if c.author_id} | {u for c in comments for u in (c.mentioned_user_ids or [])}
    names = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    docs: dict[int, list[dict]] = {}
    for d in db.query(CrmDocument).filter(
        CrmDocument.related_sub_module == DOC_SUB_MODULE, CrmDocument.related_sub_id.in_(ids),
        CrmDocument.is_deleted == False,  # noqa: E712
    ).order_by(CrmDocument.id).all():
        docs.setdefault(d.related_sub_id, []).append(
            {"id": d.id, "file_name": d.file_name, "file_size": d.file_size, "mime_type": d.mime_type})
    return [{
        "id": c.id, "body": c.body, "side": c.author_side,
        "author_id": c.author_id, "author_name": names.get(c.author_id, "Former user"),
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "mentions": [{"id": i, "name": names.get(i, f"User #{i}")} for i in (c.mentioned_user_ids or [])],
        "attachments": docs.get(c.id, []),
        "can_delete": user.role == "admin" or c.author_id == user.id,
    } for c in comments]


@router.get("/people")
def list_people(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Who can be @mentioned: members of the R&D and Business Development departments."""
    if not any(_has_side(user, s) for s in SIDE_NAMES):
        raise HTTPException(status_code=403, detail="You need CRM, R&D, or a department's Requirements access to use requirement discussions.")
    return [{"id": u.id, "name": u.name or u.email, "email": u.email, "department": u.department, "side": side}
            for u, side in _people(db)]


@router.get("/{source}/{record_id}")
def list_comments(source: Source, record_id: int, side: Side = "crm",
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _record(db, source, record_id, user, side)
    comments = db.query(CrmRequirementComment).filter(
        CrmRequirementComment.source == source, CrmRequirementComment.record_id == record_id,
        CrmRequirementComment.is_deleted == False,  # noqa: E712
    ).order_by(CrmRequirementComment.created_at, CrmRequirementComment.id).all()
    return _serialize(db, comments, user)


@router.post("/{source}/{record_id}")
async def post_comment(
    source: Source,
    record_id: int,
    background_tasks: BackgroundTasks,
    side: Side = Form("crm"),
    body: str = Form(""),
    mention_ids: str = Form(""),
    document_ids: str = Form(""),
    files: list[UploadFile] | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    record = _record(db, source, record_id, user, side)
    if side == "crm":
        # BD side: posting in the discussion is working the Inquiry/Tender
        # (Inquiries & Tenders › Discussion with R&D › Create).
        ensure_feature_action(user, "crm", "inquiries_tenders", "discussion", "create")
    elif side == "rnd":
        ensure_feature_action(user, "rnd", "requirements", "discussion", "create")
    body = (body or "").strip()
    files = [f for f in (files or []) if f and f.filename]
    shared_docs = _record_documents(db, source, record, side, document_ids)
    if not body and not files and not shared_docs:
        raise HTTPException(status_code=422, detail="Write a message or attach a file before sending.")
    if len(body) > MAX_BODY:
        raise HTTPException(status_code=422, detail=f"Message is {len(body)} characters — keep it under {MAX_BODY}, or attach the long text as a file.")
    if len(files) + len(shared_docs) > MAX_FILES:
        raise HTTPException(status_code=422, detail=f"You attached {len(files) + len(shared_docs)} files — send at most {MAX_FILES} per message.")
    if files and not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="File storage (SharePoint) isn't configured on the server, so attachments can't be saved. "
                                                    "Send the message without files, or ask IT to set SHAREPOINT_SITE_ID.")

    mentioned: list[User] = []
    if mention_ids.strip():
        try:
            wanted = list(dict.fromkeys(int(x) for x in mention_ids.split(",") if x.strip()))
        except ValueError:
            raise HTTPException(status_code=422, detail="The tagged people list is invalid — remove the tags and tag them again.") from None
        allowed = {u.id: u for u, _side in _people(db)}
        missing = [i for i in wanted if i not in allowed]
        if missing:
            raise HTTPException(status_code=422, detail="Someone you tagged is deactivated or not in the R&D or Business Development department "
                                                        "(set in Organization › Users) — remove that tag and send again.")
        mentioned = [allowed[i] for i in wanted if i != user.id]

    comment = CrmRequirementComment(
        source=source, record_id=record.id, body=body, author_id=user.id, author_side=side,
        mentioned_user_ids=[u.id for u in mentioned],
    )
    db.add(comment)
    db.flush()

    if files:
        org = db.query(Organization).filter(Organization.id == record.org_id).first()
        folder_path = build_sharepoint_folder_path(
            user.name or user.email or "", org.name if org else "General",
            f"crm/{source}/{record.universal_id or record.id}/discussion", root_folder="CRM-media",
        )
        for f in files:
            result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
            db.add(CrmDocument(
                related_module=source, related_id=record.id,
                related_sub_module=DOC_SUB_MODULE, related_sub_id=comment.id,
                universal_id=record.universal_id, folder_type="technical_offer", doc_category="Discussion",
                file_name=result["name"], file_path=result["path"], sharepoint_path=result["path"],
                sharepoint_url=result.get("webUrl"), file_size=result.get("size"), mime_type=f.content_type,
                description=f"Attached in the requirement discussion by {user.name or user.email}",
                uploaded_by_name=user.name or user.email, org_id=record.org_id, created_by_id=user.id,
                shared_via_tor=True,
            ))

    for d in shared_docs:
        # A pointer to the same SharePoint file, filed under this message and
        # opened to R&D; the original stays as it was in the Documents tab.
        db.add(CrmDocument(
            related_module=source, related_id=record.id,
            related_sub_module=DOC_SUB_MODULE, related_sub_id=comment.id,
            universal_id=record.universal_id, folder_type="technical_offer", doc_category="Discussion",
            file_name=d.file_name, file_path=d.file_path, sharepoint_path=d.sharepoint_path,
            sharepoint_url=d.sharepoint_url, file_size=d.file_size, mime_type=d.mime_type,
            description=f"{FOLDER_NAMES[d.folder_type]} document shared in the requirement discussion by {user.name or user.email}",
            uploaded_by_name=user.name or user.email, org_id=record.org_id, created_by_id=user.id,
            shared_via_tor=True,
        ))

    names = [f.filename for f in files] + [d.file_name for d in shared_docs]
    ref = record.universal_id or f"{source} #{record.id}"
    preview = body[:120] + ("…" if len(body) > 120 else "") if body else f"shared {len(names)} file(s)"
    from app.modules.rnd.services.requirement_access import link_for  # rnd imports crm models
    for u in mentioned:
        # Link each person to the page they can open: CRM users to the CRM record, R&D users to
        # R&D › Requirements, department people to their department's Requirements page.
        to_side = "crm" if _has_side(u, "crm") else "rnd"
        entity_type, entity_id = (source, record.id) if to_side == "crm" else link_for(db, u, source, record.id)
        notify_user(
            db, u.id, f"{user.name or user.email} tagged you",
            f"In the {ref} requirement discussion: {preview}",
            notification_type=f"req_mention_{to_side}_{source}",
            entity_type=entity_type, entity_id=entity_id,
        )
    # Role event (core/events/crm.py) for BD members who can open the record; the
    # @tagged people were told above, and whoever it reached is left out of the rule.
    from app.core.notification_events import notify_event
    from app.modules.crm.access import can_open_record
    tagged = {u.id for u in mentioned}
    reached = notify_event(
        db, background_tasks, "crm", "discussion_message",
        title=f"New message on {ref} — {SIDE_NAMES[side]}",
        message=f"{user.name or user.email} ({SIDE_NAMES[side]}) wrote in the {ref} requirement discussion: {preview}",
        entity_type=source, entity_id=record.id, actor=user, can_open=can_open_record(db, record),
        details=[("Requirement", ref), ("From", f"{user.name or user.email} ({SIDE_NAMES[side]})"), ("Message", body or "—")],
        skip_user_ids=tagged,
    )
    # CRM Settings → "Discussion message" rule (people @tagged above are already told).
    fire_rule(db, background_tasks, "crm", "discussion_message", f"New message on {ref}",
              f"{user.name or user.email} ({SIDE_NAMES[side]}) wrote: {preview}", source, record.id, user,
              [("Requirement", ref), ("From", f"{user.name or user.email} ({SIDE_NAMES[side]})"),
               ("Message", body or "—"), ("Files", ", ".join(names) if names else "—")],
              skip_user_ids=tagged | reached)
    db.commit()
    return _serialize(db, [comment], user)[0]


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = db.query(CrmRequirementComment).filter(CrmRequirementComment.id == comment_id, CrmRequirementComment.is_deleted == False).first()  # noqa: E712
    if not c:
        raise HTTPException(status_code=404, detail="That message was already deleted — refresh the discussion.")
    if user.role != "admin" and c.author_id != user.id:
        raise HTTPException(status_code=403, detail="You can only delete your own messages.")
    now = datetime.now(timezone.utc)
    c.is_deleted = True
    c.deleted_at = now
    for d in db.query(CrmDocument).filter(CrmDocument.related_sub_module == DOC_SUB_MODULE, CrmDocument.related_sub_id == c.id).all():
        d.is_deleted = True
    db.commit()
    return {"message": "Message deleted"}
