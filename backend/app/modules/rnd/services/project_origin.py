"""R&D project origin + source — WHY a Prototype / Research project exists and
the record that proves it.

Origins (RND_PROJECT_ORIGINS) — two since 2026-10-30:
* existing_projects — an existing project / machine (machine_id, PEW serial;
  product_id kept on older projects) is improved for a reason: customer
  complaint / NCR / service report / cost reduction / production difficulty.
  The existing project and the reason are required; the note is optional.
* new_project — new work: who proposed it and why (origin_note) plus an
  attached proposal / management note are required. Optionally the customer
  requirement it answers (a CRM Inquiry / Tender sent to R&D, listed by its R&D
  ID) is linked (source_kind/source_id) and added to the requirement's
  "Linked projects" (rnd_requirement_project_links).

Every linked record must exist and be visible to the user: inquiries and
tenders through R&D's requirement access, complaints / NCRs / service
requests through the user's data scope in that module.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope, ensure_in_scope
from app.modules.main.models.user import User
from app.modules.rnd.models.project import (
    RND_IMPROVEMENT_REASON_LABELS, RND_IMPROVEMENT_REASONS, RND_ORIGIN_LABELS,
    RND_ORIGIN_PROJECT_TYPE, RND_PROJECT_ORIGINS, RND_SOURCE_KINDS, RndProject,
)
from app.modules.rnd.services import requirement_access as ra

ORIGIN_FIELDS = ("origin", "source_kind", "source_id", "improvement_reason", "product_id", "machine_id", "origin_note")

SOURCE_KIND_LABELS = {
    "inquiry": "inquiry", "tender": "tender", "quality_complaint": "customer complaint",
    "ncr": "NCR", "service_request": "service request",
}
# Frontend detail page per source kind; the page adds the signed source_id_ref.
SOURCE_PATHS = {
    "inquiry": "/dashboard/rnd/requirements/inquiry",
    "tender": "/dashboard/rnd/requirements/tender",
    "quality_complaint": "/dashboard/quality/complaints",
    "ncr": "/dashboard/quality/ncr",
    "service_request": "/dashboard/erp/service-requests",
}
OPTION_LIMIT = 20


def _bad(msg: str) -> HTTPException:
    return HTTPException(status_code=400, detail=msg)


def _models():
    from app.modules.crm.models.inquiry import Inquiry
    from app.modules.crm.models.tender import Tender
    from app.modules.erp.models.service_request import ServiceRequest
    from app.modules.quality.models.customer_complaint import QualityCustomerComplaint
    from app.modules.quality.models.ncr import QualityNcr
    # Importing these registers the models with core.data_scope.
    import app.modules.erp.access  # noqa: F401
    import app.modules.quality.services.authz  # noqa: F401
    return {"inquiry": Inquiry, "tender": Tender, "quality_complaint": QualityCustomerComplaint,
            "ncr": QualityNcr, "service_request": ServiceRequest}


def _org_names(db: Session, ids) -> dict[int, str]:
    from app.modules.crm.models.organization import Organization
    ids = {i for i in ids if i}
    return {o.id: o.name for o in db.query(Organization.id, Organization.name).filter(Organization.id.in_(ids)).all()} if ids else {}


def _short(text: str | None, n: int = 70) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= n else text[: n - 1] + "…"


def _rd_numbers(db: Session, kind: str, ids) -> dict[int, str]:
    """record id -> R&D ID (RDR-…) of the requirements among `ids`."""
    from app.modules.rnd.models.requirement import RndRequirement
    ids = [i for i in ids if i]
    if kind not in ("inquiry", "tender") or not ids:
        return {}
    return {r.record_id: r.rd_number for r in db.query(RndRequirement).filter(RndRequirement.source == kind, RndRequirement.record_id.in_(ids)).all()}


def _option(kind: str, rec, orgs: dict[int, str], rd: dict[int, str] | None = None) -> dict:
    """{id, label, sub} — label is also the snapshot stored as source_ref."""
    if kind in ("inquiry", "tender"):
        number = (rd or {}).get(rec.id) or rec.technical_offer_number or rec.universal_id or f"{kind} #{rec.id}"
        what = rec.product if kind == "inquiry" else rec.tender_name
        parts = [number, orgs.get(rec.org_id), _short(what, 60) or None]
        sub = f"{'Inquiry' if kind == 'inquiry' else 'Tender'} {rec.universal_id}" if (rd or {}).get(rec.id) or rec.technical_offer_number else None
    elif kind == "quality_complaint":
        parts = [rec.complaint_number, rec.customer_name, _short(rec.item_name or rec.description, 60)]
        sub = f"Status: {rec.status.replace('_', ' ')} · {rec.complaint_date.strftime('%d-%m-%Y') if rec.complaint_date else ''}".rstrip(" ·")
    elif kind == "ncr":
        parts = [rec.ncr_number, _short(rec.item_name, 60), rec.vendor_name]
        sub = f"Status: {rec.status.replace('_', ' ')} · {_short(rec.description, 80)}"
    else:  # service_request
        parts = [rec.request_number, _short(rec.issue_title, 70)]
        sub = f"Status: {(rec.status or '').replace('_', ' ')}" + (f" · {rec.issue_category}" if rec.issue_category else "")
    label = " · ".join(p for p in parts if p)
    return {"id": rec.id, "label": label[:255], "sub": sub}


def _requirement_visible(db: Session, user: User, kind: str, rec) -> None:
    if not rec.technical_offer_sent_at:
        raise _bad(f"{rec.universal_id} hasn't been sent to R&D yet, so it can't be this project's customer requirement. "
                   f"Ask Sales/BD to use 'Send Technical Offer Request to R&D' on the {kind} first.")
    if not ra.access_for(db, user, kind, rec.id)["view"]:
        raise HTTPException(status_code=403, detail=(
            f"You can't see requirement {rec.technical_offer_number or rec.universal_id}. Ask the R&D head "
            f"({ra._head_names(db)}) to give you a task on it, or pick a requirement you can open."))


def load_source(db: Session, user: User, kind: str, source_id: int) -> tuple[object, dict]:
    """The linked record + its option dict; 400/403/404 with what to do."""
    model = _models()[kind]
    rec = db.query(model).filter(model.id == source_id, model.is_deleted == False).first()  # noqa: E712
    if not rec:
        raise HTTPException(status_code=404, detail=(
            f"The selected {SOURCE_KIND_LABELS[kind]} (#{source_id}) no longer exists — it may have been deleted. "
            "Pick it again from the list."))
    if kind in ("inquiry", "tender"):
        _requirement_visible(db, user, kind, rec)
    else:
        ensure_in_scope(db, user, rec)
    orgs = _org_names(db, [rec.org_id]) if kind in ("inquiry", "tender") else {}
    return rec, _option(kind, rec, orgs, _rd_numbers(db, kind, [rec.id]))


def _product(db: Session, product_id: int):
    from app.modules.products.models.product import FinishedProduct
    p = db.query(FinishedProduct).filter(FinishedProduct.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail=(
            f"Product #{product_id} no longer exists in the product master — pick the product again."))
    return p


def _machine(db: Session, machine_id: int):
    from app.modules.erp.models.project import Project as Machine
    m = db.query(Machine).filter(Machine.id == machine_id, Machine.is_deleted == False).first()  # noqa: E712
    if m is None:
        raise _bad(f"Project / machine #{machine_id} no longer exists — pick the existing project being improved again.")
    return m


def machine_label(m) -> str:
    return " — ".join(x for x in (m.serial_number, m.model_name, m.client_company) if x)


def resolve(db: Session, user: User, data: dict, *, creating: bool, attachment_count: int = 0) -> dict:
    """Validate the origin fields in `data` (the merged final values) and
    return every origin column to set, including project_type and a fresh
    source_ref. Fields that don't apply to the origin are cleared."""
    origin = data.get("origin")
    if not origin:
        raise _bad("Project origin is required — pick why this project exists: Existing Projects or New Project.")
    if origin not in RND_PROJECT_ORIGINS:
        raise _bad(f"Unknown project origin '{origin}'. Pick one of: {', '.join(RND_ORIGIN_LABELS.values())}.")
    note = (data.get("origin_note") or "").strip() or None
    kind = data.get("source_kind") or None
    source_id = data.get("source_id") or None
    reason = data.get("improvement_reason") or None
    product_id = data.get("product_id") or None
    machine_id = data.get("machine_id") or None
    if kind and kind not in RND_SOURCE_KINDS:
        raise _bad(f"Unknown source record type '{kind}'. Valid types: {', '.join(RND_SOURCE_KINDS)}.")

    out = {"origin": origin, "project_type": RND_ORIGIN_PROJECT_TYPE[origin], "origin_note": note,
           "source_kind": None, "source_id": None, "source_ref": None, "improvement_reason": None, "product_id": None,
           "machine_id": None}

    if origin == "existing_projects":
        if not machine_id:
            raise _bad("Pick the existing project being improved (PEW number).")
        out["machine_id"] = _machine(db, machine_id).id
        if not reason:
            raise _bad("Pick the reason for the improvement: customer complaint, NCR, service report, cost reduction or production difficulty.")
        if reason not in RND_IMPROVEMENT_REASONS:
            raise _bad(f"Unknown improvement reason '{reason}'. Pick one of: {', '.join(RND_IMPROVEMENT_REASON_LABELS.values())}.")
        out["improvement_reason"] = reason
    else:  # new_project
        if not note:
            raise _bad("Fill 'Who proposed it and why' — who proposed this new project and the reason for it.")
        if creating and attachment_count < 1:
            raise _bad("Attach at least one proof document in Attachments — the proposal or management note approving this work.")
        if kind or source_id:
            # Optional: the customer requirement this project answers.
            if kind not in ("inquiry", "tender") or not source_id:
                raise _bad("Pick the customer requirement (inquiry or tender sent to R&D) from the list, or clear the field — "
                           "only a requirement can be linked to a new project.")
            _, opt = load_source(db, user, kind, source_id)
            out.update(source_kind=kind, source_id=source_id, source_ref=opt["label"])
        if product_id:
            out["product_id"] = _product(db, product_id).id
    return out


