"""Customer complaints: log → investigate (NCR + CAPA, traceability,
containment) → respond (8D) → customer accepts → close once the CAPA is
closed effective. Tracks response time, repeats and cost.

  open ──start_investigation──▶ under_investigation ──record_response──▶ response_sent
  response_sent ──customer_accepted──▶ customer_accepted ──close (CAPA effective)──▶ closed
  response_sent ──customer_not_satisfied──▶ under_investigation
  open ──reject (not a valid complaint, Quality head)──▶ rejected
"""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.quality.models.capa import QualityCapa
from app.modules.quality.models.customer_complaint import (
    QualityCustomerComplaint, QUALITY_COMPLAINT_SEVERITIES, QUALITY_COMPLAINT_SOURCES, QUALITY_COMPLAINT_STATUS_LABELS,
)
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.quality.models.masters import QualityDefectCode
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.services import access, role_events
from app.modules.quality.services.settings import get_setting, active_master_values
from app.modules.quality.service import generate_complaint_number
from app.modules.store.models.item import StoreItem
from app.utils.notifications import notify_user

# Root cause must be known before the customer gets the 8D answer.
CAPA_READY_FOR_RESPONSE = ("root_cause_found", "actions_in_progress", "effectiveness_check", "closed")


class ComplaintError(ValueError):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clean(v):
    return (v.strip() or None) if isinstance(v, str) else v


def _require(c: QualityCustomerComplaint, statuses: tuple[str, ...], action: str) -> None:
    if c.status not in statuses:
        raise ComplaintError(f"{c.complaint_number} is '{QUALITY_COMPLAINT_STATUS_LABELS.get(c.status, c.status)}', so you "
                             f"can't {action}." + (" Closed complaints are never edited." if c.status == "closed" else ""))


def _find_repeat(db: Session, c: QualityCustomerComplaint) -> QualityCustomerComplaint | None:
    days = int(get_setting(db, "complaint_repeat_days"))
    since = c.complaint_date - timedelta(days=days)
    q = db.query(QualityCustomerComplaint).filter(
        QualityCustomerComplaint.is_deleted == False, QualityCustomerComplaint.id != (c.id or 0),  # noqa: E712
        QualityCustomerComplaint.status != "rejected", QualityCustomerComplaint.complaint_date >= since,
        QualityCustomerComplaint.complaint_date <= c.complaint_date,
        func.lower(QualityCustomerComplaint.customer_name) == c.customer_name.strip().lower(),
    )
    if c.item_id:
        q = q.filter(QualityCustomerComplaint.item_id == c.item_id)
    elif c.item_name:
        q = q.filter(func.lower(QualityCustomerComplaint.item_name) == c.item_name.strip().lower())
    else:
        return None
    return q.order_by(QualityCustomerComplaint.complaint_date.desc()).first()


def _validate(db: Session, data: dict) -> None:
    if "source" in data and data["source"] not in QUALITY_COMPLAINT_SOURCES:
        raise ComplaintError("Source must be one of: " + ", ".join(QUALITY_COMPLAINT_SOURCES) + ".", 422)
    if "severity" in data and data["severity"] not in QUALITY_COMPLAINT_SEVERITIES:
        raise ComplaintError("Severity must be minor, major or critical.", 422)
    if data.get("category"):
        cats = active_master_values(db, "complaint_categories")
        if data["category"] not in cats:
            raise ComplaintError(f"Category '{data['category']}' isn't an active complaint category — pick one of: "
                                 f"{', '.join(cats)} (Quality → Settings → master lists).", 422)
    if data.get("defect_code_id"):
        code = db.query(QualityDefectCode).filter(QualityDefectCode.id == data["defect_code_id"]).first()
        if not code or not code.is_active:
            raise ComplaintError("Pick an active defect code.", 422)
    if data.get("quantity_affected") is not None and data["quantity_affected"] <= 0:
        raise ComplaintError("Quantity affected must be greater than zero.", 422)
    if data.get("erp_project_id"):
        from app.modules.erp.models.project import Project
        if not db.query(Project.id).filter(Project.id == data["erp_project_id"]).first():
            raise ComplaintError(f"Machine / order #{data['erp_project_id']} not found in ERP.", 404)


def _apply_item(db: Session, c: QualityCustomerComplaint, item_id: int | None, item_name: str | None) -> None:
    if item_id:
        item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
        if not item:
            raise ComplaintError(f"Item #{item_id} isn't in the Item Master.", 404)
        c.item_id, c.item_name, c.item_code = item.id, item.item_name, item.item_code
    elif item_name is not None:
        c.item_id, c.item_name = None, _clean(item_name)


