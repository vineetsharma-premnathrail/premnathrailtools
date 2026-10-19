"""Approval workflow controls (2026-10-13): no silent bypass when every stage
is skipped, conditions that can't be evaluated are refused at save, and the
setup check reports who would be refused before a workflow is saved."""
import pytest
from fastapi import HTTPException

from app.modules.organization.services import approval_engine as engine
from app.modules.p2p.approvals import PR_KEY
from app.tests.test_p2p_requests import (  # noqa: F401 — fixture re-export
    BASE, _create_payload, _requester, _sqlite_number_series, auth_header, make_user,
)
from app.tests.p2p_workflow_helpers import link_items

WF = "/api/v1/organization/workflows"


def _admin(db):
    return make_user(db, "wfadmin@premnathrail.com", role="admin")


def _stage(**kw):
    s = {"name": "Department head", "approver_rule": "department_head", "rule_config": {}, "approval_mode": "any",
         "conditions": [], "skip_if_no_approver": False, "escalate_after_hours": None, "escalation_rule": None,
         "escalation_config": {}}
    s.update(kw)
    return s


def test_all_stages_skipped_is_refused_not_auto_approved(client, db):
    admin = _admin(db)
    engine.save_workflow(db, PR_KEY, {"stages": [_stage(skip_if_no_approver=True)], "is_active": True}, admin)
    db.commit()
    requester = _requester(db, "nohead@premnathrail.com", department="Nowhere")
    r = client.post(BASE, json=link_items(db, _create_payload()), headers=auth_header(requester))
    assert r.status_code == 422, r.text
    assert "never approved without an approver" in r.json()["detail"]


def test_number_operator_on_choice_field_is_refused(db):
    admin = _admin(db)
    with pytest.raises(HTTPException) as e:
        engine.save_workflow(db, PR_KEY, {"stages": [_stage(conditions=[{"field": "priority", "op": "gt", "value": "high"}])]}, admin)
    assert "only works on numbers" in e.value.detail


def test_choice_value_must_be_valid(db):
    admin = _admin(db)
    with pytest.raises(HTTPException) as e:
        engine.save_workflow(db, PR_KEY, {"stages": [_stage(conditions=[{"field": "priority", "op": "eq", "value": "urgent"}])]}, admin)
    assert "isn't a valid value" in e.value.detail


def test_check_reports_people_without_a_department_head(client, db):
    admin = _admin(db)
    _requester(db, "orphan@premnathrail.com", department="Ghost Dept")
    r = client.post(f"{WF}/{PR_KEY}/check", json={"stages": [_stage()], "is_active": True, "allow_self_approval": True},
                    headers=auth_header(admin))
    assert r.status_code == 200, r.text
    out = r.json()
    errors = [i for i in out["issues"] if i["level"] == "error"]
    assert any("Ghost Dept" in i["message"] for i in errors)
    assert any("four-eyes" in i["message"] for i in out["issues"] if i["level"] == "warning")


def test_history_lists_saves(client, db):
    admin = _admin(db)
    engine.save_workflow(db, PR_KEY, {"stages": [_stage()]}, admin)
    db.commit()
    r = client.get(f"{WF}/{PR_KEY}/history", headers=auth_header(admin))
    assert r.status_code == 200
    assert r.json() and "changed the approval workflow" in r.json()[0]["summary"]
