"""Coverage tests for the Electrical module's sub-resources — BOM lines and
their purchase-requisition links, the cable schedule (incl. bulk status),
test records with the fail → retest chain, and Permission Matrix checks."""
from datetime import date

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.p2p.models.p2p_request import P2PRequest

API = "/api/v1/electrical"
TODAY = str(date.today())


def make_user(db, email, apps=("electrical",), role="user", grants=None):
    user = User(
        email=email, name=email.split("@")[0], role=role, is_active=True,
        assigned_apps=list(apps), granular_permissions=list(grants or []),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def make_pr(db, number, status="approved"):
    pr = P2PRequest(p2p_number=number, category_code="ELE", request_date=date.today(), status=status)
    db.add(pr)
    db.commit()
    return pr


@pytest.fixture
def eng(db):
    return make_user(db, "cov2.engineer@premnathrail.com")


@pytest.fixture
def h(eng):
    return auth(eng)


def new_job(client, h, title="Cov job"):
    r = client.post(f"{API}/jobs", json={"title": title}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def job(client, h):
    return new_job(client, h)


def add_test(client, h, job_id, **kw):
    body = {"test_type": "insulation_resistance", "result": "pass", "test_date": TODAY, **kw}
    return client.post(f"{API}/jobs/{job_id}/tests", json=body, headers=h)


# ---------------------------------------------------------------------------
# BOM
# ---------------------------------------------------------------------------

def test_bom_line_numbers_never_reused(client, h, job):
    base = f"{API}/jobs/{job['id']}/bom"
    a = client.post(base, json={"description": "  Battery isolator  ", "category": "protection"}, headers=h).json()
    b = client.post(base, json={"description": "Horn relay"}, headers=h).json()
    assert (a["line_no"], b["line_no"], a["description"]) == (1, 2, "Battery isolator")
    assert client.delete(f"{base}/{b['id']}", headers=h).status_code == 200
    c = client.post(base, json={"description": "Beacon"}, headers=h).json()
    assert c["line_no"] == 3  # line 2 is deleted, but its number stays burnt
    assert [x["line_no"] for x in client.get(base, headers=h).json()] == [1, 3]


def test_bom_validation(client, h, job):
    base = f"{API}/jobs/{job['id']}/bom"
    r = client.post(base, json={"description": "x", "category": "flux_capacitor"}, headers=h)
    assert r.status_code == 400 and "Invalid category" in r.json()["detail"]
    r = client.post(base, json={"description": "x", "procurement_status": "lost"}, headers=h)
    assert r.status_code == 400 and "Invalid procurement status" in r.json()["detail"]
    r = client.post(base, json={"description": "x", "selection_status": "approved", "make": "ABB"}, headers=h)
    assert r.status_code == 400 and "make and the part number" in r.json()["detail"]
    r = client.post(base, json={"description": "x", "store_item_id": 9999}, headers=h)
    assert r.status_code == 404
    # A panel from a different job can't be referenced.
    other = new_job(client, h, "Other")
    panel = client.post(f"{API}/jobs/{other['id']}/panels", json={"panel_tag": "P-9", "name": "Other panel"}, headers=h).json()
    r = client.post(base, json={"description": "x", "panel_id": panel["id"]}, headers=h)
    assert r.status_code == 404 and "isn't on this job" in r.json()["detail"]
    # Line from another job is not reachable via this job's URL.
    line = client.post(f"{API}/jobs/{other['id']}/bom", json={"description": "y"}, headers=h).json()
    assert client.patch(f"{base}/{line['id']}", json={"quantity": 2}, headers=h).status_code == 404


def test_bom_estimated_cost_in_job_summary(client, h, job):
    base = f"{API}/jobs/{job['id']}"
    client.post(f"{base}/bom", json={"description": "Cable lug", "quantity": 20, "estimated_unit_cost": 12.5}, headers=h)
    client.post(f"{base}/bom", json={"description": "Relay", "quantity": 3, "estimated_unit_cost": 450}, headers=h)
    client.post(f"{base}/bom", json={"description": "Free issue", "quantity": 1}, headers=h)
    summary = client.get(base, headers=h).json()["summary"]
    # 20 × 12.5 + 3 × 450 + 1 × 0 = 250 + 1350 = 1600
    assert summary["bom_estimated_cost"] == 1600
    assert summary["bom_count"] == 3 and summary["bom_required"] == 3


def test_link_and_unlink_purchase_requisition(client, db, h, job):
    base = f"{API}/jobs/{job['id']}/bom"
    line = client.post(base, json={"description": "MCB 6A", "procurement_status": "in_stock"}, headers=h).json()
    make_pr(db, "P2P-ELE-2026-0101")
    make_pr(db, "P2P-ELE-2026-0102", status="cancelled")

    r = client.post(f"{base}/{line['id']}/link-pr", json={"p2p_number": "P2P-ELE-2026-0102"}, headers=h)
    assert r.status_code == 409 and "cancelled" in r.json()["detail"]
    r = client.post(f"{base}/{line['id']}/unlink-pr", headers=h)
    assert r.status_code == 409 and "isn't linked" in r.json()["detail"]

    linked = client.post(f"{base}/{line['id']}/link-pr", json={"p2p_number": "  p2p-ele-2026-0101 "}, headers=h).json()
    assert linked["procurement_status"] == "pr_raised" and linked["p2p_number"] == "P2P-ELE-2026-0101"
    assert linked["p2p_status"] == "approved"
    unlinked = client.post(f"{base}/{line['id']}/unlink-pr", headers=h).json()
    # pr_raised falls back to required (not the earlier in_stock).
    assert unlinked["procurement_status"] == "required" and unlinked["p2p_number"] is None

    # 'Ordered' needs a linked PR; once ordered, relinking keeps the status,
    # unlinking falls back to required, and the line can't be deleted.
    r = client.patch(f"{base}/{line['id']}", json={"procurement_status": "ordered"}, headers=h)
    assert r.status_code == 400 and "Link PR" in r.json()["detail"]
    client.post(f"{base}/{line['id']}/link-pr", json={"p2p_number": "P2P-ELE-2026-0101"}, headers=h)
    assert client.patch(f"{base}/{line['id']}", json={"procurement_status": "ordered"}, headers=h).json()["procurement_status"] == "ordered"
    still = client.post(f"{base}/{line['id']}/link-pr", json={"p2p_number": "P2P-ELE-2026-0101"}, headers=h).json()
    assert still["procurement_status"] == "ordered"
    r = client.delete(f"{base}/{line['id']}", headers=h)
    assert r.status_code == 409 and "already ordered" in r.json()["detail"]
    assert client.post(f"{base}/{line['id']}/unlink-pr", headers=h).json()["procurement_status"] == "required"


def test_purchase_requirements_view(client, db, h, job):
    other = new_job(client, h, "Cancelled job")
    a = client.post(f"{API}/jobs/{job['id']}/bom", json={"description": "Alternator", "make": "Lucas"}, headers=h).json()
    client.post(f"{API}/jobs/{job['id']}/bom", json={"description": "Spare fuse", "procurement_status": "in_stock"}, headers=h)
    client.post(f"{API}/jobs/{other['id']}/bom", json={"description": "Ghost"}, headers=h)
    client.post(f"{API}/jobs/{other['id']}/cancel", json={"reason": "dropped"}, headers=h)

    open_lines = client.get(f"{API}/purchase-requirements", headers=h).json()
    # Only open procurement lines on live jobs; the cancelled job's line is hidden.
    assert [x["id"] for x in open_lines] == [a["id"]]
    assert open_lines[0]["job_number"] == job["job_number"] and open_lines[0]["job_title"] == "Cov job"
    in_stock = client.get(f"{API}/purchase-requirements", params={"procurement_status": "in_stock"}, headers=h).json()
    assert [x["description"] for x in in_stock] == ["Spare fuse"]
    assert client.get(f"{API}/purchase-requirements", params={"search": "lucas"}, headers=h).json()[0]["id"] == a["id"]

    r = client.post(f"{API}/jobs/{job['id']}/stages/purchase_requirement/complete", json={}, headers=h)
    assert r.status_code == 409 and "BOM line(s) 1" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Cables
# ---------------------------------------------------------------------------

def _cable(client, h, job_id, tag, **kw):
    return client.post(f"{API}/jobs/{job_id}/cables", json={"cable_tag": tag, "from_point": "A", "to_point": "B", **kw}, headers=h)


def test_cable_tags_are_unique_per_job(client, h, job):
    c = _cable(client, h, job["id"], " c-010 ")
    assert c.status_code == 200 and c.json()["cable_tag"] == "C-010" and c.json()["status"] == "designed"
    dup = _cable(client, h, job["id"], "C-010")
    assert dup.status_code == 409 and "already in this job's cable schedule" in dup.json()["detail"]
    # Same tag on another job is fine.
    other = new_job(client, h, "Other")
    assert _cable(client, h, other["id"], "C-010").status_code == 200
    bad = _cable(client, h, job["id"], "C-011", status="spliced")
    assert bad.status_code == 400 and "Invalid cable status" in bad.json()["detail"]
    # Renaming onto an existing tag is caught too.
    c2 = _cable(client, h, job["id"], "C-012").json()
    r = client.patch(f"{API}/jobs/{job['id']}/cables/{c2['id']}", json={"cable_tag": "c-010"}, headers=h)
    assert r.status_code == 409


def test_cable_bulk_status_and_wiring_gate(client, h, job):
    base = f"{API}/jobs/{job['id']}"
    ids = [_cable(client, h, job["id"], f"W-{n:02d}").json()["id"] for n in range(1, 4)]

    r = client.post(f"{base}/stages/wiring_installation/complete", json={}, headers=h)
    assert r.status_code == 409 and "cable(s) W-01, W-02, W-03 as installed" in r.json()["detail"]

    bad = client.post(f"{base}/cables/bulk-status", json={"cable_ids": ids[:2], "status": "glued"}, headers=h)
    assert bad.status_code == 400
    empty = client.post(f"{base}/cables/bulk-status", json={"cable_ids": [], "status": "installed"}, headers=h)
    assert empty.status_code == 422
    other = new_job(client, h, "Other")
    foreign = _cable(client, h, other["id"], "X-01").json()["id"]
    r = client.post(f"{base}/cables/bulk-status", json={"cable_ids": [ids[0], foreign], "status": "installed"}, headers=h)
    assert r.status_code == 404 and "1 of the selected cables" in r.json()["detail"]
    # Nothing changed on the failed request.
    assert {c["status"] for c in client.get(f"{base}/cables", headers=h).json()} == {"designed"}

    out = client.post(f"{base}/cables/bulk-status", json={"cable_ids": ids[:2], "status": "terminated"}, headers=h)
    assert out.status_code == 200
    # Returns the whole schedule, tag-ordered.
    assert [(c["cable_tag"], c["status"]) for c in out.json()] == [("W-01", "terminated"), ("W-02", "terminated"), ("W-03", "designed")]
    r = client.post(f"{base}/stages/wiring_installation/complete", json={}, headers=h)
    assert r.status_code == 409 and "cable(s) W-03 as installed" in r.json()["detail"]
    client.post(f"{base}/cables/bulk-status", json={"cable_ids": [ids[2]], "status": "tested"}, headers=h)
    assert client.post(f"{base}/stages/wiring_installation/complete", json={}, headers=h).status_code == 200
    summary = client.get(base, headers=h).json()["summary"]
    assert summary["cable_count"] == 3 and summary["cables_installed"] == 3


# ---------------------------------------------------------------------------
# Tests & retests
# ---------------------------------------------------------------------------

def test_test_numbers_are_per_job_and_inputs_validated(client, h, job):
    assert add_test(client, h, job["id"]).json()["test_number"] == "T-001"
    assert add_test(client, h, job["id"]).json()["test_number"] == "T-002"
    other = new_job(client, h, "Other")
    assert add_test(client, h, other["id"]).json()["test_number"] == "T-001"

    r = add_test(client, h, job["id"], result="maybe")
    assert r.status_code == 400 and "'pass' or 'fail'" in r.json()["detail"]
    r = add_test(client, h, job["id"], phase="field")
    assert r.status_code == 400 and "Invalid test phase" in r.json()["detail"]
    r = add_test(client, h, job["id"], test_type="smell_test")
    assert r.status_code == 400 and "Invalid test type" in r.json()["detail"]
    r = add_test(client, h, job["id"], tested_by_id=99999)
    assert r.status_code == 404


def test_retest_rules(client, h, job):
    passed = add_test(client, h, job["id"]).json()
    r = add_test(client, h, job["id"], retest_of_id=passed["id"])
    assert r.status_code == 409 and "only a failed test needs a retest" in r.json()["detail"]

    other = new_job(client, h, "Other")
    foreign_fail = add_test(client, h, other["id"], result="fail").json()
    r = add_test(client, h, job["id"], retest_of_id=foreign_fail["id"])
    assert r.status_code == 400 and "different job" in r.json()["detail"]

    # A retest inherits the phase of the test it repeats.
    comm_fail = add_test(client, h, job["id"], phase="commissioning", test_type="functional", result="fail").json()
    re = add_test(client, h, job["id"], phase="factory", test_type="functional", retest_of_id=comm_fail["id"]).json()
    assert re["phase"] == "commissioning" and re["retest_of_number"] == comm_fail["test_number"]


def test_fail_fail_pass_chain_clears_only_at_the_end(client, h, job):
    base = f"{API}/jobs/{job['id']}"
    t1 = add_test(client, h, job["id"], result="fail", measured_value="0.1", unit="MΩ").json()
    t2 = add_test(client, h, job["id"], result="fail", retest_of_id=t1["id"]).json()
    tests = {t["test_number"]: t["needs_retest"] for t in client.get(f"{base}/tests", headers=h).json()}
    # T-001 has a retest; the failed retest T-002 is now the open failure.
    assert tests == {"T-001": False, "T-002": True}
    r = client.post(f"{base}/stages/electrical_testing/complete", json={}, headers=h)
    assert r.status_code == 409 and "failed test(s) T-002" in r.json()["detail"]
    # Retesting T-001 again is refused — retest the latest link instead.
    r = add_test(client, h, job["id"], retest_of_id=t1["id"])
    assert r.status_code == 409 and "already has retest T-002" in r.json()["detail"]

    listed = client.get(f"{API}/tests", params={"job_id": job["id"], "needs_retest": True}, headers=h).json()
    assert [t["test_number"] for t in listed] == ["T-002"]

    add_test(client, h, job["id"], result="pass", retest_of_id=t2["id"])
    assert client.get(base, headers=h).json()["summary"]["open_failures"] == 0
    assert client.post(f"{base}/stages/electrical_testing/complete", json={}, headers=h).status_code == 200


def test_failed_result_cannot_be_edited_into_a_pass(client, h, job):
    t = add_test(client, h, job["id"], result="fail").json()
    # `result` isn't on the update schema — it's silently ignored.
    r = client.patch(f"{API}/tests/{t['id']}", json={"result": "pass", "remarks": "re-measured"}, headers=h)
    assert r.status_code == 200 and r.json()["result"] == "fail" and r.json()["remarks"] == "re-measured"
    assert r.json()["needs_retest"] is True


def test_test_delete_guards(client, h, job):
    t1 = add_test(client, h, job["id"], result="fail").json()
    t2 = add_test(client, h, job["id"], result="pass", retest_of_id=t1["id"]).json()
    r = client.delete(f"{API}/tests/{t1['id']}", headers=h)
    assert r.status_code == 409 and "Delete the retest first" in r.json()["detail"]
    issue = client.post(f"{API}/jobs/{job['id']}/issues", json={"title": "Earth fault", "test_id": t2["id"]}, headers=h)
    assert issue.status_code == 200, issue.text
    r = client.delete(f"{API}/tests/{t2['id']}", headers=h)
    assert r.status_code == 409 and "raised from test T-002" in r.json()["detail"]


def test_cable_link_on_test_must_be_same_job(client, h, job):
    other = new_job(client, h, "Other")
    foreign = _cable(client, h, other["id"], "F-01").json()
    r = add_test(client, h, job["id"], cable_id=foreign["id"])
    assert r.status_code == 404 and "cable schedule" in r.json()["detail"]
    mine = _cable(client, h, job["id"], "M-01").json()
    ok = add_test(client, h, job["id"], cable_id=mine["id"]).json()
    assert ok["cable_tag"] == "M-01" and ok["tested_by_name"] == "cov2.engineer"


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------

def test_module_access_required_everywhere(client, db, job):
    outsider = make_user(db, "cov2.outsider@premnathrail.com", apps=("erp",))
    ho = auth(outsider)
    for method, url in (
        ("get", f"{API}/jobs/{job['id']}"),
        ("get", f"{API}/jobs/{job['id']}/bom"),
        ("get", f"{API}/jobs/{job['id']}/cables"),
        ("get", f"{API}/tests"),
        ("get", f"{API}/purchase-requirements"),
        ("post", f"{API}/jobs/{job['id']}/stages/system_design/complete"),
    ):
        r = getattr(client, method)(url, headers=ho) if method == "get" else client.post(url, json={}, headers=ho)
        assert r.status_code == 403, url
    assert client.get(f"{API}/jobs").status_code in (401, 403)


def test_permission_matrix_view_only_user(client, db, job):
    viewer = make_user(db, "cov2.viewer@premnathrail.com", grants=["electrical:jobs:view"])
    hv = auth(viewer)
    assert client.get(f"{API}/jobs", headers=hv).status_code == 200
    r = client.post(f"{API}/jobs", json={"title": "x"}, headers=hv)
    assert r.status_code == 403 and "Permission Matrix" in r.json()["detail"]
    assert client.post(f"{API}/jobs/{job['id']}/bom", json={"description": "x"}, headers=hv).status_code == 403
    assert client.post(f"{API}/jobs/{job['id']}/cables/bulk-status", json={"cable_ids": [1], "status": "installed"}, headers=hv).status_code == 403
    assert client.post(f"{API}/jobs/{job['id']}/stages/system_design/complete", json={}, headers=hv).status_code == 403
    # Tabs not granted in the matrix are hidden.
    assert client.get(f"{API}/tests", headers=hv).status_code == 403
    assert client.get(f"{API}/purchase-requirements", headers=hv).status_code == 403
    assert client.get(f"{API}/drawings", headers=hv).status_code == 403
    # Deleting a job needs the 'delete' grant specifically.
    editor = make_user(db, "cov2.editor@premnathrail.com", grants=["electrical:jobs:view", "electrical:jobs:create", "electrical:jobs:edit"])
    mine = client.post(f"{API}/jobs", json={"title": "Editor's"}, headers=auth(editor)).json()
    assert client.delete(f"{API}/jobs/{mine['id']}", headers=auth(editor)).status_code == 403
