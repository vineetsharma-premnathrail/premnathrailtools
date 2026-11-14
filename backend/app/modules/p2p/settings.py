"""Procurement → Settings on the shared settings framework.

Who approves requisitions and POs is no longer a Procurement setting
(2026-10-08): it is the approval workflows "Purchase requisition" and
"Purchase order" in Organization › Approval Workflows (app/modules/p2p/approvals.py),
seeded from the old `pr_approvers` / `po_approvers` values, which stay in
module_settings only as the seed source and are no longer shown or edited here.
What remains: the company's standard terms & conditions (printed on POs) and
RFQ by email. Removed 2026-11-14 (owner): the approval-chain preview card, the
notification rules (who is told is Organization › Roles › Notifications) and the
invoice match tolerances (moved to Finance › Settings, accounts/settings.py)."""
from app.core.settings_framework import ModuleSettingsDef, SettingSpec, register_module_settings, get_setting as _get

P2P_SETTING_GROUPS = {
    "terms": "Company terms & conditions",
    "rfq": "RFQ by email",
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
    SettingSpec("rfq_quote_days", "rfq", "Days vendors get to quote", "int", 3, min=1, max=60,
                help="The default quote-by date on a new RFQ: today + this many days (the buyer can change it per RFQ). "
                     "Shown in the RFQ email."),
    SettingSpec("rfq_min_vendors", "rfq", "Minimum vendors per RFQ", "int", 3, min=1, max=10,
                help="An RFQ emailed to fewer vendors than this needs a written reason (single / limited quotation)."),
    SettingSpec("rfq_auto_reminder", "rfq", "Remind vendors a day before the quote-by date", "bool", True,
                help="Every morning the portal re-sends the RFQ to vendors who haven't quoted and whose quote-by date is "
                     "tomorrow. When the date passes, the buyer is told how many quotes came in."),
    # The buyer of each requisition line comes only from Buyer responsibility
    # (Item Master category -> buyer, p2p/buyer_responsibility.py). "Default buyer"
    # and "Buyer for each item type" were removed on 2026-11-14; their old
    # module_settings rows are no longer read.
]

register_module_settings(ModuleSettingsDef(
    module_key="p2p", label="Procurement",
    specs={s.key: s for s in _SPECS}, groups=P2P_SETTING_GROUPS,
))


def get_setting(db, key: str):
    return _get(db, "p2p", key)
