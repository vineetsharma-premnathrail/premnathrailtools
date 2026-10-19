from datetime import datetime
from pydantic import BaseModel, Field


class DesignChecklistItemPayload(BaseModel):
    id: int | None = None
    text: str = Field(min_length=2, max_length=500)


class DesignChecklistItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    sort_order: int
    text: str


class DesignChecklistCreate(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    document_type: str
    discipline: str | None = None
    is_active: bool = True
    items: list[DesignChecklistItemPayload] = []


class DesignChecklistUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=255)
    discipline: str | None = None
    is_active: bool | None = None
    items: list[DesignChecklistItemPayload] | None = None


class DesignChecklistResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    document_type: str
    discipline: str | None = None
    is_active: bool
    items: list[DesignChecklistItemResponse] = []
    created_by_id: int | None = None
    updated_at: datetime | None = None


class DesignChecklistAnswer(BaseModel):
    checklist_item_id: int
    result: str  # ok | not_ok | na
    remark: str | None = Field(None, max_length=2000)


class DesignReviewResultResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    cycle: int
    checklist_item_id: int | None = None
    item_text: str
    result: str
    remark: str | None = None
    reviewer_id: int | None = None
    created_at: datetime | None = None

    reviewer_name: str | None = None


class DesignStandardCreate(BaseModel):
    body: str
    code: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=2, max_length=255)
    version: str | None = Field(None, max_length=50)
    is_current: bool = True
    remarks: str | None = Field(None, max_length=4000)


class DesignStandardUpdate(BaseModel):
    body: str | None = None
    code: str | None = Field(None, min_length=1, max_length=100)
    title: str | None = Field(None, min_length=2, max_length=255)
    version: str | None = Field(None, max_length=50)
    is_current: bool | None = None
    remarks: str | None = Field(None, max_length=4000)


class DesignStandardResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    body: str
    code: str
    title: str
    version: str | None = None
    is_current: bool
    remarks: str | None = None
    file_name: str | None = None
    file_size: int | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None

    drawing_count: int = 0


class DesignStandardPartCreate(BaseModel):
    store_item_id: int
    document_id: int | None = None
    standard_id: int | None = None
    discipline: str = "mechanical"
    notes: str | None = Field(None, max_length=4000)


class DesignStandardPartUpdate(BaseModel):
    document_id: int | None = None
    standard_id: int | None = None
    discipline: str | None = None
    notes: str | None = Field(None, max_length=4000)


class DesignStandardPartResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    store_item_id: int
    document_id: int | None = None
    standard_id: int | None = None
    discipline: str
    notes: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None

    item_code: str | None = None
    item_name: str | None = None
    item_status: str | None = None
    doc_number: str | None = None
    released_revision_label: str | None = None
    standard_label: str | None = None
    approved_makes: list[str] = []


class DesignTemplateResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    kind: str
    name: str
    description: str | None = None
    file_name: str
    file_size: int | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None

    created_by_name: str | None = None


class DesignApprovedMakeCreate(BaseModel):
    store_item_id: int
    make: str = Field(min_length=1, max_length=150)
    part_number: str | None = Field(None, max_length=150)
    status: str = "approved"
    remarks: str | None = Field(None, max_length=4000)


class DesignApprovedMakeUpdate(BaseModel):
    make: str | None = Field(None, min_length=1, max_length=150)
    part_number: str | None = Field(None, max_length=150)
    status: str | None = None
    remarks: str | None = Field(None, max_length=4000)


class DesignApprovedMakeResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    store_item_id: int
    make: str
    part_number: str | None = None
    status: str
    remarks: str | None = None
    approved_by_id: int | None = None
    updated_at: datetime | None = None

    item_code: str | None = None
    item_name: str | None = None
    approved_by_name: str | None = None
