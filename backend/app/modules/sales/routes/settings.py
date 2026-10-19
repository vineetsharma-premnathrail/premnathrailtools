"""GET/PUT /sales/settings and POST /sales/settings/reset/{key} — the shared
settings framework (app/core/settings_framework.py), plan §10."""
from app.core.settings_framework import make_settings_router
import app.modules.sales.settings  # noqa: F401 — registers the Sales settings

router = make_settings_router("sales")
