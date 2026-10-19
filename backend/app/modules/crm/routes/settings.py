"""GET/PUT /crm/settings and POST /crm/settings/reset/{key} — CRM notification
rules on the shared settings framework (app/core/settings_framework.py)."""
from app.core.permissions import require_tab_access
from app.core.settings_framework import make_settings_router
import app.modules.crm.settings  # noqa: F401 — registers the CRM settings

# Reading needs CRM › Settings › View; saving/resetting additionally needs
# Settings › Edit (enforced inside the framework via can_edit_settings).
router = make_settings_router("crm", app_access_dep=require_tab_access("crm", "settings"))
