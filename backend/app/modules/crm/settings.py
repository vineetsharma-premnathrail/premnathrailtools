"""CRM → Settings on the shared settings framework: one notification rule per
CRM event (who gets told, on which channel — app/core/notify_rules.py), plus
the quotation approval limits and the BD Head who approves quotations.
The product / category / payment-term lists shown on the same Settings page
are their own tables (routes/products.py etc.), not settings values.

The quotation settings moved here from the retired Sales module (2026-10-30;
the migration copies the old module_settings rows: sales.sales_head_id ->
crm.quotation_head_id, sales.quotation_* -> crm.quotation_*)."""
from app.core.notify_rules import notification_groups, notification_specs, validate_notification_rules
from app.core.settings_framework import ModuleSettingsDef, SettingSpec, register_module_settings, get_setting as _get

# event key -> (label, what triggers it). Fixed in code.
NOTIFY_EVENTS: dict[str, tuple[str, str]] = {
    "organization_create": ("Customer Organization created", "a new customer organization is added in CRM"),
    "inquiry_create": ("Inquiry created", "a new inquiry is created"),
    "tender_create": ("Tender created", "a new tender is created"),
}

CRM_SETTING_GROUPS = {
    "quotation": "Quotation approval limits",
    **notification_groups(NOTIFY_EVENTS),
}

_QUOTATION_SPECS = [
    # Who approves is fixed: BD Head -> Director -> Partner (top). These values decide how far up it goes.
    SettingSpec("quotation_head_id", "quotation", "BD Head (quotation approver)", "user", None,
                help="Approves every quotation (the first stage). If blank, the head of the Sales / BD department is used. "
                     "This person also needs 'Approve' on CRM › Inquiries & Tenders › Quotations."),
    SettingSpec("quotation_auto_approve_value", "quotation", "No approval up to (₹, incl. GST)", "decimal", 0.0, min=0,
                help="A quotation worth at most this, with no discount, goes straight to Approved. 0 = every quotation needs the BD Head."),
    SettingSpec("quotation_director_value", "quotation", "Director approval above (₹, incl. GST)", "decimal", 5000000.0, min=0,
                help="A quotation worth more than this also needs a Director after the BD Head."),
    SettingSpec("quotation_partner_value", "quotation", "Partner approval above (₹, incl. GST)", "decimal", 20000000.0, min=0,
                help="A quotation worth more than this goes up to a Partner (the top approver)."),
    SettingSpec("quotation_director_discount_percent", "quotation", "Director approval for a discount above (%)", "decimal", 10.0, min=0, max=100,
                help="A header discount above this % (a flat discount is converted to %) needs a Director."),
    SettingSpec("quotation_partner_discount_percent", "quotation", "Partner approval for a discount above (%)", "decimal", 20.0, min=0, max=100,
                help="A header discount above this % needs a Partner."),
    SettingSpec("quotation_default_validity_days", "quotation", "Default validity (days)", "int", 30, min=1, max=365,
                help="A quotation sent without a Valid Until date is valid this many days from the quote date. After it, an unanswered quotation expires automatically."),
]

register_module_settings(ModuleSettingsDef(
    module_key="crm", label="CRM",
    specs={s.key: s for s in [*_QUOTATION_SPECS, *notification_specs(NOTIFY_EVENTS)]}, groups=CRM_SETTING_GROUPS,
    cross_validate=lambda values: validate_notification_rules(values, NOTIFY_EVENTS),
))


def get_setting(db, key: str):
    return _get(db, "crm", key)
