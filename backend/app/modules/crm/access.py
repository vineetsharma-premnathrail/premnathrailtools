"""CRM tab gates (Permission Matrix: crm:<tab>:<action>).

Organization children (contacts, org follow-ups, org documents) live under
the Organizations tab; Inquiry/Tender children (quotations, stages, MoM,
follow-ups, documents, TOR) live under Inquiries & Tenders."""
from fastapi import Depends, HTTPException
from sqlalchemy import and_, false, func, or_, select
from sqlalchemy.orm import Session

from app.core.data_scope import ensure_in_scope, in_scope, register_scoped, scope_filter
from app.core.permission_registry import can_feature, can_view_tab, is_admin_user
from app.core.permissions import GRANT_HINT, ensure_feature_action, ensure_tab_action, record_owner_id
from app.modules.crm.models.activity import Activity
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization
from app.modules.crm.models.tender import Tender
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user

MODULE = "crm"
ORGS = "organizations"
INQ = "inquiries_tenders"
SETTINGS = "settings"


def tab_for(related_module: str | None) -> str:
    """CRM tab a child record belongs to, from its related_module."""
    return ORGS if (related_module or "organization") == "organization" else INQ


def ensure(user: User, tab: str, action: str) -> None:
    ensure_tab_action(user, MODULE, tab, action)


def ensure_view_any(user: User, tabs: tuple[str, ...] = (ORGS, INQ)) -> None:
    if not any(can_view_tab(user, MODULE, t) for t in tabs):
        raise HTTPException(
            status_code=403,
            detail="You don't have 'View' permission on CRM › Customer Organizations or CRM › Inquiries & Tenders. "
                   f"{GRANT_HINT}",
        )


def require_view_any(*tabs: str):
    """Dependency: user can view at least one of `tabs` (default Organizations / Inquiries & Tenders)."""
    def _dependency(user: User = Depends(get_current_user)) -> User:
        ensure_view_any(user, tabs or (ORGS, INQ))
        return user
    return _dependency


# ── Data scope (core/data_scope.py) ──────────────────────────────────────
# CRM's top-level records. bd_owner / sales_engineer / followup_assigned_to /
# assigned_to are free-text user NAMES (the forms fill them with the current
# user's name), so "assigned" matches them case-insensitively against the
# user's name. None of these records has a plant / department column, so
# department and plant scope work through the creator's user row.
# Children (quotations, contacts, line items, documents, stage logs, discussion
# comments, R&D requests) are not registered — their routes check the parent.

def _name_is(col, user):
    name = (getattr(user, "name", None) or "").strip().lower()
    if not name:
        return false()
    return func.lower(func.trim(col)) == name


def _org_worked(user):
    """Organizations the user works: has an inquiry / tender on it as BD owner,
    sales engineer or creator."""
    inquiries = select(Inquiry.org_id).where(or_(
        _name_is(Inquiry.bd_owner, user), _name_is(Inquiry.sales_engineer, user), Inquiry.created_by_id == user.id,
    ))
    tenders = select(Tender.org_id).where(or_(_name_is(Tender.bd_owner, user), Tender.created_by_id == user.id))
    return or_(Organization.id.in_(inquiries), Organization.id.in_(tenders))


# Shared customer master (owner, 2026-10-27): every CRM user may add contacts, inquiries / tenders,
# quotations, R&D discussion and documents on any organization; only its creator or an admin deletes it.
register_scoped(Organization, MODULE, owner=("created_by_id",), assigned=(_org_worked,), label="CRM customer organization",
                shared=True)
register_scoped(
    Inquiry, MODULE, owner=("created_by_id",),
    assigned=(lambda u: _name_is(Inquiry.bd_owner, u), lambda u: _name_is(Inquiry.sales_engineer, u),
              lambda u: _name_is(Inquiry.followup_assigned_to, u), "bd_owner_id", "sales_engineer_id"),
    label="inquiry",
)
register_scoped(Tender, MODULE, owner=("created_by_id",), assigned=(lambda u: _name_is(Tender.bd_owner, u),), label="tender")
register_scoped(Activity, MODULE, owner=("created_by_id",), assigned=(lambda u: _name_is(Activity.assigned_to, u),),
                label="CRM follow-up")

PARENT_MODELS = {"inquiry": Inquiry, "tender": Tender, "organization": Organization}


def parent_record(db: Session, related_module: str | None, related_id: int | None):
    """The inquiry / tender / organization a child record hangs off (None if unknown)."""
    model = PARENT_MODELS.get(related_module or "organization")
    if model is None or not related_id:
        return None
    return db.get(model, related_id)


def ensure_parent_in_scope(db: Session, user: User, related_module: str | None, related_id: int | None) -> None:
    """403 when the inquiry / tender / organization a child belongs to is outside the user's CRM data scope."""
    ensure_in_scope(db, user, parent_record(db, related_module, related_id))


def _activity_parent(db: Session, activity: Activity):
    if activity.related_module in ("inquiry", "tender"):
        return parent_record(db, activity.related_module, activity.related_id)
    return parent_record(db, "organization", activity.related_id or activity.org_id)


