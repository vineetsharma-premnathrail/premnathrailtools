"""The Procurement "Prices & rates" switch (core/features/p2p.py): blanks
money figures in API responses for users who may not see them. Response
data only — never the database.

Each tab has its own switch (`p2p:<tab>.prices:view`). Holders of Edit on
the RFQ / Purchase Orders / Vendors tab always see that tab's prices: they
enter the rates, and a blanked rate echoed back on save would wipe it."""
from __future__ import annotations

import types
import typing

from pydantic import BaseModel

from app.core.permission_registry import can_feature, can_perform, can_view_tab

# Every money field name the Procurement responses carry.
PRICE_FIELDS = frozenset({
    "unit_price", "line_total", "total_value", "po_value", "quoted_price", "freight_total", "packing_total",
    "old_total", "new_total", "last_po_price", "net_price", "gross_price", "discount_pct", "tax_amount", "gst_amount",
    "subtotal", "open_value", "total_open_value", "value_change", "value_incl_gst", "total_incl_gst",
    "landed_total", "landed_unit", "landed_value", "current_rate", "rate", "last_price", "avg_price", "avg_po_price",
    "min_price", "max_price", "lowest_po_price", "highest_po_price", "best_of_lines_total", "default_price",
    "amount", "value",  # PO history: invoice taxable amount, return value
})

# Tabs whose Edit holders enter the prices themselves.
_EDITOR_TABS = {"rfq", "purchase_orders", "vendors"}


def sees_prices(user, tab: str) -> bool:
    """True if `user` may see the prices of Procurement › `tab`. A user who
    reaches the tab's data without holding its View (e.g. the Purchase desk
    reading the vendor master as a lookup) is not governed by that tab's
    switch and keeps seeing prices, as before."""
    if not can_view_tab(user, "p2p", tab):
        return True
    if can_feature(user, "p2p", tab, "prices", "view"):
        return True
    return tab in _EDITOR_TABS and can_perform(user, "p2p", tab, "edit")


def _nullable(annotation) -> bool:
    if annotation is None or annotation is type(None):
        return True
    origin = typing.get_origin(annotation)
    if origin in (typing.Union, types.UnionType):
        return type(None) in typing.get_args(annotation)
    return False


def strip_prices(obj):
    """Blank every PRICE_FIELDS value in `obj` (a pydantic model, dict or
    list of them), in place, and return it. Model fields that can't be None
    are left alone so the response schema stays valid."""
    if isinstance(obj, list):
        for x in obj:
            strip_prices(x)
    elif isinstance(obj, BaseModel):
        fields = type(obj).model_fields
        for name, f in fields.items():
            val = getattr(obj, name, None)
            if name in PRICE_FIELDS:
                if val is not None and _nullable(f.annotation):
                    setattr(obj, name, None)
            elif isinstance(val, (BaseModel, list, dict)):
                strip_prices(val)
    elif isinstance(obj, dict):
        for k, val in obj.items():
            if k in PRICE_FIELDS and isinstance(val, (int, float)) and not isinstance(val, bool):
                obj[k] = None
            elif k in ("old", "new") and obj.get("field") in PRICE_FIELDS:
                obj[k] = None  # a PO amendment's price change
            elif isinstance(val, (BaseModel, list, dict)):
                strip_prices(val)
    return obj


def mask_for(user, tab: str, obj):
    """`obj` with prices blanked when `user` may not see Procurement › `tab`'s prices."""
    return obj if sees_prices(user, tab) else strip_prices(obj)
