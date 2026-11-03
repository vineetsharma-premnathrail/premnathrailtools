"""Role-based notifications: the catalog of notifiable events and the
dispatcher that sends them to the members of every role subscribed to them.

An admin picks, per role (Organization › Roles › Notifications), which events
its members hear about and on which channels (portal bell / email / Teams);
the subscription is stored on Role.notification_events as
{"<module>.<event>": ["bell", "email", "teams"]}.

A member only gets an event when they could act on it: they must hold the
event's `access` permission (a tab or feature id — deny by default, admins
pass) and, when the caller passes `can_open`, be able to open that very record
(data scope / per-record access). The person who caused the event is never
notified. This sits next to the per-module "notify these people" rules
(core/notify_rules.py) — both keep working.

Events are declared per module in app/core/events/<module>.py with
register_event(...); see the package docstring."""
import logging
from typing import Callable

from fastapi import BackgroundTasks
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.permission_registry import MODULES, feature_id, has_grant, is_admin_user, permission_id
from app.modules.main.models.notification import Notification
from app.modules.main.models.role import Role, user_roles
from app.modules.main.models.user import User

logger = logging.getLogger(__name__)

CHANNELS = ("bell", "email", "teams")
CHANNEL_LABELS = {"bell": "Portal bell", "email": "Email", "teams": "Microsoft Teams"}

# module -> event key -> spec
EVENTS: dict[str, dict[str, dict]] = {}


def register_event(module: str, key: str, label: str, trigger: str, access: tuple, *,
                   default_channels: tuple[str, ...] = ("bell",), kind: str = "info") -> None:
    """Declare a notifiable event.

    access: (tab, action) or (tab, feature, action) — what a member must hold
    to receive it (they must be able to act on / open what it is about).
    kind: "approval" | "assignment" | "reminder" | "info" — shown in the role
    editor so admins see which events need action."""
    assert module in MODULES, module
    assert "." not in key and key, key
    if len(access) == 2:
        tab, action = access
        grant = permission_id(module, tab, action)
        assert action in MODULES[module]["actions"].get(tab, []), f"{module}:{tab}:{action} is not declared"
    elif len(access) == 3:
        tab, feature, action = access
        grant = feature_id(module, tab, feature, action)
        f = MODULES[module].get("features", {}).get(tab, {}).get(feature)
        assert f and action in f["actions"], f"{grant} is not declared"
    else:
        raise AssertionError(f"access must be (tab, action) or (tab, feature, action): {access}")
    assert set(default_channels) <= set(CHANNELS), default_channels
    assert key not in EVENTS.get(module, {}), f"{module}.{key} is declared twice"
    EVENTS.setdefault(module, {})[key] = {
        "label": label, "trigger": trigger, "access": grant, "kind": kind,
        "default_channels": list(default_channels),
        "audience": "watchers", "recipient": "Role members (everyone's records)",
    }


# notification_type -> (module, event key) of a direct notification.
DIRECT_BY_TYPE: dict[str, tuple[str, str]] = {}


def register_direct(module: str, notification_type: str, label: str, recipient: str, trigger: str, *,
                    default_channels: tuple[str, ...] = ("bell",), kind: str = "info") -> None:
    """Declare a DIRECT notification: the code itself names who gets it (the
    assignee, the requester, the approver, the department head …) through
    utils/notifications.notify_user / broadcast_notification with this
    `notification_type`. A role does not add people to it — the role's
    Notifications tab (and a user's personal override) only picks the
    channels those people receive it on; with no setting anywhere the
    `default_channels` apply. The event key is "<module>.direct:<notification_type>"
    (its own namespace, so it never clashes with a role event of the same name).

    recipient: who the code sends it to, in plain words ("The assignee")."""
    assert module in MODULES, module
    assert notification_type and "." not in notification_type and len(notification_type) <= 50, notification_type
    assert notification_type not in DIRECT_BY_TYPE, f"direct notification '{notification_type}' is declared twice"
    assert default_channels and set(default_channels) <= set(CHANNELS), default_channels
    key = f"direct:{notification_type}"
    EVENTS.setdefault(module, {})[key] = {
        "label": label, "trigger": trigger, "access": None, "kind": kind,
        "default_channels": list(default_channels),
        "audience": "direct", "recipient": recipient,
    }
    DIRECT_BY_TYPE[notification_type] = (module, key)


