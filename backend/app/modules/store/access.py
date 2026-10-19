"""Store permission helpers on top of app.core.permissions.

Item / stock / store-location / category / UOM lookups are master data that
other modules' pickers read (Production, P2P, Quality, Accounts, Electrical,
Organization › Plants …) and that every Store form needs (an issue picks
items, a transfer picks stores). They are gated by "has any portal module"
instead of a Store tab, so a Production user can still pick an item without
being granted Store › Items.
"""
from fastapi import HTTPException

from app.core.permission_registry import MODULES, can_perform
from app.core.permissions import GRANT_HINT, require_any_app_access
from app.modules.main.models.user import User

STORE_LOOKUP_APPS = tuple(MODULES)


def require_store_lookup():
    """Cross-module lookup gate: any user who can open at least one module."""
    return require_any_app_access(*STORE_LOOKUP_APPS)


def ensure_any_store_action(user: User, *grants: tuple[str, str]) -> None:
    """403 unless `user` holds at least one of the (tab, action) pairs on
    Store — for a screen that serves two tabs (e.g. the issue list that the
    New Return form also picks from)."""
    if any(can_perform(user, "store", tab, action) for tab, action in grants):
        return
    subtabs = MODULES["store"]["subtabs"]
    options = " or ".join(f"'{action.capitalize()}' on Store › {subtabs.get(tab, tab)}" for tab, action in grants)
    raise HTTPException(status_code=403, detail=f"You need {options} for this. {GRANT_HINT}")


# ── Data scope (core/data_scope.py) ─────────────────────────────────────────
# Store documents carry a store (StoreLocation), not a plant; the plant is the
# store's branch. `plant_id` is a deferred SQL expression (never loaded with
# the row) that the central data scope filters on, so "Plant" / "Multiple
# plants" scopes see the documents of their plants' stores. This replaces the
# old Store › Settings › Plant Access list (see services/plant_access.py).
from sqlalchemy import false, select  # noqa: E402
from sqlalchemy.orm import column_property, object_session  # noqa: E402

from app.core.data_scope import register_scoped, user_branch_ids, user_scope  # noqa: E402
from app.modules.store.models.location import StoreLocation  # noqa: E402
from app.modules.store.models.material_issue import StoreMaterialIssue  # noqa: E402
from app.modules.store.models.material_return import StoreMaterialReturn  # noqa: E402
from app.modules.store.models.stock_adjustment import StoreStockAdjustment  # noqa: E402
from app.modules.store.models.stock_reservation import StoreStockReservation  # noqa: E402
from app.modules.store.models.stock_transaction import StoreStockTransaction  # noqa: E402
from app.modules.store.models.stock_transfer import StoreStockTransfer  # noqa: E402


def store_plant_column(location_col):
    """Deferred `plant_id` column for a record that only carries a store id —
    e.g. `P2PGoodsReceipt.plant_id = store_plant_column(P2PGoodsReceipt.store_location_id)`
    then `register_scoped(..., branch="plant_id")`."""
    return column_property(
        select(StoreLocation.branch_id).where(StoreLocation.id == location_col).correlate_except(StoreLocation).scalar_subquery(),
        deferred=True,
    )


for _model in (StoreMaterialIssue, StoreMaterialReturn, StoreStockAdjustment, StoreStockReservation, StoreStockTransaction):
    if not hasattr(_model, "plant_id"):
        _model.plant_id = store_plant_column(_model.location_id)
if not hasattr(StoreStockTransfer, "plant_id"):
    StoreStockTransfer.plant_id = store_plant_column(StoreStockTransfer.from_location_id)
    StoreStockTransfer.to_plant_id = store_plant_column(StoreStockTransfer.to_location_id)


def _transfer_into_my_plants(user):
    """A transfer is in a plant-scoped user's view when it was sent from OR
    received into one of their plants (the receiving store keeper must see
    what's coming in)."""
    level = user_scope(user, "store")
    db = object_session(user)
    if level not in ("plant", "multi_plant") or db is None:
        return false()
    ids = user_branch_ids(db, user, level)
    return StoreStockTransfer.to_plant_id.in_(ids) if ids else false()


register_scoped(StoreMaterialIssue, "store", owner=("issued_by_id", "requested_by_id"), branch="plant_id",
                label="material issue")
register_scoped(StoreMaterialReturn, "store", entity_type="material_return", owner=("returned_by_id",),
                branch="plant_id", label="material return")
register_scoped(StoreStockAdjustment, "store", entity_type="stock_adjustment", owner=("created_by_id",),
                assigned=("approved_by_id",), branch="plant_id", label="stock adjustment")
register_scoped(StoreStockTransfer, "store", owner=("transferred_by_id",), assigned=(_transfer_into_my_plants,),
                branch="plant_id", label="stock transfer")
register_scoped(StoreStockReservation, "store", owner=("reserved_by_id",), branch="plant_id", label="stock reservation")
register_scoped(StoreStockTransaction, "store", owner=("created_by_id",), branch="plant_id", label="stock movement")
