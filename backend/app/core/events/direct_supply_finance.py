"""Direct notifications of Procurement (p2p), Store, Finance (accounts) and Production.

A direct notification is one the code sends straight to named people (the
requester, the buyer of a line, the approver, the store manager, the work
order supervisor ...) through utils/notifications.notify_user /
broadcast_notification. A role never adds recipients to it; Organization >
Roles > Notifications (and a user's own override) only pick the channels
those people receive it on. Without a setting the defaults below apply:
approvals, reminders and work handed to one person go to the bell and
Teams, results and information go to the bell only.

Every notification_type here is sent from app/modules/p2p, store, accounts
or production. Types ending in _created / _updated / _deleted are never sent
and are not listed."""
from app.core.notification_events import register_direct

BELL = ("bell",)
BELL_TEAMS = ("bell", "teams")

# ── Procurement: requisition decisions (to the requester) ───────────────────
register_direct(
    "p2p", "p2p_request_approved", "Requisition approved", "The requester",
    "an approver approves the requisition", default_channels=BELL, kind="info",
)
register_direct(
    "p2p", "p2p_request_rejected", "Requisition rejected", "The requester",
    "an approver rejects the requisition (the reason is in the message)", default_channels=BELL, kind="info",
)
register_direct(
    "p2p", "p2p_request_cancelled", "Requisition cancelled", "The requester",
    "someone other than the requester cancels the requisition", default_channels=BELL, kind="info",
)
register_direct(
    "p2p", "p2p_request_closed", "Requisition closed", "The requester",
    "the requisition is closed or short-closed (the balance will not be supplied)", default_channels=BELL, kind="info",
)
register_direct(
    "p2p", "p2p_request_item_issued_from_stock", "Item issued from store stock", "The requester",
    "an item on the requisition is issued from existing store stock instead of being purchased",
    default_channels=BELL, kind="info",
)

# ── Procurement: buyers (work handed to a person) ───────────────────────────
register_direct(
    "p2p", "p2p_request_buyer_assigned", "Assigned as buyer", "The buyer assigned to the requisition",
    "a requisition is assigned to the buyer", default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "p2p", "p2p_stock_routing", "Requisition approved, stock check result", "The main buyer and the buyer of each line",
    "an approved requisition has been checked against store stock and routed to purchase or to store issue",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "p2p", "rfq_raised_for_buyer", "RFQ raised for you", "The buyer of the lines",
    "a department head starts an RFQ on behalf of the buyer", default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "p2p", "p2p_ev_pre_po_receipt_recorded", "Material received before PO (buyer)", "The buyer of the received items",
    "Store receives material before a purchase order exists and the buyer has to create the PO",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "p2p", "p2p_line_buyer_reassigned", "Line moved to another buyer",
    "The old buyer, the new buyer and the requester",
    "a requisition line is moved from one buyer to another", default_channels=BELL, kind="info",
)
register_direct(
    "p2p", "p2p_line_short_closed", "Requisition line short-closed", "The requester and the buyer of the line",
    "a quantity on a requisition line is short-closed and will not be purchased", default_channels=BELL, kind="info",
)

# ── Procurement: purchase order approval and receiving ──────────────────────
register_direct(
    "p2p", "p2p_po_approval_pending", "Purchase order awaiting final approval", "Every Partner except the one who acted",
    "the PO approvers have approved and the purchase order needs one Partner's final approval",
    default_channels=BELL_TEAMS, kind="approval",
)
register_direct(
    "p2p", "p2p_po_approved", "Purchase order fully approved", "The requester",
    "the purchase order has all its approvals and is active", default_channels=BELL, kind="info",
)
register_direct(
    "p2p", "p2p_po_rejected", "Purchase order rejected", "The PO buyer and the requester",
    "an approver rejects the purchase order (the reason is in the message)", default_channels=BELL, kind="info",
)
register_direct(
    "p2p", "p2p_po_returned", "Purchase order returned for changes", "The PO buyer and the requester",
    "an approver returns the purchase order for changes (the reason is in the message)",
    default_channels=BELL, kind="info",
)
register_direct(
    "p2p", "p2p_po_discarded", "Draft purchase order discarded",
    "The requester, the RFQ buyer and the buyers of the lines on the PO",
    "a draft purchase order is discarded and its quantity is open to order again", default_channels=BELL, kind="info",
)
register_direct(
    "p2p", "p2p_grn_completed", "Goods received on your requisition", "The requester",
    "a goods receipt against the requisition's PO is completed", default_channels=BELL, kind="info",
)
register_direct(
    "p2p", "p2p_grn_recorded", "Goods receipt recorded", "The person who created the PO",
    "Store records a goods receipt against the PO (short supply is called out)", default_channels=BELL, kind="info",
)