def direct_spec(notification_type: str) -> tuple[str, dict] | None:
    """(event key, spec) of a registered direct notification, else None."""
    hit = DIRECT_BY_TYPE.get(notification_type)
    if not hit:
        return None
    module, key = hit
    return event_key(module, key), EVENTS[module][key]


_ROLE_SUBS = "_role_notification_subscriptions"


def _role_subscriptions(db: Session) -> list[tuple[int, bool, dict, set[int]]]:
    """(role id, is_default, notification_events, member ids) of every active
    role that sets any notification — read once per DB session (one request
    or one job run), so a loop of notify_user calls doesn't re-query roles."""
    cached = db.info.get(_ROLE_SUBS)
    if cached is not None:
        return cached
    rows = [(rid, bool(dflt), subs or {}) for rid, dflt, subs in
            db.query(Role.id, Role.is_default, Role.notification_events).filter(Role.is_active.is_(True)).all() if subs]
    members: dict[int, set[int]] = {}
    ids = [rid for rid, dflt, _ in rows if not dflt]
    if ids:
        for rid, uid in db.query(user_roles.c.role_id, user_roles.c.user_id).filter(user_roles.c.role_id.in_(ids)).all():
            members.setdefault(rid, set()).add(uid)
    cached = [(rid, dflt, subs, members.get(rid, set())) for rid, dflt, subs in rows]
    db.info[_ROLE_SUBS] = cached

    def _forget(session, *_args) -> None:  # a commit / rollback may have changed roles
        session.info.pop(_ROLE_SUBS, None)
    event.listen(db, "after_commit", _forget, once=True)
    event.listen(db, "after_rollback", _forget, once=True)
    return cached


def resolve_direct_channels(db: Session, users: list[User], key: str, default: list[str]) -> dict[int, set[str]]:
    """Channels each of `users` gets a direct notification `key` on:
    their personal override if they have one (an empty list = off), else the
    union over their active roles (and default roles) that set it — a role
    entry with no channels switches it off for that role — else `default`."""
    everyone: set[str] | None = None
    per_user: dict[int, set[str]] = {}
    for role_id, is_default, subs, members in _role_subscriptions(db):
        if key not in subs:
            continue
        chans = set(subs.get(key) or [])
        if is_default:
            everyone = (everyone or set()) | chans
            continue
        for uid in members:
            per_user.setdefault(uid, set()).update(chans)
    out: dict[int, set[str]] = {}
    for u in users:
        overrides = u.notification_overrides or {}
        if key in overrides:
            out[u.id] = {c for c in (overrides.get(key) or []) if c in CHANNELS}
        elif u.id in per_user or everyone is not None:
            out[u.id] = per_user.get(u.id, set()) | (everyone or set())
        else:
            out[u.id] = set(default)
    return out


def event_key(module: str, key: str) -> str:
    return f"{module}.{key}"


def all_event_keys() -> set[str]:
    return {event_key(m, k) for m, evs in EVENTS.items() for k in evs}


def catalog() -> dict:
    """What the role editor renders: module -> events (label, trigger, access, kind)."""
    return {
        "channels": [{"key": c, "label": CHANNEL_LABELS[c]} for c in CHANNELS],
        "modules": {m: {"label": MODULES[m]["label"], "events": evs} for m, evs in EVENTS.items() if evs},
    }


def clean_subscriptions(value) -> dict[str, list[str]]:
    """Validate a role's subscriptions; raises ValueError with a clear reason."""
    if value in (None, ""):
        return {}
    if not isinstance(value, dict):
        raise ValueError("Notification subscriptions must be an object of event → channels.")
    known = all_event_keys()
    direct = {event_key(m, k) for m, evs in EVENTS.items() for k, e in evs.items() if e.get("audience") == "direct"}
    out: dict[str, list[str]] = {}
    for k, chans in value.items():
        if k not in known:
            raise ValueError(f"Unknown notification event '{k}' — reload the page; the event list may have changed.")
        chans = [c for c in CHANNELS if c in set(chans or [])]
        # A direct notification keeps an empty entry: it means "off for this
        # role" (no entry = the event's default channels).
        if chans or k in direct:
            out[k] = chans
    return out


