from __future__ import annotations
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.erp.models.project import Project


class ProjectAttachment(Base, TimestampMixin):
    """A file uploaded against a Project/machine, stored in SharePoint (only the
    pointer/metadata lives here — the actual bytes live in SharePoint)."""

    __tablename__ = "erp_project_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("erp_projects.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_private: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    project: Mapped["Project"] = relationship("Project", back_populates="attachments")
    shares: Mapped[list["ProjectAttachmentShare"]] = relationship(
        "ProjectAttachmentShare", back_populates="attachment", cascade="all, delete-orphan"
    )

    @property
    def shared_with_user_ids(self) -> list[int]:
        return [s.user_id for s in self.shares if s.user_id is not None]

    @property
    def shared_departments(self) -> list[str]:
        return [s.department for s in self.shares if s.department]

    @property
    def shared_designations(self) -> list[str]:
        return [s.designation for s in self.shares if s.designation]


class ProjectAttachmentShare(Base):
    """Grants read access to a private ProjectAttachment (in addition to the
    uploader and admins, who always have access). Each row is exactly ONE of:
    a specific user, an entire department, or an entire designation — set
    whichever one column applies and leave the other two null. Matching is
    live against the viewer's *current* department/designation on the User
    row, not a frozen membership list, so moving departments or promotions
    take effect immediately without editing every shared document."""

    __tablename__ = "erp_project_attachment_shares"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    attachment_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("erp_project_attachments.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)
    designation: Mapped[str | None] = mapped_column(String(100), nullable=True)

    attachment: Mapped["ProjectAttachment"] = relationship("ProjectAttachment", back_populates="shares")
