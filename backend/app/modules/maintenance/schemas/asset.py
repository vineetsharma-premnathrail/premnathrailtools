from datetime import date, datetime
from pydantic import BaseModel


class MaintenanceAssetCreate(BaseModel):
    asset_code: str | None = None  # blank → EQ-NNNN
    name: str
    description: str | None = None
    category: str = "production_machine"
    parent_asset_id: int | None = None
    branch_id: int
    department_id: int | None = None
    location_text: str | None = None
    workstation_id: int | None = None
    make: str | None = None
    model: str | None = None
    serial_number: str | None = None
    year_of_manufacture: int | None = None
    supplier_vendor_id: int | None = None
    purchase_date: date | None = None
    purchase_cost: float | None = None
    warranty_expiry: date | None = None
    amc_vendor_id: int | None = None
    amc_expiry: date | None = None
    criticality: str = "B"
    meter_unit: str | None = None
    current_meter_reading: float | None = None
    commissioned_on: date | None = None
    remarks: str | None = None


class MaintenanceAssetUpdate(BaseModel):
    asset_code: str | None = None
    name: str | None = None
    description: str | None = None
    category: str | None = None
    parent_asset_id: int | None = None
    branch_id: int | None = None
    department_id: int | None = None
    location_text: str | None = None
    workstation_id: int | None = None
    make: str | None = None
    model: str | None = None
    serial_number: str | None = None
    year_of_manufacture: int | None = None
    supplier_vendor_id: int | None = None
    purchase_date: date | None = None
    purchase_cost: float | None = None
    warranty_expiry: date | None = None
    amc_vendor_id: int | None = None
    amc_expiry: date | None = None
    criticality: str | None = None
    # Only operational / standby / decommissioned — breakdown and
    # under_maintenance are system-managed.
    status: str | None = None
    meter_unit: str | None = None
    current_meter_reading: float | None = None
    commissioned_on: date | None = None
    decommissioned_on: date | None = None
    remarks: str | None = None


class MaintenanceAssetResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    asset_code: str
    name: str
    description: str | None = None
    category: str
    parent_asset_id: int | None = None
    branch_id: int
    department_id: int | None = None
    location_text: str | None = None
    workstation_id: int | None = None
    make: str | None = None
    model: str | None = None
    serial_number: str | None = None
    year_of_manufacture: int | None = None
    supplier_vendor_id: int | None = None
    purchase_date: date | None = None
    purchase_cost: float | None = None
    warranty_expiry: date | None = None
    amc_vendor_id: int | None = None
    amc_expiry: date | None = None
    criticality: str
    status: str
    meter_unit: str | None = None
    current_meter_reading: float | None = None
    meter_updated_at: datetime | None = None
    commissioned_on: date | None = None
    decommissioned_on: date | None = None
    remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    branch_name: str | None = None
    department_name: str | None = None
    parent_asset_code: str | None = None
    workstation_code: str | None = None
    workstation_status: str | None = None
    supplier_vendor_name: str | None = None
    amc_vendor_name: str | None = None
    open_work_orders: int = 0
    down_since: datetime | None = None


class MaintenanceAssetHistoryEntry(BaseModel):
    kind: str  # request | work_order
    id: int
    number: str
    title: str
    status: str
    date: datetime | None = None
    downtime_minutes: int | None = None
    total_cost: float | None = None
