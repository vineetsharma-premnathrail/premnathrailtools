"""Service (ERP) → Settings.

GET/PUT /erp/settings, POST /erp/settings/reset/{key} — approvals and
notification rules, on the shared settings framework. Who may view / create /
edit / delete machines and service requests is set by roles (Organization ›
Role & Permissions › Service & Commissioning), not here."""

from app.core.settings_framework import make_settings_router
import app.modules.erp.settings  # noqa: F401 — registers the Service settings

router = make_settings_router("erp")