def origin_touched(updates: dict) -> bool:
    return any(k in updates for k in ORIGIN_FIELDS)


def link_requirement(db: Session, user: User, project: RndProject) -> None:
    """Add the customer requirement to the requirement's Linked projects (no duplicate)."""
    from app.modules.main.models.audit_log import AuditLog
    from app.modules.rnd.models.requirement_work import RndRequirementProjectLink
    if project.origin != "new_project" or project.source_kind not in ("inquiry", "tender") or not project.source_id:
        return
    exists = db.query(RndRequirementProjectLink.id).filter(
        RndRequirementProjectLink.source == project.source_kind, RndRequirementProjectLink.record_id == project.source_id,
        RndRequirementProjectLink.project_id == project.id).first()
    if exists:
        return
    db.add(RndRequirementProjectLink(source=project.source_kind, record_id=project.source_id, project_id=project.id,
                                     linked_by_id=user.id, created_at=datetime.now(timezone.utc)))
    who = user.name or user.email
    db.add(AuditLog(entity_type=f"rnd_req_{project.source_kind}", entity_id=project.source_id, action="project_linked", module_key="rnd",
                    summary=f"{who} created R&D project {project.project_number} ({project.title}) for {project.source_ref}.",
                    performed_by_id=user.id))


def display(db: Session, project: RndProject) -> dict:
    """Denormalized origin fields for responses."""
    from app.modules.products.models.product import FinishedProduct
    out = {
        "origin_label": RND_ORIGIN_LABELS.get(project.origin) if project.origin else None,
        "improvement_reason_label": RND_IMPROVEMENT_REASON_LABELS.get(project.improvement_reason) if project.improvement_reason else None,
        "product_name": None, "machine_label": None, "source_path": None, "source_exists": False,
    }
    if getattr(project, "machine_id", None):
        from app.modules.erp.models.project import Project as Machine
        m = db.get(Machine, project.machine_id)
        out["machine_label"] = machine_label(m) if m else None
    if project.product_id:
        p = db.query(FinishedProduct.code, FinishedProduct.name).filter(FinishedProduct.id == project.product_id).first()
        out["product_name"] = f"{p.name} ({p.code})" if p else None
    if project.source_kind in SOURCE_PATHS and project.source_id:
        model = _models()[project.source_kind]
        alive = db.query(model.id).filter(model.id == project.source_id, model.is_deleted == False).first() is not None  # noqa: E712
        out["source_exists"] = alive
        out["source_path"] = SOURCE_PATHS[project.source_kind] if alive else None
    return out