def create(db: Session, data: dict, user: User) -> QualityCustomerComplaint:
    _validate(db, data)
    customer = _clean(data.get("customer_name"))
    if not customer and data.get("erp_project_id"):
        from app.modules.erp.models.project import Project
        customer = db.query(Project.client_company).filter(Project.id == data["erp_project_id"]).scalar()
    if not customer:
        raise ComplaintError("Enter the customer (or pick the machine / order it came from).", 422)
    if not _clean(data.get("description")):
        raise ComplaintError("Describe the complaint as the customer reported it.", 422)
    c = QualityCustomerComplaint(
        complaint_number=generate_complaint_number(db), source=data.get("source") or "email",
        source_reference=_clean(data.get("source_reference")), service_ticket_id=data.get("service_ticket_id"),
        customer_name=customer, customer_org_id=data.get("customer_org_id"), erp_project_id=data.get("erp_project_id"),
        contact_person=_clean(data.get("contact_person")), serial_number=_clean(data.get("serial_number")),
        batch_number=_clean(data.get("batch_number")), quantity_affected=data.get("quantity_affected"),
        category=data.get("category"), defect_code_id=data.get("defect_code_id"), description=data["description"].strip(),
        severity=data.get("severity") or "minor", status="open", complaint_date=data.get("complaint_date") or date.today(),
        received_by_id=user.id, owner_id=data.get("owner_id"), remarks=_clean(data.get("remarks")),
    )
    _apply_item(db, c, data.get("item_id"), data.get("item_name"))
    if c.complaint_date > date.today():
        raise ComplaintError("The complaint date can't be in the future.", 422)
    db.add(c)
    db.flush()
    rep = _find_repeat(db, c)
    c.repeat_of_id = rep.id if rep else None
    msg = (f"{c.complaint_number} from {c.customer_name} ({c.severity}): {c.item_name or 'product'}"
           + (f", serial/batch {c.serial_number or c.batch_number}" if (c.serial_number or c.batch_number) else "")
           + f" — {c.description[:140]}" + (f" REPEAT of {rep.complaint_number}." if rep else ""))
    heads = access.quality_heads(db)
    for u in heads:
        if u.id != user.id:
            notify_user(db, user_id=u.id, title="Customer Complaint Received", message=msg,
                        notification_type="quality_complaint_received", entity_type="quality_complaint", entity_id=c.id)
    role_events.fire(db, "complaint_received", record=c, entity_type="quality_complaint", actor=user,
                     skip={u.id for u in heads}, title=f"Customer complaint received: {c.complaint_number}", message=msg)
    return c


_EDITABLE = ("source", "source_reference", "service_ticket_id", "customer_name", "customer_org_id", "erp_project_id",
             "contact_person", "item_id", "item_name", "serial_number", "batch_number", "quantity_affected", "category",
             "defect_code_id", "description", "severity", "complaint_date", "owner_id", "containment_notes",
             "resolution_notes", "remarks", "replacement_cost", "travel_cost", "rework_cost", "other_cost")
_LOCKED_AFTER_INVESTIGATION = ("customer_name", "erp_project_id", "item_id", "item_name", "complaint_date", "source")


def update(db: Session, c: QualityCustomerComplaint, data: dict, user: User) -> QualityCustomerComplaint:
    _require(c, ("open", "under_investigation", "response_sent", "customer_accepted"), "edit it")
    _validate(db, data)
    for k in data:
        if k not in _EDITABLE:
            raise ComplaintError(f"'{k}' can't be changed on a complaint.", 422)
        if c.status != "open" and k in _LOCKED_AFTER_INVESTIGATION and data[k] != getattr(c, k):
            raise ComplaintError(f"{k.replace('_', ' ').capitalize()} is fixed once the investigation started (its NCR / CAPA "
                                 "carry it) — log a new complaint if it was wrong.", 409)
        if k.endswith("_cost") and data[k] is not None and data[k] < 0:
            raise ComplaintError("Costs can't be negative.", 422)
    if "item_id" in data or "item_name" in data:
        _apply_item(db, c, data.get("item_id"), data.get("item_name") if "item_name" in data else c.item_name)
    for k, v in data.items():
        if k in ("item_id", "item_name"):
            continue
        setattr(c, k, _clean(v))
    if c.status == "open":
        rep = _find_repeat(db, c)
        c.repeat_of_id = rep.id if rep else None
    db.flush()
    return c


