from datetime import datetime
from pydantic import BaseModel


class QualityCharacteristicCreate(BaseModel):
    code: str
    name: str
    char_type: str = "variable"
    unit: str | None = None
    method: str | None = None
    gauge_type: str | None = None
    classification: str = "minor"
    description: str | None = None


class QualityCharacteristicUpdate(BaseModel):
    name: str | None = None
    unit: str | None = None
    method: str | None = None
    gauge_type: str | None = None
    classification: str | None = None
    description: str | None = None
    is_active: bool | None = None


class QualityCharacteristicResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    char_type: str
    unit: str | None = None
    method: str | None = None
    gauge_type: str | None = None
    classification: str
    description: str | None = None
    is_active: bool
    created_at: datetime | None = None


class QualityDefectCodeCreate(BaseModel):
    code: str
    name: str
    category: str
    description: str | None = None


class QualityDefectCodeUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    description: str | None = None
    is_active: bool | None = None


class QualityDefectCodeResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    category: str
    description: str | None = None
    is_active: bool


class QualityDispositionCodeCreate(BaseModel):
    code: str
    name: str
    disposition_type: str
    description: str | None = None


class QualityDispositionCodeUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_active: bool | None = None


class QualityDispositionCodeResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    disposition_type: str
    description: str | None = None
    is_active: bool


class QualityMasterValueCreate(BaseModel):
    list_key: str
    value: str
    label: str


class QualityMasterValueUpdate(BaseModel):
    label: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class QualityMasterValueResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    list_key: str
    value: str
    label: str
    sort_order: int
    is_active: bool


class QualitySettingsUpdatePayload(BaseModel):
    values: dict


class QualityRoleAssignPayload(BaseModel):
    user_id: int
    role: str


class QualityAqlPlanResponse(BaseModel):
    model_config = {"from_attributes": True}

    code_letter: str
    severity: str
    aql: float
    sample_size: int
    accept_number: int
    reject_number: int


class QualitySampleSizeCodeResponse(BaseModel):
    model_config = {"from_attributes": True}

    inspection_level: str
    lot_size_min: int
    lot_size_max: int | None = None
    code_letter: str


class QualitySamplingCalcResponse(BaseModel):
    sample_size: int
    accept_number: int
    reject_number: int
    code_letter: str | None = None
    basis: str
