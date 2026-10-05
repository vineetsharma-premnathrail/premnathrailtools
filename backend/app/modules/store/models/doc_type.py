from __future__ import annotations
from sqlalchemy import String, Integer, Boolean, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Store → Settings master lists. Unlike Item Types/UOMs (pure labels), every
# row here carries the BEHAVIOUR the system needs to act on it, so an admin
# adding a new type also decides what it does to stock / who approves it:
#
#   stock_entry       Record Stock Entry types   — stock_effect: in | out
#   issue             Material Issue types       — label only (always stock out)
#   return_source     Material Return sources    — requires_issue + approver_rule
#   return_condition  Return line conditions     — stock_effect: usable | quarantine
#                                                  + approver_rule
STORE_DOC_TYPE_KINDS = ("stock_entry", "issue", "return_source", "return_condition")

STORE_DOC_TYPE_EFFECTS = {
    "stock_entry": ("in", "out"),
    "return_condition": ("usable", "quarantine"),
}

# Who must approve a Material Return that uses this source/condition.
#   none               posts immediately
#   warehouse_manager  the return warehouse's manager (Warehouses → Manager)
#   department_head    head(s) of the department the material was issued to
#   specific_users     the users listed in approver_user_ids (e.g. QC)
STORE_APPROVER_RULES = ("none", "warehouse_manager", "department_head", "specific_users")

# Seeded on an empty table — values match what existing documents already
# store, so old Issues/Returns/ledger rows keep resolving to a label.
STORE_DOC_TYPE_DEFAULTS: dict[str, list[dict]] = {
    "stock_entry": [
        {"value": "receipt", "label": "Receipt", "stock_effect": "in"},
        {"value": "issue", "label": "Issue", "stock_effect": "out"},
        {"value": "damage", "label": "Damage / write-off", "stock_effect": "out"},
    ],
    "issue": [
        {"value": "production", "label": "Production"},
        {"value": "maintenance", "label": "Maintenance"},
        {"value": "project", "label": "Project / Site"},
        {"value": "general", "label": "General / Office"},
    ],
    "return_source": [
        {"value": "issue", "label": "Against a Material Issue", "requires_issue": True, "approver_rule": "none"},
        {"value": "other", "label": "Other (no issue reference)", "approver_rule": "warehouse_manager"},
    ],
    "return_condition": [
        {"value": "good", "label": "Good", "stock_effect": "usable", "approver_rule": "none"},
        {"value": "damaged", "label": "Damaged", "stock_effect": "quarantine", "approver_rule": "department_head"},
        {"value": "rejected", "label": "Rejected (quality)", "stock_effect": "quarantine", "approver_rule": "specific_users"},
    ],
}


class StoreDocType(Base, TimestampMixin):
    __tablename__ = "store_doc_types"
    __table_args__ = (UniqueConstraint("kind", "value", name="uq_store_doc_type_kind_value"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # Stored on documents; never changes after creation (renames edit label).
    value: Mapped[str] = mapped_column(String(50), nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    stock_effect: Mapped[str | None] = mapped_column(String(20), nullable=True)
    requires_issue: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    approver_rule: Mapped[str] = mapped_column(String(30), nullable=False, default="none", server_default="none")
    approver_user_ids: Mapped[list[int] | None] = mapped_column(JSONB, nullable=True, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
