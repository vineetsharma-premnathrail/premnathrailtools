"""Organization › Access Reviews / Access Risk (SoD) / denied-access trace,
plus validity dates on role assignments and extra grants.

PFUD validity:  GET/PUT /organization/grc/users/{id}/validity
Access review:  /organization/grc/reviews…, /organization/grc/review-lines/{id}/decide
SoD (GRC ARA):  /organization/grc/sod/rules|report|preview|mitigations
SU53 trace:     GET /organization/grc/denials (?user_id= for one user's trace)"""
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.permission_registry import expand_grants, is_admin_user
from app.core.permissions import require_tab_action
from app.core.sod_rules import SOD_RULES, conflicts_in, rule_out
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.grc import AccessReview, AccessReviewLine, PermissionDenial, SodMitigation
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.main.services import grc

router = APIRouter(prefix="/organization/grc", tags=["Organization - Governance"])

_roles_view = require_tab_action("organization", "roles", "view")
_roles_edit = require_tab_action("organization", "roles", "edit")
_review_view = require_tab_action("organization", "access_reviews", "view")
_review_edit = require_tab_action("organization", "access_reviews", "edit")
_grc_view = require_tab_action("organization", "grc", "view")
_grc_edit = require_tab_action("organization", "grc", "edit")
_monitor_view = require_tab_action("organization", "monitor", "view")


def _names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u.name for u in db.query(User.id, User.name).filter(User.id.in_(ids))}


def _target(db: Session, user_id: int) -> User:
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="User not found — they may have been removed. Reload the list.")
    return u


# ------------------------------------------------------------------ validity

class ValidityPayload(BaseModel):
    kind: str
    role_id: int | None = None
    permission: str | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    reason: str | None = None


@router.get("/users/{user_id}/validity")
async def get_validity(user_id: int, db: Session = Depends(get_db), _user: User = Depends(_roles_view)):
    _target(db, user_id)
    return grc.validity_rows(db, user_id)


@router.put("/users/{user_id}/validity")
async def put_validity(user_id: int, payload: ValidityPayload, db: Session = Depends(get_db),
                       actor: User = Depends(_roles_edit)):
    target = _target(db, user_id)
    if target.id == actor.id and not is_admin_user(actor):
        raise HTTPException(status_code=403, detail="You can't change the validity of your own access — ask an admin.")
    grc.set_validity(db, target, actor, payload.kind, payload.role_id, payload.permission,
                     payload.valid_from, payload.valid_to, payload.reason)
    db.commit()
    return grc.validity_rows(db, user_id)


# ------------------------------------------------------------------ reviews

class ReviewCreate(BaseModel):
    period: str
    due_date: date | None = None


class LineDecision(BaseModel):
    decision: str
    comment: str | None = None


def _review_out(db: Session, r: AccessReview) -> dict:
    counts = Counter(
        (d or "pending") for (d,) in db.query(AccessReviewLine.decision).filter(AccessReviewLine.review_id == r.id)
    )
    unassigned = db.query(AccessReviewLine).filter(AccessReviewLine.review_id == r.id,
                                                   AccessReviewLine.reviewer_id.is_(None)).count()
    return {
        "id": r.id, "period": r.period, "status": r.status, "due_date": r.due_date, "started_at": r.started_at,
        "closed_at": r.closed_at, "started_by_name": _names(db, [r.started_by_id]).get(r.started_by_id),
        "total": sum(counts.values()), "pending": counts.get("pending", 0), "kept": counts.get("keep", 0),
        "revoked": counts.get("revoke", 0), "unassigned": unassigned,
    }


def _line_out(line: AccessReviewLine, names: dict[int, str], period: str | None = None) -> dict:
    return {
        "id": line.id, "review_id": line.review_id, "period": period, "user_id": line.user_id,
        "user_name": names.get(line.user_id), "reviewer_id": line.reviewer_id,
        "reviewer_name": names.get(line.reviewer_id), "kind": line.kind, "role_id": line.role_id,
        "permission": line.permission, "label": line.label, "decision": line.decision, "comment": line.comment,
        "decided_by_name": names.get(line.decided_by_id), "decided_at": line.decided_at,
    }


@router.get("/reviews")
async def list_reviews(db: Session = Depends(get_db), _user: User = Depends(_review_view)):
    return [_review_out(db, r) for r in db.query(AccessReview).order_by(AccessReview.id.desc()).limit(50).all()]


@router.post("/reviews", status_code=201)
async def create_review(payload: ReviewCreate, db: Session = Depends(get_db), actor: User = Depends(_review_edit)):
    r = grc.start_review(db, actor, payload.period, payload.due_date)
    return _review_out(db, r)


