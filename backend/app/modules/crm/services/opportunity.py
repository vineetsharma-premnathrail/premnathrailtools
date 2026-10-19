"""Inquiry as an opportunity (SAP CRM opportunity): owner as a user, structured
win / loss, weighted pipeline.

* Owners — bd_owner_id / sales_engineer_id are user FKs. The old free-text
  columns (bd_owner / sales_engineer) are kept equal to the user's name, so
  legacy rows, MoM exports and the data scope by name keep working.
* Lost — an inquiry that closes as not ordered (stage 'Closed – Not Ordered' or
  status 'Closed - Not Ordered') must carry a lost reason code; reason
  'competitor' also needs the competitor's name. Stages stay forward-only
  (services/stage_guard.py).
* Won — status 'Closed - Ordered' / stage 'Order Received' (set by Sales on SO
  confirmation, services/won.py).
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core import assignee_rules
from app.modules.main.models.user import User

LOST_REASONS = {
    "price": "Price too high",
    "technical": "Technical / specification not met",
    "delivery": "Delivery period too long",
    "budget_dropped": "Budget dropped / requirement cancelled",
    "competitor": "Lost to a competitor",
    "no_response": "No response from the customer",
    "other": "Other",
}
LOST_STAGE = "Closed – Not Ordered"
LOST_STATUS = "Closed - Not Ordered"
WON_STAGE = "Order Received"
WON_STATUS = "Closed - Ordered"


def is_lost(stage: str | None, status: str | None) -> bool:
    return stage == LOST_STAGE or status == LOST_STATUS


def is_won(stage: str | None, status: str | None) -> bool:
    return status == WON_STATUS or stage == WON_STAGE


def resolve_owner(db: Session, user_id: int | None, label: str) -> User | None:
    """An owner must be an active user who can open CRM."""
    if not user_id:
        return None
    u = db.get(User, user_id)
    if not u or not u.is_active:
        raise HTTPException(status_code=422, detail=f"The {label} picked (user #{user_id}) isn't an active user — pick someone else.")
    if "crm" not in u.get_apps():
        raise HTTPException(status_code=422, detail=(
            f"{u.name or u.email} can't open the CRM module, so they can't be the {label}. Pick a CRM user, "
            f"or give them CRM access in Organization › Role & Permissions."))
    return u


# Owner FK -> "Assign to" rule key (core/features/crm.py register_pickers).
OWNER_RULE_KEYS = {"bd_owner_id": "crm:inquiries_tenders.bd_owner", "sales_engineer_id": "crm:inquiries_tenders.sales_engineer"}


def apply_owners(db: Session, inquiry, updates: dict, user: User | None = None) -> None:
    """Validate owner FKs in `updates` and keep the legacy name columns in step.
    A changed owner must fit `user`'s role "Assign to" rule — except owning it
    yourself as BD owner (the default on every inquiry a person logs)."""
    for fk, text, label in (("bd_owner_id", "bd_owner", "BD owner"), ("sales_engineer_id", "sales_engineer", "sales engineer")):
        if fk not in updates:
            continue
        u = resolve_owner(db, updates[fk], label)
        changed = u is not None and (inquiry is None or getattr(inquiry, fk, None) != u.id)
        if changed and user is not None and not (fk == "bd_owner_id" and u.id == user.id):
            assignee_rules.ensure_allowed(db, user, OWNER_RULE_KEYS[fk], u)
        if u:
            updates[text] = u.name or u.email
        elif text not in updates and inquiry is not None and getattr(inquiry, fk, None):
            updates[text] = None  # owner cleared — clear the name that came from them


def ensure_lost_details(after: dict) -> None:
    """`after` = the inquiry's stage / status / lost fields as they will be."""
    if not is_lost(after.get("current_stage"), after.get("status")):
        return
    code = after.get("lost_reason_code")
    if not code:
        raise HTTPException(status_code=422, detail=(
            "Closing this inquiry as not ordered needs a lost reason — pick why it was lost "
            f"({', '.join(LOST_REASONS.values())})."))
    if code not in LOST_REASONS:
        raise HTTPException(status_code=422, detail=f"'{code}' isn't a lost reason. Pick one of: {', '.join(LOST_REASONS)}.")
    if code == "competitor" and not (after.get("lost_to_competitor") or "").strip():
        raise HTTPException(status_code=422, detail="The inquiry was lost to a competitor — enter the competitor's name.")
    if code == "other" and not (after.get("lost_remarks") or "").strip():
        raise HTTPException(status_code=422, detail="Lost reason is 'Other' — describe the reason in Lost remarks.")


def check_lost_code(code: str | None) -> None:
    if code and code not in LOST_REASONS:
        raise HTTPException(status_code=422, detail=f"'{code}' isn't a lost reason. Pick one of: {', '.join(LOST_REASONS)}.")


def stamp_closed(inquiry) -> None:
    closed = is_lost(inquiry.current_stage, inquiry.status) or is_won(inquiry.current_stage, inquiry.status)
    if closed and not inquiry.closed_at:
        inquiry.closed_at = datetime.now(timezone.utc)
    elif not closed:
        inquiry.closed_at = None
