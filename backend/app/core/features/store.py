"""Store features (module › tab › feature). See permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import _feature, register_features
from app.core.visibility import register_visibility
from app.modules.store.models.doc_type import STORE_DOC_TYPE_DEFAULTS
from app.modules.store.models.item import STORE_ITEM_TYPE_LABELS
from app.modules.store.models.item_plant import STORE_MRP_TYPES, STORE_PROCUREMENT_TYPES

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
    # Inventory pages that used to ride silently on Stock › View (matrix cleanup 2026-11-03).
    _feature("batches", "Batches tab", "subtab", {"view": "view"},
             "The Batches page (Inventory › Batches): batches by heat no. with their mill TC, stock per batch and traceability."),
    _feature("serials", "Serial Nos. tab", "subtab", {"view": "view"},
             "The Serial Nos. page (Inventory › Serial Nos.): every unit of a serialised item and its history."),
    _feature("reorder", "Reorder tab", "subtab", {"view": "view"},
             "The Reorder page (Inventory › Reorder): items at or below their reorder point, net of what is on order. "
             "Raising a purchase requisition from it still needs Procurement › Purchase Requisitions › Create."),
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
    _feature("approver", "Name the approving Store Manager", "picker", {
        "view": "view", "create": "create",
    }, "Carries the 'Send stock adjustments to' Assign-to rule: which Store Managers this role may name as the Approver of a "
       "new stock adjustment. They must still be a Store Manager (or the store's own manager)."),
    _feature("cycle_count", "Physical Count tab", "subtab", {
        "view": "view", "create": "create", "edit": "create", "submit": "create", "cancel": "create",
    }, "The Physical Count page (Inventory › Physical Count): see counts, start a count (freezes the items), enter counted quantities, submit the differences "
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
    _feature("before_po", "Before PO tab", "subtab", {"view": "view", "create": "create"},
             "The Before PO page (Inward › Before PO): goods that arrived before their PO, held out of stock until Procurement "
             "makes the PO. See them (view); record such a receipt, attach its papers or cancel it (create)."),
)

# "Assign to" rules per role (core/assignee_rules.py). The approver named on
# an adjustment / count is a per-document pick, not a Settings list, so a role
# can narrow it; the Store Manager check always applies on top.
register_pickers("store", "adjustments",
                 ("approver", "Send stock adjustments to", "Who this role may name as the approving Store Manager on a new stock adjustment."),
                 ("cycle_count", "Send count differences to", "Who this role may name as the approving Store Manager when submitting a physical count's differences."))

# UI visibility per role (core/visibility.py): what a member of a role sees on
# the Store screens, grouped per screen (form / page / list) for the Role
# editor's "Preview & choose". Only CODED dropdowns are offered (item type,
# issue type, MRP / make-or-buy) — never DB-fed pickers (item, store, vendor,
# category, UOM). A value a role does not allow is also refused by the server
# (routes/items.py, routes/material_issues.py, routes/item_plants.py).
# Sections holding a required field are locked (always shown). Code / number,
# status and money columns are never offered (money stays behind "Stock value & rates").

# Item types: the five coded types (store_item_types seeds them; a type an admin
# adds later is not in this list — a role that restricts Item Type can't pick it).
_ITEM_TYPE_VALUES = dict(STORE_ITEM_TYPE_LABELS)
# Issue types are fixed in code (doc_type.py: labels may be renamed only).
_ISSUE_TYPE_VALUES = {d["value"]: d["label"] for d in STORE_DOC_TYPE_DEFAULTS["issue"]}

register_visibility(
    "store", "items",
    label="Item Master — form, page & list",
    screens=(("form", "Add / Edit Item form"), ("detail", "Item page"), ("list", "Item Master list")),
    sections=(
        # Add Item / Edit Item form (dashboard/store/new, the edit sheet on dashboard/store/[id])
        ("item_details", "Item Details", "Item type, category, name, UOM, status and technical specification.", True, "form"),
        ("planning", "Planning", "Purchase lead time and legacy code ('Planning & Cost' on the edit form).", False, "form"),
        ("purchasing", "Purchasing", "Preferred vendor, minimum order qty, part code, make and manufacturer.", False, "form"),
        ("tax_accounts", "Tax & Accounts", "HSN / SAC code, GST rate, purchase and sales ledgers.", False, "form"),
        ("stock_levels", "Stock Levels & Cost", "Standard cost, reorder level / qty, safety, minimum and maximum stock.", False, "form"),
        ("quality_tracking", "Quality & Tracking", "Inspection on receipt, test certificate, batch / serial / expiry tracking.", False, "form"),
        ("photo", "Photo", "The item photo on the form.", False, "form"),
        # Item page (dashboard/store/[id], read-only view). The feature grants (Plant data, Who can supply
        # this item, Stock value & rates) still decide who may see the data at all; this only hides blocks.
        ("detail_summary", "Item summary", "Name, type / category, code, status and part code at the top of the page.", True, "detail"),
        ("detail_details", "Item Details", "Item type, category, UOM and technical specification.", False, "detail"),
        ("detail_planning", "Planning & Cost", "Lead time, legacy code, standard cost and weighted average (money stays behind Stock value & rates).", False, "detail"),
        ("detail_purchasing", "Purchasing", "Preferred vendor, minimum order qty, make / manufacturer.", False, "detail"),
        ("detail_tax_accounts", "Tax & Accounts", "HSN / SAC code, GST rate, purchase and sales ledgers.", False, "detail"),
        ("detail_stock_levels", "Stock Levels", "Reorder level / qty, safety stock, min / max stock.", False, "detail"),
        ("detail_quality", "Quality & Tracking", "Inspection on receipt, test certificate, batch / serial / expiry.", False, "detail"),
        ("detail_plant_data", "Plant data (MRP views)", "Planning per plant. Access is still set by the Plant data feature; this only hides the block on screen.", False, "detail"),
        ("detail_vendors", "Vendors for this item", "Vendor suggestions. Access is still set by the Who can supply this item feature; this only hides the block on screen.", False, "detail"),
        ("detail_photo", "Photo", "The item photo on the page.", False, "detail"),
    ),
    options=(
        ("item_type", "Item Type", _ITEM_TYPE_VALUES,
         "What kind of item this role may create or change an item into. A value not allowed here is also refused by the server, "
         "and the Excel item import is refused for a restricted role.", "form"),
    ),
    tables=(
        ("items", "Item Master list", {"type": "Type", "category": "Category", "subcategory": "Subcategory", "uom": "UOM",
                                       "description": "Technical Specification"}, "list"),
    ),
)

# Per-plant MRP block of an item (feature "Plant data"): MRP type and make / buy are coded.
register_visibility(
    "store", "items", feature_key="plant_data",
    label="Item Master — plant data (MRP per plant)",
    # One screen (the plant data block on the item page): the default "main", named like the entry.
    options=(
        ("mrp_type", "MRP type", {k: v.split(" — ")[0] for k, v in STORE_MRP_TYPES.items()},
         "How a plant plans this item. A value not allowed here is also refused by the server.", "main"),
        ("procurement_type", "Make / buy", dict(STORE_PROCUREMENT_TYPES),
         "External procurement, in-house production or both. A value not allowed here is also refused by the server.", "main"),
    ),
)

register_visibility(
    "store", "issues",
    label="Material Issues — form & list",
    screens=(("form", "New Material Issue form"), ("list", "Material Issues list")),
    sections=(
        ("issue_details", "Issue Details", "Store, issue type and the fields the type asks for.", True, "form"),
        ("remarks", "Remarks", "Free-text remarks (and the Store Manager's project-stock reason). Shown anyway for an issue type "
                               "that requires remarks, e.g. Scrap / Disposal.", False, "form"),
        ("notes", "Notes", "The hints about challans, write-offs and dispatch checks.", False, "form"),
        ("items", "Items", "The item lines being issued.", True, "form"),
        ("receive_back", "Items to receive back", "Job work challan only: what the vendor sends back.", False, "form"),
    ),
    options=(
        ("issue_type", "Issue Type", _ISSUE_TYPE_VALUES,
         "Where / why material may leave the store for this role. A value not allowed here is also refused by the server "
         "(a job work challan is an issue of type Job Work). Issues made from other screens, such as spares for a "
         "service request, follow their own rules.", "form"),
    ),
    tables=(
        ("issues", "Material Issues list", {"requisition": "Purchase Requisition", "store": "Store", "issue_type": "Issue Type",
                                            "challan": "Challan No.", "vendor": "Vendor", "department": "Department",
                                            "project_wo": "Project / WO", "requested_by": "Requested By", "issued_by": "Issued By",
                                            "date": "Date", "items": "Items"}, "list"),
        ("form_items", "Item lines on the form", {"available": "Available in store", "remarks": "Remarks"}, "form"),
    ),
)

register_visibility(
    "store", "grn",
    label="Goods Receipt (GRN) — form & list",
    screens=(("form", "Record Goods Receipt form"), ("list", "Goods receipts list")),
    sections=(
        ("receipt", "Receipt", "Purchase order, receiving store and received date.", True, "form"),
        ("gate_documents", "Gate Entry & Vendor Documents", "Gate entry no., vendor invoice, challan, e-way bill, vehicle, transporter, LR.", False, "form"),
        ("remarks", "Remarks", "Condition on arrival, packing …", False, "form"),
        ("blind_receipt", "Blind Receipt", "The note explaining invoice qty vs counted qty.", False, "form"),
        ("line_items", "Line Items", "The PO lines being received.", True, "form"),
    ),
    tables=(
        ("receipts", "Goods receipts list", {"purchase_order": "PO Number", "po_date": "PO Date", "vendor": "Vendor", "received_date": "Received Date"}, "list"),
        ("upcoming", "Upcoming deliveries (approved POs)", {"requisition": "PR Number", "po_date": "PO Date", "vendor": "Vendor",
                                                          "expected_delivery": "Expected Delivery", "pending": "Pending from Vendor"}, "list"),
        ("form_lines", "PO lines on the form", {"unit": "Unit", "ordered_qty": "Ordered Qty", "already_received": "Already Received",
                                                "invoice_qty": "Invoice Qty & Variance", "bin": "Bin"}, "form"),
    ),
)

register_visibility(
    "store", "adjustments",
    label="Stock Adjustments — form & list",
    screens=(("form", "New Stock Adjustment form"), ("list", "Stock Adjustments list")),
    sections=(
        ("adjustment_details", "Adjustment Details", "Store, approver and reason.", True, "form"),
        ("remarks", "Remarks", "Free-text remarks on the adjustment.", False, "form"),
        ("items", "Items", "The counted lines.", True, "form"),
    ),
    tables=(
        ("adjustments", "Stock Adjustments list", {"store": "Store", "date": "Date", "approver": "Approver", "items": "Items"}, "list"),
        # Hiding Existing Qty (and the difference it reveals) = a blind count for that role.
        ("form_items", "Item lines on the form", {"existing_qty": "Existing Qty & difference"}, "form"),
    ),
)
