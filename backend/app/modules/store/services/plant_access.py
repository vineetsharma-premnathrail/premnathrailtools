"""Plant-wise (unit-wise) stock visibility for the Store module — now a thin
layer over the central data scope (app/core/data_scope.py).

The old Store › Settings › Plant Access list is gone: which plants a user
sees is their data scope for the "store" module, set in Organization › Role &
Permissions (the role's Data access column) or as a personal override on the
user. `migrate_store_plant_access` (below) converted the old per-user list.

Store documents (issues, returns, transfers, adjustments, reservations, stock
movements) are scoped with `apply_scope` / `ensure_in_scope` on their own
routes. What stays here is the *store-level* view the documents can't give:
which stores a user may see stock of and post into.

    scope organization                  → every store (None)
    scope multi_plant                   → stores of their plant + assigned plants
    scope plant / department / assigned / own → stores of their own plant
    no plant on their user              → no store (the 403 says how to fix it)

Stores with no plant set are visible only to organization-wide users.

`visible_location_ids`, `filter_by_location` and `ensure_location_allowed`
keep their old signatures because P2P goods receipts import them.
"""
from fastapi import HTTPException
from sqlalchemy.orm import Query, Session

from app.core.data_scope import SCOPE_LABELS, user_branch_ids, user_scope
from app.modules.main.models.user import User
from app.modules.store import access as _store_access  # noqa: F401 — registers the Store data-scope models
from app.modules.store.models.location import StoreLocation

SCOPE_HINT = ("Ask an admin to widen your Store data access in Organization › Role & Permissions "
              "(Data access column of your role), or to add the plant to your user in Organization › Branches.")


def is_unrestricted_user(user: User) -> bool:
    return user.role == "admin" or bool(getattr(user, "is_azure_admin", False))


def user_plant_ids(db: Session, user: User, config: dict | None = None) -> set[int] | None:
    """Plant (branch) ids whose stores the user may see, or None for every plant."""
    level = user_scope(user, "store")
    if level == "organization":
        return None
    return user_branch_ids(db, user, "multi_plant" if level == "multi_plant" else "plant")


def visible_location_ids(db: Session, user: User) -> set[int] | None:
    """Store (StoreLocation) ids the user may see, or None for all."""
    plants = user_plant_ids(db, user)
    if plants is None:
        return None
    if not plants:
        return set()
    return {i for (i,) in db.query(StoreLocation.id).filter(StoreLocation.branch_id.in_(plants)).all()}


def filter_by_location(query: Query, column, allowed: set[int] | None) -> Query:
    """Narrows a list query to the allowed stores (no-op when unrestricted)."""
    if allowed is None:
        return query
    return query.filter(column.in_(allowed or {-1}))


def ensure_location_allowed(db: Session, user: User, location_id: int | None, allowed: set[int] | None = None) -> None:
    """403s when the user's Store data scope doesn't cover this store — used
    on every stock posting (issue, return, adjustment …) and store pages."""
    if location_id is None:
        return
    allowed = visible_location_ids(db, user) if allowed is None else allowed
    if allowed is None or location_id in allowed:
        return
    location = db.query(StoreLocation).filter(StoreLocation.id == location_id).first()
    name = f"'{location.name}'" if location else f"#{location_id}"
    level = SCOPE_LABELS.get(user_scope(user, "store"), "restricted")
    if not getattr(user, "branch_id", None) and not allowed:
        reason = "your user has no plant set, so your Store access covers no store"
    elif location is not None and location.branch_id is None:
        reason = "that store has no plant set, so only organization-wide users see it (set its plant under Store › Settings › Stores)"
    else:
        reason = "it belongs to a plant outside your Store data access"
    raise HTTPException(
        status_code=403,
        detail=f"You can't see or post stock for store {name} — {reason} (your Store data access is '{level}'). {SCOPE_HINT}",
    )


def migrate_store_plant_access(bind) -> dict:
    """One-off conversion of the old Store › Settings › Plant Access list into
    central data scopes. Run once (e.g. from an Alembic data migration) with a
    connection/engine. Idempotent: users who already have a "store" override
    are left alone, and the old setting row is kept (marked migrated) so it can
    be inspected.

    When the old switch was ON, every non-admin Store user was restricted:
      all_plants                       → users.data_access_scopes["store"] = "organization"
      branch_ids == {their own plant}  → "plant"
      other branch_ids                 → "multi_plant" + an active Branch user
                                          assignment per extra plant
      no entry                         → "plant" (their profile plant)
    When it was OFF nothing changes (everyone stays organization-wide).
    Returns a summary dict."""
    from datetime import date

    from sqlalchemy.orm import Session as _Session

    from app.modules.organization.models.branch import Branch
    from app.modules.organization.models.branch_user_assignment import BranchUserAssignment
    from app.modules.store.models.setting import STORE_SETTING_PLANT_ACCESS, StoreSetting

    summary = {"enabled": False, "organization": 0, "plant": 0, "multi_plant": 0, "assignments_added": 0, "skipped": 0}
    db = _Session(bind=bind)
    try:
        row = db.query(StoreSetting).filter(StoreSetting.key == STORE_SETTING_PLANT_ACCESS).first()
        raw = row.value if row and isinstance(row.value, dict) else {}
        if not raw.get("enabled") or raw.get("migrated"):
            return summary
        summary["enabled"] = True
        overrides = {str(k): v or {} for k, v in (raw.get("users") or {}).items()}
        known_plants = {b for (b,) in db.query(Branch.id).all()}
        for user in db.query(User).filter(User.is_active.is_(True)).all():
            if is_unrestricted_user(user) or "store" not in user.get_apps():
                continue
            scopes = dict(user.data_access_scopes or {})
            if scopes.get("store"):
                summary["skipped"] += 1
                continue
            entry = overrides.get(str(user.id)) or {}
            branch_ids = [int(b) for b in entry.get("branch_ids") or [] if int(b) in known_plants]
            if entry.get("all_plants"):
                level = "organization"
            elif not branch_ids or set(branch_ids) == {user.branch_id}:
                level = "plant"
            else:
                level = "multi_plant"
                have = {a.branch_id for a in db.query(BranchUserAssignment).filter(
                    BranchUserAssignment.user_id == user.id, BranchUserAssignment.status == "active").all()}
                for bid in branch_ids:
                    if bid == user.branch_id or bid in have:
                        continue
                    db.add(BranchUserAssignment(
                        branch_id=bid, user_id=user.id, is_primary_branch=False, status="active",
                        access_level="store", role="Store (migrated from Store Plant Access)", effective_from=date.today(),
                    ))
                    summary["assignments_added"] += 1
            scopes["store"] = level
            user.data_access_scopes = scopes
            summary[level] += 1
        if row is not None:
            row.value = {**raw, "migrated": True}
        db.commit()
        return summary
    finally:
        db.close()
