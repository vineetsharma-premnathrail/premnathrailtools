"""Service (ERP) → Settings on the shared settings framework
(app/core/settings_framework.py): approval on/off switches (who approves is
Organization › Approval Workflows — app/modules/erp/access.py), and one
notification rule per Service event (who gets told, on which channel — see
app/core/notify_rules.py).

Who may create / edit / delete / view machines and SRs is NOT a setting —
it is each user's `erp_permissions` list, edited from the same Settings page
through /erp/settings/permissions (routes/settings.py)."""
from app.core.notify_rules import notification_groups, notification_specs, validate_notification_rules
from app.core.settings_framework import ModuleSettingsDef, SettingSpec, register_module_settings, get_setting as _get

# event key -> (label, what triggers it). Fixed in code — admins pick the
# recipients and channels, never new events.
NOTIFY_EVENTS: dict[str, tuple[str, str]] = {
    "project_create": ("Machine registered", "a new machine / project is registered"),
    "project_update": ("Machine updated", "any detail of a machine is changed"),
    "dispatch": ("Machine dispatched", "a machine's Dispatch Date is entered or changed"),
    "sr_create": ("Service request raised", "a new service request is raised"),
    "sr_close": ("Service request closed", "a service request is closed"),
}

ERP_SETTING_GROUPS = {"approvals": "Approvals", "warranty_billing": "Warranty & service billing", **notification_groups(NOTIFY_EVENTS)}

_SPECS = [
    SettingSpec("project_approval_required", "approvals", "New machines need approval", "bool", False,
                help="On: a newly registered machine stays 'Pending approval' and no service request can be raised "
                     "on it until it is approved. Off: machines are usable as soon as they are saved. Who approves is set in "
                     "Organization › Approval Workflows › New machine."),
    SettingSpec("sr_close_approval_required", "approvals", "Closing a service request needs approval", "bool", False,
                help="On: the engineer sets the SR to 'Review' when the work is done; an approver then closes it or "
                     "sends it back. Off: the engineer closes the SR directly. Who approves is set in "
                     "Organization › Approval Workflows › Service request closure."),
    SettingSpec("default_warranty_months", "warranty_billing", "Default warranty (months)", "int", 12, min=0, max=120,
                help="Used when a machine has no warranty end date and its product (Sales › Products) has no warranty "
                     "months: warranty end = warranty start (or commissioning / handover date) + these months."),
    SettingSpec("service_sac_code", "warranty_billing", "SAC code for service charges", "text", "998717",
                help="GST SAC printed on the labour / visit / transport lines of a service invoice "
                     "(998717 = maintenance and repair of commercial and industrial machinery)."),
    SettingSpec("service_gst_rate", "warranty_billing", "GST % on service charges", "decimal", 18.0, min=0, max=40,
                help="GST rate of the labour / visit / transport lines of a service invoice. Spares use their Item Master GST rate."),
    SettingSpec("service_labour_rate_per_hour", "warranty_billing", "Engineer labour rate (₹ / hour on site)", "decimal", 0.0,
                min=0, max=100000,
                help="Once an SR has visits, its service / labour charge = hours worked on all visits × this rate "
                     "(+ travel hours × the travel rate). 0 = the labour charge stays a hand-entered amount; travel, stay "
                     "and other expenses always come from the visits."),
    SettingSpec("service_travel_rate_per_hour", "warranty_billing", "Engineer travel rate (₹ / travel hour)", "decimal", 0.0,
                min=0, max=100000,
                help="Charged per travel hour logged on the SR's visits, added to the labour charge. 0 = travel time isn't billed."),
    *notification_specs(NOTIFY_EVENTS),
]


register_module_settings(ModuleSettingsDef(
    module_key="erp", label="Service",
    specs={s.key: s for s in _SPECS}, groups=ERP_SETTING_GROUPS,
    cross_validate=lambda values: validate_notification_rules(values, NOTIFY_EVENTS),
))


def get_setting(db, key: str):
    return _get(db, "erp", key)
