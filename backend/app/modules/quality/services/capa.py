"""CAPA (8D) workflow and its automatic triggers.

  open / reopened ──(D1 team, D2 problem, D3 containment, D4 root cause)──▶ root_cause_found
  root_cause_found ──(D5 ≥1 corrective action with owner + due date)──▶ actions_in_progress
  actions_in_progress ──(every action done with D6 evidence, D7 prevention
        recorded or "not needed" reason)──▶ effectiveness_check (due after
        Quality → Settings "effectiveness_days")
  effectiveness_check ──(Quality head, on/after the due date: effective)──▶ closed
                      └─(not effective)──▶ reopened (actions superseded, report revision +1)
  closed ──(Quality head, reason)──▶ reopened

Hooks other code calls (flush, never commit):
  on_ncr_raised(db, ncr, user_id)          — Major / Critical NCR and repeat-defect triggers
  raise_for_complaint(db, complaint, ncr, user_id)
  raise_for_vendor(db, vendor_name=, reason=, user_id=, item_id=None)  — rating below On-watch
  raise_for_audit_finding(db, audit_reference=, finding=, severity=, user_id=, item_id=None, vendor_name=None)  — Phase 4
  ncr_closure_problem(db, ncr) -> str | None   — rule 6 for NCR closure
  covering_capas(db, ncr) -> list[QualityCapa]
"""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.quality.models.capa import (
    QualityCapa, QualityCapaAction, QualityCapaNcr, QualityCapaTeamMember,
    QUALITY_CAPA_OPEN_STATUSES, QUALITY_CAPA_STATUS_LABELS, QUALITY_CAPA_TRIGGER_LABELS, QUALITY_CAPA_ACTION_TYPES,
    QUALITY_CAPA_ROOT_CAUSE_METHODS, QUALITY_FISHBONE_CATEGORIES, QUALITY_CAPA_ITEM_KINDS,
    QUALITY_CAPA_PREVENTION_TYPES, QUALITY_CAPA_TEAM_ROLES,
)
from app.modules.quality.models.masters import QualityDefectCode
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.services import access, role_events
from app.modules.quality.services.settings import get_setting
from app.modules.quality.service import generate_capa_number
from app.modules.store.models.item import StoreItem
from app.utils.notifications import notify_user

# A Major / Critical NCR may close once its CAPA has reached at least this
# far (root cause found and corrective actions planned) — the 90-day D8
# effectiveness check must not hold the NCR (and its cost booking) open.
NCR_CLOSE_MIN_STATUSES = ("actions_in_progress", "effectiveness_check", "closed")
_SEV_RANK = {"minor": 1, "major": 2, "critical": 3}


class CapaError(ValueError):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _name(u: User | None) -> str:
    return (u.name or u.email) if u else "—"


def _clean(v) -> str | None:
    v = (v or "").strip() if isinstance(v, str) else v
    return v or None


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

def covering_capas(db: Session, ncr: QualityNcr) -> list[QualityCapa]:
    linked = db.query(QualityCapaNcr.capa_id).filter(QualityCapaNcr.ncr_id == ncr.id)
    return db.query(QualityCapa).filter(
        QualityCapa.is_deleted == False,  # noqa: E712
        or_(QualityCapa.ncr_id == ncr.id, QualityCapa.id.in_(linked)),
    ).order_by(QualityCapa.id).all()


def linked_ncrs(db: Session, capa: QualityCapa) -> list[QualityNcr]:
    ids = {l.ncr_id for l in capa.ncr_links}
    if capa.ncr_id:
        ids.add(capa.ncr_id)
    return db.query(QualityNcr).filter(QualityNcr.id.in_(ids)).order_by(QualityNcr.id).all() if ids else []


def ncr_closure_problem(db: Session, ncr: QualityNcr) -> str | None:
    """Rule 6: a Major / Critical NCR needs a CAPA that has its root cause and
    corrective actions before the NCR closes."""
    if ncr.severity not in ("major", "critical"):
        return None
    capas = covering_capas(db, ncr)
    if not capas:
        return (f"{ncr.ncr_number} is {ncr.severity}: rule 6 needs a CAPA against it before closure. "
                "Raise one in Quality → CAPA and link this NCR.")
    if any(c.status in NCR_CLOSE_MIN_STATUSES for c in capas):
        return None
    c = capas[0]
    return (f"{ncr.ncr_number} is {ncr.severity}: its CAPA {c.capa_number} is still "
            f"'{QUALITY_CAPA_STATUS_LABELS.get(c.status, c.status)}'. Rule 6 — find the root cause and plan the corrective "
            "actions on the CAPA (status 'Actions in progress') before closing the NCR.")


