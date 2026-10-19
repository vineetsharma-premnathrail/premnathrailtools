from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, ForeignKey, Date, Text, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin


class ProjectLetter(Base, TimestampMixin, SoftDeleteMixin):
    """A free-form letter written in the portal against a Project/machine
    (the "Created" side of the Documents tab, vs uploaded attachments).

    Only the letter's content is stored — the PDF/Word file is rendered on
    demand on the company letterhead, so editing a letter never leaves a
    stale file behind. letter_no is a per-machine running number
    (<serial>/LTR/001) so every outgoing letter has a quotable reference.
    Deleting is a soft delete: the row keeps its seq, so an issued reference
    number is never handed out again to a different letter.
    """

    __tablename__ = "erp_project_letters"
    __table_args__ = (UniqueConstraint("project_id", "seq", name="uq_erp_project_letters_project_seq"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("erp_projects.id"), index=True, nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    # Bumped on every content edit, so a Word draft made from an older
    # version of the letter is flagged as out of date (see managed documents).
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    letter_no: Mapped[str] = mapped_column(String(150), nullable=False)
    letter_date: Mapped[date] = mapped_column(Date, nullable=False)
    recipient: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    signatory_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    signatory_designation: Mapped[str | None] = mapped_column(String(150), nullable=True)
    # "general" = free-form letter (recipient/subject/body). Any other value is
    # a fixed-format delivery document (see erp/reports/letter_templates.py)
    # whose structured fields live in `data`; subject/recipient are derived.
    letter_type: Mapped[str] = mapped_column(String(40), nullable=False, default="general", server_default="general")
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