def start_investigation(db: Session, c: QualityCustomerComplaint, *, owner_id: int | None, user: User) -> QualityCustomerComplaint:
    """Raises the complaint NCR (source complaint) and the CAPA (trigger
    complaint) and moves to investigation."""
    from app.modules.quality.services import ncr as ncr_service, capa as capa_service
    _require(c, ("open",), "start the investigation")
    if not access.is_quality_engineer(user):
        raise ComplaintError("Only a Quality engineer or head can start a complaint investigation.", 403)
    if not (c.item_id or c.item_name):
        raise ComplaintError("Record which item the complaint is about before investigating.", 422)
    owner_id = owner_id or c.owner_id
    if owner_id and not db.query(User.id).filter(User.id == owner_id, User.is_active.is_(True)).first():
        raise ComplaintError("Pick an active user as the complaint owner.", 422)
    try:
        ncr = ncr_service.create_manual(db, {
            "source": "complaint", "severity": c.severity, "item_id": c.item_id, "item_name": c.item_name,
            "item_code": c.item_code, "quantity": c.quantity_affected, "batch_number": c.batch_number or c.serial_number,
            "defect_code_id": c.defect_code_id, "source_reference": c.complaint_number,
            "description": f"Customer complaint {c.complaint_number} from {c.customer_name}: {c.description}",
        }, user)
    except ncr_service.NcrError as e:
        raise ComplaintError(f"Couldn't raise the complaint NCR: {e}", e.status)
    c.owner_id = owner_id
    capa = capa_service.raise_for_complaint(db, c, ncr, user.id)
    if owner_id and not capa.responsible_user_id:
        capa_service.update(db, capa, {"responsible_user_id": owner_id}, user)
    c.ncr_id = ncr.id
    c.capa_id = capa.id
    c.status = "under_investigation"
    c.investigation_started_at = _now()
    db.flush()
    return c


def record_response(db: Session, c: QualityCustomerComplaint, *, response_text: str | None, user: User) -> QualityCustomerComplaint:
    _require(c, ("under_investigation",), "record the customer response")
    if not access.is_quality_engineer(user):
        raise ComplaintError("Only a Quality engineer or head can send the customer response.", 403)
    if not _clean(response_text):
        raise ComplaintError("Write the response sent to the customer (summary of the 8D: root cause, containment, actions).", 422)
    capa = db.query(QualityCapa).filter(QualityCapa.id == c.capa_id).first() if c.capa_id else None
    if capa and capa.status not in CAPA_READY_FOR_RESPONSE:
        raise ComplaintError(f"CAPA {capa.capa_number} has no root cause yet — the customer's 8D response needs D1–D4 done "
                             "(mark the root cause found on the CAPA first).")
    c.response_text = response_text.strip()
    c.response_sent_at = _now()
    c.response_sent_by_id = user.id
    c.status = "response_sent"
    db.flush()
    return c


def customer_feedback(db: Session, c: QualityCustomerComplaint, *, accepted: bool, reference: str | None,
                      remarks: str | None, user: User) -> QualityCustomerComplaint:
    _require(c, ("response_sent",), "record the customer's feedback")
    if not access.is_quality_engineer(user):
        raise ComplaintError("Only a Quality engineer or head can record the customer's feedback.", 403)
    if accepted:
        if not _clean(reference):
            raise ComplaintError("Record how the customer accepted (email / letter reference, name and date).", 422)
        c.customer_accepted_at = _now()
        c.customer_acceptance_reference = reference.strip()
        c.status = "customer_accepted"
    else:
        if not _clean(remarks):
            raise ComplaintError("Record what the customer was not satisfied with.", 422)
        c.remarks = ((c.remarks or "") + f"\nCustomer not satisfied ({_now():%d-%m-%Y}): {remarks.strip()}").strip()
        c.status = "under_investigation"
    db.flush()
    return c


def close(db: Session, c: QualityCustomerComplaint, *, resolution_notes: str | None, user: User) -> QualityCustomerComplaint:
    _require(c, ("customer_accepted",), "close it")
    if not access.can_close_complaint(user):
        raise ComplaintError("Only a Quality head can close a customer complaint.", 403)
    capa = db.query(QualityCapa).filter(QualityCapa.id == c.capa_id).first() if c.capa_id else None
    if capa and not (capa.status == "closed" and capa.effectiveness_result == "effective"):
        raise ComplaintError(f"CAPA {capa.capa_number} isn't closed effective yet (status: {capa.status.replace('_', ' ')}). "
                             "A complaint closes only when the customer accepted and the CAPA proved effective (D8).")
    if _clean(resolution_notes):
        c.resolution_notes = resolution_notes.strip()
    c.status = "closed"
    c.closed_at = _now()
    c.closed_by_id = user.id
    db.flush()
    return c


