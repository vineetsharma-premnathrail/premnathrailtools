"""Admin-configured notification rules, shared by every module's Settings page
(Service, CRM, …). A module lists its events once; this builds the settings
specs for them (on / who / channels / extra emails), validates them, and
fires them.

Rules are explicitly switched on by an admin, so they deliberately bypass the
global "no create/update notices" suppression in app/utils/notifications.py
(their type is `<module>_rule_<event>`, which doesn't end in _created etc.)."""
import html
import logging
import re

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.settings_framework import SettingSpec, get_setting
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.utils.email import _send_graph_mail, _wrap_email_html
from app.utils.notifications import _notify_teams

logger = logging.getLogger(__name__)

NOTIFY_CHANNELS = [("bell", "Portal bell"), ("email", "Email"), ("teams", "Microsoft Teams")]
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def notification_groups(events: dict[str, tuple[str, str]]) -> dict[str, str]:
    """events: key -> (label, "what triggers it")."""
    return {f"notify_{e}": f"Notification — {label}" for e, (label, _) in events.items()}


def notification_specs(events: dict[str, tuple[str, str]], user_apps: dict[str, tuple[str, ...]] | None = None) -> list[SettingSpec]:
    """user_apps: event -> modules its recipients may come from (default: the settings module's own)."""
    specs: list[SettingSpec] = []
    for event, (_label, trigger) in events.items():
        g = f"notify_{event}"
        specs += [
            SettingSpec(f"notify_{event}_enabled", g, "Send this notification", "bool", False,
                        help=f"Sent when {trigger}. The person who did it is not notified. Off = nobody is notified."),
            SettingSpec(f"notify_{event}_users", g, "Notify these people", "users", [], user_apps=(user_apps or {}).get(event)),
            SettingSpec(f"notify_{event}_channels", g, "Channels", "multi_select", ["bell"], options=NOTIFY_CHANNELS,
                        help="Bell = portal notification. Email goes to each person's work email. "
                             "Teams needs the person to have signed in with Microsoft."),
            SettingSpec(f"notify_{event}_emails", g, "Also email these addresses", "json_list", [],
                        help="Extra addresses outside the list above, e.g. a team mailbox. "
                             "Sent whenever this notification is on, even if Email is not ticked."),
        ]
    return specs


def validate_notification_rules(values: dict, events: dict[str, tuple[str, str]]) -> None:
    for event, (label, _) in events.items():
        for addr in values.get(f"notify_{event}_emails") or []:
            if not _EMAIL_RE.match(str(addr)):
                raise ValueError(f"{label} → Also email these addresses: \"{addr}\" is not a valid email address — "
                                 "fix or remove it (separate addresses with commas).")
        if values.get(f"notify_{event}_enabled") and not values.get(f"notify_{event}_users") \
                and not values.get(f"notify_{event}_emails"):
            raise ValueError(f"{label} is switched on but nobody would receive it — add people or email addresses, "
                             "or switch it off.")
        if values.get(f"notify_{event}_users") and not values.get(f"notify_{event}_channels"):
            raise ValueError(f"{label}: people are selected but no channel is ticked — tick Portal bell, Email or Teams.")


def fire_rule(
    db: Session,
    background_tasks: BackgroundTasks | None,
    module: str,
    event: str,
    title: str,
    message: str,
    entity_type: str,
    entity_id: int,
    actor: User,
    details: list[tuple[str, str]] | None = None,
    skip_user_ids: set[int] | None = None,
) -> None:
    """Apply the admin's rule for `module`/`event`. Bell/Teams rows are added to
    `db` (caller commits); emails go out after the response via background_tasks.
    `skip_user_ids`: people already notified another way (e.g. @mentioned)."""
    if not get_setting(db, module, f"notify_{event}_enabled"):
        return
    skip = (skip_user_ids or set()) | {actor.id}
    channels = set(get_setting(db, module, f"notify_{event}_channels") or [])
    user_ids = [i for i in (get_setting(db, module, f"notify_{event}_users") or []) if i not in skip]
    users = db.query(User).filter(User.id.in_(user_ids), User.is_active == True).all() if user_ids else []  # noqa: E712

    emails: dict[str, str] = {}
    for u in users:
        if "bell" in channels and u.notifications_enabled:
            db.add(Notification(user_id=u.id, title=title, message=message, notification_type=f"{module}_rule_{event}"[:50],
                                entity_type=entity_type, entity_id=entity_id))
        if "teams" in channels and u.notifications_enabled:
            _notify_teams(u, title, message)
        if "email" in channels and u.email:
            emails[u.email.lower()] = u.name or u.email
    for addr in get_setting(db, module, f"notify_{event}_emails") or []:
        emails.setdefault(str(addr).lower(), str(addr))

    if emails and background_tasks is not None:
        background_tasks.add_task(_send_emails, module, title, message, details or [], emails)


_SUBJECT_TAG = {"erp": "Service", "crm": "CRM"}


async def _send_emails(module: str, title: str, message: str, details: list[tuple[str, str]], recipients: dict[str, str]) -> None:
    sender = settings.SENDER_EMAIL
    if not sender:
        logger.warning("Notification '%s' not emailed: SENDER_EMAIL is not set in the backend .env.", title)
        return
    rows = "".join(
        f'<tr><td style="padding:8px 12px;background:{"#f8fafc" if i % 2 == 0 else "#fff"};font-weight:600;'
        f'color:#475569;width:40%">{html.escape(k)}</td><td style="padding:8px 12px;color:#1e293b">{html.escape(v or "—")}</td></tr>'
        for i, (k, v) in enumerate(details)
    )
    body = (
        f'<h2 style="margin:0 0 12px;font-size:18px;color:#0f172a">{html.escape(title)}</h2>'
        f'<p style="margin:0 0 18px;font-size:14px;color:#475569;line-height:1.7">{html.escape(message)}</p>'
        + (f'<table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e2e8f0">{rows}</table>' if rows else "")
    )
    page = _wrap_email_html(body)
    tag = _SUBJECT_TAG.get(module, module.upper())
    for addr, name in recipients.items():
        ok, err = await _send_graph_mail(sender, f"[{tag}] {title}", page, addr, name)
        if not ok:
            logger.warning("Notification '%s' to %s failed: %s", title, addr, err)