def _open_capa_for(db: Session, *, item_id: int | None, item_name: str | None, defect_code_id: int | None) -> QualityCapa | None:
    q = db.query(QualityCapa).filter(QualityCapa.is_deleted == False, QualityCapa.status.in_(QUALITY_CAPA_OPEN_STATUSES))  # noqa: E712
    q = q.filter(QualityCapa.item_id == item_id) if item_id else q.filter(QualityCapa.item_name == item_name)
    if defect_code_id:
        q = q.filter(QualityCapa.defect_code_id == defect_code_id)
    return q.order_by(QualityCapa.id.desc()).first()


def _notify_heads(db: Session, capa: QualityCapa, actor_id: int | None, title: str, message: str, ntype: str,
                  teams: bool = False, extra: list[int] | None = None) -> None:
    ids = {u.id for u in access.quality_heads(db)} | set(extra or [])
    if capa.responsible_user_id:
        ids.add(capa.responsible_user_id)
    for uid in ids:
        if uid != actor_id:
            notify_user(db, user_id=uid, title=title, message=message, notification_type=ntype,
                        entity_type="quality_capa", entity_id=capa.id, teams=teams)


# ---------------------------------------------------------------------------
# Creation (manual + automatic triggers)
# ---------------------------------------------------------------------------

def _new(db: Session, *, trigger: str, title: str, user_id: int | None, severity: str = "major",
         ncr: QualityNcr | None = None, complaint_id: int | None = None, item_id: int | None = None,
         item_name: str | None = None, vendor_name: str | None = None, defect_code_id: int | None = None,
         problem: str | None = None, audit_reference: str | None = None, responsible_user_id: int | None = None,
         due_date: date | None = None, action_type: str = "corrective") -> QualityCapa:
    capa = QualityCapa(
        capa_number=generate_capa_number(db), action_type=action_type, trigger=trigger, severity=severity,
        ncr_id=ncr.id if ncr else None, complaint_id=complaint_id, audit_reference=audit_reference,
        item_id=item_id if item_id is not None else (ncr.item_id if ncr else None),
        item_name=item_name or (ncr.item_name if ncr else None),
        vendor_name=vendor_name if vendor_name is not None else (ncr.vendor_name if ncr else None),
        defect_code_id=defect_code_id if defect_code_id is not None else (ncr.defect_code_id if ncr else None),
        title=title[:255], problem_statement=problem, responsible_user_id=responsible_user_id, due_date=due_date,
        status="open", created_by_id=user_id,
    )
    db.add(capa)
    db.flush()
    if ncr:
        capa.ncr_links.append(QualityCapaNcr(ncr_id=ncr.id))
    if responsible_user_id:
        capa.team.append(QualityCapaTeamMember(user_id=responsible_user_id, role="champion"))
    db.flush()
    label = QUALITY_CAPA_TRIGGER_LABELS.get(trigger, trigger)
    _notify_heads(db, capa, user_id, "CAPA Raised",
                  f"{capa.capa_number} ({label}): {capa.title}. Form the 8D team and start the investigation.",
                  "quality_capa_raised")
    return capa


def link_ncr(db: Session, capa: QualityCapa, ncr: QualityNcr) -> None:
    if ncr.id == capa.ncr_id or any(l.ncr_id == ncr.id for l in capa.ncr_links):
        return
    capa.ncr_links.append(QualityCapaNcr(ncr_id=ncr.id))
    db.flush()


