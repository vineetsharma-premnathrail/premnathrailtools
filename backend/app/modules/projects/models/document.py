from __future__ import annotations
from sqlalchemy import String, Integer, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

PM_DOCUMENT_TYPES = ("drawing", "report", "certificate", "specification", "contract", "other")


class PmProjectDocument(Base, TimestampMixin, SoftDeleteMixin):
    """A file uploaded against a Project Management module project, stored in
    SharePoint (only the pointer/metadata lives here — the actual bytes live
    in SharePoint), same pattern as CrmDocument/QualityDocument. Table
    `pm_project_documents` — not to be confused with the unrelated ERP
    `ProjectAttachment` model (table `erp_project_attachments`, for the
    machine-registry "Projects")."""

    __tablename__ = "pm_project_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("pm_projects.id"), nullable=False, index=True)
    # Set when the file is a milestone's handover evidence or a task's file;
    # both still list under the project's Documents tab.
    milestone_id: Mapped[int | None] = mapped_column(ForeignKey("pm_project_milestones.id"), nullable=True, index=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("pm_project_tasks.id"), nullable=True, index=True)
    # Set (with task_id) when the file is attached to one sub-task.
    subtask_id: Mapped[int | None] = mapped_column(ForeignKey("pm_task_subtasks.id", ondelete="CASCADE"), nullable=True, index=True)
    # Set when the file was sent in the milestone team chat.
    message_id: Mapped[int | None] = mapped_column(ForeignKey("pm_milestone_messages.id"), nullable=True, index=True)
    doc_type: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    uploaded_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