def notify_event(
    db: Session,
    background_tasks: BackgroundTasks | None,
    module: str,
    event: str,
    *,
    title: str,
    message: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    actor: User | None = None,
    can_open: Callable[[User], bool] | None = None,
    details: list[tuple[str, str]] | None = None,
    skip_user_ids: set[int] | None = None,
) -> set[int]:
    """Send `module.event` to every member of a role subscribed to it who may
    act on it — and to anyone whose personal override (User.notification_overrides)
    subscribes them; a personal entry replaces the role channels for that user
    (an empty list switches the event off for them). Bell / Teams rows are added to `db` (caller commits); emails go
    out after the response via background_tasks. Returns the user ids reached,
    so callers can skip them in their own direct notify_user calls.
    Never raises — a notification must not break the business action."""
    key = event_key(module, event)
    spec = EVENTS.get(module, {}).get(event)
    if not spec or spec.get("audience") == "direct":
        logger.warning("notify_event: '%s' is not a registered role event (app/core/events/%s.py).", key, module)
        return set()
    try:
        roles = [r for r in db.query(Role).filter(Role.is_active.is_(True)).all() if key in (r.notification_events or {})]
        channels_by_user: dict[int, set[str]] = {}
        everyone = set()
        for r in roles:
            chans = set(r.notification_events.get(key) or [])
            if r.is_default:
                everyone |= chans
                continue
            for (uid,) in db.query(user_roles.c.user_id).filter(user_roles.c.role_id == r.id).all():
                channels_by_user.setdefault(uid, set()).update(chans)
        if everyone:
            for (uid,) in db.query(User.id).filter(User.is_active.is_(True)).all():
                channels_by_user.setdefault(uid, set()).update(everyone)
        # Personal overrides beat the roles for this one user.
        for uid, ov in db.query(User.id, User.notification_overrides).filter(User.is_active.is_(True)).all():
            if ov and key in ov:
                chans = {c for c in (ov.get(key) or []) if c in ("bell", "email", "teams")}
                if chans:
                    channels_by_user[uid] = chans
                else:
                    channels_by_user.pop(uid, None)
        if not channels_by_user:
            return set()
        skip = set(skip_user_ids or set())
        if actor is not None:
            skip.add(actor.id)
        users = db.query(User).filter(User.id.in_([u for u in channels_by_user if u not in skip]), User.is_active.is_(True)).all() \
            if channels_by_user else []

        reached: set[int] = set()
        emails: dict[str, str] = {}
        for u in users:
            if not (is_admin_user(u) or has_grant(u, spec["access"])):
                continue
            if can_open is not None:
                try:
                    if not can_open(u):
                        continue
                except Exception:
                    continue
            chans = channels_by_user.get(u.id, set())
            if "bell" in chans and u.notifications_enabled:
                db.add(Notification(user_id=u.id, title=title, message=message,
                                    notification_type=f"{module}_ev_{event}"[:50],
                                    entity_type=entity_type, entity_id=entity_id))
                reached.add(u.id)
            if "teams" in chans and u.notifications_enabled:
                from app.utils.notifications import _notify_teams
                _notify_teams(u, title, message)
                reached.add(u.id)
            if "email" in chans and u.email:
                emails[u.email.lower()] = u.name or u.email
                reached.add(u.id)
        if emails and background_tasks is not None:
            from app.core.notify_rules import _send_emails
            background_tasks.add_task(_send_emails, module, title, message, details or [], emails)
        return reached
    except Exception:
        logger.exception("notify_event '%s' failed", key)
        return set()


# Per-module event declarations (app/core/events/<module>.py).
from app.core import events as _events  # noqa: E402,F401