@router.get("/reviews/my-lines")
async def my_lines(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Lines waiting for the signed-in reviewer (a reporting manager) — no
    Organization tab needed: every manager recertifies their own reports."""
    rows = (db.query(AccessReviewLine, AccessReview.period)
            .join(AccessReview, AccessReview.id == AccessReviewLine.review_id)
            .filter(AccessReview.status == "open", AccessReviewLine.reviewer_id == user.id)
            .order_by(AccessReviewLine.user_id, AccessReviewLine.id).all())
    names = _names(db, {x for line, _ in rows for x in (line.user_id, line.reviewer_id, line.decided_by_id)})
    return [_line_out(line, names, period) for line, period in rows]


@router.get("/reviews/{review_id}")
async def review_detail(review_id: int, db: Session = Depends(get_db), _user: User = Depends(_review_view)):
    r = db.get(AccessReview, review_id)
    if not r:
        raise HTTPException(status_code=404, detail="Access review not found.")
    lines = db.query(AccessReviewLine).filter(AccessReviewLine.review_id == r.id) \
        .order_by(AccessReviewLine.reviewer_id, AccessReviewLine.user_id, AccessReviewLine.id).all()
    names = _names(db, {x for line in lines for x in (line.user_id, line.reviewer_id, line.decided_by_id)})
    return {**_review_out(db, r), "lines": [_line_out(line, names, r.period) for line in lines]}


@router.post("/reviews/{review_id}/close")
async def close_review(review_id: int, db: Session = Depends(get_db), actor: User = Depends(_review_edit)):
    r = db.get(AccessReview, review_id)
    if not r:
        raise HTTPException(status_code=404, detail="Access review not found.")
    if r.status != "open":
        raise HTTPException(status_code=409, detail="This access review is already closed.")
    r.status, r.closed_at = "closed", datetime.now(timezone.utc)
    db.add(AuditLog(entity_type="access_review", entity_id=r.id, action="closed", module_key="organization",
                    subtab_key="access_reviews", performed_by_id=actor.id,
                    summary=f"{actor.name} closed access review '{r.period}'"))
    db.commit()
    return _review_out(db, r)


@router.post("/review-lines/{line_id}/decide")
async def decide(line_id: int, payload: LineDecision, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    line = db.get(AccessReviewLine, line_id)
    if not line:
        raise HTTPException(status_code=404, detail="Review line not found — reload the review.")
    grc.decide_line(db, line, user, payload.decision, payload.comment)
    names = _names(db, [line.user_id, line.reviewer_id, line.decided_by_id])
    return _line_out(line, names)


# ------------------------------------------------------------------ SoD

class SodPreview(BaseModel):
    user_id: int
    role_ids: list[int] | None = None
    granular_permissions: list[str] | None = None


class MitigationCreate(BaseModel):
    user_id: int
    rule_id: str
    reason: str
    valid_to: date | None = None


@router.get("/sod/rules")
async def sod_rules(_user: User = Depends(_grc_view)):
    return [rule_out(r) for r in SOD_RULES]


@router.get("/sod/report")
async def sod_report(db: Session = Depends(get_db), _user: User = Depends(_grc_view)):
    report = grc.sod_report(db)
    for row in report["users"]:
        for c in row["conflicts"]:
            if c.get("mitigation"):
                c["mitigation"]["mitigated_by_name"] = _names(db, [c["mitigation"]["mitigated_by_id"]]).get(
                    c["mitigation"]["mitigated_by_id"])
    return report


@router.post("/sod/preview")
async def sod_preview(payload: SodPreview, db: Session = Depends(get_db), _user: User = Depends(_roles_view)):
    """Conflicts the planned roles / extra grants would ADD for the user — the
    Users page calls this before saving to show the SoD warning."""
    target = _target(db, payload.user_id)
    after = grc.permissions_after(db, payload.role_ids, payload.granular_permissions, target)
    added = grc.new_conflicts(db, target, after)
    return {"new_conflicts": added, "needs_reason": any(c["risk"] == "high" for c in added)}


@router.get("/sod/roles/{role_id}")
async def sod_role(role_id: int, db: Session = Depends(get_db), _user: User = Depends(_roles_view)):
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found.")
    return conflicts_in(expand_grants(role.permissions or []))


@router.get("/sod/mitigations")
async def list_mitigations(db: Session = Depends(get_db), _user: User = Depends(_grc_view)):
    rows = db.query(SodMitigation).order_by(SodMitigation.id.desc()).limit(500).all()
    names = _names(db, {x for m in rows for x in (m.user_id, m.mitigated_by_id)})
    d = grc.today()
    return [{
        "id": m.id, "user_id": m.user_id, "user_name": names.get(m.user_id), "rule_id": m.rule_id,
        "rule_title": grc.rule_title(m.rule_id), "reason": m.reason, "valid_to": m.valid_to,
        "active": not m.valid_to or m.valid_to >= d, "mitigated_by_name": names.get(m.mitigated_by_id),
        "created_at": m.created_at,
    } for m in rows]


@router.post("/sod/mitigations", status_code=201)
async def add_mitigation(payload: MitigationCreate, db: Session = Depends(get_db), actor: User = Depends(_grc_edit)):
    from app.core.sod_rules import RULES_BY_ID

    if payload.rule_id not in RULES_BY_ID:
        raise HTTPException(status_code=400, detail=f"Unknown SoD rule '{payload.rule_id}'.")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Enter the mitigating control — who checks this person's work.")
    target = _target(db, payload.user_id)
    m = SodMitigation(user_id=target.id, rule_id=payload.rule_id, reason=payload.reason.strip(),
                      valid_to=payload.valid_to, mitigated_by_id=actor.id)
    db.add(m)
    db.add(AuditLog(entity_type="user_permissions", entity_id=target.id, action="sod_mitigated", module_key="organization",
                    subtab_key="grc", performed_by_id=actor.id,
                    summary=f"{actor.name} accepted SoD risk {payload.rule_id} for {target.name}: {m.reason}"))
    db.commit()
    return {"id": m.id}


@router.delete("/sod/mitigations/{mitigation_id}")
async def delete_mitigation(mitigation_id: int, db: Session = Depends(get_db), actor: User = Depends(_grc_edit)):
    m = db.get(SodMitigation, mitigation_id)
    if not m:
        raise HTTPException(status_code=404, detail="Mitigation not found.")
    db.add(AuditLog(entity_type="user_permissions", entity_id=m.user_id, action="sod_mitigation_withdrawn",
                    module_key="organization", subtab_key="grc", performed_by_id=actor.id,
                    summary=f"{actor.name} withdrew the SoD mitigation {m.rule_id}"))
    db.delete(m)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ SU53

def _granting_roles(db: Session, key: str | None) -> list[dict]:
    """Roles that would grant `key` — the 'how to fix' half of SU53."""
    if not key:
        return []
    out = []
    for r in db.query(Role).filter(Role.is_active.is_(True)).order_by(Role.name).all():
        eff = expand_grants(r.permissions or [])
        if key.endswith(":*:view"):
            mk = key.split(":", 1)[0]
            ok = any(g.startswith(f"{mk}:") and g.endswith(":view") for g in eff)
        else:
            ok = key in eff
        if ok:
            out.append({"id": r.id, "name": r.name})
    return out[:10]


def _key_label(key: str | None) -> str | None:
    """A permission id in words (features, '*' and actions included)."""
    if not key:
        return None
    from app.core.permission_words import words
    return words(key)


@router.get("/denials")
async def denials(user_id: int | None = None, days: int = 7, permission: str | None = None, limit: int = 300,
                  db: Session = Depends(get_db), _user: User = Depends(_monitor_view)):
    since = datetime.now(timezone.utc) - timedelta(days=min(max(days, 1), 90))
    q = db.query(PermissionDenial).filter(PermissionDenial.occurred_at >= since)
    if user_id:
        q = q.filter(PermissionDenial.user_id == user_id)
    if permission:
        q = q.filter(PermissionDenial.permission_key == permission)
    rows = q.order_by(PermissionDenial.id.desc()).limit(min(max(limit, 1), 1000)).all()
    names = _names(db, {r.user_id for r in rows})
    role_cache: dict = {}
    out = []
    for r in rows:
        if r.permission_key not in role_cache:
            role_cache[r.permission_key] = _granting_roles(db, r.permission_key)
        out.append({
            "id": r.id, "user_id": r.user_id, "user_name": names.get(r.user_id), "permission_key": r.permission_key,
            "permission_label": _key_label(r.permission_key), "method": r.method, "path": r.path, "detail": r.detail,
            "repeat_count": r.repeat_count, "occurred_at": r.occurred_at,
            "granted_by_roles": role_cache[r.permission_key],
        })
    return out


@router.get("/denials/summary")
async def denial_summary(days: int = 7, db: Session = Depends(get_db), _user: User = Depends(_monitor_view)):
    since = datetime.now(timezone.utc) - timedelta(days=min(max(days, 1), 90))
    rows = db.query(PermissionDenial).filter(PermissionDenial.occurred_at >= since).all()
    by_key: dict = {}
    for r in rows:
        k = r.permission_key or "(no permission key)"
        e = by_key.setdefault(k, {"permission_key": r.permission_key, "permission_label": _key_label(r.permission_key),
                                  "count": 0, "users": set()})
        e["count"] += r.repeat_count or 1
        if r.user_id:
            e["users"].add(r.user_id)
    out = sorted(by_key.values(), key=lambda e: -e["count"])
    return [{**e, "users": len(e["users"])} for e in out[:100]]

