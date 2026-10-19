"""Store › Items › "Stock value & rates" (a sensitive feature): who sees money
in Store. Users without it get these numbers blanked (None) in API responses
— the database is never touched. See app/core/features/store.py."""
from app.core.permission_registry import can_feature, can_perform

# Keys blanked in Store JSON responses (item master, movements, stock on a
# date, job work).
VALUE_KEYS = frozenset({
    "moving_average_cost", "last_receipt_rate", "unit_cost", "value", "valuation_value_after",
    "opening_value", "closing_value", "closing_rate", "total_opening_value", "total_closing_value",
    "rate", "taxable_value", "outstanding_value", "component_value", "output_unit_cost",
})


def sees_stock_values(user) -> bool:
    return can_feature(user, "store", "items", "stock_values", "view")


def sees_standard_cost(user) -> bool:
    """Standard cost is an editable item field: whoever edits items sees it
    (or saving the item would blank it)."""
    return sees_stock_values(user) or can_perform(user, "store", "items", "edit")


def mask_values(data, keys=VALUE_KEYS):
    """Copy of a dict / list tree with `keys` set to None (in place for
    dicts and lists built by the route itself)."""
    if isinstance(data, dict):
        for k, v in data.items():
            if k in keys:
                data[k] = None
            elif isinstance(v, (dict, list)):
                mask_values(v, keys)
    elif isinstance(data, list):
        for v in data:
            mask_values(v, keys)
    return data


def mask_for(user, data, keys=VALUE_KEYS):
    """`data` unchanged for users who see stock values, masked otherwise."""
    return data if sees_stock_values(user) else mask_values(data, keys)


def blank_model(user, model, fields):
    """Pydantic model copy with `fields` set to None for users without the switch."""
    if sees_stock_values(user):
        return model
    return model.model_copy(update={f: None for f in fields})
