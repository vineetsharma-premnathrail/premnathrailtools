"""Procurement features (module › tab › feature). See permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had. Record-level rules stay on top (named approvers, the PR's
Store Manager for issue-from-stock, requester-only attachment uploads, the
Purchase-team app gate, data scope, the Settings PR/PO approvers).

Prices: each tab that shows money has its own "Prices & rates" switch (a
feature belongs to one tab, and a single module-wide switch would have to
inherit from one tab's View — users of the other tabs would lose prices on
day 1). Anyone holding Edit on the RFQ / Purchase Orders / Vendors tab
always sees that tab's prices: they type them, and a blanked rate sent back
on save would wipe the real one (app/modules/p2p/pricing.py)."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import _feature, register_features

_PRICES_HINT = ("Unit prices, tax, line totals and order values. Off = those figures are blanked on screen and in the API. "
                "Holders of Edit on this tab always see them (they enter the rates).")

register_features(
    "p2p", "purchase_requisitions",
    _feature("purchase_order", "Purchase order block", "section", {"view": "view"},
             "The Purchase Order card on a requisition (vendor, PO lines, PO document) for the people who buy or approve it."),
    _feature("fulfilment", "Stock check & issue from stock", "action", {"view": "view", "create": "view", "edit": "edit"},
             "See each line's store-stock check, issue lines from stock (only the PR's Store Manager or an admin can) and send lines to procurement (Purchase team)."),
    _feature("buyer", "Assign buyer", "action", {"edit": "edit", "view": "view"},
             "Assign or change the Purchase-team buyer of an approved requisition."),
    _feature("attachments", "Attachments", "section", {"view": "view", "create": "view", "delete": "delete"},
             "See, upload and remove supporting files. Uploading still needs Create (own PR) or Edit; removing only your own files."),
    _feature("close", "Close / short-close", "action", {"view": "view", "edit": "edit"},
             "Close a fully received requisition, or short-close a partly received one (writes the balance off)."),
    _feature("history", "Audit history", "section", {"view": "view"},
             "The requisition's change / approval history log."),
    _feature("prices", "Prices & PO values", "sensitive", {"view": "view"},
             "PO value, PO unit prices, tax and line totals shown on a requisition. Off = blanked on screen and in the API."),
)

register_features(
    "p2p", "rfq",
    _feature("vendor_quotes", "Vendor quotations", "subtab",
             {"view": "view", "create": "edit", "edit": "edit", "delete": "delete"},
             "Vendor quotation files and line-wise quotes on an RFQ: add, change and remove them (only your own files)."),
    _feature("evaluation", "Technical & commercial evaluation", "action",
             {"view": "view", "edit": "edit", "approve": "approve", "reject": "reject"},
             "Start the technical / commercial evaluation and qualify (approve) or disqualify (reject) vendor quotations."),
    _feature("comparison", "Quotation comparison", "subtab", {"view": "view", "export": "export"},
             "The side-by-side quotation comparison and its Excel export."),
    _feature("award", "Award / split award", "action", {"view": "view", "edit": "edit"},
             "Select the winning vendor quotation, or award lines to several vendors."),
    _feature("prices", "Prices & rates", "sensitive", {"view": "view"}, _PRICES_HINT),
)

register_features(
    "p2p", "purchase_orders",
    _feature("amendments", "Amendments & versions", "subtab", {"view": "view", "create": "edit", "cancel": "edit"},
             "PO amendments (raise / withdraw) and the PO's version history."),
    _feature("delivery_costs", "Delivery costs", "section",
             {"view": "view", "create": "edit", "edit": "edit", "delete": "edit"},
             "Freight / packing / other delivery charges on a PO and their landed-cost vouchers."),
    _feature("service_entries", "Service entries", "section",
             {"view": "view", "create": "create", "approve": "approve", "cancel": "cancel"},
             "Confirm services received against a PO's service lines, accept or cancel service entries."),
    _feature("po_document", "PO document", "action", {"view": "view", "create": "edit"},
             "Download the signed PO document, and upload it on a draft PO."),
    _feature("link_item", "Link PO line to Item Master", "action", {"view": "view", "edit": "edit"},
             "Link an older PO line to its Item Master item so goods can be received against it."),
    _feature("history", "PO history", "section", {"view": "view"},
             "The PO's receipt / invoice / change history."),
    _feature("prices", "Prices & rates", "sensitive", {"view": "view"}, _PRICES_HINT),
)

register_features(
    "p2p", "vendors",
    _feature("documents", "Vendor documents", "subtab", {"view": "view", "create": "edit", "delete": "delete"},
             "A vendor's documents (GST, PAN, MSME, agreements …): see, upload and remove (only your own)."),
    _feature("catalog", "Vendor catalog", "subtab",
             {"view": "view", "create": "edit", "edit": "edit", "delete": "edit", "import": "import", "export": "export"},
             "The items a vendor supplies: add, change, remove, import and export catalog lines."),
    _feature("info_records", "Item rates & approved vendors", "subtab",
             {"view": "view", "create": "edit", "edit": "edit", "delete": "delete"},
             "Saved vendor rates per item (rate contracts, last PO and quoted rates) and the approved-vendor list."),
    _feature("prices", "Prices & rates", "sensitive", {"view": "view"}, _PRICES_HINT),
)

# "Assign to" rules per role (core/assignee_rules.py). The category's
# auto-buyer (P2P_CATEGORY_AUTO_BUYERS) is coded, not picked, so it is not
# checked; PR / PO approvers are fixed in Settings and never take a rule.
register_pickers("p2p", "purchase_requisitions",
                 ("buyer", "Assign buyer to", "Who this role may assign (or re-assign) as the buyer of an approved requisition."))
