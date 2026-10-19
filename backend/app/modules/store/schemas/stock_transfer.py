from datetime import date, datetime
from pydantic import BaseModel, Field


class StoreStockTransferItemPayload(BaseModel):
    item_id: int
    quantity: float
    batch_number: str | None = None
    remarks: str | None = None
    # WM: the bin it is picked from at the sending store; serialised: the units.
    from_bin_id: int | None = None
    serials: list[str] = Field(default_factory=list)


class StoreStockTransferItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    quantity: float
    batch_number: str | None = None
    remarks: str | None = None
    dispatch_value: float | None = None
    from_bin_id: int | None = None
    from_bin_code: str | None = None
    to_bin_id: int | None = None
    to_bin_code: str | None = None
    serial_numbers: list[str] | None = None
    # Tax-invoice transfers between GSTINs (services/transfer_gst.py).
    transfer_rate: float | None = None
    gst_rate: float | None = None
    taxable_value: float | None = None
    tax_amount: float | None = None


class StoreStockTransferCreate(BaseModel):
    from_location_id: int
    to_location_id: int
    transfer_date: date | None = None
    reason: str | None = None
    remarks: str | None = None
    items: list[StoreStockTransferItemPayload]


class StoreStockTransferResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    transfer_number: str
    from_location_id: int
    from_location_name: str | None = None
    to_location_id: int
    to_location_name: str | None = None
    transfer_date: date
    reason: str | None = None
    transferred_by_id: int | None = None
    transferred_by_name: str | None = None
    remarks: str | None = None
    status: str = "received"
    status_label: str | None = None
    approved_by_id: int | None = None
    approved_by_name: str | None = None
    decided_at: datetime | None = None
    rejected_reason: str | None = None
    dispatched_by_id: int | None = None
    dispatched_by_name: str | None = None
    dispatched_at: datetime | None = None
    vehicle_number: str | None = None
    transporter_name: str | None = None
    driver_name: str | None = None
    driver_phone: str | None = None
    eway_bill_number: str | None = None
    document_type: str | None = None
    inter_state: bool = False
    tax_invoice_number: str | None = None
    from_gstin: str | None = None
    to_gstin: str | None = None
    taxable_value: float | None = None
    cgst_amount: float | None = None
    sgst_amount: float | None = None
    igst_amount: float | None = None
    received_by_id: int | None = None
    received_by_name: str | None = None
    received_at: datetime | None = None
    receipt_remarks: str | None = None
    can_dispatch: bool = False
    can_receive: bool = False
    can_cancel: bool = False
    items: list[StoreStockTransferItemResponse] = []


class StoreStockTransferDispatch(BaseModel):
    vehicle_number: str | None = Field(None, max_length=30)
    transporter_name: str | None = Field(None, max_length=150)
    driver_name: str | None = Field(None, max_length=100)
    driver_phone: str | None = Field(None, max_length=20)
    eway_bill_number: str | None = Field(None, max_length=30)
    # Tax invoice only: transfer price per unit by line (blank = average cost).
    lines: list["StoreStockTransferDispatchLine"] | None = None


class StoreStockTransferDispatchLine(BaseModel):
    line_id: int
    transfer_rate: float | None = Field(None, ge=0)


StoreStockTransferDispatch.model_rebuild()


class StoreStockTransferReceiveBin(BaseModel):
    line_id: int
    bin_id: int | None = None


class StoreStockTransferReceive(BaseModel):
    remarks: str | None = None
    # WM putaway at the receiving store, per line (optional).
    bins: list[StoreStockTransferReceiveBin] = Field(default_factory=list)
