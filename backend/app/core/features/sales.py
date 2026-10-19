"""Sales features (module › tab › feature). See permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had. Record rules (draft-only edits, sales-head checks, the
approval engine, data scope) stay as they are; a feature grant is an extra
role-level gate on top."""
from app.core.permission_registry import _feature, register_features

register_features(
    "sales", "orders",
    _feature("lines", "Lines", "subtab", {"view": "view", "edit": "edit"},
             "The Lines sub-tab of a sales order: products and quantities; edit = change a draft's lines."),
    _feature("schedule", "Delivery schedule", "subtab", {"view": "view", "edit": "edit"},
             "The Delivery Schedule sub-tab: consignees, vehicles and dates; edit = change a draft's schedule. Delivery actions stay on Sales › Delivery."),
    _feature("billing_plan", "Billing plan", "subtab", {"view": "view", "edit": "edit"},
             "The Billing Plan sub-tab: milestones and their billing status; edit = change a draft's plan, mark a milestone due and request its invoice."),
    _feature("proforma", "Proforma invoices", "subtab", {"view": "view", "create": "edit", "cancel": "edit", "print": "print"},
             "Proforma invoices on the Billing Plan sub-tab: see, raise (create), cancel and print them."),
    _feature("amendments", "Amendments", "subtab", {
        "view": "view", "create": "create", "edit": "edit", "submit": "submit", "approve": "approve", "cancel": "cancel",
    }, "The Amendments sub-tab: see amendments of a confirmed order, start / edit / submit them, approve / reject and cancel them."),
    _feature("documents", "Documents", "subtab", {"view": "view", "create": "edit", "delete": "edit"},
             "The Documents sub-tab: customer PO / LOA and amendment letters — open them, upload (create) and delete."),
    _feature("approvals", "Approvals", "subtab", {"view": "view"},
             "The Approvals sub-tab: who approved / returned / rejected the order and when."),
    _feature("timeline", "Timeline", "subtab", {"view": "view"},
             "The Timeline sub-tab: the order's change history."),
    _feature("prices", "Prices & margins", "sensitive", {"view": "view"},
             "Unit / list prices, discounts, taxable value, GST, order totals, billing amounts, LD amounts and the customer's credit position on sales orders and amendments (and the priced OA PDF). People who may edit a draft's lines always see the prices — they enter them."),
)