def create_manual(db: Session, data: dict, user: User) -> QualityCapa:
    if not access.can_edit_capa(user):
        raise CapaError("Only a Quality engineer or head can raise a CAPA — ask an admin to apply the role in "
                        "Quality → Settings → Quality roles.", 403)
    title = _clean(data.get("title"))
    if not title:
        raise CapaError("Give the CAPA a short title (the problem in one line).", 422)
    if data.get("action_type", "corrective") not in QUALITY_CAPA_ACTION_TYPES:
        raise CapaError("Type must be corrective or preventive.", 422)
    if data.get("severity", "major") not in _SEV_RANK:
        raise CapaError("Severity must be minor, major or critical.", 422)
    ncrs = []
    for nid in data.get("ncr_ids") or []:
        n = db.query(QualityNcr).filter(QualityNcr.id == nid, QualityNcr.is_deleted == False).first()  # noqa: E712
        if not n:
            raise CapaError(f"NCR #{nid} not found — it may have been removed.", 404)
        ncrs.append(n)
    item = None
    if data.get("item_id"):
        item = db.query(StoreItem).filter(StoreItem.id == data["item_id"]).first()
        if not item:
            raise CapaError(f"Item #{data['item_id']} isn't in the Item Master.", 404)
    if data.get("defect_code_id") and not db.query(QualityDefectCode.id).filter(QualityDefectCode.id == data["defect_code_id"]).first():
        raise CapaError("Pick a defect code from Quality → Masters.", 422)
    if data.get("responsible_user_id") and not db.query(User.id).filter(User.id == data["responsible_user_id"], User.is_active.is_(True)).first():
        raise CapaError("Pick an active user as the CAPA owner.", 422)
    first = ncrs[0] if ncrs else None
    capa = _new(db, trigger="manual", title=title, user_id=user.id, severity=data.get("severity") or "major", ncr=first,
                complaint_id=data.get("complaint_id"), item_id=item.id if item else None,
                item_name=item.item_name if item else _clean(data.get("item_name")),
                vendor_name=_clean(data.get("vendor_name")), defect_code_id=data.get("defect_code_id"),
                problem=_clean(data.get("problem_statement")), responsible_user_id=data.get("responsible_user_id"),
                due_date=data.get("due_date"), action_type=data.get("action_type") or "corrective",
                audit_reference=_clean(data.get("audit_reference")))
    for n in ncrs[1:]:
        link_ncr(db, capa, n)
    return capa


def _repeat_ncrs(db: Session, ncr: QualityNcr) -> list[QualityNcr]:
    days = int(get_setting(db, "capa_repeat_days"))
    since = (ncr.ncr_date or date.today()) - timedelta(days=days)
    q = db.query(QualityNcr).filter(
        QualityNcr.is_deleted == False, QualityNcr.status != "cancelled",  # noqa: E712
        QualityNcr.defect_code_id == ncr.defect_code_id, QualityNcr.ncr_date >= since,
    )
    q = q.filter(QualityNcr.item_id == ncr.item_id) if ncr.item_id else q.filter(QualityNcr.item_name == ncr.item_name)
    return q.order_by(QualityNcr.id).all()


def on_ncr_raised(db: Session, ncr: QualityNcr, user_id: int | None) -> QualityCapa | None:
    """Automatic CAPA triggers for a new NCR:
      * Major / Critical NCR → a CAPA (or link to the open CAPA for the same
        item + defect code, so one problem has one 8D);
      * the same defect code on the same item ≥ capa_repeat_count times within
        capa_repeat_days → a repeat-defect CAPA linking all of them."""
    capa = None
    existing = _open_capa_for(db, item_id=ncr.item_id, item_name=ncr.item_name, defect_code_id=ncr.defect_code_id) \
        if ncr.defect_code_id else None
    if ncr.severity in ("major", "critical"):
        if existing:
            link_ncr(db, existing, ncr)
            capa = existing
        else:
            capa = _new(db, trigger="ncr", severity=ncr.severity, ncr=ncr, user_id=user_id,
                        title=f"{ncr.severity.title()} NCR {ncr.ncr_number}: {ncr.item_name}",
                        problem=ncr.description)
    if ncr.defect_code_id:
        repeats = _repeat_ncrs(db, ncr)
        if len(repeats) >= int(get_setting(db, "capa_repeat_count")):
            target = capa or existing
            if not target:
                code = db.query(QualityDefectCode).filter(QualityDefectCode.id == ncr.defect_code_id).first()
                worst = max((r.severity for r in repeats), key=lambda s: _SEV_RANK.get(s, 0))
                target = _new(
                    db, trigger="repeat_defect", severity="major" if worst == "minor" else worst, ncr=repeats[0], user_id=user_id,
                    title=f"Repeat defect {code.code if code else ''} on {ncr.item_name} ({len(repeats)}× in "
                          f"{get_setting(db, 'capa_repeat_days')} days)",
                    problem=f"Defect {code.code + ' ' + code.name if code else ''} recurred {len(repeats)} times: "
                            + ", ".join(r.ncr_number for r in repeats) + ".",
                )
            for r in repeats:
                link_ncr(db, target, r)
            capa = target
    return capa


