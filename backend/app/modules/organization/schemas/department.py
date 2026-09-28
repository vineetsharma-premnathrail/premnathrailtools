from pydantic import BaseModel


class DepartmentMemberResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    email: str
    designation: str | None = None
    is_head: bool = False


class DepartmentAddMemberPayload(BaseModel):
    user_id: int


class DepartmentCreate(BaseModel):
    branch_id: int | None = None
    name: str
    head_user_id: int | None = None
    secondary_head_user_id: int | None = None
    additional_head_user_ids: list[int] | None = None


class DepartmentUpdate(BaseModel):
    name: str | None = None
    branch_id: int | None = None
    head_user_id: int | None = None
    secondary_head_user_id: int | None = None
    additional_head_user_ids: list[int] | None = None


class DepartmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    branch_id: int | None = None
    name: str
    code: str
    head_user_id: int | None = None
    secondary_head_user_id: int | None = None
    additional_head_user_ids: list[int] | None = None
    branch_name: str | None = None
    # "Name A / Name B / Name C…" joining head_user_id, secondary_head_user_id
    # and additional_head_user_ids — see Department.additional_head_user_ids
    # docstring.
    head_user_name: str | None = None
