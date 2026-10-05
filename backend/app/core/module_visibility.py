"""Hard-coded module visibility lock (2026-10-01).

The modules in RESTRICTED_APPS are hidden from EVERY user — admins included —
except the emails in RESTRICTED_APPS_ALLOWED_EMAILS. Hidden means: not in the
user's `apps` (sidebar / dashboard / page guards), and every API route whose
code lives in that module's package returns 403 (see module_visibility_gate,
wired as a global dependency in main.py).

To open a module to everyone again, remove its key from RESTRICTED_APPS.
To let another person see the hidden modules, add their email below.
Users' `assigned_apps` in the DB are untouched, so un-restricting a module
restores exactly the access they had before.
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db.session import get_db

# App key -> display name (keys match User.AVAILABLE_APPS).
RESTRICTED_APPS: dict[str, str] = {
    "quality": "Quality",
    "production": "Production",
    "maintenance": "Maintenance",
    "design": "Design",
    "electrical": "Electrical",
    "hydraulic": "Hydraulic & Pneumatic",
    "projects": "Project Management",
    "accounts": "Finance & Accounting",
    "hr": "HR & Admin",
}

# Lower-case emails that see EVERY module (restricted or not) and are always
# admin (promoted on their next request, see get_current_user), whatever
# their role or assigned_apps — see User.get_apps().
RESTRICTED_APPS_ALLOWED_EMAILS: set[str] = {
    "vineet.sharma@premnathrail.com",
}

# Backend package (app.modules.<name>) -> app key, for the route gate.
_PACKAGE_TO_APP = {key: key for key in RESTRICTED_APPS}


def can_see_restricted_apps(email: str | None) -> bool:
    return (email or "").strip().lower() in RESTRICTED_APPS_ALLOWED_EMAILS


def _restricted_app_for_route(request: Request) -> str | None:
    route = request.scope.get("route")
    endpoint = getattr(route, "endpoint", None)
    module = getattr(endpoint, "__module__", "") or ""
    parts = module.split(".")
    if len(parts) >= 3 and parts[0] == "app" and parts[1] == "modules":
        return _PACKAGE_TO_APP.get(parts[2])
    return None


def module_visibility_gate(request: Request, db: Session = Depends(get_db)) -> None:
    """Global dependency: blocks every route of a restricted module for
    anyone not on the allow-list, including routes that don't otherwise
    check app access (e.g. HR self-service)."""
    app_key = _restricted_app_for_route(request)
    if app_key is None:
        return
    from app.modules.main.routes.auth import get_current_user  # local: avoid import cycle

    user = get_current_user(request, db)
    if not can_see_restricted_apps(user.email):
        raise HTTPException(
            status_code=403,
            detail=f"The {RESTRICTED_APPS[app_key]} module is currently switched off for your account. "
                   "Ask the portal administrator if you need access.",
        )
