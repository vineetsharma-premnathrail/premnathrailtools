"""History lists on the project page and the machine page: Store Issues, Purchases (PR -> PO -> GRN) and Tasks.
Linked rows only, PO values behind the Prices switch, 403 without access, data scope on the parent record."""
from datetime import date, datetime, timedelta, timezone

from app.auth.jwt_handler import create_access_token
from app.modules.erp.models.project import Project
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.task import PmProjectTask, PmTaskSubtask
from app.modules.rnd.models.project_task import RndProjectTask
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem

API = "/api/v1"
TODAY = date.today()
SECTIONS = ("store-issues", "purchases", "task-history")
PM_VIEW = ["projects:all_projects:view", "projects:project_history:view"]


def _user(db, email, role="user", **kw):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _with_role(db, email, perms, scopes=None):
    role = Role(name=f"role {email}", permissions=perms, data_scopes=scopes or {})
    db.add(role)
    db.commit()
    u = _user(db, email)
    u.roles = [role]
    db.commit()
    return u


def _world(db):
    """Project A with a machine, plus an unrelated project B; each has issues, a PR chain and tasks."""
    owner = _user(db, "hist.owner@premnathrail.com", role="admin")
    pa = PmProject(project_code="PEW-901", name="A", project_manager_id=owner.id)
    pb = PmProject(project_code="PEW-902", name="B", project_manager_id=owner.id)
    db.add_all([pa, pb])
    db.commit()
    machine = Project(serial_number="HIST-M1", pm_project_id=pa.id)
    loose = Project(serial_number="HIST-M2")          # no linked project
    other_machine = Project(serial_number="HIST-M3", pm_project_id=pb.id)
    db.add_all([machine, loose, other_machine])
    loc = StoreLocation(name="Main store", code="HIST-LOC")
    item = StoreItem(item_code="H01", item_name="Bearing", uom="Nos")
    db.add_all([loc, item])
    db.commit()
    sr = ServiceRequest(request_number="SR-H1", project_id=machine.id, issue_title="Noise")
    db.add(sr)
    db.commit()

    def issue(no, **kw):
        i = StoreMaterialIssue(issue_number=no, location_id=loc.id, issue_date=TODAY, issue_type="general", **kw)
        i.items = [StoreMaterialIssueItem(item_id=item.id, quantity=3)]
        db.add(i)
        return i

    issue("HI-A", order_project_id=pa.id)
    issue("HI-B", order_project_id=pb.id)
    issue("HI-MACH", erp_project_id=machine.id)
    issue("HI-SR", service_request_id=sr.id)
    issue("HI-LOOSE", erp_project_id=loose.id)
    db.commit()

    def pr(no, project, status="po_approved", line_project=None):
        r = P2PRequest(p2p_number=no, category_code="01", request_date=TODAY, status=status, order_project_id=project)
        r.items = [P2PRequestItem(item_name="Bearing", quantity=2, order_project_id=line_project)]
        db.add(r)
        db.commit()
        return r

    pr_a = pr("PR-A", pa.id)
    pr("PR-B", pb.id)
    pr("PR-A-DRAFT", pa.id, status="draft")
    pr("PR-LINE", None, line_project=pa.id)            # header has no project, a line is charged to A
    po = P2PPurchaseOrder(po_number="PO-A", p2p_request_id=pr_a.id, vendor_name="Vendor A", po_date=TODAY, status="issued", total_value=1234.5)
    db.add(po)
    db.commit()
    db.add(P2PGoodsReceipt(grn_number="GRN-A", purchase_order_id=po.id, received_date=TODAY, status="completed"))

    # A milestone is a pm_project_tasks row; its tasks are pm_task_subtasks (top level).
    ms = PmProjectTask(project_id=pa.id, title="Build", status="todo", due_date=TODAY + timedelta(days=30))
    other_ms = PmProjectTask(project_id=pb.id, title="Other milestone", status="todo")
    db.add_all([ms, other_ms])
    db.commit()
    db.add_all([
        PmTaskSubtask(task_id=ms.id, title="Done early", status="done", completed_at=datetime.now(timezone.utc)),
        PmTaskSubtask(task_id=ms.id, title="Later", status="todo", due_date=TODAY + timedelta(days=9)),
        PmTaskSubtask(task_id=other_ms.id, title="Other project task", status="todo"),
        # An R&D task given on project A from R&D › R&D Tasks.
        RndProjectTask(pm_project_id=pa.id, title="Sooner", assigned_to_id=owner.id, created_by_id=owner.id,
                       original_due_date=TODAY + timedelta(days=2), due_date=TODAY + timedelta(days=2), status="open"),
    ])
    db.commit()
    return owner, pa, pb, machine, loose, other_machine


