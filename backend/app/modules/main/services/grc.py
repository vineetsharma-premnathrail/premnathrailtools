"""Access governance: validity dates (PFUD), access recertification (GRC UAR)
and Segregation of Duties analysis (GRC ARA). Routes: main/routes/grc.py."""
import json
import logging
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.permission_registry import expand_grant_sources, expand_grants, is_admin_user
from app.core.sod_rules import RULES_BY_ID, conflicts_in
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.grc import AccessReview, AccessReviewLine, AccessValidity, SodMitigation
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.core.permission_words import words

logger = logging.getLogger(__name__)


def today() -> date:
    return datetime.now(timezone.utc).astimezone().date()


# ---------------------------------------------------------------- validity

_TABLE_READY: bool | None = None


def _table_ready(session) -> bool:
    """access_validities exists (False only before the migration ran) —
    checked once per process so a missing table never aborts a request."""
    global _TABLE_READY
    if _TABLE_READY is None:
        import sqlalchemy as sa
        try:
            _TABLE_READY = sa.inspect(session.get_bind()).has_table("access_validities")
        except Exception:  # noqa: BLE001
            return False
    return _TABLE_READY


def inactive_access(user) -> tuple[set[int], set[str]]:
    """(role ids, extra grants) of `user` that are outside their validity
    window today — not yet started or already ended. Cached on the instance
    for the day so effective_permissions stays a cheap property."""
    from sqlalchemy.orm import object_session

    d = today()
    cached = user.__dict__.get("_inactive_access_cache")
    if cached is not None and cached[0] == d:
        return cached[1]
    session = object_session(user)
    result: tuple[set[int], set[str]] = (set(), set())
    if session is not None and getattr(user, "id", None) is not None:
        rows = session.query(AccessValidity).filter(AccessValidity.user_id == user.id).all() if _table_ready(session) else []
        for v in rows:
            if (v.valid_from and v.valid_from > d) or (v.valid_to and v.valid_to < d):
                if v.kind == "role" and v.role_id:
                    result[0].add(v.role_id)
                elif v.kind == "grant" and v.permission:
                    result[1].add(v.permission)
    user.__dict__["_inactive_access_cache"] = (d, result)
    return result


def validity_rows(db: Session, user_id: int) -> list[dict]:
    rows = db.query(AccessValidity).filter(AccessValidity.user_id == user_id).all()
    d = today()
    roles = {r.id: r.name for r in db.query(Role.id, Role.name)}
    return [{
        "id": v.id, "kind": v.kind, "role_id": v.role_id, "role_name": roles.get(v.role_id),
        "permission": v.permission, "valid_from": v.valid_from, "valid_to": v.valid_to, "reason": v.reason,
        "assigned_by_id": v.assigned_by_id,
        "active": not ((v.valid_from and v.valid_from > d) or (v.valid_to and v.valid_to < d)),
    } for v in rows]


def set_validity(db: Session, target: User, actor: User, kind: str, role_id: int | None, permission: str | None,
                 valid_from: date | None, valid_to: date | None, reason: str | None) -> AccessValidity | None:
    """Set (or clear, when both dates are empty) the validity window of one of
    the user's roles / extra grants."""
    if kind not in ("role", "grant"):
        raise HTTPException(status_code=400, detail="kind must be 'role' or 'grant'.")
    if kind == "role":
        if not role_id or role_id not in {r.id for r in target.roles}:
            raise HTTPException(status_code=400, detail=f"{target.name} doesn't hold that role — assign the role first, then set its validity dates.")
        permission = None
    else:
        if not permission or permission not in (target.granular_permissions or []):
            raise HTTPException(status_code=400, detail=f"'{words(permission)}' isn't one of {target.name}'s extra grants — add the grant first, then set its validity dates.")
        role_id = None
    if valid_from and valid_to and valid_to < valid_from:
        raise HTTPException(status_code=400, detail="'Valid to' is before 'Valid from' — pick an end date on or after the start date.")
    q = db.query(AccessValidity).filter(AccessValidity.user_id == target.id, AccessValidity.kind == kind)
    q = q.filter(AccessValidity.role_id == role_id) if kind == "role" else q.filter(AccessValidity.permission == permission)
    row = q.first()
    what = _label(db, kind, role_id, permission)
    if not valid_from and not valid_to:
        if row:
            db.delete(row)
            _audit(db, actor, target, "access_validity_cleared", f"{actor.name} made {what} permanent for {target.name}")
        target.__dict__.pop("_inactive_access_cache", None)
        target.invalidate_permissions()
        return None
    if not row:
        row = AccessValidity(user_id=target.id, kind=kind, role_id=role_id, permission=permission)
        db.add(row)
    row.valid_from, row.valid_to, row.reason, row.assigned_by_id = valid_from, valid_to, (reason or "").strip() or None, actor.id
    _audit(db, actor, target, "access_validity_set",
           f"{actor.name} set {what} for {target.name} valid {valid_from or '…'} to {valid_to or '…'}"
           + (f" — {row.reason}" if row.reason else ""))
    target.__dict__.pop("_inactive_access_cache", None)
    target.invalidate_permissions()
    return row


