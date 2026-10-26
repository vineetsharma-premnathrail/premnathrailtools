"""Procurement → Settings on the shared settings framework.

Who approves requisitions and POs is no longer a Procurement setting
(2026-10-08): it is the approval workflows "Purchase requisition" and
"Purchase order" in Organization › Approval Workflows (app/modules/p2p/approvals.py),
seeded from the old `pr_approvers` / `po_approvers` values, which stay in
module_settings only as the seed source and are no longer shown or edited here.
What remains: the company's standard terms & conditions (shown on RFQs and POs)
and the notification rules (app/core/notify_rules.py)."""
from app.core.notify_rules import notification_groups, notification_specs, validate_notification_rules
from app.core.settings_framework import ModuleSettingsDef, SettingSpec, register_module_settings, get_setting as _get
from app.modules.main.models.user import AVAILABLE_APPS
from app.modules.p2p.models.p2p_request import P2P_CATEGORIES, P2P_CATEGORY_AUTO_BUYERS, standard_buyer_id

# Notification recipients may come from any department.
_ANY_MODULE = tuple(sorted(AVAILABLE_APPS))

NOTIFY_EVENTS: dict[str, tuple[str, str]] = {
    "pr_create": ("PR created", "a new purchase requisition is raised"),
    "pr_approved": ("PR approved", "a requisition gets its last PR approval"),
    "pr_rejected": ("PR rejected", "a requisition is rejected"),
    "rfq_create": ("RFQ created", "an RFQ is created for a requisition"),
    "po_raised": ("PO raised", "a purchase order is submitted for approval"),
    "po_approved": ("PO approved", "a purchase order gets its final (Partner) approval"),
    "vendor_create": ("Vendor added", "a new vendor is added to the vendor master"),
}

P2P_SETTING_GROUPS = {
    "terms": "Company terms & conditions",
    "invoice_match": "Invoice match tolerances (3-way match per PO line)",
    "rfq": "RFQ by email",
    "buyers": "Buyer for each requisition category",
    **notification_groups(NOTIFY_EVENTS),
}

# The company's standing PO Declaration (official Tally PO) — the default for
# "Standard terms & conditions", printed as the numbered Declaration on every PO.
DEFAULT_COMPANY_TERMS = [
    "Please quote the Purchase Order (P.O.) number on all communications, invoices and any other correspondence in connection with this order.",
    "Payment will be made after 45 days from the date of receipt of supplies unless otherwise specified.",
    "Supplies received as per the P.O. are subject to acceptance of the goods upon approval and inspection.",
    "Advance payment received from the Company should be mentioned on the bills, giving details such as cheque no., date and amount.",
    "Goods are to be delivered within the time specified in the P.O. Failure to deliver within the specified time may lead to "
    "cancellation of the order and/or purchase of the unfulfilled quantity at the supplier's cost.",
    "Any litigation arising out of or in connection with this order shall be subject to HARYANA Jurisdiction only.",
]

_SPECS = [
    SettingSpec("company_terms", "terms", "Standard terms & conditions", "longtext", "\n".join(DEFAULT_COMPANY_TERMS),
                help="Write one clause per line. Printed on every new PO (a vendor's own terms are used on the RFQ only, never on the PO). "
                     "Not entered on the RFQ."),
    # SAP OMR6 tolerance keys — read by accounts/services/po_match.py.
    SettingSpec("invoice_qty_tolerance_pct", "invoice_match", "Quantity tolerance (%)", "decimal", 2.0, min=0, max=50,
                help="A bill line may invoice up to this % more than was received (and not yet invoiced) on its PO line "
                     "before it is held as a variance for Finance Manager approval."),
    SettingSpec("invoice_price_tolerance_pct", "invoice_match", "Price tolerance (%)", "decimal", 1.0, min=0, max=50,
                help="A bill line's rate may differ from the PO line's rate by up to this % (either way)."),
    SettingSpec("invoice_price_tolerance_abs", "invoice_match", "Price tolerance cap (₹ per line)", "decimal", 500.0, min=0, max=10000000,
                help="Even inside the % tolerance, a line whose price difference (rate difference x quantity) is more "
                     "than this amount is held as a variance. 0 = no cap."),
    SettingSpec("rfq_quote_days", "rfq", "Days vendors get to quote", "int", 3, min=1, max=60,
                help="The default quote-by date on a new RFQ: today + this many days (the buyer can change it per RFQ). "
                     "Shown in the RFQ email."),
    SettingSpec("rfq_min_vendors", "rfq", "Minimum vendors per RFQ", "int", 3, min=1, max=10,
                help="An RFQ emailed to fewer vendors than this needs a written reason (single / limited quotation)."),
    SettingSpec("rfq_auto_reminder", "rfq", "Remind vendors a day before the quote-by date", "bool", True,
                help="Every morning the portal re-sends the RFQ to vendors who haven't quoted and whose quote-by date is "
                     "tomorrow. When the date passes, the buyer is told how many quotes came in."),
    # The buyer a new requisition goes to, by its category (2026-10-23) — was
    # fixed in code (P2P_CATEGORY_AUTO_BUYERS), which stays the fallback for a
    # category not yet saved here. Never blank (2026-10-26): shown pre-filled
    # with the standard buyer; categories without one are required until picked.
    *(SettingSpec(f"buyer_{code.lower()}", "buyers", f"{label} ({code})", "user", None, user_apps=("p2p", "purchase"),
                  required=True,
                  default_resolver=((lambda db, _c=code: standard_buyer_id(db, _c, active_only=True))
                                    if code in P2P_CATEGORY_AUTO_BUYERS else None),
                  help=(f"New {label} requisitions are assigned to this buyer." if code in P2P_CATEGORY_AUTO_BUYERS
                        else f"New {label} requisitions are assigned to this buyer. "
                             "Required: pick the buyer for this category."))
      for code, label in P2P_CATEGORIES.items()),
    *notification_specs(NOTIFY_EVENTS, user_apps={e: _ANY_MODULE for e in NOTIFY_EVENTS}),
]

register_module_settings(ModuleSettingsDef(
    module_key="p2p", label="Procurement",
    specs={s.key: s for s in _SPECS}, groups=P2P_SETTING_GROUPS,
    cross_validate=lambda values: validate_notification_rules(values, NOTIFY_EVENTS),
))


def get_setting(db, key: str):
    return _get(db, "p2p", key)