def _get(client, user, path):
    return client.get(f"{API}{path}", headers=h(user))


# ── Project page ─────────────────────────────────────────────────────────

def test_project_store_issues_only_this_project(client, db):
    owner, pa, pb, *_ = _world(db)
    rows = _get(client, owner, f"/projects/{pa.id}/store-issues").json()
    assert [r["issue_number"] for r in rows] == ["HI-A"]
    r = rows[0]
    assert r["id"] and r["status"] == "issued" and r["store_name"] == "Main store" and r["line_count"] == 1
    assert r["lines"] == [{"item_code": "H01", "item_name": "Bearing", "quantity": 3.0, "uom": "Nos"}]
    assert {"issue_date", "issue_type", "issue_type_label", "issued_to"} <= set(r)


def test_project_purchases_chain_and_other_projects_excluded(client, db):
    owner, pa, *_ = _world(db)
    rows = _get(client, owner, f"/projects/{pa.id}/purchases").json()
    assert sorted(r["pr_number"] for r in rows) == ["PR-A", "PR-LINE"]      # no PR-B, no draft
    a = next(r for r in rows if r["pr_number"] == "PR-A")
    assert a["line_count"] == 1 and a["status_label"] == "PO approved"
    po = a["pos"][0]
    assert po["po_number"] == "PO-A" and po["vendor_name"] == "Vendor A" and po["total_amount"] == 1234.5
    assert [g["grn_number"] for g in po["grns"]] == ["GRN-A"] and po["grns"][0]["id"]


def test_project_task_history_order_and_scope(client, db):
    owner, pa, *_ = _world(db)
    rows = _get(client, owner, f"/projects/{pa.id}/task-history").json()
    assert [r["title"] for r in rows] == ["Sooner", "Later", "Done early"]
    assert [r["kind"] for r in rows] == ["rnd", "pm", "pm"]
    assert rows[1]["milestone_name"] == "Build" and rows[2]["completed_at"]
    assert rows[0]["status_label"] == "Open" and rows[0]["department_name"] == "R&D" and rows[0]["checklist"] == []
    assert {"created_by_name", "start_date", "priority", "progress_percent", "description"} <= set(rows[0])


def test_project_history_unknown_project_is_404_with_reason(client, db):
    owner, *_ = _world(db)
    for s in SECTIONS:
        r = _get(client, owner, f"/projects/999999/{s}")
        assert r.status_code == 404 and "not found" in r.json()["detail"]


def test_project_history_needs_access(client, db):
    owner, pa, *_ = _world(db)
    nobody = _user(db, "hist.nobody@premnathrail.com")
    tab_missing = _with_role(db, "hist.tab@premnathrail.com", ["projects:all_projects:view"])   # no History tab
    for s in SECTIONS:
        assert _get(client, nobody, f"/projects/{pa.id}/{s}").status_code == 403
        assert _get(client, tab_missing, f"/projects/{pa.id}/{s}").status_code == 403


def test_project_history_features_inherit_tab_view(client, db):
    owner, pa, *_ = _world(db)
    viewer = _with_role(db, "hist.viewer@premnathrail.com", PM_VIEW)
    for s in SECTIONS:
        assert _get(client, viewer, f"/projects/{pa.id}/{s}").status_code == 200, s