def _label(db: Session, kind: str, role_id: int | None, permission: str | None) -> str:
    if kind == "role":
        role = db.get(Role, role_id) if role_id else None
        return f"role '{role.name if role else role_id}'"
    return f"extra grant '{words(permission)}'"


def _audit(db: Session, actor: User | None, target: User, action: str, summary: str, old=None, new=None) -> None:
    db.add(AuditLog(
        entity_type="user_permissions", entity_id=target.id, action=action, module_key="organization",
        subtab_key="roles", summary=summary, performed_by_id=actor.id if actor else None,
        old_value=json.dumps(old) if old is not None else None, new_value=json.dumps(new) if new is not None else None,
    ))


def remove_access(db: Session, target: User, kind: str, role_id: int | None, permission: str | None,
                  actor: User | None, why: str) -> bool:
    """Take one role / extra grant away from `target` (expiry or review revoke)."""
    removed = False
    if kind == "role" and role_id:
        role = next((r for r in target.roles if r.id == role_id), None)
        if role:
            target.roles.remove(role)
            removed = True
    elif kind == "grant" and permission:
        grants = list(target.granular_permissions or [])
        if permission in grants:
            grants.remove(permission)
            target.granular_permissions = grants
            removed = True
    q = db.query(AccessValidity).filter(AccessValidity.user_id == target.id, AccessValidity.kind == kind)
    q = q.filter(AccessValidity.role_id == role_id) if kind == "role" else q.filter(AccessValidity.permission == permission)
    for v in q.all():
        db.delete(v)
    target.__dict__.pop("_inactive_access_cache", None)
    target.invalidate_permissions()
    if removed:
        _audit(db, actor, target, "access_removed", f"{_label(db, kind, role_id, permission)} removed from {target.name}: {why}")
    return removed


def expire_access(db: Session) -> int:
    """Daily (PFUD): remove every role / extra grant whose valid_to has
    passed, audit it and tell the user and the admins (bell only)."""
    from app.utils.notifications import notify_user

    d = today()
    rows = db.query(AccessValidity).filter(AccessValidity.valid_to.isnot(None), AccessValidity.valid_to < d).all()
    count = 0
    admins = [u.id for u in db.query(User).filter(User.is_active.is_(True), User.role == "admin").all()]
    for v in rows:
        target = db.get(User, v.user_id)
        if not target:
            db.delete(v)
            continue
        what = _label(db, v.kind, v.role_id, v.permission)
        if remove_access(db, target, v.kind, v.role_id, v.permission, None, f"validity ended on {v.valid_to:%d-%m-%Y}"):
            count += 1
            db.add(AuditLog(entity_type="user_permissions", entity_id=target.id, action="access_expired",
                            module_key="organization", subtab_key="roles",
                            summary=f"{what} expired for {target.name} (valid to {v.valid_to:%d-%m-%Y})"))
            for uid in {target.id, *admins}:
                notify_user(db, uid, "Access expired",
                            f"{what[0].upper() + what[1:]} for {target.name} ended on {v.valid_to:%d-%m-%Y} and was removed.",
                            "access_expired", "user", target.id)
    db.commit()
    return count


# ---------------------------------------------------------------- reviews

def _access_items(db: Session, u: User) -> list[tuple[str, int | None, str | None, str]]:
    items = [("role", r.id, None, f"Role: {r.name}") for r in (u.roles or []) if not r.is_default]
    items += [("grant", None, g, f"Extra grant: {words(g)}") for g in (u.granular_permissions or [])]
    return items


