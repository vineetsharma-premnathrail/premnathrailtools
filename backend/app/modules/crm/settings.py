"""CRM → Settings on the shared settings framework: one notification rule per
CRM event (who gets told, on which channel — app/core/notify_rules.py).
The product / category / payment-term lists shown on the same Settings page
are their own tables (routes/products.py etc.), not settings values."""
from app.core.notify_rules import notification_groups, notification_specs, validate_notification_rules
from app.core.settings_framework import ModuleSettingsDef, register_module_settings, get_setting as _get

# event key -> (label, what triggers it). Fixed in code.
NOTIFY_EVENTS: dict[str, tuple[str, str]] = {
    "organization_create": ("Customer Organization created", "a new customer organization is added in CRM"),
    "inquiry_create": ("Inquiry created", "a new inquiry is created"),
    "tender_create": ("Tender created", "a new tender is created"),
    "discussion_message": ("Discussion message", "anyone (BD or R&D) posts in a requirement Discussion — people @tagged in it are notified anyway"),
}

register_module_settings(ModuleSettingsDef(
    module_key="crm", label="CRM",
    # Discussion involves R&D too, so its recipients may be R&D-only people.
    specs={s.key: s for s in notification_specs(NOTIFY_EVENTS, user_apps={"discussion_message": ("crm", "rnd")})}, groups=notification_groups(NOTIFY_EVENTS),
    cross_validate=lambda values: validate_notification_rules(values, NOTIFY_EVENTS),
))


def get_setting(db, key: str):
    return _get(db, "crm", key)
