"""In-app notification side effects for ERP events (sync SQLAlchemy Session)."""
import logging
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote
import httpx
from sqlalchemy.orm import Session
from app.modules.main.models.user import User
from app.modules.main.models.notification import Notification
from app.auth.microsoft import get_msal_app

logger = logging.getLogger(__name__)

# Teams pushes are a real network call to Graph (token + HTTP POST) per
# recipient — doing that inline used to block the triggering request (e.g.
# creating an Inquiry) for several seconds per notified user, long enough to
# blow past the frontend's request timeout while the write itself had
# already succeeded. Fire them from a background pool instead so the
# request returns as soon as the DB write is done.
_teams_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="teams-notify")

# Must match teams-app/manifest.json's root "id" (the Teams catalog app ID —
# NOT webApplicationInfo.id, which is the AAD client ID used for SSO) and the
# "home" staticTabs entityId — Graph validates the activityType against
# whatever manifest is currently published to Teams, and the webUrl must be a
# Teams deep link (plain https:// URLs are rejected with a 400).
TEAMS_APP_ID = "da0e9c5c-b2d8-4a1f-a92a-7de40bba7eb3"
TEAMS_ENTITY_ID = "home"
PORTAL_URL = "https://erp.premnathrailtools.cloud/dashboard"


def _send_teams_activity_notification(azure_user_id: str, title: str, message: str) -> None:
    """Push a real Teams activity-feed notification (bell + toast + mobile push) to a user."""
    result = get_msal_app().acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    token = result.get("access_token")
    if not token:
        raise ValueError(f"Unable to acquire Graph token: {result.get('error_description', result.get('error'))}")
    web_url = f"https://teams.microsoft.com/l/entity/{TEAMS_APP_ID}/{TEAMS_ENTITY_ID}?webUrl={quote(PORTAL_URL, safe='')}"
    payload = {
        "topic": {
            "source": "text",
            "value": title,
            "webUrl": web_url,
        },
        "activityType": "notificationAlert",
        "previewText": {"content": message[:150]},
        "templateParameters": [{"name": "message", "value": message[:150]}],
        "recipient": {
            "@odata.type": "microsoft.graph.aadUserNotificationRecipient",
            "userId": azure_user_id,
        },
    }
    with httpx.Client() as client:
        resp = client.post(
            f"https://graph.microsoft.com/v1.0/users/{azure_user_id}/teamwork/sendActivityNotification",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.is_error:
            # raise_for_status() alone logs only "403 Forbidden", which is
            # indistinguishable between "the app registration is missing
            # TeamsActivity.Send consent" and "this recipient never installed
            # the Teams app" — Graph puts that difference in the body, so keep it.
            raise RuntimeError(
                f"Graph sendActivityNotification failed for {azure_user_id}: "
                f"{resp.status_code} {resp.text[:500]}"
            )


def _notify_teams_sync(user_id: int, azure_id: str, title: str, message: str) -> None:
    try:
        _send_teams_activity_notification(azure_id, title, message)
    except Exception:
        logger.exception("Failed to send Teams notification to user %s: '%s'", user_id, title)


def _notify_teams(user: User, title: str, message: str) -> None:
    if not user.azure_id:
        return
    # Read the scalar fields now (while the ORM object is still attached to
    # its session) and hand only those off to the background thread — the
    # User instance itself must not be touched outside the request's thread.
    _teams_executor.submit(_notify_teams_sync, user.id, user.azure_id, title, message)


# Record create/update/delete events are not notified at all — neither in the
# bell nor in Teams (2026-09-30). Only actionable notifications go out:
# approvals, assignments, results and follow-up reminders.
_SUPPRESSED_SUFFIXES = ("_created", "_updated", "_deleted")


def _is_suppressed(notification_type: str) -> bool:
    return notification_type.endswith(_SUPPRESSED_SUFFIXES)


def _send_email_sync(module: str, title: str, message: str, email: str, name: str, user_id: int) -> None:
    import asyncio
    from app.core.notify_rules import _send_emails
    try:
        asyncio.run(_send_emails(module, title, message, [], {email.lower(): name}))
    except Exception:
        logger.exception("Failed to email notification '%s' to user %s", title, user_id)


_AFTER_COMMIT = "_notification_emails_after_commit"


def _email_after_commit(db: Session, job: tuple) -> None:
    """Queue an email until the caller's transaction commits, so a rolled-back
    action never mails anyone. Only plain values are queued (no ORM objects)."""
    from sqlalchemy import event

    pending = db.info.get(_AFTER_COMMIT)
    if pending is None:
        pending = db.info[_AFTER_COMMIT] = []

        def _send(session) -> None:
            for j in session.info.pop(_AFTER_COMMIT, []):
                _teams_executor.submit(_send_email_sync, *j)

        def _drop(session) -> None:
            session.info.pop(_AFTER_COMMIT, None)
            if event.contains(session, "after_commit", _send):
                event.remove(session, "after_commit", _send)

        event.listen(db, "after_commit", _send, once=True)
        event.listen(db, "after_rollback", _drop, once=True)
    pending.append(job)


def _deliver(db: Session, users: list[User], title: str, message: str, notification_type: str,
             entity_type: str | None, entity_id: int | None, teams: bool) -> None:
    """Send one direct notification to `users` on their channels.

    A notification_type registered with register_direct (app/core/events/direct_*.py)
    takes its channels from Organization › Roles › Notifications and the
    user's personal override, else the type's defaults. An unregistered type
    keeps the old rule: bell, plus Teams when the caller passed teams=True."""
    from app.core.notification_events import direct_spec, resolve_direct_channels
    hit = direct_spec(notification_type)
    if hit:
        key, spec = hit
        module = key.partition(".")[0]
        channels = resolve_direct_channels(db, users, key, spec["default_channels"])
    else:
        module = "erp"
        logger.debug("Notification type '%s' is not registered as a direct notification.", notification_type)
        fallback = {"bell", "teams"} if teams else {"bell"}
        channels = {u.id: set(fallback) for u in users}
    for u in users:
        if not u.notifications_enabled:
            continue
        chans = channels.get(u.id, set())
        if hit and spec["kind"] == "approval":
            chans = chans | {"bell"}  # an approval request can never be switched off completely
        if "bell" in chans:
            db.add(Notification(
                user_id=u.id, title=title, message=message, notification_type=notification_type,
                entity_type=entity_type, entity_id=entity_id,
            ))
        if "teams" in chans:
            _notify_teams(u, title, message)
        if "email" in chans and u.email:
            _email_after_commit(db, (module, title, message, u.email, u.name or u.email, u.id))


def broadcast_notification(
    db: Session,
    title: str,
    message: str,
    notification_type: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    exclude_user_id: int | None = None,
    app_name: str = "erp",
    teams: bool = False,
) -> None:
    """Notify every user with access to `app_name` (except the actor), on the
    channels their roles / personal settings give this notification type."""
    if _is_suppressed(notification_type):
        return
    try:
        users = [
            u for u in db.query(User).filter(User.is_active == True).all()  # noqa: E712
            if app_name in u.get_apps() and not (exclude_user_id and u.id == exclude_user_id)
        ]
        _deliver(db, users, title, message, notification_type, entity_type, entity_id, teams)
    except Exception:
        logger.exception("Failed to broadcast notification '%s'", title)


def notify_user(
    db: Session,
    user_id: int,
    title: str,
    message: str,
    notification_type: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    teams: bool = False,
) -> None:
    """Direct notification to one person. Channels come from the type's
    registration (register_direct) and the person's role / personal
    notification settings; `teams` only matters for an unregistered type."""
    if _is_suppressed(notification_type):
        return
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return
        _deliver(db, [user], title, message, notification_type, entity_type, entity_id, teams)
    except Exception:
        logger.exception("Failed to notify user %s: '%s'", user_id, title)