def start_review(db: Session, actor: User, period: str, due_date: date | None) -> AccessReview:
    """Create a campaign: one line per role / extra grant of every active
    non-admin user, assigned to their reporting manager (no manager →
    unassigned, reviewed by Organization › Access Reviews editors)."""
    from app.utils.notifications import notify_user

    period = (period or "").strip()
    if not period:
        raise HTTPException(status_code=400, detail="Give the review a period name, e.g. '2026-Q4'.")
    if db.query(AccessReview).filter(AccessReview.status == "open", AccessReview.period == period).first():
        raise HTTPException(status_code=409, detail=f"An open access review for '{period}' already exists — close it first or use another period name.")
    review = AccessReview(period=period, due_date=due_date, started_by_id=actor.id, status="open")
    db.add(review)
    db.flush()
    reviewers: dict[int, int] = {}
    users = db.query(User).filter(User.is_active.is_(True)).all()
    for u in users:
        if is_admin_user(u):
            continue
        reviewer = u.reporting_manager_id if u.reporting_manager_id and u.reporting_manager_id != u.id else None
        for kind, role_id, perm, label in _access_items(db, u):
            db.add(AccessReviewLine(review_id=review.id, reviewer_id=reviewer, user_id=u.id, kind=kind,
                                    role_id=role_id, permission=perm, label=label))
            if reviewer:
                reviewers[reviewer] = reviewers.get(reviewer, 0) + 1
    for rid, n in reviewers.items():
        notify_user(db, rid, "Access review: confirm your team's access",
                    f"Review '{period}': confirm or revoke {n} role(s)/grant(s) your reports hold"
                    + (f" by {due_date:%d-%m-%Y}." if due_date else "."),
                    "access_review", "access_review", review.id, teams=True)
    db.add(AuditLog(entity_type="access_review", entity_id=review.id, action="started", module_key="organization",
                    subtab_key="access_reviews", performed_by_id=actor.id,
                    summary=f"{actor.name} started access review '{period}'"))
    db.commit()
    return review


def can_manage_reviews(user: User) -> bool:
    from app.core.permission_registry import can_perform
    return can_perform(user, "organization", "access_reviews", "edit")


def decide_line(db: Session, line: AccessReviewLine, actor: User, decision: str, comment: str | None) -> AccessReviewLine:
    if decision not in ("keep", "revoke"):
        raise HTTPException(status_code=400, detail="Decision must be 'keep' or 'revoke'.")
    review = db.get(AccessReview, line.review_id)
    if not review or review.status != "open":
        raise HTTPException(status_code=409, detail="This access review is closed — decisions can no longer be changed.")
    if line.reviewer_id != actor.id and not can_manage_reviews(actor):
        raise HTTPException(status_code=403, detail="Only the user's reporting manager (the assigned reviewer) or an Organization › Access Reviews editor can decide this line.")
    if line.user_id == actor.id and not is_admin_user(actor):
        raise HTTPException(status_code=403, detail="You can't recertify your own access — your reporting manager or an admin must decide it.")
    if line.decision == "revoke":
        raise HTTPException(status_code=409, detail="This access was already revoked. To give it back, assign the role again in Organization › Users.")
    if decision == "revoke" and not (comment or "").strip():
        raise HTTPException(status_code=400, detail="Say why the access is being revoked (e.g. 'moved to Sales, no longer posts GRNs').")
    line.decision, line.comment = decision, (comment or "").strip() or None
    line.decided_by_id, line.decided_at = actor.id, datetime.now(timezone.utc)
    if decision == "revoke":
        target = db.get(User, line.user_id)
        if target:
            remove_access(db, target, line.kind, line.role_id, line.permission, actor,
                          f"revoked in access review '{review.period}' by {actor.name}: {line.comment}")
    db.commit()
    return line


def remind_reviewers(db: Session) -> int:
    """Daily: remind reviewers of undecided lines in an open review that is
    due within 3 days or overdue (Teams: it's a reminder)."""
    from app.utils.notifications import notify_user

    d = today()
    sent = 0
    for review in db.query(AccessReview).filter(AccessReview.status == "open", AccessReview.due_date.isnot(None)).all():
        if review.due_date - d > timedelta(days=3):
            continue
        pending: dict[int, int] = {}
        for line in db.query(AccessReviewLine).filter(AccessReviewLine.review_id == review.id,
                                                      AccessReviewLine.decision.is_(None),
                                                      AccessReviewLine.reviewer_id.isnot(None)).all():
            pending[line.reviewer_id] = pending.get(line.reviewer_id, 0) + 1
        for rid, n in pending.items():
            notify_user(db, rid, "Access review reminder",
                        f"{n} access line(s) in review '{review.period}' still need your decision (due {review.due_date:%d-%m-%Y}).",
                        "access_review_reminder", "access_review", review.id, teams=True)
            sent += 1
    db.commit()
    return sent


# ---------------------------------------------------------------- SoD

