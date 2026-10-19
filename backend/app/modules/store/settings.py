"""Store → valuation settings (foundation plan §5.2) on the shared settings
framework (app/core/settings_framework.py). Values only (D8): there is no
"valuation method" switch — weighted average is code.

No settings router is mounted yet: `valuation_enabled` must only be switched
on by the Phase D cut-over (backfill apply), never by hand on a ledger that
has not been valued, so it has no UI toggle in Phases A/B. While it is off the
ledger behaves exactly as before (quantity only, no cost columns)."""
from app.core.settings_framework import ModuleSettingsDef, SettingSpec, register_module_settings, get_setting as _get

STORE_SETTING_GROUPS = {
    "valuation": "Stock valuation (weighted average)",
}

_SPECS = [
    SettingSpec("valuation_enabled", "valuation", "Weighted-average valuation on", "bool", False,
                help="On: every stock movement carries a rate and value and maintains the item's company-wide "
                     "weighted average. Off: movements are quantity-only (the rollback switch). Turned on by the "
                     "valuation cut-over."),
    SettingSpec("valuation_cutover_date", "valuation", "Valuation cut-over date", "text", "",
                help="Date of the cut-over run (YYYY-MM-DD). Values on movements before it are cut-over estimates."),
    SettingSpec("require_rate_on_manual_receipt", "valuation", "Require a rate on manual receipts", "bool", True,
                help="A manual receipt or adjustment-in of an item with no average and no standard cost is refused "
                     "until a rate is entered."),
    SettingSpec("allow_negative_stock", "valuation", "Allow negative stock", "bool", False, locked=True,
                help="Locked off while weighted average is on — an average cost is undefined on negative quantity."),
]

register_module_settings(ModuleSettingsDef(
    module_key="store", label="Store",
    specs={s.key: s for s in _SPECS}, groups=STORE_SETTING_GROUPS,
))


def get_setting(db, key: str):
    return _get(db, "store", key)