def test_project_history_respects_project_data_scope(client, db):
    owner, pa, *_ = _world(db)
    mine = PmProject(project_code="PEW-903", name="Mine")
    db.add(mine)
    db.commit()
    viewer = _with_role(db, "hist.scoped@premnathrail.com", PM_VIEW, {"projects": "assigned"})
    mine.project_manager_id = viewer.id
    db.commit()
    assert _get(client, viewer, f"/projects/{mine.id}/purchases").status_code == 200
    r = _get(client, viewer, f"/projects/{pa.id}/purchases")
    assert r.status_code == 403 and "outside your data access" in r.json()["detail"]


def test_po_values_hidden_without_prices_permission(client, db):
    owner, pa, *_ = _world(db)
    no_prices = _with_role(db, "hist.noprice@premnathrail.com", PM_VIEW)
    rows = _get(client, no_prices, f"/projects/{pa.id}/purchases").json()
    po = next(r for r in rows if r["pr_number"] == "PR-A")["pos"][0]
    assert po["po_number"] == "PO-A" and po["total_amount"] is None
    desk = _with_role(db, "hist.desk@premnathrail.com", PM_VIEW + ["p2p:purchase_orders:view"])
    rows = _get(client, desk, f"/projects/{pa.id}/purchases").json()
    assert next(r for r in rows if r["pr_number"] == "PR-A")["pos"][0]["total_amount"] == 1234.5   # Prices inherits PO view


# ── Machine page ─────────────────────────────────────────────────────────

def test_machine_store_issues_machine_sr_and_project(client, db):
    owner, pa, pb, machine, loose, other = _world(db)
    rows = _get(client, owner, f"/erp/projects/{machine.id}/store-issues").json()
    assert sorted(r["issue_number"] for r in rows) == ["HI-A", "HI-MACH", "HI-SR"]
    assert [r["issue_number"] for r in _get(client, owner, f"/erp/projects/{loose.id}/store-issues").json()] == ["HI-LOOSE"]


def test_machine_purchases_and_tasks_follow_linked_project(client, db):
    owner, pa, pb, machine, loose, other = _world(db)
    prs = _get(client, owner, f"/erp/projects/{machine.id}/purchases").json()
    assert sorted(r["pr_number"] for r in prs) == ["PR-A", "PR-LINE"]
    assert [t["title"] for t in _get(client, owner, f"/erp/projects/{machine.id}/task-history").json()] == ["Sooner", "Later", "Done early"]
    assert [r["pr_number"] for r in _get(client, owner, f"/erp/projects/{other.id}/purchases").json()] == ["PR-B"]
    for s in ("purchases", "task-history"):      # a machine with no project: empty lists, not an error
        r = _get(client, owner, f"/erp/projects/{loose.id}/{s}")
        assert r.status_code == 200 and r.json() == []


def test_machine_history_unknown_machine_404(client, db):
    owner, *_ = _world(db)
    r = _get(client, owner, "/erp/projects/999999/purchases")
    assert r.status_code == 404 and "No machine" in r.json()["detail"]


def test_machine_history_needs_access(client, db):
    owner, pa, pb, machine, *_ = _world(db)
    nobody = _user(db, "hist.mnobody@premnathrail.com")
    pm_only = _with_role(db, "hist.pmonly@premnathrail.com", ["projects:project_history:view"])  # project History alone is not the machine register
    tab_only = _with_role(db, "hist.mtab@premnathrail.com", ["projects:all_projects:view"])
    for s in SECTIONS:
        assert _get(client, nobody, f"/erp/projects/{machine.id}/{s}").status_code == 403
        assert _get(client, pm_only, f"/erp/projects/{machine.id}/{s}").status_code == 403
        assert _get(client, tab_only, f"/erp/projects/{machine.id}/{s}").status_code == 200   # features inherit the tab view


def test_machine_po_values_hidden_without_prices(client, db):
    owner, pa, pb, machine, *_ = _world(db)
    viewer = _with_role(db, "hist.mprice@premnathrail.com", ["projects:all_projects:view"])
    rows = _get(client, viewer, f"/erp/projects/{machine.id}/purchases").json()
    assert next(r for r in rows if r["pr_number"] == "PR-A")["pos"][0]["total_amount"] is None
    rows = _get(client, owner, f"/erp/projects/{machine.id}/purchases").json()
    assert next(r for r in rows if r["pr_number"] == "PR-A")["pos"][0]["total_amount"] == 1234.5
