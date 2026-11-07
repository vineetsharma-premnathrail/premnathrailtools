"""Owner 2026-11-07: every approval workflow is OFF by default — a document
type needs no approval until an admin switches its workflow on."""
import pytest

from app.modules.organization.services import approval_engine as engine
from app.modules.p2p.approvals import PR_KEY
from app.tests.test_p2p_requests import auth_header, make_user

pytestmark = pytest.mark.approvals_default_off
WF = "/api/v1/organization/workflows"


def test_new_workflows_start_off(db):
    for key in engine.transaction_types():
        assert engine.ensure_workflow(db, key).is_active is False, key


def test_workflow_list_and_reset_show_off(client, db):
    admin = make_user(db, "wfadmin@premnathrail.com", role="admin")
    r = client.get(WF, headers=auth_header(admin))
    assert r.status_code == 200, r.text
    rows = r.json() if isinstance(r.json(), list) else r.json().get("types") or r.json().get("items") or []
    assert rows and all(row["is_active"] is False for row in rows)
    # Switched on by an admin, then "Reset to default" turns it off again.
    engine.save_workflow(db, PR_KEY, {"stages": [s.__dict__ for s in engine.get_type(PR_KEY).default_stages],
                                      "is_active": True}, admin)
    db.commit()
    assert engine.ensure_workflow(db, PR_KEY).is_active is True
    r = client.post(f"{WF}/{PR_KEY}/reset", headers=auth_header(admin))
    assert r.status_code == 200, r.text
    assert r.json()["workflow"]["is_active"] is False