def raise_for_complaint(db: Session, complaint, ncr: QualityNcr | None, user_id: int | None) -> QualityCapa:
    capa = None
    if ncr:
        existing = covering_capas(db, ncr)
        capa = existing[0] if existing else None
    if capa is None:
        capa = _new(db, trigger="complaint", severity="critical" if complaint.severity == "critical" else "major", ncr=ncr,
                    complaint_id=complaint.id, user_id=user_id, item_id=complaint.item_id, item_name=complaint.item_name,
                    defect_code_id=complaint.defect_code_id, responsible_user_id=complaint.owner_id,
                    title=f"Customer complaint {complaint.complaint_number}: {complaint.customer_name} — {complaint.item_name or 'product'}",
                    problem=complaint.description)
    capa.complaint_id = complaint.id
    if capa.trigger == "ncr":
        capa.trigger = "complaint"
    db.flush()
    return capa


def raise_for_vendor(db: Session, *, vendor_name: str, reason: str, user_id: int | None, item_id: int | None = None) -> QualityCapa:
    """Vendor rejection trend (rating below the On-watch limit): one open
    vendor CAPA per vendor — reused while it is open."""
    existing = db.query(QualityCapa).filter(
        QualityCapa.is_deleted == False, QualityCapa.trigger == "vendor_trend",  # noqa: E712
        QualityCapa.vendor_name == vendor_name, QualityCapa.status.in_(QUALITY_CAPA_OPEN_STATUSES),
    ).first()
    if existing:
        return existing
    return _new(db, trigger="vendor_trend", vendor_name=vendor_name, item_id=item_id, user_id=user_id,
                title=f"Vendor quality: {vendor_name}", problem=reason)


def raise_for_audit_finding(db: Session, *, audit_reference: str, finding: str, severity: str = "major",
                            user_id: int | None = None, item_id: int | None = None,
                            vendor_name: str | None = None) -> QualityCapa:
    """Hook for Phase 4 audits (and vendor audits now): a Major / Minor audit
    finding becomes a CAPA."""
    return _new(db, trigger="audit", severity=severity if severity in _SEV_RANK else "major", user_id=user_id,
                audit_reference=audit_reference, item_id=item_id, vendor_name=vendor_name,
                title=f"Audit finding {audit_reference}: {finding[:150]}", problem=finding)


# ---------------------------------------------------------------------------
# 8D editing
# ---------------------------------------------------------------------------

_EDIT_FIELDS = {
    # field: statuses in which it can still be changed
    "title": QUALITY_CAPA_OPEN_STATUSES,
    "severity": ("open", "reopened", "root_cause_found"),
    "responsible_user_id": QUALITY_CAPA_OPEN_STATUSES,
    "due_date": QUALITY_CAPA_OPEN_STATUSES,
    "problem_statement": ("open", "reopened", "root_cause_found"),
    "containment_actions": ("open", "reopened", "root_cause_found", "actions_in_progress"),
    "root_cause_method": ("open", "reopened", "root_cause_found"),
    "why_analysis": ("open", "reopened", "root_cause_found"),
    "fishbone": ("open", "reopened", "root_cause_found"),
    "root_cause": ("open", "reopened", "root_cause_found"),
    "implementation_summary": ("actions_in_progress", "effectiveness_check"),
    "prevention_not_needed_reason": ("root_cause_found", "actions_in_progress"),
    "verification_notes": QUALITY_CAPA_OPEN_STATUSES,
    "item_id": ("open", "reopened"),
    "vendor_name": ("open", "reopened"),
    "defect_code_id": ("open", "reopened"),
    "action_type": ("open", "reopened"),
}


def _require_open(capa: QualityCapa, action: str) -> None:
    if capa.status == "closed":
        raise CapaError(f"{capa.capa_number} is closed, so you can't {action}. Closed CAPAs are never edited — "
                        "a Quality head can reopen it with a reason.")


