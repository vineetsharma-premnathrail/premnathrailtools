from datetime import datetime
from pydantic import BaseModel


class RndFeasibilityStudyUpdate(BaseModel):
    """Upsert payload — the project has at most one study, so create and
    update share this all-optional shape (PUT /projects/{id}/feasibility)."""

    material_cost: float | None = None
    labour_cost: float | None = None
    overhead_cost: float | None = None
    target_selling_price: float | None = None
    costing_rating: str | None = None
    costing_notes: str | None = None
    sourcing_rating: str | None = None
    sourcing_notes: str | None = None
    process_rating: str | None = None
    process_notes: str | None = None
    quality_rating: str | None = None
    quality_notes: str | None = None
    recommendation: str | None = None
    decision_notes: str | None = None


class RndFeasibilityStudyResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    material_cost: float | None = None
    labour_cost: float | None = None
    overhead_cost: float | None = None
    target_selling_price: float | None = None
    costing_rating: str | None = None
    costing_notes: str | None = None
    sourcing_rating: str | None = None
    sourcing_notes: str | None = None
    process_rating: str | None = None
    process_notes: str | None = None
    quality_rating: str | None = None
    quality_notes: str | None = None
    recommendation: str | None = None
    decision_notes: str | None = None
    reviewed_by_id: int | None = None
    reviewed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    reviewed_by_name: str | None = None
    estimated_unit_cost: float | None = None
    estimated_margin_pct: float | None = None