def ensure_activity_in_scope(db: Session, user: User, activity: Activity) -> None:
    """A follow-up is open to whoever its own scope covers (creator / assignee …)
    or whoever can see the inquiry / tender / organization it is logged against."""
    if activity is None or in_scope(db, user, activity):
        return
    parent = _activity_parent(db, activity)
    if parent is not None and in_scope(db, user, parent):
        return
    ensure_in_scope(db, user, activity)


def activity_scope_filter(db: Session, user: User):
    """SQL filter for follow-up lists / counts (None = no restriction): the
    follow-up's own scope, or a parent record in scope."""
    own = scope_filter(db, user, Activity)
    if own is None:
        return None
    parts = [own]
    for module, model in (("inquiry", Inquiry), ("tender", Tender)):
        expr = scope_filter(db, user, model)
        ids = select(model.id) if expr is None else select(model.id).where(expr)
        parts.append(and_(Activity.related_module == module, Activity.related_id.in_(ids)))
    org_expr = scope_filter(db, user, Organization)
    org_ids = select(Organization.id) if org_expr is None else select(Organization.id).where(org_expr)
    parts.append(and_(
        or_(Activity.related_module == "organization", Activity.related_module.is_(None)),
        Activity.org_id.in_(org_ids),
    ))
    return or_(*parts)


def apply_activity_scope(query, db: Session, user: User):
    expr = activity_scope_filter(db, user)
    return query if expr is None else query.filter(expr)


# ── Features (core/features/crm.py) ──────────────────────────────────────
# Children of an inquiry / tender (follow-ups, documents …) are features of
# Inquiries & Tenders; an organization's own children stay on the
# Organizations tab action they always used.

def ensure_child_action(user: User, related_module: str | None, feature: str, action: str, org_action: str) -> None:
    """Inquiry / tender child -> `crm:inquiries_tenders.<feature>:<action>`;
    organization child -> `crm:organizations:<org_action>`."""
    if tab_for(related_module) == INQ:
        ensure_feature_action(user, MODULE, INQ, feature, action)
    else:
        ensure(user, ORGS, org_action)


def can_child_view(user: User, related_module: str | None, feature: str) -> bool:
    if tab_for(related_module) == INQ:
        return can_feature(user, MODULE, INQ, feature, "view")
    return can_view_tab(user, MODULE, ORGS)


def ensure_own(user: User, record, what: str) -> None:
    """The company-wide "delete only what you created" rule, without the tab
    check (the caller has already checked the feature's delete)."""
    if is_admin_user(user):
        return
    owner_id = record_owner_id(record)
    if owner_id is not None and owner_id != user.id:
        raise HTTPException(status_code=403, detail=(
            f"You can only delete {'an' if what[:1].lower() in 'aeiou' else 'a'} {what} you created yourself — this one was "
            "created by someone else. Ask its creator or an admin to delete it."))


# ── Sensitive: Prices & margins (crm:inquiries_tenders.prices:view) ──────
INQUIRY_MONEY_FIELDS = ("expected_value",)
TENDER_MONEY_FIELDS = ("tender_value", "contract_value")
QUOTATION_MONEY_FIELDS = ("price", "lump_sum_gst_percent", "discount")
QUOTATION_LINE_MONEY_FIELDS = ("unit_price", "subtotal", "total", "list_price")
STATUS_MONEY_FIELDS = ("gross_value", "discount_percent", "net_value")


def sees_prices(user: User) -> bool:
    return can_feature(user, "crm", "inquiries_tenders", "prices", "view")


def sees_quotation_prices(user: User) -> bool:
    """Quotation prices: the Prices switch, or whoever prices / releases
    quotations (create, edit or approve them) — editing implies seeing."""
    return (sees_prices(user)
            or can_feature(user, "crm", "inquiries_tenders", "quotations", "create")
            or can_feature(user, "crm", "inquiries_tenders", "quotations", "edit")
            or can_feature(user, "crm", "inquiries_tenders", "quotations", "approve"))


def blank(obj, fields: tuple[str, ...]):
    """Set `fields` to None on a response object / dict (never on a DB row)."""
    for f in fields:
        if isinstance(obj, dict):
            if f in obj:
                obj[f] = None
        elif hasattr(obj, f):
            setattr(obj, f, None)
    return obj


def drop_money_updates(user: User, updates: dict, fields: tuple[str, ...]) -> None:
    """A user who can't see the money fields gets them blanked in responses —
    so a save of the edit form must not wipe them: ignore those fields."""
    if not sees_prices(user):
        for f in fields:
            updates.pop(f, None)


def mask_revision_changes(user: User, revisions: list[dict], fields: tuple[str, ...]) -> list[dict]:
    """Blank old / new values of money fields in a revision-history list."""
    if sees_prices(user):
        return revisions
    for r in revisions:
        for c in r.get("changes", []):
            if c.get("field") in fields:
                c["old"] = c["new"] = None
    return revisions



# ── Role-based notifications (core/events/crm.py) ────────────────────────
def can_open_record(db: Session, record):
    """notify_event can_open: the member's CRM data scope covers this inquiry /
    tender / organization (any error = no)."""
    def _check(u: User) -> bool:
        try:
            return in_scope(db, u, record)
        except Exception:
            return False
    return _check


def can_open_activity(db: Session, activity: Activity):
    """notify_event can_open for a follow-up (its own scope or its parent's)."""
    def _check(u: User) -> bool:
        try:
            ensure_activity_in_scope(db, u, activity)
            return True
        except Exception:
            return False
    return _check