def reject(db: Session, c: QualityCustomerComplaint, *, reason: str | None, user: User) -> QualityCustomerComplaint:
    _require(c, ("open",), "reject it")
    if not access.can_close_complaint(user):
        raise ComplaintError("Only a Quality head can reject a complaint as not valid.", 403)
    if not _clean(reason):
        raise ComplaintError("Give the reason the complaint is not valid (it is shared with the customer).", 422)
    c.rejection_reason = reason.strip()
    c.status = "rejected"
    c.closed_at = _now()
    c.closed_by_id = user.id
    db.flush()
    return c


def total_cost(c: QualityCustomerComplaint) -> float:
    return round(sum(v or 0 for v in (c.replacement_cost, c.travel_cost, c.rework_cost, c.other_cost)), 2)


def response_days(c: QualityCustomerComplaint) -> int | None:
    if not c.response_sent_at:
        return None
    return (c.response_sent_at.date() - c.complaint_date).days


# ---------------------------------------------------------------------------
# Traceability + containment
# ---------------------------------------------------------------------------

def _keys(c) -> list[str]:
    return [k for k in {(c.batch_number or "").strip(), (c.serial_number or "").strip()} if k]


def traceability(db: Session, *, item_id: int | None, batch: str | None, serial: str | None) -> dict:
    """Serial / batch → inspection lots (with their GRN / vendor or work order
    source), NCRs, first articles, third-party calls, the ERP machine with
    that serial, and dispatches of the batch."""
    keys = [k for k in {(batch or "").strip(), (serial or "").strip()} if k]
    out: dict = {"keys": keys, "lots": [], "ncrs": [], "first_articles": [], "inspection_calls": [], "machines": [],
                 "dispatches": [], "work_orders": [], "grns": []}
    if not keys:
        return out
    lowered = [k.lower() for k in keys]
    lq = db.query(QualityInspectionLot).filter(func.lower(QualityInspectionLot.batch_number).in_(lowered))
    if item_id:
        lq = lq.filter(QualityInspectionLot.item_id == item_id)
    lots = lq.order_by(QualityInspectionLot.id).all()
    for l in lots:
        out["lots"].append({"id": l.id, "lot_number": l.lot_number, "inspection_type": l.inspection_type, "status": l.status,
                            "decision": l.decision, "quantity": l.quantity, "accepted_qty": l.accepted_qty,
                            "rejected_qty": l.rejected_qty, "source_type": l.source_type, "source_reference": l.source_reference,
                            "vendor_name": l.vendor_name, "item_name": l.item_name, "lot_date": l.lot_date.isoformat()})
        if l.source_type == "work_order" and l.source_reference:
            out["work_orders"].append({"wo_number": l.source_reference, "id": l.source_id, "lot_number": l.lot_number})
        if l.source_type == "grn" and l.source_reference:
            out["grns"].append({"grn_number": l.source_reference, "vendor_name": l.vendor_name, "lot_number": l.lot_number})
    nq = db.query(QualityNcr).filter(QualityNcr.is_deleted == False, func.lower(QualityNcr.batch_number).in_(lowered))  # noqa: E712
    if item_id:
        nq = nq.filter(QualityNcr.item_id == item_id)
    out["ncrs"] = [{"id": n.id, "ncr_number": n.ncr_number, "severity": n.severity, "status": n.status, "source": n.source,
                    "quantity": n.quantity, "description": n.description[:200]} for n in nq.order_by(QualityNcr.id).all()]
    from app.modules.quality.models.first_article import QualityFirstArticle
    lot_ids = [l.id for l in lots]
    if lot_ids:
        out["first_articles"] = [{"id": f.id, "fai_number": f.fai_number, "status": f.status, "vendor_name": f.vendor_name}
                                 for f in db.query(QualityFirstArticle).filter(QualityFirstArticle.lot_id.in_(lot_ids)).all()]
    from app.modules.quality.models.inspection_call import QualityInspectionCall
    cq = db.query(QualityInspectionCall).filter(func.lower(QualityInspectionCall.batch_number).in_(lowered))
    if item_id:
        cq = cq.filter(QualityInspectionCall.item_id == item_id)
    out["inspection_calls"] = [{"id": x.id, "call_number": x.call_number, "agency": x.agency, "status": x.status,
                                "result": x.result, "certificate_number": x.certificate_number} for x in cq.all()]
    from app.modules.erp.models.project import Project
    out["machines"] = [{"id": p.id, "serial_number": p.serial_number, "model_name": p.model_name, "client_company": p.client_company,
                        "po_number": p.po_number}
                       for p in db.query(Project).filter(func.lower(Project.serial_number).in_(lowered)).all()]
    out["dispatches"] = dispatches_of(db, item_id=item_id, keys=keys)
    return out


