"""UI visibility: per role, WHAT a person sees on a screen.

A feature grant says whether someone may open or use a screen. Visibility
narrows what that screen SHOWS them, per role, without touching the data
rules: which sections of a form appear, which values a dropdown offers
(e.g. the Purpose list on a purchase requisition), which columns a table has.
It is set on the tab (or feature) row of the Permission Matrix and stored on
Role.visibility_rules as  "<module>:<tab>"  or  "<module>:<tab>.<feature>"  ->

    {"hidden_sections": ["remarks"],
     "options": {"purpose": ["stock"]},                  allowed values of a dropdown
     "hidden_columns": {"requisitions": ["priority"]}}   columns hidden per table

Only OVERRIDES are stored: no rule = everything is visible (today's
behaviour). The catalogue of what can be hidden — sections, dropdowns with
their coded values, tables with their columns — is declared in code next to
the permission features (core/features/<module>.py, register_visibility()).
An admin never invents a field, an option or a column; they only hide ones
the code offers. A section that holds a required field is `locked` and can
never be hidden, so a form can never become impossible to submit.

Several roles: only roles that open the key (hold its `view` grant) count. A
section or column is hidden only if EVERY such role hides it; a dropdown is
restricted only if every such role restricts it, and then the user may pick
any value ANY of them allows (roles add access, never take it away). Admins
and Partners are never restricted.

Enforcement: dropdown values are also checked by the server
(ensure_option_allowed -> 422 with the real reason), so a hidden value can't
be sent by hand. Sections and columns are hidden on screen only — they hold
optional data the other screens already carry — and the Role editor says so."""
import json
import logging

from fastapi import HTTPException
from sqlalchemy.orm import object_session

# "<module>:<tab>[.<feature>]" -> catalogue entry (see register_visibility).
VISIBILITY: dict[str, dict] = {}

_CACHE_NAME = "_visibility_effective_cache"
# key -> [(section, dropdown, value the form sends when the section is hidden)] - see register_visibility.
_SECTION_DEFAULTS: dict[str, list[tuple[str, str, str]]] = {}
_logger = logging.getLogger(__name__)
_logged_once: set[tuple] = set()


def _log_once(level: int, *args) -> None:
    """Log a configuration problem once per process, not on every request."""
    if args[1:3] not in _logged_once:
        _logged_once.add(args[1:3])
        _logger.log(level, *args)


def register_visibility(module_key: str, tab_key: str, feature_key: str | None = None, *, label: str,
                        sections: tuple = (), options: tuple = (), tables: tuple = (),
                        section_defaults: tuple = (), screens: tuple = ()) -> None:
    """Declare what can be hidden on one tab (or feature):
      screens  = ((code, label), ...): the screens this key covers (a form, a record
        page, a list ...). Omitted = one screen "main" named like the entry, so a
        simple entry needs nothing here. The first screen is the default of an item
        that names none.
      sections = ((key, label, hint, locked[, screen]), ...)
      options  = ((dropdown_key, label, {value: label}, hint[, screen]), ...)
      tables   = ((table_key, label, {column_key: label}[, screen]), ...)
      section_defaults = ((section_key, dropdown_key, value), ...): a hidden section
        sends `value` for that dropdown, so a role can't hide the section while
        leaving that value out (clean_rules refuses it: the form couldn't be submitted).
    The tab / feature must exist in the permission registry. Call at import
    time from core/features/<module>.py, below the register_features() call."""
    from app.core.permission_registry import MODULES

    module = MODULES.get(module_key)
    assert module is not None, f"visibility: unknown module '{module_key}'"
    assert tab_key in module["actions"], f"visibility: '{module_key}:{tab_key}' is not a tab"
    if feature_key:
        assert feature_key in module.get("features", {}).get(tab_key, {}), \
            f"visibility: '{module_key}:{tab_key}.{feature_key}' is not a feature"
    key = f"{module_key}:{tab_key}" + (f".{feature_key}" if feature_key else "")
    screen_map = dict(screens) if screens else {"main": label}
    assert len(screen_map) == (len(screens) if screens else 1), f"visibility: duplicate screen code in '{key}'"
    default_screen = next(iter(screen_map))

    def screen_of(item: tuple, fixed: int, what: str) -> str:
        assert fixed <= len(item) <= fixed + 1, f"visibility: bad {what} tuple in '{key}': {item[0]!r}"
        code = item[fixed] if len(item) > fixed else default_screen
        assert code in screen_map, f"visibility: {what} '{item[0]}' of '{key}' names unknown screen '{code}' (declared: {', '.join(screen_map)})"
        return code

    assert all(isinstance(v, str) for o in options for v in o[2]), \
        f"visibility: every option value of '{key}' must be a str"
    for section_key, dropdown_key, value in section_defaults:
        assert section_key in {s[0] for s in sections} and any(
            o[0] == dropdown_key and value in o[2] for o in options), f"visibility: bad section default in '{key}'"
    _SECTION_DEFAULTS[key] = [tuple(d) for d in section_defaults]
    VISIBILITY[key] = {
        "label": label,
        "screens": screen_map,
        "sections": {s[0]: {"label": s[1], "hint": s[2], "locked": bool(s[3]), "screen": screen_of(s, 4, "section")} for s in sections},
        "options": {o[0]: {"label": o[1], "hint": o[3], "values": dict(o[2]), "screen": screen_of(o, 4, "dropdown")} for o in options},
        "tables": {t[0]: {"label": t[1], "columns": dict(t[2]), "screen": screen_of(t, 3, "table")} for t in tables},
    }


