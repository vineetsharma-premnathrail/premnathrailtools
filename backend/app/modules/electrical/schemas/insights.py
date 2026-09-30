from pydantic import BaseModel

from app.modules.electrical.schemas.job import ElectricalJobResponse


class ElectricalLookupOption(BaseModel):
    id: int
    code: str | None = None
    label: str
    extra: str | None = None


class ElectricalStageMeta(BaseModel):
    key: str
    label: str
    phase: str
    sequence: int
    is_mandatory: bool


class ElectricalMetaResponse(BaseModel):
    """Every coded list the Electrical UI needs, served once so labels and
    options never drift between backend and frontend."""
    stages: list[ElectricalStageMeta]
    phases: dict[str, str]
    component_categories: dict[str, str]
    panel_types: dict[str, str]
    drawing_types: dict[str, str]
    test_types: dict[str, str]
    document_categories: dict[str, str]


class ElectricalPhaseCount(BaseModel):
    phase: str
    label: str
    jobs: int


class ElectricalDashboardKpis(BaseModel):
    draft: int = 0
    in_progress: int = 0
    on_hold: int = 0
    handed_over: int = 0
    overdue: int = 0
    drawings_pending_approval: int = 0
    open_failures: int = 0
    open_issues: int = 0
    critical_issues: int = 0
    purchase_pending: int = 0
    awaiting_qc: int = 0


class ElectricalDashboardResponse(BaseModel):
    kpis: ElectricalDashboardKpis
    by_phase: list[ElectricalPhaseCount]
    recent: list[ElectricalJobResponse]
    due_soon: list[ElectricalJobResponse]
