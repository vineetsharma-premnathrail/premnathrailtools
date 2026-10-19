"""Shared plumbing for the demo seeders (scripts/seed_demo.py).

Every seeder gets one `Demo` context:

* `demo.call(method, url, user, **kw)` — the real API through FastAPI's
  TestClient, acting as that user, so demo records go through the same
  validation, numbering, approvals and stock/ledger posting as real ones.
  A failure stops the run with the server's own message.
* `demo.user(slug, name, apps, role="user", **flags)` — a demo person
  (demo.<slug>@example.invalid, name "DEMO …"). Can't log in (SSO only);
  the script acts for them. Re-used if it already exists.
* `demo.data` — registry shared across seeders, so later modules link to
  what earlier ones made (customer → inquiry → offer → order → …).
  Every key a seeder puts there is listed in its module docstring.
* `demo.db` — a SQLAlchemy session, for lookups or masters with no API.

Access (RBAC — deny by default; see app/core/permission_registry.py). A
demo person's modules follow from the roles they hold, NOT from the `apps`
list passed to demo.user() (that only fills the legacy assigned_apps
column). Give people real roles through these helpers — all of them go
through the Organization › Role & Permissions API as the admin (`demo.me`):

* `demo.perms(module, *tabs, actions=None, skip=())` → list of concrete
  `module:tab:action` ids. No tabs = every tab of the module; actions=None =
  every action the tab has (an action a tab doesn't have is just skipped, so
  `demo.perms("store", actions=["view"])` is "Store view-only").
* `demo.role(name, *grants, description=None, data_scopes=None)` → role dict
  from the API. Creates the role "DEMO <name>" or, if it exists, replaces its
  grants (so a re-run picks up changes). `grants` may be ids, wildcards
  (`store:*:*`, `store:*:view`) or lists of them (e.g. demo.perms(...)).
* `demo.assign(user, *roles)` — adds roles to what the user already holds.
  A role is a dict/id from demo.role(), "DEMO <name>", the short "<name>"
  (the DEMO role wins over a real role of the same name), or any existing
  role's name ("Quality head", "Employee self-service",
  "Store – Full Access"; '-' and '–' are treated alike, case ignored).
* `demo.grant(user, *grants)` — adds EXTRA grants (on top of roles).
* `demo.flags(user, **flags)` — approval flags through PATCH /users/{id}
  (is_store_manager, is_purchase_manager, is_purchase_head, is_director,
  is_finance_manager, is_design_manager, is_rnd_manager,
  is_production_manager, is_project_manager, is_department_head,
  is_project_head, is_plant_head). `is_partner=True` goes through Company
  Info → Partners instead (the only place Partner is granted).
* `demo.gstin(state_code, pan)` → a GSTIN with a valid check character.

Nothing leaves this machine: every outbound HTTP request is refused (only
the in-process TestClient host is allowed), SharePoint is replaced by an
in-memory store, and mail/Teams are no-ops. Run only against a localhost
database — `guard_local_database()` refuses anything else.
"""
from __future__ import annotations

import io
import sys
import uuid
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

DEMO_DOMAIN = "example.invalid"
LABEL = "DEMO"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
_ALLOWED_HTTP_HOSTS = {"testserver", *LOCAL_HOSTS}


def guard_local_database() -> str:
    from app.core.config import settings
    host = urlparse(settings.database_url.replace("+psycopg", "").replace("+psycopg2", "")).hostname
    if host not in LOCAL_HOSTS:
        raise SystemExit(f"Refusing to seed demo data: DATABASE_URL points at '{host}', not this machine. "
                         "Demo data is for the local database only.")
    return settings.database_url


# ── Outbound side effects ─────────────────────────────────────────────────