def update(db: Session, capa: QualityCapa, data: dict, user: User) -> QualityCapa:
    _require_open(capa, "edit it")
    if not access.can_edit_capa(user):
        raise CapaError("Only a Quality engineer or head can work on a CAPA.", 403)
    for field, value in data.items():
        allowed = _EDIT_FIELDS.get(field)
        if allowed is None:
            raise CapaError(f"'{field}' can't be changed on a CAPA.", 422)
        current = getattr(capa, field)
        if current == value:
            continue
        if capa.status not in allowed:
            raise CapaError(f"{field.replace('_', ' ').capitalize()} can't be changed while the CAPA is "
                            f"'{QUALITY_CAPA_STATUS_LABELS[capa.status]}'.", 409)
        if field == "root_cause_method" and value and value not in QUALITY_CAPA_ROOT_CAUSE_METHODS:
            raise CapaError("Root-cause method must be why-why, fishbone or both.", 422)
        if field == "severity" and value not in _SEV_RANK:
            raise CapaError("Severity must be minor, major or critical.", 422)
        if field == "action_type" and value not in QUALITY_CAPA_ACTION_TYPES:
            raise CapaError("Type must be corrective or preventive.", 422)
        if field == "why_analysis" and value is not None:
            value = [str(v).strip() for v in value if str(v).strip()]
            if len(value) > 7:
                raise CapaError("Keep the why-why chain to at most 7 whys.", 422)
        if field == "fishbone" and value is not None:
            bad = [k for k in value if k not in QUALITY_FISHBONE_CATEGORIES]
            if bad:
                raise CapaError(f"Fishbone categories are {', '.join(QUALITY_FISHBONE_CATEGORIES)} — not {', '.join(bad)}.", 422)
            value = {k: [str(c).strip() for c in (v or []) if str(c).strip()] for k, v in value.items()}
        if field == "responsible_user_id" and value:
            if not db.query(User.id).filter(User.id == value, User.is_active.is_(True)).first():
                raise CapaError("Pick an active user as the CAPA owner.", 422)
            if not any(m.user_id == value for m in capa.team):
                capa.team.append(QualityCapaTeamMember(user_id=value, role="champion"))
            notify_user(db, user_id=value, title="CAPA Assigned to You",
                        message=f"{_name(user)} made you the owner of {capa.capa_number}: {capa.title}.",
                        notification_type="quality_capa_assigned", entity_type="quality_capa", entity_id=capa.id)
        if field == "item_id" and value and not db.query(StoreItem.id).filter(StoreItem.id == value).first():
            raise CapaError(f"Item #{value} isn't in the Item Master.", 404)
        if isinstance(value, str):
            value = value.strip() or None
        setattr(capa, field, value)
        if field == "item_id" and value:
            capa.item_name = db.query(StoreItem.item_name).filter(StoreItem.id == value).scalar()
        if field == "containment_actions":
            capa.containment_done_at = _now() if value else None
    db.flush()
    return capa


def set_team(db: Session, capa: QualityCapa, members: list[dict], user: User) -> QualityCapa:
    _require_open(capa, "change its team")
    if not access.can_edit_capa(user):
        raise CapaError("Only a Quality engineer or head can change the 8D team.", 403)
    seen = set()
    for m in members:
        if m["user_id"] in seen:
            raise CapaError("A person can only be on the team once.", 422)
        seen.add(m["user_id"])
        if m.get("role", "member") not in QUALITY_CAPA_TEAM_ROLES:
            raise CapaError("Team role must be champion, leader or member.", 422)
        if not db.query(User.id).filter(User.id == m["user_id"], User.is_active.is_(True)).first():
            raise CapaError(f"User #{m['user_id']} isn't an active user.", 422)
    if capa.responsible_user_id and capa.responsible_user_id not in seen:
        raise CapaError("The CAPA owner must stay on the team — change the owner first.", 422)
    existing = {m.user_id: m for m in capa.team}
    for uid, m in list(existing.items()):
        if uid not in seen:
            capa.team.remove(m)
    for m in members:
        row = existing.get(m["user_id"])
        if row:
            row.role = m.get("role") or "member"
            row.department = _clean(m.get("department"))
        else:
            capa.team.append(QualityCapaTeamMember(user_id=m["user_id"], role=m.get("role") or "member",
                                                   department=_clean(m.get("department"))))
            if m["user_id"] != user.id:
                notify_user(db, user_id=m["user_id"], title="Added to a CAPA Team",
                            message=f"{_name(user)} added you to the 8D team of {capa.capa_number}: {capa.title}.",
                            notification_type="quality_capa_team", entity_type="quality_capa", entity_id=capa.id)
    db.flush()
    return capa


def add_ncr(db: Session, capa: QualityCapa, ncr_id: int, user: User) -> QualityCapa:
    _require_open(capa, "link NCRs")
    if not access.can_edit_capa(user):
        raise CapaError("Only a Quality engineer or head can link NCRs to a CAPA.", 403)
    ncr = db.query(QualityNcr).filter(QualityNcr.id == ncr_id, QualityNcr.is_deleted == False).first()  # noqa: E712
    if not ncr:
        raise CapaError(f"NCR #{ncr_id} not found.", 404)
    link_ncr(db, capa, ncr)
    if not capa.ncr_id:
        capa.ncr_id = ncr.id
    return capa


