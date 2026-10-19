"""Electrical — subtab write permissions (Testing / Troubleshooting /
Purchase), the PR-backed procurement-status gate, the BOM approval check,
the 'needs retest' filter beyond the row limit, and non-ASCII file names on
the inline file headers."""
from datetime import date, timedelta

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.electrical.models.test_record import ElectricalTest
from app.modules.electrical.service import inline_file_headers
from app.modules.main.models.user import User
from app.modules.p2p.models.p2p_request import P2PRequest

API = "/api/v1/electrical"
TODAY = str(date.today())


def make_user(db, email, grants=None, apps=("electrical",)):
    user = User(
        email=email, name=email.split("@")[0], role="user", is_active=True,
        assigned_apps=list(apps), granular_permissions=list(grants or []),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


@pytest.fixture
def h(db):
    return auth(make_user(db, "gates.engineer@premnathrail.com"))


@pytest.fixture
def job(client, h):
    r = client.post(f"{API}/jobs", json={"title": "Gates job"}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_testing_grants_allow_test_records_without_jobs_edit(client, db, h, job):
    tester = auth(make_user(db, "gates.tester@premnathrail.com", grants=[
        "electrical:testing:view", "electrical:testing:create", "electrical:testing:edit",
    ]))
    body = {"test_type": "insulation_resistance", "result": "pass", "test_date": TODAY}
    r = client.post(f"{API}/jobs/{job['id']}/tests", json=body, headers=tester)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    assert client.patch(f"{API}/tests/{tid}", json={"remarks": "ok"}, headers=tester).status_code == 200
    # No testing:delete grant -> 403 naming every grant that would allow it.
    r = client.delete(f"{API}/tests/{tid}", headers=tester)
    assert r.status_code == 403
    detail = r.json()["detail"]
    assert "'edit' on Electrical › RRV Electrical Jobs" in detail and "'delete' on Electrical › Testing" in detail
    # Testing grants don't open up issues.
    assert client.post(f"{API}/jobs/{job['id']}/issues", json={"title": "x"}, headers=tester).status_code == 403


def test_troubleshooting_grants_allow_issue_work(client, db, h, job):
    tech = auth(make_user(db, "gates.tech@premnathrail.com", grants=[
        "electrical:troubleshooting:view", "electrical:troubleshooting:create", "electrical:troubleshooting:edit",
    ]))
    r = client.post(f"{API}/jobs/{job['id']}/issues", json={"title": "Horn dead"}, headers=tech)
    assert r.status_code == 200, r.text
    iid = r.json()["id"]
    assert client.patch(f"{API}/issues/{iid}", json={"symptom": "No sound"}, headers=tech).status_code == 200
    r = client.delete(f"{API}/issues/{iid}", headers=tech)
    assert r.status_code == 403 and "'delete' on Electrical › Troubleshooting" in r.json()["detail"]
    assert client.post(f"{API}/jobs/{job['id']}/tests", json={
        "test_type": "insulation_resistance", "result": "pass", "test_date": TODAY,
    }, headers=tech).status_code == 403


def test_purchase_edit_grant_can_link_pr_but_not_edit_bom(client, db, h, job):
    line = client.post(f"{API}/jobs/{job['id']}/bom", json={"description": "Contactor"}, headers=h).json()
    db.add(P2PRequest(p2p_number="P2P-ELE-2026-0201", category_code="ELE", request_date=date.today(), status="approved"))
    db.commit()
    buyer = auth(make_user(db, "gates.buyer@premnathrail.com", grants=["electrical:purchase:view", "electrical:purchase:edit"]))
    base = f"{API}/jobs/{job['id']}/bom/{line['id']}"
    r = client.post(f"{base}/link-pr", json={"p2p_number": "P2P-ELE-2026-0201"}, headers=buyer)
    assert r.status_code == 200, r.text
    assert client.post(f"{base}/unlink-pr", headers=buyer).status_code == 200
    assert client.patch(base, json={"quantity": 3}, headers=buyer).status_code == 403


def test_pr_backed_statuses_need_a_linked_pr(client, db, h, job):
    base = f"{API}/jobs/{job['id']}/bom"
    for status, label in (("pr_raised", "PR Raised"), ("ordered", "Ordered")):
        r = client.post(base, json={"description": "Relay", "procurement_status": status}, headers=h)
        assert r.status_code == 400 and f"'{label}'" in r.json()["detail"] and "Link PR" in r.json()["detail"]
    line = client.post(base, json={"description": "Relay"}, headers=h).json()
    r = client.patch(f"{base}/{line['id']}", json={"procurement_status": "ordered"}, headers=h)
    assert r.status_code == 400 and f"BOM line {line['line_no']}" in r.json()["detail"]
    # In stock doesn't need a PR.
    assert client.patch(f"{base}/{line['id']}", json={"procurement_status": "in_stock"}, headers=h).status_code == 200


def test_bom_approval_needs_approve_grant(client, db, h, job):
    base = f"{API}/jobs/{job['id']}/bom"
    editor = auth(make_user(db, "gates.editor@premnathrail.com", grants=["electrical:jobs:view", "electrical:jobs:edit"]))
    approver = auth(make_user(db, "gates.approver@premnathrail.com", grants=[
        "electrical:jobs:view", "electrical:jobs:edit", "electrical:jobs:approve",
    ]))
    sel = {"make": "ABB", "part_number": "A9F74106"}
    r = client.post(base, json={"description": "MCB", "selection_status": "approved", **sel}, headers=editor)
    assert r.status_code == 403 and "approve a component selection" in r.json()["detail"]
    line = client.post(base, json={"description": "MCB", "selection_status": "selected", **sel}, headers=editor).json()
    assert client.patch(f"{base}/{line['id']}", json={"selection_status": "approved"}, headers=editor).status_code == 403
    assert client.patch(f"{base}/{line['id']}", json={"selection_status": "approved"}, headers=approver).status_code == 200
    # Approved line: remarks stay editable, swapping the part needs approve again.
    assert client.patch(f"{base}/{line['id']}", json={"remarks": "x", "selection_status": "approved"}, headers=editor).status_code == 200
    assert client.patch(f"{base}/{line['id']}", json={"part_number": "OTHER"}, headers=editor).status_code == 403


def test_needs_retest_filter_applies_before_row_limit(client, db, h, job):
    old = date.today() - timedelta(days=400)
    db.add(ElectricalTest(job_id=job["id"], test_number="T-001", test_type="insulation_resistance", result="fail", test_date=old))
    db.add_all([
        ElectricalTest(job_id=job["id"], test_number=f"T-{i:03d}", test_type="continuity", result="pass", test_date=date.today())
        for i in range(2, 503)
    ])
    db.commit()
    listed = client.get(f"{API}/tests", params={"needs_retest": True}, headers=h).json()
    assert [t["test_number"] for t in listed] == ["T-001"] and listed[0]["needs_retest"] is True
    assert client.get(f"{API}/tests", params={"needs_retest": True, "job_id": 999999}, headers=h).json() == []


def test_inline_file_headers_are_latin1_safe():
    headers = inline_file_headers('Wiring – R1 "final" वायरिंग.pdf')
    for value in headers.values():
        value.encode("latin-1")  # the raw name would raise here
    assert 'filename="Wiring  R1 final .pdf"' in headers["Content-Disposition"]
    assert "filename*=UTF-8''Wiring%20%E2%80%93" in headers["Content-Disposition"]
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert 'filename="download"' in inline_file_headers("वायर")["Content-Disposition"]
