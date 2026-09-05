from pydantic import BaseModel


class DepartmentMemberResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    email: str
    designation: str | None = None
    is_head: bool = False


class DepartmentCreate(BaseModel):
    branch_id: int | None = None
    name: str
    head_user_id: int | None = None


class DepartmentUpdate(BaseModel):
    name: str | None = None
    branch_id: int | None = None
    head_user_id: int | None = None
    secondary_head_user_id: int | None = None


class DepartmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    branch_id: int | None = None
    name: str
    code: str
    head_user_id: int | None = None
    secondary_head_user_id: int | None = None
    branch_name: str | None = None
    # "Name A / Name B" when secondary_head_user_id is also set — see
    # Department.secondary_head_user_id docstring.
    head_user_name: str | None = None
