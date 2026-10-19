"""Sales → Settings (plan §10) on the shared settings framework
(app/core/settings_framework.py). Only the values Phase 1 code reads."""
from app.core.settings_framework import ModuleSettingsDef, SettingSpec, register_module_settings, get_setting as _get

SALES_SETTING_GROUPS = {
    "approval": "Order approval",
    "standards": "Standard terms (deviations need Director + Partner approval)",
    "defaults": "New order defaults",
    "delivery": "Delivery tracking",
    "quotation": "Quotation approval (CRM quotations before they go to the customer)",
}

_SPECS = [
    SettingSpec("sales_head_id", "approval", "Sales Head", "user", None,
                help="Approves every sales order (the 'Sales Head' stage) and handles cancel / short-close / close. "
                     "If blank, the head of the Sales / BD department is used. The order-value limits for Director / "
                     "Partner approval are set in Organization › Approval Workflows (Sales order / Sales order amendment)."),
    SettingSpec("credit_check_mode", "approval", "Credit check", "select", "warn",
                options=[("off", "Off"), ("warn", "Warn the approver"), ("block", "Block approval")],
                help="Compares the customer's open order value with their credit limit (CRM organisation)."),
    SettingSpec("standard_ld_max_percent", "standards", "Standard LD cap (%)", "decimal", 10.0, min=0, max=100,
                help="An LD cap above this, or no cap at all, is a deviation (non-standard terms — by default Director + Partner approval)."),
    SettingSpec("standard_warranty_months_max", "standards", "Standard warranty, max months", "int", 30, min=0, max=240,
                help="A warranty longer than this (from delivery or commissioning) is a deviation (non-standard terms — by default Director + Partner approval)."),
    SettingSpec("standard_min_advance_percent", "standards", "Minimum advance (%)", "decimal", 0.0, min=0, max=100,
                help="0 turns the check off. An advance milestone below this is a deviation (non-standard terms — by default Director + Partner approval)."),
    SettingSpec("default_ld_rate_percent", "defaults", "Default LD rate (%)", "decimal", 0.5, min=0, max=100),
    SettingSpec("default_ld_period", "defaults", "Default LD period", "select", "week",
                options=[("week", "Per week or part thereof"), ("day", "Per day")]),
    SettingSpec("default_ld_basis", "defaults", "Default LD basis", "select", "delayed_value",
                options=[("delayed_value", "Value of the delayed units"), ("contract_value", "Contract value")]),
    SettingSpec("default_warranty_months_from_delivery", "defaults", "Default warranty from delivery (months)", "int", 30, min=0, max=240),
    SettingSpec("default_warranty_months_from_commissioning", "defaults", "Default warranty from commissioning (months)", "int", 24, min=0, max=240),
    SettingSpec("default_warranty_rule", "defaults", "Default warranty rule", "select", "earlier_of",
                options=[("from_delivery", "From delivery"), ("from_commissioning", "From commissioning"),
                         ("earlier_of", "Whichever is earlier"), ("later_of", "Whichever is later")]),
    # Quotation release limits (SAP VA21 release strategy). Who approves is fixed:
    # Sales Head → Director → Partner (top). These values decide how far up it goes.
    SettingSpec("quotation_auto_approve_value", "quotation", "No approval up to (₹, incl. GST)", "decimal", 0.0, min=0,
                help="A quotation worth at most this, with no discount, goes straight to Approved. 0 = every quotation needs the Sales Head."),
    SettingSpec("quotation_director_value", "quotation", "Director approval above (₹, incl. GST)", "decimal", 5000000.0, min=0,
                help="A quotation worth more than this also needs a Director after the Sales Head."),
    SettingSpec("quotation_partner_value", "quotation", "Partner approval above (₹, incl. GST)", "decimal", 20000000.0, min=0,
                help="A quotation worth more than this goes up to a Partner (the top approver)."),
    SettingSpec("quotation_director_discount_percent", "quotation", "Director approval for a discount above (%)", "decimal", 10.0, min=0, max=100,
                help="A header discount above this % (a flat discount is converted to %) needs a Director."),
    SettingSpec("quotation_partner_discount_percent", "quotation", "Partner approval for a discount above (%)", "decimal", 20.0, min=0, max=100,
                help="A header discount above this % needs a Partner."),
    SettingSpec("quotation_default_validity_days", "quotation", "Default validity (days)", "int", 30, min=1, max=365,
                help="A quotation sent without a Valid Until date is valid this many days from the quote date. After it, an unanswered quotation expires automatically."),
    SettingSpec("at_risk_reminder_days", "delivery", "At-risk warning window (days)", "int", 14, min=0, max=365,
                help="A vehicle due within this many days whose build hasn't reached Final Inspection is flagged at risk."),
]


register_module_settings(ModuleSettingsDef(
    module_key="sales", label="Sales",
    specs={s.key: s for s in _SPECS}, groups=SALES_SETTING_GROUPS,
))


def get_setting(db, key: str):
    return _get(db, "sales", key)