def active_actions(capa: QualityCapa) -> list[QualityCapaAction]:
    return [a for a in capa.actions if not a.superseded]


def add_action(db: Session, capa: QualityCapa, data: dict, user: User) -> QualityCapaAction:
    if capa.status not in ("open", "reopened", "root_cause_found", "actions_in_progress"):
        raise CapaError(f"Actions can't be added while the CAPA is '{QUALITY_CAPA_STATUS_LABELS[capa.status]}'"
                        + (" — reopen it first." if capa.status == "closed" else "."))
    if not access.can_edit_capa(user):
        raise CapaError("Only a Quality engineer or head can plan CAPA actions.", 403)
    kind = data.get("kind") or "corrective"
    if kind not in QUALITY_CAPA_ITEM_KINDS:
        raise CapaError("Action kind must be corrective (D5) or preventive (D7).", 422)
    ptype = data.get("prevention_type")
    if kind == "preventive":
        if ptype not in QUALITY_CAPA_PREVENTION_TYPES:
            raise CapaError("Say what the prevention updates: inspection plan, drawing, training, procedure, FMEA or other.", 422)
    else:
        ptype = None
    desc = _clean(data.get("description"))
    if not desc:
        raise CapaError("Describe the action.", 422)
    owner = db.query(User).filter(User.id == data.get("owner_id"), User.is_active.is_(True)).first() if data.get("owner_id") else None
    if not owner:
        raise CapaError("Every action needs an owner — pick an active user.", 422)
    due = data.get("due_date")
    if not due:
        raise CapaError("Every action needs a due date.", 422)
    if due < date.today():
        raise CapaError("The due date can't be in the past.", 422)
    act = QualityCapaAction(capa_id=capa.id, kind=kind, prevention_type=ptype, description=desc, owner_id=owner.id,
                            due_date=due, status="open", created_by_id=user.id)
    capa.actions.append(act)
    db.flush()
    if owner.id != user.id:
        notify_user(db, user_id=owner.id, title="CAPA Action Assigned",
                    message=f"{capa.capa_number}: {desc[:160]} — due {due:%d-%m-%Y}. Record the evidence when it's done.",
                    notification_type="quality_capa_action_assigned", entity_type="quality_capa", entity_id=capa.id)
    role_events.fire(db, "capa_action_assigned", record=capa, entity_type="quality_capa", actor=user, skip={owner.id},
                     title=f"CAPA action assigned: {capa.capa_number}",
                     message=f"{capa.capa_number}: {desc[:160]} — owner {owner.name or owner.email}, due {due:%d-%m-%Y}.")
    return act


def complete_action(db: Session, capa: QualityCapa, action: QualityCapaAction, *, evidence: str | None,
                    evidence_reference: str | None, user: User) -> QualityCapaAction:
    _require_open(capa, "update its actions")
    if action.status != "open" or action.superseded:
        raise CapaError("This action is already done or cancelled.")
    if user.id != action.owner_id and not access.can_edit_capa(user):
        raise CapaError("Only the action owner or a Quality engineer / head can mark it done.", 403)
    if not _clean(evidence):
        raise CapaError("D6 — record the implementation evidence (what was done, where it can be seen).", 422)
    if action.kind == "preventive" and action.prevention_type in ("update_inspection_plan", "update_drawing", "update_procedure", "update_fmea") \
            and not _clean(evidence_reference):
        raise CapaError("Give the reference of the updated document (plan number + revision, drawing revision, procedure number).", 422)
    action.status = "done"
    action.evidence = evidence.strip()
    action.evidence_reference = _clean(evidence_reference)
    action.done_by_id = user.id
    action.done_at = _now()
    db.flush()
    return action


def cancel_action(db: Session, capa: QualityCapa, action: QualityCapaAction, *, reason: str | None, user: User) -> QualityCapaAction:
    _require_open(capa, "update its actions")
    if action.status != "open" or action.superseded:
        raise CapaError("Only an open action can be cancelled.")
    if not access.can_edit_capa(user):
        raise CapaError("Only a Quality engineer or head can cancel a CAPA action.", 403)
    if not _clean(reason):
        raise CapaError("Give the reason for cancelling the action.", 422)
    action.status = "cancelled"
    action.cancel_reason = reason.strip()
    db.flush()
    return action


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------

