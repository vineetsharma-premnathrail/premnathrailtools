from datetime import date, datetime
from pydantic import BaseModel, Field


class ProductionBomItemPayload(BaseModel):
    # Required for stock / non-stock lines; empty on text / document lines.
    component_item_id: int | None = None
    quantity: float = Field(gt=0)
    scrap_percent: float = Field(0.0, ge=0, lt=100)
    remarks: str | None = None
    # Set on lines transferred from Design; kept when the draft is edited.
    make_buy: str | None = Field(None, pattern="^(make|buy)$")
    item_category: str = Field("stock", pattern="^(stock|non_stock|text|document)$")
    line_text: str | None = None
    document_id: int | None = None
    # Kept from a discipline-BOM merge when the draft is edited.
    source_tag: str | None = None


class ProductionBomItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    component_item_id: int | None = None
    quantity: float
    scrap_percent: float
    remarks: str | None = None
    sort_order: int
    make_buy: str | None = None
    item_category: str = "stock"
    line_text: str | None = None
    document_id: int | None = None
    source_tag: str | None = None

    document_number: str | None = None
    has_bom: bool = False
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    unit_cost: float | None = 0.0  # None = hidden (Production › BOM › costs switch)


class ProductionBomOperationPayload(BaseModel):
    sequence: int = Field(ge=1)
    operation_name: str = Field(min_length=1, max_length=150)
    workstation_id: int | None = None
    setup_hours: float = Field(0.0, ge=0)
    run_hours_per_unit: float = Field(0.0, ge=0)
    requires_inspection: bool = False
    instructions: str | None = None
    control_key: str = Field("internal", pattern="^(internal|external)$")
    confirmation: str = Field("optional", pattern="^(required|optional|none)$")
    print_on_job_card: bool = True
    vendor_id: int | None = None
    external_cost: float | None = Field(None, ge=0)


class ProductionBomOperationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    sequence: int
    operation_name: str
    workstation_id: int | None = None
    setup_hours: float
    run_hours_per_unit: float
    requires_inspection: bool
    instructions: str | None = None
    control_key: str = "internal"
    confirmation: str = "optional"
    print_on_job_card: bool = True
    vendor_id: int | None = None
    external_cost: float | None = None

    workstation_name: str | None = None
    vendor_name: str | None = None


class ProductionBomCreate(BaseModel):
    product_item_id: int
    base_quantity: float = Field(1.0, gt=0)
    description: str | None = None
    remarks: str | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    change_number: str | None = Field(None, max_length=50)
    items: list[ProductionBomItemPayload] = []
    operations: list[ProductionBomOperationPayload] = []


class ProductionBomUpdate(BaseModel):
    """Draft-only. `items` / `operations`, when sent, replace the full list."""
    base_quantity: float | None = Field(None, gt=0)
    description: str | None = None
    remarks: str | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    change_number: str | None = Field(None, max_length=50)
    items: list[ProductionBomItemPayload] | None = None
    operations: list[ProductionBomOperationPayload] | None = None


class ProductionBomFromDesignPayload(BaseModel):
    """eBOM -> mBOM transfer: the released Design BOM revision to take the
    components from. Refreshes the product's open draft if there is one,
    otherwise starts the next version (routing copied from the active one)."""
    design_bom_revision_id: int


class ProductionBomDiffRow(BaseModel):
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    design_qty: float | None = None
    production_qty: float | None = None
    design_make_buy: str | None = None
    # same | qty_changed | design_only (in the eBOM, missing here) |
    # production_only (keyed in Production — e.g. shop consumables)
    change: str


class ProductionBomDesignDiff(BaseModel):
    bom_id: int
    design_bom_id: int
    design_bom_number: str
    design_bom_title: str | None = None
    compared_revision_id: int
    compared_revision_label: str
    linked_revision_label: str | None = None
    latest_released_label: str | None = None
    outdated: bool = False
    differences: int = 0
    rows: list[ProductionBomDiffRow] = []


