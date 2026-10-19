from datetime import datetime
from pydantic import BaseModel


class PmProjectDocumentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    milestone_id: int | None = None
    task_id: int | None = None
    message_id: int | None = None
    milestone_title: str | None = None
    task_title: str | None = None
    # Where the file came from, so the project manager sees who sent what:
    # project (uploaded on the project) | evidence | task | chat.
    source: str = "project"
    milestone_sequence: int | None = None
    department_name: str | None = None
    # Project Plan & Milestones: the milestone and (if any) the task the file is on.
    subtask_id: int | None = None
    plan_milestone_id: int | None = None
    plan_milestone_title: str | None = None
    plan_task_title: str | None = None
    doc_type: str
    title: str
    version: str | None = None
    file_name: str
    file_path: str
    sharepoint_url: str | None = None
    file_size: int | None = None
    mime_type: str | None = None
    description: str | None = None
    uploaded_by_id: int | None = None
    uploaded_by_name: str | None = None
    created_at: datetime | None = None
