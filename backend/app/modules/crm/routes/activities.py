from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.core.permissions import require_app_access
from app.modules.main.models.user import User
from app.modules.crm.models.activity import Activity
from app.modules.crm.models.activity_attachment import ActivityAttachment
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.tender import Tender
from app.modules.crm.models.organization import Organization, OrgContact
from app.modules.crm.schemas.activity import ActivityCreate, ActivityUpdate, ActivityResponse, ActivityAttachmentResponse
from app.modules.crm.reports.mom_docx import build_mom_docx, mom_rows_from_activity
from app.utils.sharepoint import upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint, download_file_content

router = APIRouter(prefix="/crm/activities", tags=["CRM - Activities"])


def _can_modify(record, user: User) -> bool:
    return user.role == "admin" or record.created_by_id == user.id


@router.get("/team-members")
async def list_team_members(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    """Lightweight internal-user lookup (name + designation) for the MOM
    export's "PEW Member Present" picker — avoids re-typing attendee names
    that already live on the user's profile."""
    users = db.query(User).filter(User.is_active == True).order_by(User.name).all()  # noqa: E712
    return [{"id": u.id, "name": u.name, "designation": u.designation} for u in users]


def _enrich(db: Session, activities: list[Activity]) -> list[ActivityResponse]:
    """Attach display-only fields the org/inquiry Activities tabs need to show
    "who" and "which record" without a client-side round trip per activity:
    contact name(s) and a human label for the linked Inquiry/Tender. Activity
    only stores raw ids (org_contact_id/contact_ids/related_id) — the
    frontend used to resolve org_contact_id itself, but that breaks for
    activities whose org_id is a stale snapshot (see below), since it fetches
    contacts scoped to the *current* org_id, not necessarily the one the
    activity's contact actually belongs to."""
    contact_ids = {a.org_contact_id for a in activities if a.org_contact_id}
    for a in activities:
        contact_ids.update(a.contact_ids or [])
    contacts_by_id = {}
    if contact_ids:
        contacts_by_id = {c.id: c.name for c in db.query(OrgContact).filter(OrgContact.id.in_(contact_ids)).all()}

    inquiry_ids = {a.related_id for a in activities if a.related_module == "inquiry" and a.related_id}
    tender_ids = {a.related_id for a in activities if a.related_module == "tender" and a.related_id}
    inquiry_labels = {i.id: i.universal_id for i in db.query(Inquiry).filter(Inquiry.id.in_(inquiry_ids)).all()} if inquiry_ids else {}
    tender_labels = {t.id: t.universal_id for t in db.query(Tender).filter(Tender.id.in_(tender_ids)).all()} if tender_ids else {}

    creator_ids = {a.created_by_id for a in activities if a.created_by_id}
    creators_by_id: dict[int, str] = {}
    if creator_ids:
        creators_by_id = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(creator_ids)).all()}

    activity_ids = [a.id for a in activities]
    attachments_by_activity: dict[int, list[ActivityAttachment]] = {aid: [] for aid in activity_ids}
    if activity_ids:
        for att in db.query(ActivityAttachment).filter(ActivityAttachment.activity_id.in_(activity_ids)).order_by(ActivityAttachment.id.asc()).all():
            attachments_by_activity[att.activity_id].append(att)

    results = []
    for a in activities:
        resp = ActivityResponse.model_validate(a)
        names = [contacts_by_id[cid] for cid in (a.contact_ids or []) if cid in contacts_by_id]
        if a.org_contact_id and a.org_contact_id in contacts_by_id and contacts_by_id[a.org_contact_id] not in names:
            names.insert(0, contacts_by_id[a.org_contact_id])
        resp.contact_names = names
        if a.related_module == "inquiry":
            resp.related_label = inquiry_labels.get(a.related_id)
        elif a.related_module == "tender":
            resp.related_label = tender_labels.get(a.related_id)
        resp.attachments = [ActivityAttachmentResponse.model_validate(att) for att in attachments_by_activity.get(a.id, [])]
        resp.created_by_name = creators_by_id.get(a.created_by_id)
        results.append(resp)
    return results