class ProductionDesignSource(BaseModel):
    """A released Design BOM revision and where Production stands on it."""
    design_bom_id: int
    design_bom_number: str
    title: str
    design_bom_revision_id: int
    revision_label: str
    released_at: datetime | None = None
    line_count: int = 0
    product_item_id: int
    product_code: str | None = None
    product_name: str | None = None
    # none | draft | current | outdated
    mbom_state: str
    mbom_id: int | None = None
    mbom_number: str | None = None
    mbom_version: int | None = None
    mbom_status: str | None = None
    mbom_revision_label: str | None = None


class ProductionBomResponse(BaseModel):
    model_config = {"from_attributes": True}
    lock_version: int | None = None  # SM12 optimistic lock — echo back as X-Lock-Version

    id: int
    bom_number: str
    product_item_id: int
    version: int
    base_quantity: float
    status: str
    description: str | None = None
    remarks: str | None = None
    created_by_id: int | None = None
    activated_by_id: int | None = None
    activated_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    items: list[ProductionBomItemResponse] = []
    operations: list[ProductionBomOperationResponse] = []

    # Denormalized display fields, filled in by the route.
    product_code: str | None = None
    product_name: str | None = None
    product_uom: str | None = None
    created_by_name: str | None = None
    activated_by_name: str | None = None
    # None = hidden by the Production costs switch (production/sensitive.py).
    standard_material_cost: float | None = 0.0
    standard_labour_cost: float | None = 0.0
    # Costing-sheet overhead on the standard material + labour (KGI2).
    standard_overhead_cost: float | None = 0.0
    work_order_count: int = 0

    # eBOM -> mBOM link (see ProductionBomFromDesignPayload).
    design_bom_id: int | None = None
    design_bom_revision_id: int | None = None
    design_revision_label: str | None = None
    transferred_at: datetime | None = None
    transferred_by_id: int | None = None
    design_bom_number: str | None = None
    transferred_by_name: str | None = None
    latest_design_revision_id: int | None = None
    latest_design_revision_label: str | None = None
    # A newer eBOM revision has been released since this version was taken.
    design_outdated: bool = False

    # CS02 validity / CC01 effectivity.
    valid_from: date | None = None
    valid_to: date | None = None
    change_number: str | None = None
    ecn_id: int | None = None
    effectivity_type: str | None = None
    effective_serial: str | None = None
    ecn_number: str | None = None
    # Discipline BOMs (electrical / hydraulic) merged into this version.
    discipline_merges: list["ProductionBomDisciplineMergeResponse"] = []


class ProductionBomDisciplineMergeResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    source_type: str
    source_id: int
    source_label: str
    quantities: dict = {}
    merged_by_id: int | None = None
    merged_at: datetime | None = None
    merged_by_name: str | None = None
    line_count: int = 0


class ProductionBomMergeDisciplinePayload(BaseModel):
    """CWBPP: merge an electrical job's BOM or a released hydraulic BOM into
    this draft. Lines are added per Item Master code (quantities summed with
    any existing line) and tagged with the source."""
    source_type: str = Field(pattern="^(electrical|hydraulic)$")
    source_id: int
    # Units of the discipline BOM per base_quantity of the product (1 hydraulic
    # system per machine, usually).
    multiplier: float = Field(1.0, gt=0)


class ProductionDisciplineSource(BaseModel):
    source_type: str
    source_id: int
    label: str
    title: str | None = None
    status: str
    line_count: int = 0
    unmapped_count: int = 0
    mergeable: bool = False
    problem: str | None = None


class ProductionExplosionRow(BaseModel):
    """One row of the multi-level (indented) explosion (CS11/CS12)."""
    level: int
    path: str
    item_id: int | None = None
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    item_category: str = "stock"
    quantity_per: float = 0.0
    total_quantity: float = 0.0
    make_buy: str | None = None
    has_bom: bool = False
    bom_id: int | None = None
    bom_number: str | None = None
    unit_cost: float | None = 0.0
    extended_cost: float | None = 0.0
    line_text: str | None = None
    source_tag: str | None = None
    cycle: bool = False


class ProductionExplosion(BaseModel):
    bom_id: int
    bom_number: str
    product_code: str | None = None
    product_name: str | None = None
    quantity: float
    max_level: int = 0
    total_material_cost: float | None = 0.0
    rows: list[ProductionExplosionRow] = []
