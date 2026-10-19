"""Role-based notification events (core/notification_events.py): every
declared event names a real permission and valid channels, and role
subscriptions are validated."""
import pytest

from app.core.notification_events import CHANNELS, EVENTS, all_event_keys, catalog, clean_subscriptions
from app.core.permission_registry import all_permission_ids


def test_every_event_needs_a_declared_permission():
    declared = all_permission_ids()
    for module, events in EVENTS.items():
        for key, spec in events.items():
            assert spec["access"] in declared, f"{module}.{key} needs {spec['access']}, which is not declared"
            assert set(spec["default_channels"]) <= set(CHANNELS), f"{module}.{key}"
            assert spec["kind"] in {"approval", "assignment", "reminder", "info"}, f"{module}.{key}"


def test_catalog_lists_every_event():
    cat = catalog()
    listed = {f"{m}.{k}" for m, mod in cat["modules"].items() for k in mod["events"]}
    assert listed == all_event_keys()


def test_subscriptions_are_cleaned_and_validated():
    some = next(iter(sorted(all_event_keys())), None)
    if some is None:
        pytest.skip("no events declared")
    assert clean_subscriptions({some: ["teams", "bell", "nope"]}) == {some: ["bell", "teams"]}
    assert clean_subscriptions({some: []}) == {}
    assert clean_subscriptions(None) == {}
    with pytest.raises(ValueError):
        clean_subscriptions({"nope.event": ["bell"]})


def test_notify_event_reaches_subscribed_roles_with_access(db):
    """A role subscribed to an event notifies its members who hold the event's
    permission and can open the record — never the actor, never a member
    without the permission, never one the record check refuses."""
    from app.core.notification_events import notify_event
    from app.modules.main.models.notification import Notification
    from app.modules.main.models.role import Role
    from app.modules.main.models.user import User

    approver_role = Role(name="Quotation approvers", permissions=["crm:inquiries_tenders:view", "crm:inquiries_tenders:approve"],
                         notification_events={"crm.quotation_submitted": ["bell"]})
    viewer_role = Role(name="CRM viewers", permissions=["crm:inquiries_tenders:view"],
                       notification_events={"crm.quotation_submitted": ["bell"]})
    db.add_all([approver_role, viewer_role])
    db.flush()

    def user(email, roles):
        u = User(email=email, name=email.split("@")[0], role="user", is_active=True)
        u.roles = roles
        db.add(u)
        return u

    approver = user("approver@x.com", [approver_role])
    blocked = user("blocked@x.com", [approver_role])
    viewer = user("viewer@x.com", [viewer_role])
    actor = user("actor@x.com", [approver_role])
    db.commit()

    reached = notify_event(
        db, None, "crm", "quotation_submitted", title="Quotation QT-1 waiting", message="Please review.",
        entity_type="inquiry", entity_id=1, actor=actor, can_open=lambda u: u.id != blocked.id,
    )
    db.commit()
    assert reached == {approver.id}
    rows = db.query(Notification).filter(Notification.notification_type == "crm_ev_quotation_submitted").all()
    assert {r.user_id for r in rows} == {approver.id}

    # A role that customised the Quotations feature away no longer receives it.
    approver_role.permissions = ["crm:inquiries_tenders:view", "crm:inquiries_tenders:approve", "crm:inquiries_tenders.*:none"]
    db.commit()
    for u in (approver, blocked, viewer, actor):
        u.invalidate_permissions()
    assert notify_event(db, None, "crm", "quotation_submitted", title="t", message="m", actor=actor) == set()
