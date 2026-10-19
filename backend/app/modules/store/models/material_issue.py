from __future__ import annotations
from datetime import date
from sqlalchemy import Boolean, String, Integer, Float, Date, Text, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin


class StoreMaterialIssue(Base, TimestampMixin):
    """Material issued out of a warehouse to a department/project — posts an
    'issue' stock transaction per line as soon as it's created (no separate
    draft/confirm step, matching how this module's other single-step docs
    work)."""

    __tablename__ = "store_material_issues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    issue_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False)

    requested_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
    project_or_work_order: Mapped[str | None] = mapped_column(String(150), nullable=True)
    # Set when this issue was created from the P2P "issue from stock" action
    # on an approved PR, instead of the standalone Material Issue form.
    p2p_request_id: Mapped[int | None] = mapped_column(ForeignKey("p2p_requests.id"), nullable=True)

    # StoreDocType kind "issue" — a fixed list. Which of the fields below an
    # issue must carry is decided by its type (store/issue_forms.py).
    issue_type: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Delivery challan — mandatory whenever the material leaves the factory.
    challan_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Job work vendor: vendor_id is the Vendor master row, vendor_name its
    # snapshot (a job-work Return reads it to raise the job-work inspection).
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey("vendors.id"), nullable=True)
    # When the material is due back (job work, returnable sample / site item,
    # non-destructive test).
    expected_return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Job work (GST Rule 45): the last "days out" reminder step already sent
    # for this challan (300 / 330 / 360 for inputs, 1000 / 1080 for capital
    # goods), so the daily job sends each step once.
    jobwork_reminded_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # "Against" references, one per issue type (store/issue_forms.py).
    maintenance_work_order_id: Mapped[int | None] = mapped_column(ForeignKey("maintenance_work_orders.id"), nullable=True)
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("maintenance_assets.id"), nullable=True)
    ncr_id: Mapped[int | None] = mapped_column(ForeignKey("quality_ncrs.id"), nullable=True)
    inspection_lot_id: Mapped[int | None] = mapped_column(ForeignKey("quality_inspection_lots.id"), nullable=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("crm_organizations.id"), nullable=True)
    # Type-specific details.
    process: Mapped[str | None] = mapped_column(String(30), nullable=True)       # job work: machining / plating / …
    # Job work: the processed item expected back (SAP: the subcontract order's
    # finished material) — the Job Work Receipt starts from it.
    output_item_id: Mapped[int | None] = mapped_column(ForeignKey("store_items.id"), nullable=True)
    purpose: Mapped[str | None] = mapped_column(String(20), nullable=True)       # customer sample: sample / trial
    returnable: Mapped[bool | None] = mapped_column(Boolean, nullable=True)      # sample / site material comes back?
    destructive: Mapped[bool | None] = mapped_column(Boolean, nullable=True)     # testing: material used up?
    site_address: Mapped[str | None] = mapped_column(Text, nullable=True)        # project / site
    vehicle_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    transporter: Mapped[str | None] = mapped_column(String(150), nullable=True)
    lr_number: Mapped[str | None] = mapped_column(String(50), nullable=True)     # dispatch: lorry receipt
    scrap_buyer: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Dispatch to a customer (issue type "dispatch"): the ERP machine /
    # order it goes against — Quality's dispatch release checks its
    # third-party inspection requirement (rule 8).
    erp_project_id: Mapped[int | None] = mapped_column(ForeignKey("erp_projects.id"), nullable=True)
    # Spares sent to a customer site for a service request (issue type
    # "service"): the SR whose material lines / cost this issue books.
    service_request_id: Mapped[int | None] = mapped_column(ForeignKey("erp_service_requests.id"), nullable=True, index=True)

    # Order Project (Sales › Order Projects): the vehicle / lot element the
    # material goes to — mandatory when the issue is for an RRV order
    # (store/services/project_stock.py). Lines may name their own element
    # (a dispatch ships several vehicles).
    order_project_id: Mapped[int | None] = mapped_column(
        ForeignKey("sales_order_projects.id", ondelete="SET NULL"), nullable=True, index=True)
    order_project_element_id: Mapped[int | None] = mapped_column(
        ForeignKey("sales_order_project_elements.id", ondelete="SET NULL"), nullable=True, index=True)
    # A Store Manager issued stock held for another element / project: why.
    project_stock_override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    issued_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list["StoreMaterialIssueItem"]] = relationship(
        "StoreMaterialIssueItem", back_populates="issue", cascade="all, delete-orphan"
    )


class StoreMaterialIssueItem(Base, TimestampMixin):
    __tablename__ = "store_material_issue_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("store_material_issues.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    # WM: the bin it was picked from; serialised item: the units issued.
    bin_id: Mapped[int | None] = mapped_column(ForeignKey("store_bins.id"), nullable=True)
    serial_numbers: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Order Project element this line goes to (defaults to the issue's).
    order_project_element_id: Mapped[int | None] = mapped_column(
        ForeignKey("sales_order_project_elements.id", ondelete="SET NULL"), nullable=True, index=True)

    issue: Mapped["StoreMaterialIssue"] = relationship("StoreMaterialIssue", back_populates="items")