class FakeSharePoint:
    """In-memory stand-in for every SharePoint call the app makes."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    def _item(self, folder: str, name: str, data: bytes) -> dict:
        item_id = uuid.uuid4().hex
        path = f"{folder.strip('/')}/{name}"
        self.files[item_id] = self.files[path] = data
        return {"item_id": item_id, "id": item_id, "name": name, "path": path, "size": len(data),
                "webUrl": f"https://demo.invalid/{path}"}

    async def upload_bytes(self, site_id, folder_path, filename, content_type, data):
        return self._item(folder_path, filename, data)

    async def upload_file(self, site_id, folder_path, upload_file):
        upload_file.file.seek(0)
        return self._item(folder_path, upload_file.filename, upload_file.file.read())

    async def replace(self, site_id, item_id, data, content_type):
        self.files[item_id] = data
        return {"id": item_id}

    async def none(self, *a, **k):
        return None

    async def versions(self, site_id, item_id):
        return [{"version": "1.0", "id": "1.0", "modified_by": "DEMO", "modified_at": date.today().isoformat(), "size": len(self.files.get(item_id, b""))}]

    async def download_item(self, site_id, item_id, as_pdf=False):
        return self.files.get(item_id, b"")

    async def download_version(self, site_id, item_id, version_id):
        return self.files.get(item_id, b"")

    async def download_content(self, site_id, file_path):
        return self.files.get(file_path, b"%PDF-1.4 demo placeholder"), "application/octet-stream"

    async def url(self, *a, **k):
        return "https://demo.invalid/file"

    async def upload_session(self, site_id, folder_path, filename):
        return {"upload_url": "https://demo.invalid/upload", "item_id": None}

    async def drive_item(self, site_id, item_id):
        return {"id": item_id, "size": len(self.files.get(item_id, b""))}

    async def head(self, site_id, item_id, length=16):
        return self.files.get(item_id, b"")[:length]


_SP_FAKES = {
    "upload_bytes_to_sharepoint": "upload_bytes", "upload_file_to_sharepoint": "upload_file",
    "replace_item_content": "replace", "grant_item_edit_access": "none", "list_item_versions": "versions",
    "download_item": "download_item", "download_item_version": "download_version",
    "delete_file_from_sharepoint": "none", "delete_drive_item": "none", "download_file_content": "download_content",
    "get_preview_url": "url", "get_download_url": "url", "create_upload_session": "upload_session",
    "get_drive_item": "drive_item", "read_item_head": "head",
}


def _block_network() -> None:
    import httpx

    def guard(original):
        def send(self, request, *a, **k):
            if request.url.host not in _ALLOWED_HTTP_HOSTS:
                raise RuntimeError(f"Demo seeding blocks outbound requests ({request.url.host}).")
            return original(self, request, *a, **k)
        return send

    def aguard(original):
        async def send(self, request, *a, **k):
            if request.url.host not in _ALLOWED_HTTP_HOSTS:
                raise RuntimeError(f"Demo seeding blocks outbound requests ({request.url.host}).")
            return await original(self, request, *a, **k)
        return send

    httpx.Client.send = guard(httpx.Client.send)
    httpx.AsyncClient.send = aguard(httpx.AsyncClient.send)


def stub_side_effects() -> FakeSharePoint:
    """Call after `import app.main`: patches every loaded module that
    imported a SharePoint/mail function, so nothing reaches Microsoft."""
    _block_network()
    from app.core.config import settings
    settings.SHAREPOINT_SITE_ID = settings.SHAREPOINT_SITE_ID or "demo-site"

    sp = FakeSharePoint()

    async def _mail_ok(*a, **k):
        return True

    async def _mail_ok_pair(*a, **k):
        # Senders annotated `-> tuple[bool, str]` are unpacked as (success, error).
        return True, ""

    def _mail_fake(obj):
        ret = str(getattr(obj, "__annotations__", {}).get("return", "")).replace("typing.", "").lower()
        return _mail_ok_pair if ret.startswith("tuple") else _mail_ok

    import app.utils.notifications as notifications
    notifications._notify_teams = lambda *a, **k: None
    for module in list(sys.modules.values()):
        name = getattr(module, "__name__", "")
        if not name.startswith("app."):
            continue
        for attr, fake in _SP_FAKES.items():
            if hasattr(module, attr):
                setattr(module, attr, getattr(sp, fake))
        for attr in dir(module):
            if attr == "_send_graph_mail" or (attr.startswith(("send_", "_send_")) and "email" in attr):
                obj = getattr(module, attr)
                if callable(obj) and obj not in (_mail_ok, _mail_ok_pair):
                    setattr(module, attr, _mail_fake(obj))
    from app.middleware.owasp import RATE_CONFIG
    for cfg in RATE_CONFIG.values():
        if isinstance(cfg, dict) and "limit" in cfg:
            cfg["limit"] = 10 ** 6
    return sp


# ── Context ───────────────────────────────────────────────────────────────

@dataclass
class Demo:
    db: Any
    client: Any
    me: Any                      # the real admin running the seed (sees everything in the UI)
    sp: FakeSharePoint
    data: dict = field(default_factory=dict)
    log: list = field(default_factory=list)
    today: date = field(default_factory=date.today)

    def headers(self, user) -> dict:
        from app.auth.jwt_handler import create_access_token
        return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}

    def call(self, method: str, url: str, user=None, ok=(200, 201, 204), **kw):
        user = user or self.me
        r = self.client.request(method, f"/api/v1{url}", headers=self.headers(user), **kw)
        if r.status_code not in ok and r.status_code >= 400:
            raise SystemExit(f"\n{method} {url} as {user.email} failed ({r.status_code}): {r.text[:800]}")
        if r.status_code == 204 or not r.content:
            return None
        ctype = r.headers.get("content-type", "")
        return r.json() if "json" in ctype else r.content

    def try_call(self, method: str, url: str, user=None, **kw):
        """Like call(), but returns (status, body) instead of stopping — for
        optional steps whose failure shouldn't end the whole demo."""
        user = user or self.me
        r = self.client.request(method, f"/api/v1{url}", headers=self.headers(user), **kw)
        try:
            body = r.json()
        except Exception:  # noqa: BLE001
            body = r.text
        return r.status_code, body

    def user(self, slug: str, name: str, apps, role: str = "user", **flags):
        from app.modules.main.models.user import User
        email = f"demo.{slug}@{DEMO_DOMAIN}"
        u = self.db.query(User).filter(User.email == email).first()
        if not u:
            u = User(email=email, name=f"{LABEL} {name}", role=role, is_active=True, assigned_apps=list(apps),
                     department=flags.pop("department", LABEL), designation=flags.pop("designation", name))
            self.db.add(u)
        else:
            u.assigned_apps = sorted(set(u.get_apps()) | set(apps))
        for flag, value in flags.items():
            setattr(u, flag, value)
        self.db.commit()
        self.db.refresh(u)
        return u

    # ── Access: roles, extra grants, approval flags ───────────────────────

    def _fresh(self, user):
        """The user row re-read after an API call changed it."""
        self.db.expire_all()
        from app.modules.main.models.user import User
        return self.db.get(User, user.id)

    @staticmethod
    def perms(module: str, *tabs: str, actions=None, skip=()) -> list[str]:
        from app.core.permission_registry import MODULES
        m = MODULES.get(module)
        if not m:
            raise SystemExit(f"demo.perms: unknown module '{module}' — known: {', '.join(sorted(MODULES))}.")
        bad = [t for t in tabs if t not in m["actions"]]
        if bad:
            raise SystemExit(f"demo.perms: module '{module}' has no tab(s) {', '.join(bad)} — tabs: {', '.join(m['actions'])}.")
        out = []
        for tab in tabs or m["actions"]:
            for action in m["actions"][tab]:
                if (actions is None or action in actions) and action not in skip:
                    out.append(f"{module}:{tab}:{action}")
        return out

    @staticmethod
    def _flatten(grants) -> list[str]:
        out: list[str] = []
        for g in grants:
            if isinstance(g, (list, tuple, set)):
                out.extend(Demo._flatten(g))
            elif g:
                out.append(g)
        return sorted(set(out))

    def role(self, name: str, *grants, description: str | None = None, data_scopes: dict | None = None) -> dict:
        full = name if name.startswith(f"{LABEL} ") else f"{LABEL} {name}"
        payload = {"name": full, "description": description or f"{LABEL} role for demo people ({name}).",
                   "permissions": self._flatten(grants), "data_scopes": data_scopes or {}}
        from app.modules.main.models.role import Role
        existing = self.db.query(Role).filter(Role.name == full).first()
        if existing:
            return self.call("PATCH", f"/roles/{existing.id}", json=payload)
        return self.call("POST", "/roles", json=payload)

    @staticmethod
    def _role_key(name: str) -> str:
        return " ".join(name.replace("–", "-").replace("—", "-").lower().split())

    def _role_id(self, ref) -> int:
        if isinstance(ref, int):
            return ref
        if isinstance(ref, dict):
            return ref["id"]
        from app.modules.main.models.role import Role
        roles = self.db.query(Role).all()
        by_key = {self._role_key(r.name): r.id for r in roles}
        # The DEMO role wins over a same-named real one ("Quality Inspector"
        # vs the seeded "Quality inspector").
        for candidate in (f"{LABEL} {ref}", ref):
            if self._role_key(candidate) in by_key:
                return by_key[self._role_key(candidate)]
        raise SystemExit(f"demo.assign: no role named '{ref}' (or '{LABEL} {ref}'). Create it with demo.role() first, "
                         "or use an existing name from Organization › Role & Permissions.")

    def assign(self, user, *roles):
        wanted = [self._role_id(r) for r in roles]
        current = [r.id for r in self._fresh(user).roles]
        ids = sorted(set(current) | set(wanted))
        if set(ids) != set(current):
            self.call("PUT", f"/users/{user.id}/roles", json={"role_ids": ids})
        return self._fresh(user)

    def grant(self, user, *grants):
        current = list(self._fresh(user).granular_permissions or [])
        new = sorted(set(current) | set(self._flatten(grants)))
        if new != sorted(set(current)):
            self.call("PATCH", f"/users/{user.id}/permissions", json={"granular_permissions": new})
        return self._fresh(user)

    def flags(self, user, **flags):
        partner = flags.pop("is_partner", None)
        if flags:
            self.call("PATCH", f"/users/{user.id}", json=flags)
        if partner is not None:
            from app.modules.main.models.user import User
            ids = {u.id for u in self.db.query(User).filter(User.is_partner.is_(True)).all()}
            ids = (ids | {user.id}) if partner else (ids - {user.id})
            self.call("PUT", "/organization/company/partners", json={"user_ids": sorted(ids)})
        return self._fresh(user)

    @staticmethod
    def gstin(state_code: str, pan: str, entity: str = "1") -> str:
        """`state_code` 2 digits, `pan` 10 chars (AAAAA9999A) → 15-char GSTIN
        that passes the GST check-digit test."""
        charset = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        body = f"{state_code}{pan.upper()}{entity}Z"
        total = 0
        for i, ch in enumerate(body):
            product = charset.index(ch) * (1 if i % 2 == 0 else 2)
            total += product // 36 + product % 36
        return body + charset[(36 - total % 36) % 36]

    def note(self, module: str, text: str) -> None:
        self.log.append((module, text))
        print(f"  [{module}] {text}")

    @staticmethod
    def pdf(name: str = "demo.pdf"):
        return (name, io.BytesIO(b"%PDF-1.4\n% DEMO placeholder document\n"), "application/pdf")