def active_mitigations(db: Session, user_id: int) -> dict[str, SodMitigation]:
    d = today()
    rows = db.query(SodMitigation).filter(SodMitigation.user_id == user_id).all()
    return {m.rule_id: m for m in rows if not m.valid_to or m.valid_to >= d}


def user_conflicts(db: Session, user: User) -> list[dict]:
    conflicts = conflicts_in(set(user.effective_permissions))
    mitig = active_mitigations(db, user.id)
    for c in conflicts:
        m = mitig.get(c["rule_id"])
        c["mitigation"] = {"reason": m.reason, "valid_to": m.valid_to, "mitigated_by_id": m.mitigated_by_id} if m else None
    return conflicts


def sod_report(db: Session) -> dict:
    users_out, admins = [], 0
    for u in db.query(User).filter(User.is_active.is_(True)).order_by(User.name).all():
        if is_admin_user(u):
            admins += 1
            continue
        conflicts = user_conflicts(db, u)
        if conflicts:
            users_out.append({"user_id": u.id, "name": u.name, "email": u.email, "department": u.department,
                              "conflicts": conflicts})
    roles_out = []
    for r in db.query(Role).filter(Role.is_active.is_(True)).order_by(Role.name).all():
        c = conflicts_in(expand_grants(r.permissions or []))
        if c:
            roles_out.append({"role_id": r.id, "name": r.name, "is_system": r.is_system, "conflicts": c})
    return {"users": users_out, "roles": roles_out, "admins_excluded": admins}


def permissions_after(db: Session, role_ids: list[int] | None, extras: list[str] | None, target: User) -> set[str]:
    roles = db.query(Role).filter(Role.id.in_(role_ids)).all() if role_ids else []
    sources = [list(extras if extras is not None else (target.granular_permissions or []))]
    held_roles = roles if role_ids is not None else list(target.roles or [])
    for r in held_roles:
        if r.is_active:
            sources.append(list(r.permissions or []))
    for r in db.query(Role).filter(Role.is_default.is_(True), Role.is_active.is_(True)).all():
        sources.append(list(r.permissions or []))
    # Expanded per source: features inherit per role (permission_registry.expand_grants).
    return expand_grant_sources(*sources)


def new_conflicts(db: Session, target: User, after: set[str]) -> list[dict]:
    """Conflicts the change would introduce that the user doesn't already have
    and that aren't covered by an active mitigation."""
    if is_admin_user(target):
        return []
    before = {c["rule_id"] for c in conflicts_in(set(target.effective_permissions))}
    mitig = active_mitigations(db, target.id)
    return [c for c in conflicts_in(after) if c["rule_id"] not in before and c["rule_id"] not in mitig]


def check_assignment(db: Session, target: User, actor: User, after: set[str], reason: str | None,
                     valid_to: date | None = None) -> list[dict]:
    """Block a change that adds a HIGH-risk SoD conflict unless a mitigation
    reason is given (then record it); medium conflicts pass and are returned
    as warnings."""
    from app.utils.notifications import notify_user

    added = new_conflicts(db, target, after)
    high = [c for c in added if c["risk"] == "high"]
    reason = (reason or "").strip()
    if high and not reason:
        names = "; ".join(f"{c['rule_id']} {c['title']} — {c['why']}" for c in high)
        raise HTTPException(
            status_code=409,
            detail=f"Segregation of Duties conflict for {target.name}: {names} To assign it anyway, enter a "
                   "mitigation reason (who checks their work, and until when) and save again — or give the "
                   "conflicting duty to someone else.",
        )
    if high:
        partners = [u.id for u in db.query(User).filter(User.is_active.is_(True), User.is_partner.is_(True)).all()]
        for c in high:
            db.add(SodMitigation(user_id=target.id, rule_id=c["rule_id"], reason=reason, valid_to=valid_to,
                                 mitigated_by_id=actor.id))
            db.add(AuditLog(entity_type="user_permissions", entity_id=target.id, action="sod_mitigated",
                            module_key="organization", subtab_key="grc", performed_by_id=actor.id,
                            summary=f"{actor.name} accepted SoD risk {c['rule_id']} ({c['title']}) for {target.name}: {reason}"))
            for pid in partners:
                notify_user(db, pid, "SoD risk accepted",
                            f"{actor.name} gave {target.name} conflicting duties ({c['rule_id']} {c['title']}). Reason: {reason}",
                            "sod_mitigated", "user", target.id)
    return added


def rule_title(rule_id: str) -> str:
    r = RULES_BY_ID.get(rule_id)
    return r.title if r else rule_id
