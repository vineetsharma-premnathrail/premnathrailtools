from pydantic import BaseModel


class BranchCreate(BaseModel):
    company_id: int
    name: str
    code: str
    address: str | None = None
    city: str | None = None
    state: str | None = None


class BranchUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None


class BranchResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    company_id: int
    name: str
    code: str
    address: str | None = None
    city: str | None = None
    state: str | None = None
    company_name: str | None = None
