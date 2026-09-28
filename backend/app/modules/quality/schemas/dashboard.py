from pydantic import BaseModel


class QualityDashboardKpis(BaseModel):
    open_ncrs: int
    critical_ncrs: int
    open_capas: int
    overdue_capas: int
    pending_inspections: int
    failed_inspections_30d: int
    open_complaints: int
    open_rejections: int
    active_standards: int


class QualityDashboardResponse(BaseModel):
    kpis: QualityDashboardKpis