# ── Store: approval outcomes and transfers ──────────────────────────────────
register_direct(
    "store", "stock_adjustment_approved", "Stock adjustment approved", "The person who raised the adjustment",
    "an approver approves the stock adjustment and it is posted to stock", default_channels=BELL, kind="info",
)
register_direct(
    "store", "stock_adjustment_rejected", "Stock adjustment rejected", "The person who raised the adjustment",
    "an approver rejects the stock adjustment (the reason is in the message)", default_channels=BELL, kind="info",
)
register_direct(
    "store", "material_return_approved", "Material return approved", "The person who returned the material",
    "an approver approves the material return and it is posted to stock", default_channels=BELL, kind="info",
)
register_direct(
    "store", "material_return_rejected", "Material return rejected", "The person who returned the material",
    "an approver rejects the material return (the reason is in the message)", default_channels=BELL, kind="info",
)
register_direct(
    "store", "stock_transfer_approved", "Stock transfer approved", "The person who raised the transfer",
    "an approver approves the stock transfer and it can be dispatched", default_channels=BELL, kind="info",
)
register_direct(
    "store", "stock_transfer_dispatched", "Stock transfer dispatched to your store", "The manager of the receiving store",
    "a stock transfer is dispatched to the store and its receipt must be confirmed",
    default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "store", "stock_transfer_received", "Stock transfer received", "The person who raised the transfer",
    "the receiving store confirms receipt of the stock transfer", default_channels=BELL, kind="info",
)

# ── Finance ─────────────────────────────────────────────────────────────────
register_direct(
    "accounts", "accounts_dispute_assigned", "Dispute assigned to you", "The owner of the dispute",
    "a customer dispute is raised with you as its owner", default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "accounts", "collections_promise_broken", "Promise to pay broken", "The collector who logged the promise",
    "a customer's promised payment date passes without the promised amount received",
    default_channels=BELL_TEAMS, kind="reminder",
)
register_direct(
    "accounts", "collections_follow_up", "Collection follow-up today", "The collector who logged the note",
    "the follow-up date of a collection note is today", default_channels=BELL_TEAMS, kind="reminder",
)
register_direct(
    "accounts", "sales_billing_due", "Billing due on a sales order", "Everyone with Finance access",
    "a billing milestone of a sales order becomes due to be invoiced", default_channels=BELL, kind="info",
)
register_direct(
    "accounts", "credit_release_decision", "Your credit release was decided", "The person who asked for the credit release",
    "Finance releases or refuses a credit release you asked for", default_channels=BELL, kind="info",
)

# ── Production ──────────────────────────────────────────────────────────────
register_direct(
    "production", "work_order_released", "Work order released", "The work order supervisor",
    "a work order is released to the shop floor with you as its supervisor", default_channels=BELL_TEAMS,
    kind="assignment",
)
register_direct(
    "production", "work_order_completed", "Work order completed", "The person who created the work order",
    "a work order is completed", default_channels=BELL, kind="info",
)
register_direct(
    "production", "production_inspection_result", "Quality gate result on a work order",
    "The work order supervisor and creator",
    "an inspection on a work order operation passes or fails (production and in-process quality both send it)",
    default_channels=BELL, kind="info",
)
register_direct(
    "production", "production_wo_change_flag", "Engineering change on an open work order",
    "The work order supervisor and creator",
    "an engineering change affects a work order that is still open", default_channels=BELL, kind="info",
)
register_direct(
    "production", "production_inspection_requested", "Final vehicle inspection requested",
    "Everyone with Quality access",
    "Production requests the final inspection of a finished vehicle", default_channels=BELL, kind="info",
)
register_direct(
    "production", "production_rrv_completed", "Vehicle build complete", "The build manager and the build creator",
    "all stages of a vehicle build are complete and it is ready for handover", default_channels=BELL, kind="info",
)
register_direct(
    "production", "production_rrv_handed_over", "Vehicle handed over",
    "The build manager and creator, and everyone with ERP access",
    "a finished vehicle is handed over to the customer and becomes a machine in service",
    default_channels=BELL, kind="info",
)
register_direct(
    "production", "production_rrv_inspection_passed", "Final inspection passed",
    "The build manager and the build creator",
    "the final vehicle inspection passes and the Final Quality Inspection stage can be completed",
    default_channels=BELL, kind="info",
)
register_direct(
    "production", "production_rework_raised", "Rework raised on a vehicle build",
    "The build manager, the build creator and the rework assignee",
    "a rework order is raised on a vehicle build", default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "production", "production_rework_done", "Rework ready for verification", "The build manager and the build creator",
    "rework is finished and someone else has to verify it", default_channels=BELL_TEAMS, kind="assignment",
)
register_direct(
    "production", "production_rework_rejected", "Rework sent back",
    "The build manager, the build creator, the person who did the rework and its assignee",
    "a verifier sends rework back because it failed verification", default_channels=BELL_TEAMS, kind="assignment",
)
