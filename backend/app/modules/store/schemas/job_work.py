from datetime import date
from pydantic import BaseModel, Field


class StoreJobWorkReceiptComponentPayload(BaseModel):
    issue_item_id: int            # the challan line the material went out on
    consumed_quantity: float = 0  # used up in the processed item
    scrap_quantity: float = 0     # process scrap / loss kept by the vendor


class StoreJobWorkReceiptCreate(BaseModel):
    issue_id: int                 # the job-work challan (Material Issue of type job_work)
    location_id: int | None = None  # store receiving the processed item (default: the challan's store)
    receipt_date: date | None = None
    vendor_challan_number: str | None = None
    output_item_id: int
    output_quantity: float
    job_charge_rate: float | None = None
    purchase_order_item_id: int | None = None
    remarks: str | None = None
    components: list[StoreJobWorkReceiptComponentPayload] = Field(default_factory=list)


class StoreBatchStatusPayload(BaseModel):
    status: str                   # active | blocked
    reason: str | None = None
