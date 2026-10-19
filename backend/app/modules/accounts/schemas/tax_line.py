from pydantic import BaseModel


class TaxLinePayload(BaseModel):
    description: str | None = None
    store_item_id: int | None = None
    hsn_sac_code: str | None = None
    quantity: float = 1
    uom: str | None = None
    rate: float = 0
    discount_amount: float = 0
    gst_rate: float = 0
    # Blank = the default purchase/sales ledger (Ledger Settings).
    gl_account_id: int | None = None
    cost_center_id: int | None = None
    internal_order_id: int | None = None
    po_item_id: int | None = None


class TaxLineResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    line_number: int
    description: str
    store_item_id: int | None = None
    hsn_sac_code: str | None = None
    quantity: float
    uom: str | None = None
    rate: float
    discount_amount: float
    taxable_amount: float
    gst_rate: float
    cgst_amount: float
    sgst_amount: float
    igst_amount: float
    gl_account_id: int
    gl_account_code: str | None = None
    gl_account_name: str | None = None
    cost_center_id: int | None = None
    internal_order_id: int | None = None
    # Purchase invoice lines against a PO: the PO line and its 3-way match result.
    po_item_id: int | None = None
    match_status: str | None = None
    qty_variance: float | None = None
    price_variance: float | None = None
