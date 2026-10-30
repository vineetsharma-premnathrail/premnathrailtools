"""PR create page: submit showed an error although the PR had been created."""
import time

from app.tests.p2p_workflow_helpers import master_item, set_pr_workflow
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    BASE, _pr_approvers, _requester, _sqlite_number_series, auth_header,
)

REFS = {"X-Record-Refs": "1"}


def _frontend_body(item, **over):
    # Exactly what frontend/src/app/dashboard/p2p/new/page.tsx sends.
    body = {"save_as_draft": False, "purpose": "department", "project_label": None,
            "account_assignment": None, "priority": "standard",
            "items": [{"store_item_id": item.id, "quantity": 2, "project_inhouse": "Inhouse",
                       "order_project_element_id": None}]}
    body.update(over)
    return body


def test_submit_from_form_returns_signed_ref(client, db):
    req = _requester(db, "sr.req1@premnathrail.com")
    item = master_item(db, "SR bolt M12", item_type="material")
    set_pr_workflow(db, [u.id for u in _pr_approvers(db).values()], req)
    t = time.perf_counter()
    r = client.post(BASE, json=_frontend_body(item), headers={**auth_header(req), **REFS})
    print("elapsed", time.perf_counter() - t)
    assert r.status_code == 200, r.text
    assert isinstance(r.json().get("id_ref"), str), r.json().keys()


def test_count_queries(client, db, monkeypatch):
    async def _noop(pr_id): return None
    monkeypatch.setattr('app.modules.p2p.routes.p2p_requests._send_p2p_pr_approval_emails_background', _noop)
    monkeypatch.setattr('app.core.notify_rules.fire_rule', lambda *a, **k: None, raising=False)
    from sqlalchemy import event
    from sqlalchemy.engine import Engine as e
    req = _requester(db, "sr.req2@premnathrail.com")
    items = [master_item(db, f"SR part {i}", item_type="material") for i in range(5)]
    set_pr_workflow(db, [u.id for u in _pr_approvers(db).values()], req)
    n = {"q": 0}
    def cb(*a, **k): n["q"] += 1
    event.listen(e, "before_cursor_execute", cb)
    body = _frontend_body(items[0])
    body["items"] = [{"store_item_id": i.id, "quantity": 2, "project_inhouse": "Inhouse"} for i in items]
    r = client.post(BASE, json=body, headers={**auth_header(req), **REFS})
    event.remove(e, "before_cursor_execute", cb)
    print("queries", n["q"])
    assert r.status_code == 200, r.text
