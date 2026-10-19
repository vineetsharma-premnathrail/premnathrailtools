from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Text, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin


class ManagedDocument(Base, TimestampMixin):
    """A system-generated Word document that people may edit before it goes
    out, kept as the document of record instead of a loose download.

    Lifecycle: the system generates the .docx (letterhead + data) into
    SharePoint → people edit it in Word Online (SharePoint keeps every save
    as a version, attributed to the editor's own M365 account) or upload a
    revised copy through the portal. The latest version is the document of
    record — its PDF is rendered from it on demand. Polymorphic via
    entity_type/entity_id (e.g. "crm_quotation"/42) so quotations, letters,
    offers… share one workflow. source_revision is the entity's own revision number at
    generation, so the UI can flag a draft as stale when the underlying
    record was revised afterwards. Older rows for the same entity are kept
    as history; the newest row is the active one.
    """

    __tablename__ = "managed_documents"
    __table_args__ = (Index("ix_managed_documents_entity", "entity_type", "entity_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    source_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    docx_item_id: Mapped[str] = mapped_column(String(200), nullable=False)
    docx_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    docx_web_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    events: Mapped[list["ManagedDocumentEvent"]] = relationship(
        "ManagedDocumentEvent", back_populates="document", cascade="all, delete-orphan",
        order_by="ManagedDocumentEvent.id",
    )


class ManagedDocumentEvent(Base):
    """Portal-side actions on a ManagedDocument (generated, regenerated,
    revised copy uploaded, edit access granted). Needed alongside
    SharePoint's own version history because versions the portal writes are
    attributed there to the app ("SharePoint App"), not to the person who
    clicked — this row records who it really was."""

    __tablename__ = "managed_document_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(Integer, ForeignKey("managed_documents.id", ondelete="CASCADE"), index=True, nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    sharepoint_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    document: Mapped["ManagedDocument"] = relationship("ManagedDocument", back_populates="events")
