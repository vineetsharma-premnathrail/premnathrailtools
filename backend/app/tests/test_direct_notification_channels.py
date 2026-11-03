"""Direct notifications (register_direct) take their channels from
Organization › Roles › Notifications and the user's personal override,
else the type's default channels (2026-11-03)."""
from app.core.notification_events import DIRECT_BY_TYPE, clean_subscriptions, direct_spec
from app.modules.main.models.notification import Notification
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.utils import notifications

ASSIGNED = "rnd_task_assigned"          # assignment: default bell + Teams
INFO = "p2p_request_approved"           # result: default bell only


def _user(db, email, **kw):
    u = User(email=email, name=email.split("@")[0], role="user", is_active=True,
             assigned_apps=["rnd", "p2p"], azure_id=f"az-{email}", **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _capture(monkeypatch):
    pushed: list[tuple[int, str]] = []
    monkeypatch.setattr(notifications, "_notify_teams", lambda u, t, m: pushed.append((u.id, t)))
    return pushed


def _bells(db, user):
    return db.query(Notification).filter(Notification.user_id == user.id).count()


def test_catalog_registers_the_reported_types():
    for t in (ASSIGNED, INFO, "rnd_project_task_assigned", "approval", "approval_decided", "sr_assigned"):
        assert t in DIRECT_BY_TYPE, t
    key, spec = direct_spec(ASSIGNED)
    assert key == "rnd.direct:rnd_task_assigned"
    assert spec["audience"] == "direct" and set(spec["default_channels"]) == {"bell", "teams"}


def test_assignee_gets_bell_and_teams_by_default(db, monkeypatch):
    pushed = _capture(monkeypatch)
    u = _user(db, "dn1@premnathrail.com")
    notifications.notify_user(db, u.id, "New task", "m", ASSIGNED)
    notifications.notify_user(db, u.id, "PR approved", "m", INFO)
    db.commit()
    assert pushed == [(u.id, "New task")]
    assert _bells(db, u) == 2


def test_role_setting_picks_channels_and_can_switch_off(db, monkeypatch):
    pushed = _capture(monkeypatch)
    off, teams_only = _user(db, "dn2@premnathrail.com"), _user(db, "dn3@premnathrail.com")
    key = direct_spec(ASSIGNED)[0]
    r_off = Role(name="DN off", is_active=True, notification_events={key: []})
    r_teams = Role(name="DN teams", is_active=True, notification_events={key: ["teams"]})
    db.add_all([r_off, r_teams])
    db.commit()
    off.roles = [r_off]
    teams_only.roles = [r_teams]
    db.commit()
    for u in (off, teams_only):
        notifications.notify_user(db, u.id, "New task", "m", ASSIGNED)
    db.commit()
    assert _bells(db, off) == 0 and (off.id, "New task") not in pushed
    assert _bells(db, teams_only) == 0 and (teams_only.id, "New task") in pushed


def test_personal_override_beats_roles(db, monkeypatch):
    pushed = _capture(monkeypatch)
    key = direct_spec(INFO)[0]
    u = _user(db, "dn4@premnathrail.com", notification_overrides={key: ["bell", "teams"]})
    notifications.notify_user(db, u.id, "PR approved", "m", INFO)
    db.commit()
    assert (u.id, "PR approved") in pushed and _bells(db, u) == 1


def test_unregistered_type_keeps_old_rule(db, monkeypatch):
    pushed = _capture(monkeypatch)
    u = _user(db, "dn5@premnathrail.com")
    notifications.notify_user(db, u.id, "x", "m", "some_unregistered_type")
    notifications.notify_user(db, u.id, "y", "m", "some_unregistered_type", teams=True)
    db.commit()
    assert pushed == [(u.id, "y")] and _bells(db, u) == 2


def test_role_subscriptions_keep_empty_direct_entry():
    key = direct_spec(ASSIGNED)[0]
    assert clean_subscriptions({key: []}) == {key: []}
    assert clean_subscriptions({"rnd.task_assigned": []}) == {}


def test_approval_bell_cannot_be_switched_off(db, monkeypatch):
    _capture(monkeypatch)
    key = direct_spec("approval")[0]
    u = _user(db, "dn6@premnathrail.com", notification_overrides={key: []})
    notifications.notify_user(db, u.id, "Approval needed", "m", "approval")
    db.commit()
    assert _bells(db, u) == 1


def test_email_waits_for_commit_and_skips_rollback(db, monkeypatch):
    _capture(monkeypatch)
    sent: list = []
    monkeypatch.setattr(notifications._teams_executor, "submit", lambda fn, *a: sent.append(a[1]))
    key = direct_spec(INFO)[0]
    u = _user(db, "dn7@premnathrail.com", notification_overrides={key: ["email"]})
    notifications.notify_user(db, u.id, "rolled back", "m", INFO)
    db.rollback()
    notifications.notify_user(db, u.id, "kept", "m", INFO)
    assert sent == []
    db.commit()
    assert sent == ["kept"]
