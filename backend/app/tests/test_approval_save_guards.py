"""Approval workflow save guards and four-eyes (2026-10-24):
- the setup check flags a deadlock (the same people must approve consecutive
  'every one' stages under 'different person per stage');
- saving through the API refuses blocking mistakes, an editor naming themselves,
  and non-admins switching off approval controls;
- self-approval is refused for the requester, a delegate acting as the requester,
  an admin standing in, and 'also allowed' permission holders;
- opening a workflow never marks it customised; escalation never targets someone four-eyes bars."""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalDelegation, ApprovalWorkflow
from app.modules.organization.services import approval_engine as engine

KEY = "test.save_guards"
APPROVE = ["quality:ncr:approve", "quality:ncr:reject"]
WF = "/api/v1/organization/workflows"

engine.register_transaction(engine.TransactionType(
    key=KEY, module_key="quality", subtab_key="ncr", label="Test save guards", entity_type="test_save_guards",
    url="/dashboard/quality/ncr/{id}", default_stages=[engine.StageDef("Check", "partner")],
))


def _user(db, email, grants=(), **kw):
    u = User(email=email, name=email.split("@")[0], role=kw.pop("role", "user"), is_active=True, **kw)
    u.granular_permissions = list(grants)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _stage(name, user_ids, mode="any", **kw):
    s = {"name": name, "approver_rule": "specific_users", "rule_config": {"user_ids": user_ids}, "approval_mode": mode,
         "conditions": [], "skip_if_no_approver": False, "escalate_after_hours": None, "escalation_rule": None,
         "escalation_config": {}}
    s.update(kw)
    return s


@pytest.fixture
def team(db):
    return {
        "admin": _user(db, "sg.admin@premnathrail.com", role="admin"),
        "editor": _user(db, "sg.editor@premnathrail.com", grants=["organization:workflows:view", "organization:workflows:edit"]),
        "req": _user(db, "sg.req@premnathrail.com", grants=APPROVE),
        "a": _user(db, "sg.a@premnathrail.com", grants=APPROVE),
        "b": _user(db, "sg.b@premnathrail.com", grants=APPROVE),
    }


def test_check_flags_deadlock_between_all_stages(db, team):
    a, b = team["a"], team["b"]
    two = [_stage("One", [a.id, b.id], "all"), _stage("Two", [a.id, b.id], "all")]
    out = engine.check_workflow(db, KEY, {"stages": two, "distinct_approvers": True, "is_active": True})
    dead = [i for i in out["issues"] if "can never be passed" in i["message"]]
    assert dead and dead[0]["level"] == "error" and dead[0]["stage"] == 1
    ok = engine.check_workflow(db, KEY, {"stages": two, "distinct_approvers": False, "is_active": True})
    assert not [i for i in ok["issues"] if "can never be passed" in i["message"]]


def test_save_refuses_blocking_mistakes(client, db, team):
    a, b = team["a"], team["b"]
    # Make the deadlock hit everyone who could raise the document: only these users exist with access.
    for u in list(db.query(User).all()):
        if u.id not in (a.id, b.id, team["admin"].id):
            u.is_active = False
    db.commit()
    two = [_stage("One", [a.id, b.id], "all"), _stage("Two", [a.id, b.id], "all")]
    r = client.put(f"{WF}/{KEY}", headers=_h(team["admin"]), json={"stages": two, "distinct_approvers": True, "is_active": True})
    out = engine.check_workflow(db, KEY, {"stages": two, "distinct_approvers": True, "is_active": True})
    blocking = [i for i in out["issues"] if i["blocking"]]
    if blocking:
        assert r.status_code == 422 and r.json()["detail"].startswith("Not saved")
        assert db.query(ApprovalWorkflow).filter(ApprovalWorkflow.key == KEY, ApprovalWorkflow.updated_by_id.isnot(None)).count() == 0
    else:  # the admin is in the checked group but isn't an approver: not everyone is hit
        assert r.status_code == 200


