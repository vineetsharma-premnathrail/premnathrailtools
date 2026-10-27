from datetime import date, datetime
from pydantic import BaseModel, Field


class P2PGoodsReceiptBatchPayload(BaseModel):
    """One vendor heat / batch of a batch-tracked line (Store batches)."""
    heat_number: str
    quantity: float
    tc_number: str | None = None
    mfg_date: date | None = None
    expiry_date: date | None = None
    remarks: str | None = None


class P2PGoodsReceiptBatchInspectPayload(BaseModel):
    batch_id: int
    accepted_quantity: float


class P2PGoodsReceiptItemPayload(BaseModel):
    po_item_id: int
    received_quantity: float
    # Required (summing to received_quantity) for a batch-tracked item.
    batches: list[P2PGoodsReceiptBatchPayload] = Field(default_factory=list)
    # Blind receipt: the quantity the vendor's invoice / challan states —
    # received_quantity is what the store physically counted.
    invoice_quantity: float | None = None
    # WM putaway bin (a bin of the GRN's store).
    bin_id: int | None = None
    # Serialised item: one serial number per unit received.
    serials: list[str] = Field(default_factory=list)
    vendor_warranty_until: date | None = None


class P2PGoodsReceiptItemInspectPayload(BaseModel):
    item_id: int
    accepted_quantity: float
    rejected_quantity: float = 0
    quality_status: str
    rejection_reason: str | None = None
    remarks: str | None = None
    # Batch-tracked line in several heats, partly accepted: accepted per heat.
    batches: list[P2PGoodsReceiptBatchInspectPayload] = Field(default_factory=list)
    # Serialised line, partly rejected: the serial numbers of the rejected units.
    rejected_serials: list[str] = Field(default_factory=list)


class P2PGoodsReceiptItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    po_item_id: int
    store_item_id: int | None = None
    item_code: str | None = None
    item_name: str
    unit: str | None = None
    ordered_quantity: float
    received_quantity: float
    accepted_quantity: float | None = None
    rejected_quantity: float | None = None
    returned_quantity: float = 0
    rejected_returned_quantity: float = 0
    quality_status: str
    # quality (in Quality stock since receipt) / lot / none (asset, no stock) / null (older GRN).
    receipt_posting: str | None = None
    rejection_reason: str | None = None
    remarks: str | None = None
    # Store batches of this line (heat no., TC) — filled in by the route.
    batches: list[dict] = Field(default_factory=list)
    invoice_quantity: float | None = None
    # received − invoice quantity (None when no invoice quantity was entered).
    receipt_variance: float | None = None
    bin_id: int | None = None
    bin_code: str | None = None
    serial_numbers: list[str] | None = None
    # Project unit (vehicle / lot) this line is for (from its PO line) — Store tags the stock with it — ProjectUnitChip.
    order_project_id: int | None = None
    order_project_element_id: int | None = None
    order_project_number: str | None = None
    order_project_element_no: str | None = None
    order_project_element_label: str | None = None
    order_project_display: str | None = None


class P2PGoodsReceiptCreate(BaseModel):
    purchase_order_id: int
    store_location_id: int | None = None
    received_date: date | None = None
    remarks: str | None = None
    # Gate entry + the vendor's documents (vendor invoice no. unique per vendor).
    gate_entry_number: str | None = None
    gate_entry_at: datetime | None = None
    vendor_invoice_number: str | None = None
    vendor_invoice_date: date | None = None
    delivery_challan_number: str | None = None
    delivery_challan_date: date | None = None
    eway_bill_number: str | None = None
    vehicle_number: str | None = None
    transporter_name: str | None = None
    lr_number: str | None = None
    items: list[P2PGoodsReceiptItemPayload] = Field(default_factory=list)


class P2PGoodsReceiptInspectPayload(BaseModel):
    items: list[P2PGoodsReceiptItemInspectPayload] = Field(default_factory=list)


class P2PGoodsReceiptResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    grn_number: str
    purchase_order_id: int
    store_location_id: int | None = None
    status: str
    received_date: date
    received_by_id: int | None = None
    remarks: str | None = None
    inspected_by_id: int | None = None
    inspected_at: datetime | None = None
    reversed_by_id: int | None = None
    reversed_at: datetime | None = None
    reversal_reason: str | None = None
    gate_entry_number: str | None = None
    gate_entry_at: datetime | None = None
    vendor_invoice_number: str | None = None
    vendor_invoice_date: date | None = None
    delivery_challan_number: str | None = None
    delivery_challan_date: date | None = None
    eway_bill_number: str | None = None
    vehicle_number: str | None = None
    transporter_name: str | None = None
    lr_number: str | None = None
    created_at: datetime | None = None
    items: list[P2PGoodsReceiptItemResponse] = Field(default_factory=list)

    # Denormalized display fields, filled in by the route.
    po_number: str | None = None
    po_date: date | None = None
    p2p_request_id: int | None = None
    p2p_number: str | None = None
    vendor_name: str | None = None
    store_location_name: str | None = None
    received_by_name: str | None = None
    inspected_by_name: str | None = None
    reversed_by_name: str | None = None
    # Populated only right after /inspect completes — items whose accepted
    # quantity could NOT be posted to the Store stock ledger (no matching
    # Item Master entry by name, or no store_location_id on this GRN), so the
    # Store team knows exactly what to add before stock reflects the receipt.
    stock_sync_notes: list[str] = Field(default_factory=list)


class P2PGoodsReceiptReversePayload(BaseModel):
    reason: str
