"""In-app notification side effects for ERP events (sync SQLAlchemy Session)."""
import logging
from urllib.parse import quote
import httpx
from sqlalchemy.orm import Session
from app.modules.main.models.user import User
from app.modules.main.models.notification import Notification
from app.auth.microsoft import get_msal_app

logger = logging.getLogger(__name__)

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
        resp.raise_for_status()


def _notify_teams(user: User, title: str, message: str) -> None:
    if not user.azure_id:
        return
    try:
        _send_teams_activity_notification(user.azure_id, title, message)
    except Exception:
        logger.exception("Failed to send Teams notification to user %s: '%s'", user.id, title)


def broadcast_notification(
    db: Session,
    title: str,
    message: str,
    notification_type: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    exclude_user_id: int | None = None,
    app_name: str = "erp",
) -> None:
    """Notify every user with access to `app_name` (except the actor)."""
    try:
        for u in db.query(User).filter(User.is_active == True).all():  # noqa: E712
            if app_name not in u.get_apps():
                continue
            if exclude_user_id and u.id == exclude_user_id:
                continue
            db.add(Notification(
                user_id=u.id, title=title, message=message, notification_type=notification_type,
                entity_type=entity_type, entity_id=entity_id,
            ))
            _notify_teams(u, title, message)
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
) -> None:
    try:
        db.add(Notification(
            user_id=user_id, title=title, message=message, notification_type=notification_type,
            entity_type=entity_type, entity_id=entity_id,
        ))
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            _notify_teams(user, title, message)
    except Exception:
        logger.exception("Failed to notify user %s: '%s'", user_id, title)
