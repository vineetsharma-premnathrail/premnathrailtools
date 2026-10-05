from datetime import date
from pydantic import BaseModel


class StoreStockTransactionCreate(BaseModel):
    item_id: int
    location_id: int
    bin_id: int | None = None
    # Stock Entry Type value (Store → Settings). transaction_type is kept for
    # older clients that sent receipt/issue/damage directly.
    entry_type: str | None = None
    transaction_type: str | None = None
    quantity: float
    batch_number: str | None = None
    reference_type: str | None = None
    reference_number: str | None = None
    vendor_name: str | None = None
    transaction_date: date | None = None
    remarks: str | None = None


class StoreStockTransactionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    location_id: int
    location_name: str | None = None
    bin_id: int | None = None
    bin_code: str | None = None
    transaction_type: str
    entry_type: str | None = None
    entry_type_label: str | None = None
    quantity: float
    batch_number: str | None = None
    reference_type: str | None = None
    reference_number: str | None = None
    vendor_name: str | None = None
    transaction_date: date
    remarks: str | None = None
    created_by_id: int | None = None
    created_by_name: str | None = None


class StoreStockBalanceResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    location_id: int
    location_name: str | None = None
    on_hand_qty: float
    reserved_qty: float
    # Not on the ORM model — always computed and set via .model_copy() in
    # the route right after model_validate(); the default here only exists
    # so model_validate() itself doesn't reject the object for lacking it.
    available_qty: float = 0
    quarantine_qty: float = 0


class StoreQuarantineClear(BaseModel):
    item_id: int
    location_id: int
    quantity: float
    disposition: str  # scrap | vendor_return | release
    remarks: str | None = None
