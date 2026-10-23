"""Store features (module › tab › feature). See permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import _feature, register_features

register_features(
    "store", "items",
    _feature("plant_data", "Plant data (MRP per plant)", "section", {
        "view": "view", "edit": "edit",
    }, "The per-plant MRP block of an item (MRP type, procurement type, reorder point, lot size per plant): see it, and change it."),
    _feature("vendor_suggestions", "Who can supply this item", "section", {
        "view": "view",
    }, "The vendor suggestions block of an item: preferred vendor, vendor catalog prices and the last PO rate per vendor."),
    _feature("stock_values", "Stock value & rates", "sensitive", {
        "view": "view",
    }, "Money in Store (stock is valued at the PO rate): weighted average and last receipt rate of items, unit cost / value of "
       "movements, stock-on-date and overview values, job-work challan and receipt values. Without it these show as hidden "
       "everywhere in Store. Standard cost stays visible to whoever can edit items (they edit it)."),
)

register_features(
    "store", "stock",
    _feature("as_of", "Stock on a date", "section", {
        "view": "view", "export": "export",
    }, "The 'Stock on a date' report (opening, receipts, issues, closing per item and store for a period): see it and download it to Excel."),
)

register_features(
    "store", "issues",
    _feature("job_work", "Job work (subcontracting)", "subtab", {
        "view": "view", "create": "create", "export": "export",
    }, "The Job Work page: challans at vendors, stock with vendors and the GST ITC-04 report; create = send material out on a "
       "job-work issue; export = ITC-04 to Excel."),
    _feature("job_work_receipts", "Receive processed items (job work receipt)", "action", {
        "view": "view", "create": "create",
    }, "See job work receipts and receive the processed item back from the job worker (challan material is consumed). "
       "Sending material back unprocessed ('return as-is') is a Store return and needs Returns › Create."),
)

register_features(
    "store", "adjustments",
    _feature("approver", "Name the approving Store Manager", "action", {
        "view": "view", "create": "create",
    }, "The Approver field of a new stock adjustment: the Store Manager who signs it off before book stock changes. "
       "They must still be a Store Manager (or the store's own manager)."),
    _feature("cycle_count", "Physical / cycle count", "action", {
        "view": "view", "create": "create", "edit": "create", "submit": "create", "cancel": "create",
    }, "Physical stock counts: see them, start a count (freezes the items), enter counted quantities, submit the differences "
       "as one stock adjustment for approval, cancel a count. Seeing book stock during a blind count still needs Adjustments › Approve."),
    _feature("quarantine_clear", "Clear blocked stock", "action", {
        "view": "view", "create": "create",
    }, "Clear blocked (quarantine) stock: scrap it, record it as returned to the vendor, or release it to usable stock."),
    _feature("batch_status", "Block / release a batch", "action", {
        "view": "view", "edit": "create",
    }, "Change a batch's status (block or release a batch, e.g. after a failed test)."),
)

register_features(
    "store", "transfers",
    _feature("dispatch", "Dispatch a transfer", "action", {
        "view": "view", "edit": "edit",
    }, "Dispatch an approved store-to-store transfer (vehicle, transporter, e-way bill) — the stock goes in transit."),
    _feature("receive", "Receive a transfer", "action", {
        "view": "view", "edit": "edit",
    }, "Receive an in-transit transfer at the destination store (into the bins picked there)."),
    _feature("bin_moves", "Bin-to-bin moves (put-away)", "action", {
        "view": "view", "create": "create",
    }, "Move stock between bins of the same store (put-away after receipt, re-slotting) from the Bin Stock page."),
)

register_features(
    "store", "grn",
    _feature("inspection", "Quality inspection decision", "action", {
        "view": "view", "approve": "approve",
    }, "Complete the inspection of a GRN (accepted / rejected split per line, rejected serials) — accepted goes to Free stock, rejected to Blocked."),
    _feature("return_to_vendor", "Return to vendor", "action", {
        "view": "view", "create": "create",
    }, "See the returns to vendor of a GRN and send goods back to the vendor (leaves stock at the PO rate, re-opens the PO, raises a debit note when the invoice is booked)."),
    _feature("reverse", "Reverse a GRN", "action", {
        "view": "view", "approve": "approve",
    }, "Undo a GRN entered by mistake: its stock is taken back out and the PO opens again."),
    _feature("mill_tc", "Upload mill test certificates", "action", {
        "view": "view", "create": "create",
    }, "Attach the mill test certificate (TC) to a received batch."),
)

# "Assign to" rules per role (core/assignee_rules.py). The approver named on
# an adjustment / count is a per-document pick, not a Settings list, so a role
# can narrow it; the Store Manager check always applies on top.
register_pickers("store", "adjustments",
                 ("approver", "Send stock adjustments to", "Who this role may name as the approving Store Manager on a new stock adjustment."),
                 ("cycle_count", "Send count differences to", "Who this role may name as the approving Store Manager when submitting a physical count's differences."))
