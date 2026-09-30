from sqlalchemy import String, Integer, Text, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# What a document can be attached to. entity_id points at that table's id —
# a polymorphic pointer rather than one FK column per parent.
HYD_DOCUMENT_ENTITIES = ("system", "component", "circuit", "test", "service_record")
HYD_DOCUMENT_TYPES = (
    "circuit_diagram", "schematic", "ga_drawing", "datasheet", "test_certificate", "test_report",
    "manual", "photo", "other",
)


class HydDocument(Base, TimestampMixin, SoftDeleteMixin):
    """A file attached to a Hydraulic & Pneumatic record — circuit diagrams,
    datasheets, test certificates, service photos. Bytes live in SharePoint;
    only the pointer and metadata live here, same as RndDocument."""

    __tablename__ = "hyd_documents"
    __table_args__ = (Index("ix_hyd_documents_entity", "entity_type", "entity_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(30), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    doc_type: Mapped[str] = mapped_column(String(30), default="other", nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    uploaded_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