def dispatches_of(db: Session, *, item_id: int | None, keys: list[str]) -> list[dict]:
    from app.modules.erp.models.project import Project
    from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
    q = db.query(StoreMaterialIssue, StoreMaterialIssueItem).join(
        StoreMaterialIssueItem, StoreMaterialIssueItem.issue_id == StoreMaterialIssue.id).filter(
        func.lower(StoreMaterialIssueItem.batch_number).in_([k.lower() for k in keys]))
    if item_id:
        q = q.filter(StoreMaterialIssueItem.item_id == item_id)
    rows = q.order_by(StoreMaterialIssue.issue_date).all()
    projects = {p.id: p for p in db.query(Project).filter(Project.id.in_({i.erp_project_id for i, _ in rows} - {None})).all()}
    out = []
    for issue, line in rows:
        p = projects.get(issue.erp_project_id)
        out.append({"issue_number": issue.issue_number, "issue_type": issue.issue_type, "issue_date": issue.issue_date.isoformat(),
                    "quantity": line.quantity, "batch_number": line.batch_number,
                    "to": (f"{p.client_company or ''} — {p.serial_number}".strip(" —") if p else
                           (issue.vendor_name or issue.project_or_work_order or "internal"))})
    return out


def batch_stock(db: Session, *, item_id: int, keys: list[str]) -> list[dict]:
    """Quantity of the batch still in each store by stock type, from the
    stock ledger (balances aren't kept per batch)."""
    from app.modules.store.models.location import StoreLocation
    from app.modules.store.models.stock_transaction import StoreStockTransaction, STORE_STOCK_TYPE_EFFECT
    rows = db.query(StoreStockTransaction).filter(
        StoreStockTransaction.item_id == item_id,
        func.lower(StoreStockTransaction.batch_number).in_([k.lower() for k in keys]),
    ).all()
    per: dict[int, dict[str, float]] = {}
    for t in rows:
        frm, to = STORE_STOCK_TYPE_EFFECT.get(t.transaction_type, (None, None))
        bucket = per.setdefault(t.location_id, {"free": 0.0, "quality": 0.0, "blocked": 0.0, "vendor": 0.0})
        if frm:
            bucket[frm] -= t.quantity
        if to:
            bucket[to] += t.quantity
    names = {l.id: l.name for l in db.query(StoreLocation).filter(StoreLocation.id.in_(list(per))).all()} if per else {}
    return [{"location_id": lid, "location_name": names.get(lid), **{k: round(v, 4) for k, v in b.items()}}
            for lid, b in per.items() if any(abs(v) > 1e-9 for v in b.values())]


def containment(db: Session, c: QualityCustomerComplaint) -> dict:
    """Other units of the same batch: still in stock (by store and stock type)
    and already delivered (dispatch / issues of that batch)."""
    keys = _keys(c)
    if not keys or not c.item_id:
        return {"keys": keys, "in_stock": [], "delivered": [],
                "note": "Record the item (from the Item Master) and its batch / serial to list the other units to contain."}
    return {"keys": keys, "in_stock": batch_stock(db, item_id=c.item_id, keys=keys),
            "delivered": dispatches_of(db, item_id=c.item_id, keys=keys), "note": None}


def related_open(db: Session, c: QualityCustomerComplaint) -> list[QualityCustomerComplaint]:
    keys = _keys(c)
    if not keys:
        return []
    return db.query(QualityCustomerComplaint).filter(
        QualityCustomerComplaint.id != c.id, QualityCustomerComplaint.is_deleted == False,  # noqa: E712
        or_(func.lower(QualityCustomerComplaint.batch_number).in_([k.lower() for k in keys]),
            func.lower(QualityCustomerComplaint.serial_number).in_([k.lower() for k in keys])),
    ).all()
