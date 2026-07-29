from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

# Modules a user's `assigned_apps` list may contain. Admin/super_admin
# roles bypass this entirely and get access to every module regardless
# of what's in the list (see get_user_apps() usage in routes).
AVAILABLE_APPS = {"erp", "rnd", "crm"}


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(unique=True, index=True)
    name: Mapped[str]
    azure_id: Mapped[str | None] = mapped_column(unique=True, nullable=True)
    role: Mapped[str] = mapped_column(default="user")
    is_active: Mapped[bool] = mapped_column(default=True)
    designation: Mapped[str | None] = mapped_column(nullable=True)
    department: Mapped[str | None] = mapped_column(nullable=True)
    phone: Mapped[str | None] = mapped_column(nullable=True)
    assigned_apps: Mapped[list[str]] = mapped_column(JSON, default=list)
    erp_permissions: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_azure_admin: Mapped[bool] = mapped_column(default=False)

    def get_apps(self) -> list[str]:
        """Modules this user can see: admins get all of them, everyone else
        gets whatever was explicitly assigned to them."""
        if self.role in ("admin", "super_admin"):
            return sorted(AVAILABLE_APPS)
        return self.assigned_apps or []