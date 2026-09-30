from datetime import date, datetime
from pydantic import BaseModel


class HydLookupOption(BaseModel):
    id: int
    label: str
    code: str | None = None
    extra: str | None = None


class HydDocumentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    entity_type: str
    entity_id: int
    doc_type: str
    title: str
    description: str | None = None
    file_name: str
    file_size: int | None = None
    mime_type: str | None = None
    uploaded_by_id: int | None = None
    uploaded_by_name: str | None = None
    created_at: datetime | None = None


class HydDashboardKpis(BaseModel):
    hydraulic_systems: int = 0
    pneumatic_systems: int = 0
    in_service: int = 0
    under_maintenance: int = 0
    active_components: int = 0
    circuits_in_review: int = 0
    draft_boms: int = 0
    plans_overdue: int = 0
    plans_due_soon: int = 0
    open_service_records: int = 0
    downtime_hours_30d: float = 0.0
    service_cost_30d: float = 0.0
    tests_30d: int = 0
    tests_failed_30d: int = 0
    spares_low: int = 0
    critical_spares_out: int = 0


class HydDashboardPlanRow(BaseModel):
    plan_id: int
    plan_number: str
    title: str
    system_number: str | None = None
    system_name: str | None = None
    next_due_date: date | None = None
    due_status: str
    days_to_due: int | None = None


class HydDashboardTestRow(BaseModel):
    test_id: int
    test_number: str
    title: str
    test_type: str
    test_date: date | None = None
    status: str
    result: str


class HydDashboardSpareRow(BaseModel):
    spare_part_id: int
    part_code: str
    name: str
    criticality: str
    available_qty: float | None = None
    min_stock_qty: float
    uom: str
    stock_status: str


class HydDashboardServiceRow(BaseModel):
    record_id: int
    record_number: str
    system_number: str | None = None
    system_name: str | None = None
    service_type: str
    service_date: date
    status: str


class HydDashboardResponse(BaseModel):
    kpis: HydDashboardKpis
    maintenance_due: list[HydDashboardPlanRow] = []
    recent_tests: list[HydDashboardTestRow] = []
    low_spares: list[HydDashboardSpareRow] = []
    open_services: list[HydDashboardServiceRow] = []
