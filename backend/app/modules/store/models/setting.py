from __future__ import annotations
from sqlalchemy import String, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Keys used in store_settings (one row each, created on first save).
#   adjustment_approver_ids  list[int] — users offered as approver on a new
#                            Stock Adjustment. Empty/missing = any Store user.
#   challan_rules            {"issue_types": [str], "location_ids": [int]} —
#                            a Material Issue whose type OR warehouse is
#                            listed must carry a delivery challan number.
STORE_SETTING_ADJUSTMENT_APPROVERS = "adjustment_approver_ids"
#   vendor_issue_types       list[str] — issue types whose material goes to an
#                            outside vendor (job work); the issue must name it.
#   return_date_issue_types  list[str] — issue types whose material comes back
#                            (machining / rework etc.); the issue must
#                            carry an expected return date.
STORE_SETTING_CHALLAN_RULES = "challan_rules"
STORE_SETTING_VENDOR_ISSUE_TYPES = "vendor_issue_types"
STORE_SETTING_RETURN_DATE_ISSUE_TYPES = "return_date_issue_types"


class StoreSetting(Base, TimestampMixin):
    """Store → Settings single values that aren't a list of types."""

    __tablename__ = "store_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    value: Mapped[object | None] = mapped_column(JSONB, nullable=True)
