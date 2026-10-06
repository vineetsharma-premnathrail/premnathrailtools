from pydantic import BaseModel


class QualityDashboardKpis(BaseModel):
    lots_waiting: int = 0
    lots_overdue: int = 0
    lot_waiting_days: int = 2
    open_ncrs: int = 0
    critical_ncrs: int = 0
    major_ncrs: int = 0
    minor_ncrs: int = 0
    ncrs_awaiting_approval: int = 0
    open_capas: int = 0
    overdue_capas: int = 0
    open_complaints: int = 0
    gate_inspections_pending: int = 0
    month_lots_decided: int = 0
    month_received_qty: float = 0
    month_rejected_qty: float = 0
    month_rejection_rate: float = 0


class QualityDashboardResponse(BaseModel):
    kpis: QualityDashboardKpis