def _d1_to_d4_missing(capa: QualityCapa) -> list[str]:
    missing = []
    if not capa.responsible_user_id:
        missing.append("D1 owner")
    if len(capa.team) < 2:
        missing.append("D1 team (owner + at least one more member)")
    if not capa.problem_statement:
        missing.append("D2 problem description")
    if not capa.containment_actions:
        missing.append("D3 containment")
    if not capa.root_cause_method:
        missing.append("D4 root-cause method")
    if capa.root_cause_method in ("why_why", "both") and len(capa.why_analysis or []) < 2:
        missing.append("D4 why-why chain (at least 2 whys)")
    if capa.root_cause_method in ("fishbone", "both") and not any((capa.fishbone or {}).values()):
        missing.append("D4 fishbone causes")
    if not capa.root_cause:
        missing.append("D4 root cause statement")
    return missing


def advance(db: Session, capa: QualityCapa, user: User) -> QualityCapa:
    """Moves the CAPA to its next 8D stage after checking the stage is complete."""
    if not access.can_edit_capa(user):
        raise CapaError("Only a Quality engineer or head can move a CAPA forward.", 403)
    if capa.status in ("open", "reopened"):
        missing = _d1_to_d4_missing(capa)
        if missing:
            raise CapaError("Complete these before marking the root cause found: " + "; ".join(missing) + ".", 422)
        capa.status = "root_cause_found"
        capa.root_cause_found_at = _now()
    elif capa.status == "root_cause_found":
        corrective = [a for a in active_actions(capa) if a.kind == "corrective" and a.status != "cancelled"]
        if not corrective:
            raise CapaError("D5 — add at least one corrective action (owner + due date) before starting the actions.", 422)
        capa.status = "actions_in_progress"
    elif capa.status == "actions_in_progress":
        acts = [a for a in active_actions(capa) if a.status != "cancelled"]
        open_ = [a for a in acts if a.status == "open"]
        if open_:
            raise CapaError(f"{len(open_)} action(s) still open — " + "; ".join(
                f"{a.description[:60]} (due {a.due_date:%d-%m-%Y})" for a in open_[:5]) + ". Mark them done with evidence first.", 422)
        if not any(a.kind == "corrective" for a in acts):
            raise CapaError("D5 — at least one corrective action must be done.", 422)
        if not any(a.kind == "preventive" for a in acts) and not capa.prevention_not_needed_reason:
            raise CapaError("D7 — add a prevention item (update the inspection plan / drawing / training …) or record "
                            "why no prevention is needed.", 422)
        days = int(get_setting(db, "effectiveness_days"))
        capa.status = "effectiveness_check"
        capa.actions_completed_at = _now()
        capa.effectiveness_due_date = date.today() + timedelta(days=days)
        _notify_heads(db, capa, user.id, "CAPA Actions Completed",
                      f"{capa.capa_number}: all actions are done. Effectiveness check (D8) is due on "
                      f"{capa.effectiveness_due_date:%d-%m-%Y}.", "quality_capa_actions_done")
    else:
        raise CapaError(f"{capa.capa_number} is '{QUALITY_CAPA_STATUS_LABELS[capa.status]}' — "
                        + ("record the effectiveness check (D8) instead." if capa.status == "effectiveness_check"
                           else "a closed CAPA doesn't move forward; reopen it if needed."))
    db.flush()
    return capa


def recurrences(db: Session, capa: QualityCapa) -> list[QualityNcr]:
    """NCRs of the same item + defect code raised after the actions were
    completed — evidence the CAPA was not effective."""
    if not capa.actions_completed_at or not (capa.item_id or capa.item_name) or not capa.defect_code_id:
        return []
    q = db.query(QualityNcr).filter(
        QualityNcr.is_deleted == False, QualityNcr.status != "cancelled",  # noqa: E712
        QualityNcr.defect_code_id == capa.defect_code_id, QualityNcr.created_at > capa.actions_completed_at,
    )
    q = q.filter(QualityNcr.item_id == capa.item_id) if capa.item_id else q.filter(QualityNcr.item_name == capa.item_name)
    return q.all()


def _reopen(capa: QualityCapa) -> None:
    capa.status = "reopened"
    capa.reopen_count += 1
    capa.report_revision += 1
    capa.root_cause_found_at = None
    capa.actions_completed_at = None
    capa.effectiveness_due_date = None
    capa.closed_at = None
    capa.closed_by_id = None
    for a in capa.actions:
        a.superseded = True


