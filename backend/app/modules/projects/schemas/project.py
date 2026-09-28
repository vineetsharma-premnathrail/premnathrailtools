from datetime import date, datetime
from pydantic import BaseModel


class PmProjectCreate(BaseModel):
    name: str
    description: str | None = None
    scope_statement: str | None = None
    objectives: str | None = None
    client_name: str | None = None
    project_type: str | None = None
    category: str | None = None
    department_id: int | None = None
    branch_id: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    priority: str = "medium"
    project_manager_id: int | None = None
    sponsor_id: int | None = None


class PmProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    scope_statement: str | None = None
    objectives: str | None = None
    client_name: str | None = None
    project_type: str | None = None
    category: str | None = None
    department_id: int | None = None
    branch_id: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: str | None = None
    priority: str | None = None
    project_manager_id: int | None = None
    sponsor_id: int | None = None

    # Closure fields.
    closure_date: date | None = None
    closed_by_id: int | None = None
    final_status: str | None = None
    lessons_learned: str | None = None
    client_signoff: bool | None = None
    closure_report: str | None = None


class PmProjectResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_code: str
    name: str
    description: str | None = None
    scope_statement: str | None = None
    objectives: str | None = None
    client_name: str | None = None
    project_type: str | None = None
    category: str | None = None
    department_id: int | None = None
    branch_id: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: str
    priority: str
    project_manager_id: int | None = None
    sponsor_id: int | None = None
    created_by_id: int | None = None

    closure_date: date | None = None
    closed_by_id: int | None = None
    final_status: str | None = None
    lessons_learned: str | None = None
    client_signoff: bool
    closure_report: str | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    department_name: str | None = None
    branch_name: str | None = None
    project_manager_name: str | None = None
    sponsor_name: str | None = None
    created_by_name: str | None = None
    closed_by_name: str | None = None