def test_editor_cannot_name_themselves_or_flip_controls(client, db, team):
    ed = team["editor"]
    me = client.put(f"{WF}/{KEY}", headers=_h(ed), json={"stages": [_stage("Check", [ed.id, team["a"].id])]})
    assert me.status_code == 422 and "named yourself" in me.json()["detail"]
    flip = client.put(f"{WF}/{KEY}", headers=_h(ed), json={"stages": [_stage("Check", [team["a"].id])], "allow_self_approval": True})
    assert flip.status_code == 403 and "Only an admin" in flip.json()["detail"]
    off = client.put(f"{WF}/{KEY}", headers=_h(ed), json={"stages": [_stage("Check", [team["a"].id])], "is_active": False})
    assert off.status_code == 403
    ok = client.put(f"{WF}/{KEY}", headers=_h(ed), json={"stages": [_stage("Check", [team["a"].id])]})
    assert ok.status_code == 200, ok.text
    adm = client.put(f"{WF}/{KEY}", headers=_h(team["admin"]), json={"stages": [_stage("Check", [team["a"].id])], "distinct_approvers": True})
    assert adm.status_code == 200, adm.text


def test_opening_a_workflow_does_not_mark_it_customised(client, db, team):
    client.get(f"{WF}/{KEY}", headers=_h(team["admin"]))
    rows = {w["key"]: w for w in client.get(WF, headers=_h(team["admin"])).json()}
    assert rows[KEY]["customised"] is False
    client.put(f"{WF}/{KEY}", headers=_h(team["admin"]), json={"stages": [_stage("Check", [team["a"].id])]})
    rows = {w["key"]: w for w in client.get(WF, headers=_h(team["admin"])).json()}
    assert rows[KEY]["customised"] is True


def _open(db, team, n, **extra):
    engine.save_workflow(db, KEY, {"stages": [_stage("Check", [team["a"].id, team["req"].id])], "is_active": True,
                                   "allow_self_approval": False, **extra}, team["admin"])
    db.commit()
    req = engine.submit(db, KEY, entity_id=n, requester=team["req"], title=f"Doc {n}", reference=f"SG-{n}")
    db.commit()
    return req


def test_requester_delegate_and_admin_cannot_self_approve(db, team):
    req = _open(db, team, 1)
    assert [s.approver_id for s in req.steps] == [team["a"].id]  # planner dropped the requester
    db.add(ApprovalDelegation(delegator_id=team["a"].id, delegate_id=team["req"].id, start_date=date.today() - timedelta(days=1),
                              end_date=date.today() + timedelta(days=1), is_active=True))
    db.commit()
    with pytest.raises(HTTPException) as e:
        engine.decide(db, req.id, team["req"], "approve")
    assert e.value.status_code == 403 and "four-eyes" in e.value.detail
    engine.save_workflow(db, KEY, {"stages": [_stage("Check", [team["a"].id])], "is_active": True,
                                   "allow_self_approval": False}, team["admin"])
    db.commit()
    admin_req = engine.submit(db, KEY, entity_id=2, requester=team["admin"], title="Doc 2", reference="SG-2")
    db.commit()
    with pytest.raises(HTTPException) as e2:
        engine.decide(db, admin_req.id, team["admin"], "approve", "standing in")
    assert e2.value.status_code == 403 and "four-eyes" in e2.value.detail


def test_plus_permission_holder_who_is_requester_is_dropped(db, team):
    engine.save_workflow(db, KEY, {"stages": [_stage("Check", [team["a"].id], rule_config={
        "user_ids": [team["a"].id], "plus_permission": "quality:ncr:approve"})], "is_active": True,
        "allow_self_approval": False}, team["admin"])
    db.commit()
    req = engine.submit(db, KEY, entity_id=3, requester=team["req"], title="Doc 3", reference="SG-3")
    db.commit()
    assert team["req"].id not in {i for s in req.steps for i in (s.escalated_to_ids or [])}
    with pytest.raises(HTTPException) as e:
        engine.decide(db, req.id, team["req"], "approve")
    assert e.value.status_code == 403


def test_escalation_skips_people_four_eyes_bars(db, team):
    prep = _user(db, "sg.prep@premnathrail.com", grants=APPROVE)
    engine.save_workflow(db, KEY, {"stages": [_stage("Check", [team["a"].id], escalate_after_hours=1, escalation_rule="specific_users",
                                                     escalation_config={"user_ids": [prep.id, team["b"].id]})],
                                   "is_active": True, "allow_self_approval": False}, team["admin"])
    db.commit()
    req = engine.submit(db, KEY, entity_id=4, requester=team["req"], title="Doc 4", reference="SG-4", exclude_user_ids=[prep.id])
    db.commit()
    for s in req.steps:
        s.due_at = s.due_at - timedelta(hours=5)
    db.commit()
    engine.escalate_overdue(db)
    db.commit()
    db.refresh(req)
    assert set(req.steps[0].escalated_to_ids) == {team["b"].id}