def check_effectiveness(db: Session, capa: QualityCapa, *, effective: bool, remarks: str | None, user: User,
                        today: date | None = None) -> QualityCapa:
    today = today or date.today()
    if capa.status != "effectiveness_check":
        raise CapaError(f"{capa.capa_number} isn't waiting for its effectiveness check "
                        f"(status: {QUALITY_CAPA_STATUS_LABELS[capa.status]}).")
    if not access.can_close_capa(user):
        raise CapaError("Only a Quality head can record the D8 effectiveness check and close a CAPA.", 403)
    if capa.effectiveness_due_date and today < capa.effectiveness_due_date and effective:
        raise CapaError(f"The effectiveness check is due on {capa.effectiveness_due_date:%d-%m-%Y} "
                        f"({(capa.effectiveness_due_date - today).days} days to go) — the actions must prove themselves over "
                        "the full period (Quality → Settings) before the CAPA can be closed effective.")
    rec = recurrences(db, capa)
    note = _clean(remarks)
    if effective and rec and not note:
        raise CapaError(f"The same defect recurred after the actions ({', '.join(n.ncr_number for n in rec)}). Mark the CAPA "
                        "not effective, or explain in the remarks why it is still effective.", 422)
    if not effective and not note:
        raise CapaError("Say why the CAPA is not effective — it reopens for a new root-cause analysis.", 422)
    capa.effectiveness_result = "effective" if effective else "not_effective"
    capa.effectiveness_remarks = note
    capa.effectiveness_checked_by_id = user.id
    capa.effectiveness_checked_at = _now()
    if effective:
        capa.status = "closed"
        capa.closed_at = _now()
        capa.closed_by_id = user.id
        capa.closure_remarks = note
        _notify_heads(db, capa, user.id, "CAPA Closed",
                      f"{capa.capa_number} was verified effective and closed by {_name(user)}.", "quality_capa_closed",
                      extra=[m.user_id for m in capa.team])
    else:
        _reopen(capa)
        _notify_heads(db, capa, user.id, "CAPA Not Effective — Reopened",
                      f"{capa.capa_number} was found not effective by {_name(user)}: {note}. Redo the root cause (D4) and actions.",
                      "quality_capa_reopened", extra=[m.user_id for m in capa.team])
    db.flush()
    return capa


def reopen(db: Session, capa: QualityCapa, *, reason: str | None, user: User) -> QualityCapa:
    if capa.status != "closed":
        raise CapaError("Only a closed CAPA can be reopened.")
    if not access.can_close_capa(user):
        raise CapaError("Only a Quality head can reopen a CAPA.", 403)
    if not _clean(reason):
        raise CapaError("Give the reason for reopening (e.g. the defect came back).", 422)
    capa.verification_notes = ((capa.verification_notes or "") + f"\nReopened by {_name(user)}: {reason.strip()}").strip()
    _reopen(capa)
    db.flush()
    return capa


def overdue_actions(db: Session, today: date | None = None) -> list[tuple[QualityCapa, QualityCapaAction]]:
    today = today or date.today()
    rows = db.query(QualityCapaAction, QualityCapa).join(QualityCapa, QualityCapa.id == QualityCapaAction.capa_id).filter(
        QualityCapaAction.status == "open", QualityCapaAction.superseded.is_(False), QualityCapaAction.due_date < today,
        QualityCapa.is_deleted == False, QualityCapa.status.in_(QUALITY_CAPA_OPEN_STATUSES),  # noqa: E712
    ).all()
    return [(c, a) for a, c in rows]


def effectiveness_due(db: Session, today: date | None = None) -> list[QualityCapa]:
    today = today or date.today()
    return db.query(QualityCapa).filter(
        QualityCapa.is_deleted == False, QualityCapa.status == "effectiveness_check",  # noqa: E712
        QualityCapa.effectiveness_due_date.isnot(None), QualityCapa.effectiveness_due_date <= today,
    ).all()


def is_overdue(capa: QualityCapa, today: date | None = None) -> bool:
    today = today or date.today()
    if capa.status not in QUALITY_CAPA_OPEN_STATUSES:
        return False
    if capa.due_date and capa.due_date < today and capa.status != "effectiveness_check":
        return True
    return any(a.status == "open" and not a.superseded and a.due_date < today for a in capa.actions)
