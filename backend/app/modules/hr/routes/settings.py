"""GET/PUT /hr/settings and POST /hr/settings/reset/{key} — the shared
settings framework (app/core/settings_framework.py).

Reading needs the HR Settings tab (HR Permission Matrix, opt-in); editing
needs admin or an explicit `hr:settings:edit` grant (framework rule), so
ordinary employees using My HR can never change HR policy."""
from app.core.settings_framework import make_settings_router
from app.modules.hr.services.access import require_hr_tab
import app.modules.hr.settings  # noqa: F401 — registers the HR settings

router = make_settings_router("hr", app_access_dep=require_hr_tab("settings"))
