"""Helpers for Store role-based notifications (events: app/core/events/store.py)."""
from sqlalchemy.orm import Session


def location_opener(db: Session, *location_ids: int | None):
    """can_open for notify_event: the member's Store data scope covers at
    least one of these stores (plant-scoped users only hear about theirs)."""
    from app.modules.store.services.plant_access import visible_location_ids

    ids = {i for i in location_ids if i}

    def _can_open(user) -> bool:
        allowed = visible_location_ids(db, user)
        return allowed is None or not ids or bool(ids & set(allowed))

    return _can_open


def pending_approvers(req) -> set[int]:
    """Approvers the approval engine just notified directly (skip them)."""
    if req is None:
        return set()
    return {s.approver_id for s in req.steps if s.status == "pending" and s.approver_id}


def user_by_id(db: Session, user_id: int | None):
    if not user_id:
        return None
    from app.modules.main.models.user import User
    return db.get(User, user_id)