def _loaded() -> dict[str, dict]:
    """The catalogue, with the feature files (which register entries) imported."""
    import app.core.permission_registry  # noqa: F401 — importing it loads core/features/*
    return VISIBILITY


def catalog() -> dict:
    """What the Role editor renders (a copy: callers may not edit the catalogue)."""
    _loaded()
    return json.loads(json.dumps(VISIBILITY))


def _not_in_catalogue(what: str) -> ValueError:
    return ValueError(f"{what} isn't in the current catalogue — reload the page to get the current options.")


def _malformed(what: str) -> ValueError:
    return ValueError(f"{what} is malformed — reload the page and set it again.")


def _names(value, what: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
        raise _malformed(what)
    return sorted(set(value))


def _mapping(value, what: str) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise _malformed(what)
    return value


def clean_rules(value) -> dict[str, dict]:
    """Validate a role's visibility rules; drop empty ones and ones that change
    nothing. Raises ValueError with a user-facing message."""
    out: dict[str, dict] = {}
    for key, rule in _mapping(value, "The visibility rules").items():
        if not rule:
            continue
        entry = _loaded().get(key)
        if entry is None:
            # A screen whose catalogue entry was removed: its old rule is dropped so an
            # unrelated edit of the role still saves.
            _logger.warning("Dropping the visibility rule of '%s': it is no longer in the catalogue.", key)
            continue
        if not isinstance(rule, dict):
            raise _malformed(f"The visibility rule of '{entry['label']}'")
        clean: dict = {}

        hidden = _names(rule.get("hidden_sections"), f"The hidden sections of '{entry['label']}'")
        for s in hidden:
            section = entry["sections"].get(s)
            if section is None:
                raise _not_in_catalogue(f"Section '{s}' of '{entry['label']}'")
            if section["locked"]:
                raise ValueError(f"'{section['label']}' holds a required field, so it can't be hidden. Leave it visible.")
        if hidden:
            clean["hidden_sections"] = hidden

        opts: dict[str, list[str]] = {}
        for dropdown, values in _mapping(rule.get("options"), f"The dropdown rules of '{entry['label']}'").items():
            spec = entry["options"].get(dropdown)
            if spec is None:
                raise _not_in_catalogue(f"Dropdown '{dropdown}' of '{entry['label']}'")
            picked = _names(values, f"The allowed {spec['label']} values of '{entry['label']}'")
            for v in picked:
                if v not in spec["values"]:
                    raise _not_in_catalogue(f"{spec['label']} value '{v}'")
            if not picked:
                raise ValueError(f"Pick at least one {spec['label']} value, or reset it to all values.")
            if set(picked) != set(spec["values"]):  # every value ticked = no restriction
                opts[dropdown] = picked
        if opts:
            clean["options"] = opts

        cols: dict[str, list[str]] = {}
        for table, columns in _mapping(rule.get("hidden_columns"), f"The hidden columns of '{entry['label']}'").items():
            spec = entry["tables"].get(table)
            if spec is None:
                raise _not_in_catalogue(f"Table '{table}' of '{entry['label']}'")
            names = _names(columns, f"The hidden columns of {spec['label']}")
            for c in names:
                if c not in spec["columns"]:
                    raise _not_in_catalogue(f"Column '{c}' of '{spec['label']}'")
            if names:
                cols[table] = names
        if cols:
            clean["hidden_columns"] = cols

        for section_key, dropdown, default in _SECTION_DEFAULTS.get(key, []):
            allowed = clean.get("options", {}).get(dropdown)
            if section_key in clean.get("hidden_sections", []) and allowed is not None and default not in allowed:
                section, spec = entry["sections"][section_key], entry["options"][dropdown]
                raise ValueError(f"{section['label']} can't be hidden while {spec['label']} leaves out {spec['values'][default]}: "
                                 f"the form could never be submitted. Show the section, or allow {spec['values'][default]}.")

        if clean:
            out[key] = clean
    return out


def _roles_of(user) -> list:
    """Active roles of `user` (assigned and inside their validity window) plus
    every active applies-to-everyone role — the same set effective_permissions uses."""
    from app.modules.main.models.role import Role
    from app.modules.main.services.grc import inactive_access

    off_roles = inactive_access(user)[0]
    roles = [r for r in (getattr(user, "roles", None) or []) if r.is_active and r.id not in off_roles]
    session = object_session(user)
    if session is not None:
        seen = {r.id for r in roles}
        roles += [r for r in session.query(Role).filter(Role.is_default.is_(True), Role.is_active.is_(True)).all()
                  if r.id not in seen]
    return roles


def _relevant_rules(user, key: str, roles: list | None = None, expanded: dict | None = None) -> list[dict | None]:
    """The rule of every role of `user` that opens `key` (None = that role sets
    no rule for it). `expanded` caches each role's expanded grants by role id."""
    from app.core.permission_registry import expand_grants

    module, tabfeat = key.split(":", 1)
    needle = f"{module}:{tabfeat}:view"
    out: list[dict | None] = []
    for role in (_roles_of(user) if roles is None else roles):
        grants = expanded.get(role.id) if expanded is not None else None
        if grants is None:
            grants = expand_grants(role.permissions or [])
            if expanded is not None:
                expanded[role.id] = grants
        if needle in grants:
            out.append((role.visibility_rules or {}).get(key))
    return out


def _resolve_key(key: str, rules: list[dict | None]) -> dict:
    """Combine the relevant roles' rules for one key into the effective restriction."""
    entry = VISIBILITY[key]
    if not rules or any(not r for r in rules):
        return {}  # no relevant role, or one with no rule at all = no restriction
    out: dict = {}
    hidden = set.intersection(*[set(r.get("hidden_sections") or []) for r in rules]) & set(entry["sections"])
    hidden = {s for s in hidden if not entry["sections"][s]["locked"]}
    if hidden:
        out["hidden_sections"] = sorted(hidden)
    opts: dict[str, list[str]] = {}
    for dropdown, spec in entry["options"].items():
        per_role = [(r.get("options") or {}).get(dropdown) for r in rules]
        if any(p is None for p in per_role):
            continue  # one role offers every value
        allowed = set().union(*per_role) & set(spec["values"])
        if not allowed:
            # Stored values that no longer exist: fail CLOSED (nothing allowed), never open.
            _log_once(logging.ERROR, "Visibility of '%s' > %s points at values that no longer exist; refusing every value "
                      "until an admin saves the role's Visibility again.", key, dropdown)
            opts[dropdown] = []
        elif allowed != set(spec["values"]):
            opts[dropdown] = sorted(allowed)
    if opts:
        out["options"] = opts
    cols: dict[str, list[str]] = {}
    for table, spec in entry["tables"].items():
        shared = set.intersection(*[set((r.get("hidden_columns") or {}).get(table) or []) for r in rules]) & set(spec["columns"])
        if shared:
            cols[table] = sorted(shared)
    if cols:
        out["hidden_columns"] = cols
    return out


def effective(user) -> dict:
    """The restrictions that apply to `user`: only keys with at least one,
    {"p2p:purchase_requisitions": {"hidden_sections": [...], "options":
    {dropdown: [allowed values]}, "hidden_columns": {table: [...]}}}.
    Admins, Azure admins and Partners get {}. Cached on the instance until
    their roles (or those roles' rules / grants) change. Read-only: don't edit
    the returned dict."""
    from app.core.permission_registry import is_admin_user

    if user is None or is_admin_user(user) or bool(getattr(user, "is_partner", False)):
        return {}
    roles = _roles_of(user)
    cache_key = tuple(
        (r.id, tuple(r.permissions or ()), json.dumps(r.visibility_rules or {}, sort_keys=True)) for r in roles
    )
    cached = user.__dict__.get(_CACHE_NAME)
    if cached is not None and cached[0] == cache_key:
        return cached[1]
    result: dict[str, dict] = {}
    expanded: dict = {}
    for key in _loaded():
        resolved = _resolve_key(key, _relevant_rules(user, key, roles, expanded))
        if resolved:
            result[key] = resolved
    user.__dict__[_CACHE_NAME] = (cache_key, result)
    return result


def allowed_values(user, key: str, dropdown: str) -> set[str] | None:
    """Values `user` may pick in this dropdown, or None = no restriction."""
    allowed = (effective(user).get(key, {}).get("options") or {}).get(dropdown)
    return None if allowed is None else set(allowed)


def section_hidden(user, key: str, section: str) -> bool:
    return section in (effective(user).get(key, {}).get("hidden_sections") or [])


def filter_options(user, key: str, dropdown: str, rows: list, value_of=lambda r: r["code"]) -> list:
    """Keep only the dropdown rows `user` may pick."""
    allowed = allowed_values(user, key, dropdown)
    return rows if allowed is None else [r for r in rows if value_of(r) in allowed]


def _where_to_widen(key: str) -> str:
    from app.core.permission_registry import MODULES

    module, tabfeat = key.split(":", 1)
    tab, _, feature = tabfeat.partition(".")
    mod = MODULES.get(module, {})
    parts = [mod.get("label", module), mod.get("subtabs", {}).get(tab, tab)]
    if feature:
        parts.append(mod.get("features", {}).get(tab, {}).get(feature, {}).get("label", feature))
    return " › ".join(["Organization", "Role & Permissions", *parts, "Visibility"])


def _labels(spec: dict, allowed: set[str] | None) -> str:
    return ", ".join(lbl for v, lbl in spec["values"].items() if allowed is None or v in allowed)


def _stale(spec: dict) -> HTTPException:
    return HTTPException(
        status_code=422,
        detail=f"Your role's {spec['label']} visibility points at values that no longer exist — ask an admin to open the "
               "role and save its Visibility again.")


def _spec_of(key: str, dropdown: str) -> dict | None:
    """The catalogue entry of one dropdown; None (and one logged error) when the code names a key /
    dropdown nobody registered — a coding slip must never become a 500 on the user's request."""
    spec = (VISIBILITY.get(key, {}).get("options") or {}).get(dropdown)
    if spec is None:
        _log_once(logging.ERROR, "Visibility check for '%s' > %s skipped: it is not registered in the catalogue "
                  "(register_visibility in core/features).", key, dropdown)
    return spec


def ensure_option_given(user, key: str, dropdown: str, value) -> None:
    """422 when `value` is empty but `user`'s roles restrict this dropdown: an
    omitted value must not be a way round the restriction."""
    allowed = allowed_values(user, key, dropdown)
    if allowed is None or value not in (None, ""):
        return
    spec = _spec_of(key, dropdown)
    if spec is None:
        return
    if not allowed:
        raise _stale(spec)
    raise HTTPException(status_code=422, detail=f"Pick a {spec['label']} — your role allows: {_labels(spec, allowed)}.")


def ensure_option_allowed(user, key: str, dropdown: str, value) -> None:
    """422 when `value` is outside what `user`'s roles let them pick in this
    dropdown. An empty value is the caller's own validation (see ensure_option_given)."""
    if value in (None, ""):
        return
    allowed = allowed_values(user, key, dropdown)
    if allowed is None:
        return  # no restriction: nothing else to read from the catalogue
    spec = _spec_of(key, dropdown)
    if spec is None:
        return
    if not isinstance(value, str):
        raise HTTPException(status_code=422, detail=f"{spec['label']} must be one of: {_labels(spec, allowed)}.")
    if value in allowed:
        return
    if not allowed:
        raise _stale(spec)
    raise HTTPException(
        status_code=422,
        detail=f"{spec['label']} '{spec['values'].get(value, value)}' isn't available to your role — you can pick: "
               f"{_labels(spec, allowed)}. Ask an admin to widen it in {_where_to_widen(key)}.")