def source_options(db: Session, user: User, kind: str, q: str | None) -> list[dict]:
    """Up to 20 pickable records of `kind` matching `q` that the user may see (machines: all of them).
    kind="product" lists finished products (no Product Management access needed)."""
    q = (q or "").strip()
    like = f"%{q}%"
    if kind == "machine":
        # Existing projects / machines (PEW serials) — what an improvement project improves.
        # Full list, not capped: users scroll the whole PEW series to find the machine.
        from app.modules.erp.models.project import Project as Machine
        query = db.query(Machine).filter(Machine.is_deleted == False)  # noqa: E712
        if q:
            query = query.filter(or_(Machine.serial_number.ilike(like), Machine.model_name.ilike(like), Machine.client_company.ilike(like)))
        return [{"id": m.id, "label": machine_label(m), "sub": m.site_name or None}
                for m in query.order_by(Machine.serial_number.asc()).all()]
    if kind == "product":
        from app.modules.products.models.product import PRODUCT_STATUS_LABELS, FinishedProduct
        query = db.query(FinishedProduct).filter(FinishedProduct.status != "discontinued")
        if q:
            query = query.filter(or_(FinishedProduct.name.ilike(like), FinishedProduct.code.ilike(like), FinishedProduct.model_number.ilike(like)))
        return [{"id": p.id, "label": f"{p.name} ({p.code})", "sub": PRODUCT_STATUS_LABELS.get(p.status, p.status)}
                for p in query.order_by(FinishedProduct.name.asc()).limit(OPTION_LIMIT).all()]
    if kind not in RND_SOURCE_KINDS:
        raise _bad(f"Unknown record type '{kind}'. Valid types: machine, product, {', '.join(RND_SOURCE_KINDS)}.")
    model = _models()[kind]
    query = db.query(model).filter(model.is_deleted == False)  # noqa: E712
    if kind in ("inquiry", "tender"):
        from app.modules.crm.models.organization import Organization
        query = query.filter(model.technical_offer_sent_at.isnot(None))
        keys = ra.visible_keys(db, user)
        if keys is not None:
            ids = [rid for (src, rid) in keys if src == kind]
            if not ids:
                return []
            query = query.filter(model.id.in_(ids))
        if q:
            what = model.product if kind == "inquiry" else model.tender_name
            org_ids = db.query(Organization.id).filter(Organization.name.ilike(like))
            query = query.filter(or_(model.universal_id.ilike(like), model.technical_offer_number.ilike(like),
                                     what.ilike(like), model.org_id.in_(org_ids)))
        rows = query.order_by(model.universal_id.asc()).limit(OPTION_LIMIT).all()
        orgs = _org_names(db, [r.org_id for r in rows])
        rd = _rd_numbers(db, kind, [r.id for r in rows])
        return [_option(kind, r, orgs, rd) for r in rows]
    query = apply_scope(query, user, model, db)
    if kind == "quality_complaint":
        if q:
            query = query.filter(or_(model.complaint_number.ilike(like), model.customer_name.ilike(like),
                                     model.item_name.ilike(like), model.description.ilike(like)))
        rows = query.order_by(model.complaint_date.desc(), model.id.desc()).limit(OPTION_LIMIT).all()
    elif kind == "ncr":
        if q:
            query = query.filter(or_(model.ncr_number.ilike(like), model.item_name.ilike(like), model.description.ilike(like)))
        rows = query.order_by(model.ncr_date.desc(), model.id.desc()).limit(OPTION_LIMIT).all()
    else:
        if q:
            query = query.filter(or_(model.request_number.ilike(like), model.issue_title.ilike(like)))
        rows = query.order_by(model.id.desc()).limit(OPTION_LIMIT).all()
    return [_option(kind, r, {}) for r in rows]
