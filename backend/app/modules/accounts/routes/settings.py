"""GET/PUT /accounts/settings and POST /accounts/settings/reset/{key} — the
shared settings framework. Reading needs the Finance app; editing needs admin
or an explicit `accounts:settings:edit` grant (framework rule)."""
from app.core.settings_framework import make_settings_router
import app.modules.accounts.settings  # noqa: F401 — registers the Finance settings

router = make_settings_router("accounts")
