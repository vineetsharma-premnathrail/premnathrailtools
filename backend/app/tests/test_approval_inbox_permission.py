"""Approval engine read side and approver checks (2026-10-23):
- My Approvals only loads what the user can act on, in a fixed number of queries;
- an approver without the Approve permission is flagged up front (preview, setup
  check) and never shown a button that would answer 403;
- the people excluded by four-eyes are remembered on the request so decide() refuses them."""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import event

from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalDelegation, ApprovalRequestStep
from app.modules.organization.services import approval_engine as engine

KEY = "test.inbox_permission"
APPROVE = ["quality:ncr:approve", "quality:ncr:reject"]

engine.register_transaction(engine.TransactionType(
    key=KEY, module_key="quality", subtab_key="ncr", label="Test inbox permission", entity_type="test_inbox_perm",
    url="/dashboard/quality/ncr/{id}", default_stages=[engine.StageDef("Check", "partner")],
))


def _user(db, email, grants=(), **kw):
    u = User(email=email, name=email.split("@")[0], role=kw.pop("role", "user"), is_active=True, **kw)
    u.granular_permissions = list(grants)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _stage(user_ids, **kw):
    s = {"name": "Check", "approver_rule": "specific_users", "rule_config": {"user_ids": user_ids}, "approval_mode": "any",
         "conditions": [], "skip_if_no_approver": False, "escalate_after_hours": None, "escalation_rule": None,
         "escalation_config": {}}
    s.update(kw)
    return s


def _point_at(db, admin, user_ids, **flags):
    engine.save_workflow(db, KEY, {"stages": [_stage(user_ids)], "is_active": True, "allow_self_approval": False, **flags}, admin)
    db.commit()


def _submit(db, requester, n, **kw):
    req = engine.submit(db, KEY, entity_id=n, requester=requester, title=f"Doc {n}", reference=f"D-{n}", **kw)
    db.commit()
    return req


@pytest.fixture
def team(db):
    return {
        "admin": _user(db, "ip.admin@premnathrail.com", role="admin"),
        "req": _user(db, "ip.req@premnathrail.com"),
        "holder": _user(db, "ip.holder@premnathrail.com", grants=APPROVE),
        "other": _user(db, "ip.other@premnathrail.com", grants=APPROVE),
        "nobody": _user(db, "ip.nobody@premnathrail.com"),  # no Approve anywhere
    }


def test_inbox_only_returns_own_approvals_and_query_count_is_flat(db, team):
    holder, other, req = team["holder"], team["other"], team["req"]
    _point_at(db, team["admin"], [holder.id])
    _submit(db, req, 1)
    _point_at(db, team["admin"], [other.id])
    for n in range(2, 8):
        _submit(db, req, n)

    assert [r["reference"] for r in engine.inbox(db, holder)] == ["D-1"]
    assert len(engine.inbox(db, other)) == 6
    assert engine.inbox(db, team["nobody"]) == []

    def count(user):
        n = []
        listener = lambda *a, **k: n.append(1)  # noqa: E731
        event.listen(db.get_bind(), "before_cursor_execute", listener)
        try:
            db.expire_all()
            engine.inbox(db, user)
        finally:
            event.remove(db.get_bind(), "before_cursor_execute", listener)
        return len(n)

    few = count(holder)
    for n in range(8, 20):
        _submit(db, req, n)
    assert count(holder) <= few + 1  # unrelated pending requests don't add queries
    assert count(other) < 15  # 18 rows for `other`: a handful of queries, not a few per row


def test_inbox_includes_delegate(db, team):
    holder, req = team["holder"], team["req"]
    delegate = _user(db, "ip.deleg@premnathrail.com", grants=APPROVE)
    db.add(ApprovalDelegation(delegator_id=holder.id, delegate_id=delegate.id, is_active=True,
                              start_date=date.today() - timedelta(days=1), end_date=date.today() + timedelta(days=1)))
    _point_at(db, team["admin"], [holder.id])
    _submit(db, req, 1)
    assert [r["acting_for"] for r in engine.inbox(db, delegate)] == [holder.name]


def test_approver_without_approve_permission_is_flagged_and_hidden(db, team):
    admin, req, nobody = team["admin"], team["req"], team["nobody"]
    _point_at(db, admin, [nobody.id])

    stages = engine.preview(db, KEY, requester=req, context={}, branch_id=None)
    warning = stages[0]["warning"]
    assert "ip.nobody" in warning and "doesn't hold Approve on" in warning and "pick someone else" in warning

    out = engine.check_workflow(db, KEY, {"stages": [_stage([nobody.id])], "is_active": True})
    assert any("doesn't hold Approve" in i["message"] for i in out["issues"] if i["level"] == "error")

    # Submitting still works (an admin can stand in) but the named person gets no dead button.
    r = _submit(db, req, 1)
    assert engine.request_out(db, r, nobody)["can_decide"] is False
    assert engine.inbox(db, nobody) == []
    assert engine.request_out(db, r, admin)["can_stand_in"] is True

    # With the permission requirement switched off, the named person is the approver and sees it.
    _point_at(db, admin, [nobody.id], require_permission=False)
    assert engine.preview(db, KEY, requester=req, context={}, branch_id=None)[0]["warning"] is None
    _submit(db, req, 2)
    assert [x["reference"] for x in engine.inbox(db, nobody)] == ["D-1", "D-2"]  # the earlier one too: nobody needs the permission now


def test_holder_kept_and_non_holder_dropped_from_a_mixed_stage(db, team):
    _point_at(db, team["admin"], [team["holder"].id, team["nobody"].id])
    r = _submit(db, team["req"], 1)
    assert {s.approver_id for s in r.steps} == {team["holder"].id}
    assert engine.inbox(db, team["nobody"]) == []
    assert len(engine.inbox(db, team["holder"])) == 1


def test_can_decide_false_when_permission_was_removed_after_submit(db, team):
    holder = team["holder"]
    _point_at(db, team["admin"], [holder.id])
    r = _submit(db, team["req"], 1)
    assert engine.request_out(db, r, holder)["can_decide"] is True
    holder.granular_permissions = []
    holder.invalidate_permissions()
    db.commit()
    assert engine.request_out(db, r, holder)["can_decide"] is False
    assert engine.inbox(db, holder) == []


def test_four_eyes_exclusion_is_stored_and_enforced_on_decide(db, team):
    preparer = _user(db, "ip.prep@premnathrail.com", grants=APPROVE)
    _point_at(db, team["admin"], [team["holder"].id, preparer.id])
    r = _submit(db, team["req"], 1, exclude_user_ids=[preparer.id])
    assert r.context["_excluded_user_ids"] == [preparer.id]
    # The planner already drops the preparer; decide() is the second line of defence:
    # give them a step anyway and they are still refused.
    db.add(ApprovalRequestStep(request_id=r.id, sequence=r.current_sequence, stage_name="Check", approval_mode="any",
                               approver_id=preparer.id, status="pending", escalated_to_ids=[]))
    db.commit()
    with pytest.raises(HTTPException) as e:
        engine.decide(db, r.id, preparer, "approve")
    assert e.value.status_code == 403 and "four-eyes" in e.value.detail