@router.get("", response_model=list[ActivityResponse])
async def list_activities(
    search: str | None = None,
    status: str | None = None,
    org_id: int | None = None,
    related_module: str | None = None,
    related_id: int | None = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    query = db.query(Activity).filter(Activity.is_deleted == False)  # noqa: E712
    if status:
        query = query.filter(Activity.status == status)
    if org_id:
        # Activity.org_id is stamped at creation time and can drift from the
        # truth if the parent Inquiry/Tender's org is edited afterwards — so
        # don't trust it alone. Also match any activity logged against an
        # Inquiry/Tender that *currently* belongs to this org, so the
        # Organization's Activities tab shows everything logged under its
        # Inquiries/Tenders even if the Activity row's own org_id is stale.
        org_inquiry_ids = [i for (i,) in db.query(Inquiry.id).filter(Inquiry.org_id == org_id).all()]
        org_tender_ids = [t for (t,) in db.query(Tender.id).filter(Tender.org_id == org_id).all()]
        conditions = [Activity.org_id == org_id]
        if org_inquiry_ids:
            conditions.append(and_(Activity.related_module == "inquiry", Activity.related_id.in_(org_inquiry_ids)))
        if org_tender_ids:
            conditions.append(and_(Activity.related_module == "tender", Activity.related_id.in_(org_tender_ids)))
        query = query.filter(or_(*conditions))
    if related_module:
        query = query.filter(Activity.related_module == related_module)
    if related_id:
        query = query.filter(Activity.related_id == related_id)
    if search:
        like = f"%{search}%"
        query = query.filter((Activity.universal_id.ilike(like)) | (Activity.remarks.ilike(like)))
    activities = query.order_by(Activity.id.desc()).offset(skip).limit(limit).all()
    return _enrich(db, activities)


@router.post("", response_model=ActivityResponse, status_code=201)
async def create_activity(
    payload: ActivityCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    data = payload.model_dump()
    data["mom_items"] = payload.model_dump(mode="json").get("mom_items")
    activity = Activity(**data, created_by_id=user.id)
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return _enrich(db, [activity])[0]


@router.patch("/{activity_id}", response_model=ActivityResponse)
async def update_activity(
    activity_id: int,
    payload: ActivityUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    activity = db.query(Activity).filter(Activity.id == activity_id, Activity.is_deleted == False).first()  # noqa: E712
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if not _can_modify(activity, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this activity.")
    json_data = payload.model_dump(exclude_unset=True, mode="json")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(activity, field, json_data[field] if field == "mom_items" else value)
    db.commit()
    db.refresh(activity)
    return _enrich(db, [activity])[0]


@router.post("/{activity_id}/attachments", response_model=ActivityResponse)
async def upload_activity_attachments(
    activity_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    activity = db.query(Activity).filter(Activity.id == activity_id, Activity.is_deleted == False).first()  # noqa: E712
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if not _can_modify(activity, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can add photos to this activity.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    for f in files:
        if not f.content_type or not f.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail=f"'{f.filename}' is not an image — only photos can be attached to an activity.")

    org_name = "General"
    if activity.org_id:
        org = db.query(Organization).filter(Organization.id == activity.org_id).first()
        if org:
            org_name = org.name
    folder_path = build_sharepoint_folder_path(user.name or user.email or "", org_name, f"crm/activity/{activity.id}", root_folder="CRM-media")

    uploaded, failed = [], []
    for f in files:
        try:
            result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
            attachment = ActivityAttachment(
                activity_id=activity.id,
                filename=result["name"],
                content_type=f.content_type,
                size=result["size"],
                sharepoint_path=result["path"],
                sharepoint_url=result.get("webUrl"),
                created_by_id=user.id,
            )
            db.add(attachment)
            uploaded.append(attachment)
        except HTTPException as exc:
            failed.append({"filename": f.filename or "photo", "error": exc.detail})

    if not uploaded and failed:
        raise HTTPException(status_code=502, detail=failed[0]["error"])

    db.commit()
    db.refresh(activity)
    return _enrich(db, [activity])[0]


@router.get("/{activity_id}/attachments/{attachment_id}/content")
async def get_activity_attachment_content(
    activity_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    """Raw bytes for in-app preview, fetched via the app-only Graph token —
    never the raw SharePoint webUrl."""
    attachment = db.query(ActivityAttachment).filter(
        ActivityAttachment.id == attachment_id, ActivityAttachment.activity_id == activity_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Photo not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path or "")
    return Response(
        content=content,
        media_type=attachment.content_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{attachment.filename}"'},
    )


@router.delete("/{activity_id}/attachments/{attachment_id}", response_model=ActivityResponse)
async def delete_activity_attachment(
    activity_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    activity = db.query(Activity).filter(Activity.id == activity_id, Activity.is_deleted == False).first()  # noqa: E712
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if not _can_modify(activity, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can delete photos from this activity.")

    attachment = db.query(ActivityAttachment).filter(
        ActivityAttachment.id == attachment_id, ActivityAttachment.activity_id == activity_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Photo not found")

    if settings.SHAREPOINT_SITE_ID and attachment.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if SharePoint delete fails

    db.delete(attachment)
    db.commit()
    db.refresh(activity)
    return _enrich(db, [activity])[0]


@router.delete("/{activity_id}")
async def delete_activity(
    activity_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    activity = db.query(Activity).filter(Activity.id == activity_id, Activity.is_deleted == False).first()  # noqa: E712
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can delete this activity.")
    activity.is_deleted = True
    activity.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Activity deleted"}


@router.post("/{activity_id}/mom-docx")
async def export_activity_mom(
    activity_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    """One-click MOM export for a single follow-up — no form. Everything
    (subject, date, attendees) is pulled straight from what the user already
    saved on the follow-up itself; there's nothing left to ask them."""
    activity = db.query(Activity).filter(Activity.id == activity_id, Activity.is_deleted == False).first()  # noqa: E712
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    org = db.query(Organization).filter(Organization.id == activity.org_id).first() if activity.org_id else None
    contacts = (
        db.query(OrgContact).filter(OrgContact.id.in_(activity.contact_ids)).all()
        if activity.contact_ids else []
    )
    target = activity.next_followup.strftime("%d.%m.%Y") if activity.next_followup else None

    ctx = {
        "org_name": org.name if org else None,
        "subject": activity.subject,
        "meeting_date": activity.created_at.strftime("%d.%m.%Y") if activity.created_at else "",
        "pew_members": [{"name": activity.assigned_to, "designation": None}] if activity.assigned_to else [],
        "client_members": [{"name": c.name, "designation": c.designation} for c in contacts],
        "activities": mom_rows_from_activity(activity.remarks, activity.action_plan, activity.assigned_to, target),
    }
    buf = build_mom_docx(ctx)

    org_slug = (org.name if org else "Activity").replace(" ", "_").replace("/", "-")
    date_slug = activity.created_at.strftime("%Y%m%d") if activity.created_at else "undated"
    filename = f"MOM_{org_slug}_{date_slug}.docx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
