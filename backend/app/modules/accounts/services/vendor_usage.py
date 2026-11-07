"""Is a vendor used anywhere? Decides whether the shared vendor master row
(Accounts and Procurement both manage it) may be deleted.

Every column on every model that points at the vendor master is found from
the SQLAlchemy metadata, so a new table with a `*vendor_id` column is covered
without editing this file. Columns that clean up after themselves (the
vendor's own catalog and documents cascade, RFQ attachments / an item's
preferred vendor are set to blank) do not block a delete."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import Base

# Plain business words for the message the user sees.
_LABELS = {
    "accounts_bank_guarantees": "a bank guarantee",
    "accounts_party_notes": "a debit / credit note",
    "accounts_payment_proposal_lines": "a payment proposal",
    "journal_entry_lines": "ledger entries",
    "maintenance_assets": "a maintenance asset (supplier / AMC)",
    "maintenance_work_orders": "a maintenance work order",
    "p2p_landed_cost_vouchers": "a landed cost voucher",
    "p2p_po_charges": "a purchase order charge",
    "p2p_purchase_orders": "a purchase order",
    "p2p_source_list": "an item source list",
    "p2p_vendor_quotations": "a vendor quotation",
    "p2p_vendor_returns": "a return to vendor",
    "payment_transactions": "a payment",
    "production_bom_operations": "a BOM operation (job work)",
    "production_work_order_operations": "a production work order operation",
    "quality_approved_vendors": "the Quality approved vendor list",
    "quality_inspections": "a quality inspection",
    "quality_rejections": "a quality rejection",
    "quality_supplier_scorecards": "a supplier scorecard",
    "rfq_vendor_invites": "an RFQ",
    "store_batches": "a stock batch / lot",
    "store_job_work_receipts": "a job work receipt",
    "store_material_issues": "a material issue",
    "store_pre_po_receipts": "a Before-PO receipt",
    "vendor_invoices": "a vendor invoice",
}
_SELF_CLEANING = {"CASCADE", "SET NULL"}


def _vendor_columns():
    for table in Base.metadata.tables.values():
        if table.name == "vendors":
            continue
        for col in table.columns:
            if not col.name.endswith("vendor_id"):
                continue
            fks = list(col.foreign_keys)
            if fks and not any(fk.target_fullname == "vendors.id" for fk in fks):
                continue  # points at some other table
            if any((fk.ondelete or "").upper() in _SELF_CLEANING for fk in fks):
                continue
            yield table, col


def vendor_usage(db: Session, vendor_id: int) -> list[str]:
    """Where the vendor is used, as plain labels (empty = safe to delete)."""
    found: list[str] = []
    for table, col in _vendor_columns():
        if db.execute(select(col).where(col == vendor_id).limit(1)).first() is not None:
            label = _LABELS.get(table.name, table.name.replace("_", " "))
            if label not in found:
                found.append(label)
    return found


def vendor_in_use_message(name: str, used_in: list[str]) -> str:
    return (f"Vendor '{name}' can't be deleted — it is used in {', '.join(used_in)}. "
            "Set its status to Inactive or Blocked instead, so it stops showing in new RFQs and POs.")
