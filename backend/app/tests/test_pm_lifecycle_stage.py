"""PM lifecycle stage: forward / backward moves, mirror to machines, auto 'dispatched',
machine stage for past projects, and the Service gate (non-serviceable machines are refused)."""
from datetime import date, timedelta

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.erp.models.project import Project as Machine
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.projects import lifecycle
from app.modules.projects.models.project import PmProject

API = "/api/v1"
TODAY = date.today()


def make_user(db, email, apps=("projects",), **flags):
    flags.setdefault("is_active", True)
    flags.setdefault("role", "user")
    user = User(email=email, name=email.split("@")[0], assigned_apps=list(apps), **flags)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def make_project(db, manager, code="PEW-901", stage="planned"):
    p = PmProject(project_code=code, name="Test machine", client_name="RVNL", customer_po_ref="PO", sales_order_ref="SO",
                  start_date=TODAY, target_handover_date=TODAY + timedelta(days=30), status="active",
                  project_manager_id=manager.id, created_by_id=manager.id, lifecycle_stage=stage)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@pytest.fixture
def partner(db):
    return make_user(db, "lc.partner@x.com", is_partner=True)


def test_constants():
    assert lifecycle.LIFECYCLE_STAGES[0] == "planned" and lifecycle.LIFECYCLE_STAGES[-1] == "closed"
    assert lifecycle.is_serviceable("dispatched") and not lifecycle.is_serviceable("testing")
    assert lifecycle.stage_index("design") == 1 and lifecycle.stage_index("nope") == -1


def test_meta_lists_stages(client, partner):
    r = client.get(f"{API}/projects/meta", headers=auth(partner))
    keys = [s["key"] for s in r.json()["lifecycle_stages"]]
    assert keys == list(lifecycle.LIFECYCLE_STAGES)


def test_forward_move_by_partner_and_response_fields(client, db, partner):
    p = make_project(db, partner)
    r = client.post(f"{API}/projects/{p.id}/stage", headers=auth(partner), json={"stage": "assembly"})
    assert r.status_code == 200, r.text
    assert r.json()["lifecycle_stage"] == "assembly" and r.json()["lifecycle_stage_label"] == "Assembly"
    log = db.query(AuditLog).filter(AuditLog.entity_type == "pm_project", AuditLog.entity_id == p.id, AuditLog.action == "stage_changed").one()
    assert "Planned" in log.summary and "Assembly" in log.summary
    # list filter
    assert [x["id"] for x in client.get(f"{API}/projects?stage=assembly", headers=auth(partner)).json()] == [p.id]
    assert client.get(f"{API}/projects?stage=design", headers=auth(partner)).json() == []


def test_unknown_stage_is_422_with_options(client, db, partner):
    p = make_project(db, partner)
    r = client.post(f"{API}/projects/{p.id}/stage", headers=auth(partner), json={"stage": "flying"})
    assert r.status_code == 422 and "Planned" in r.json()["detail"]


def test_backward_needs_admin_or_partner_and_reason(client, db, partner):
    pm = make_user(db, "lc.pm@x.com")
    p = make_project(db, pm, stage="testing")
    # the project's own manager may not go back
    r = client.post(f"{API}/projects/{p.id}/stage", headers=auth(pm), json={"stage": "assembly", "reason": "rework"})
    assert r.status_code == 403 and "admin or a Partner" in r.json()["detail"]
    # partner without reason -> 422
    r = client.post(f"{API}/projects/{p.id}/stage", headers=auth(partner), json={"stage": "assembly"})
    assert r.status_code == 422 and "reason" in r.json()["detail"].lower()
    r = client.post(f"{API}/projects/{p.id}/stage", headers=auth(partner), json={"stage": "assembly", "reason": "Test failed, rework"})
    assert r.status_code == 200 and r.json()["lifecycle_stage"] == "assembly"
    # but the manager can go forward
    r = client.post(f"{API}/projects/{p.id}/stage", headers=auth(pm), json={"stage": "ready_for_dispatch"})
    assert r.status_code == 200


def test_stranger_is_denied(client, db, partner):
    other = make_user(db, "lc.other@x.com")
    p = make_project(db, partner)
    r = client.post(f"{API}/projects/{p.id}/stage", headers=auth(other), json={"stage": "design"})
    assert r.status_code in (403, 404)
    db.expire_all()
    assert db.get(PmProject, p.id).lifecycle_stage == "planned"
    noapp = make_user(db, "lc.noapp@x.com", apps=())
    assert client.post(f"{API}/projects/{p.id}/stage", headers=auth(noapp), json={"stage": "design"}).status_code == 403


def test_stage_mirrors_to_linked_machine(client, db, partner):
    p = make_project(db, partner)
    m = Machine(serial_number="PEW-901", pm_project_id=p.id, lifecycle_stage="planned")
    other = Machine(serial_number="PEW-902", lifecycle_stage="planned")
    db.add_all([m, other])
    db.commit()
    assert client.post(f"{API}/projects/{p.id}/stage", headers=auth(partner), json={"stage": "dispatched"}).status_code == 200
    db.expire_all()
    assert db.get(Machine, m.id).lifecycle_stage == "dispatched"
    assert db.get(Machine, other.id).lifecycle_stage == "planned"


def test_on_units_changed_auto_dispatches_never_backwards(db, partner):
    from app.modules.projects.models.element import PmProjectElement
    from app.modules.sales.models.order import SalesOrder, SalesOrderLine  # noqa: F401
    p = make_project(db, partner, stage="testing")
    m = Machine(serial_number="PEW-901", pm_project_id=p.id, lifecycle_stage="testing")
    db.add(m)
    db.commit()
    # no units yet -> nothing happens
    assert lifecycle.on_units_changed(db, p) is False

    def unit(no, status):
        return PmProjectElement.__table__.insert().values(
            project_id=p.id, element_no=no, kind="lot", label=no, sales_order_line_id=1, quantity=1, status=status)

    from sqlalchemy import text
    db.execute(text("PRAGMA foreign_keys=OFF"))
    db.execute(unit("PEW-901/01", "dispatched"))
    db.execute(unit("PEW-901/02", "in_progress"))
    db.execute(unit("PEW-901/03", "cancelled"))
    db.commit()
    assert lifecycle.on_units_changed(db, p) is False  # one live unit still in progress
    db.execute(PmProjectElement.__table__.update().where(PmProjectElement.element_no == "PEW-901/02").values(status="delivered"))
    db.commit()
    assert lifecycle.on_units_changed(db, p) is True
    db.commit()
    db.expire_all()
    assert db.get(PmProject, p.id).lifecycle_stage == "dispatched"
    assert db.get(Machine, m.id).lifecycle_stage == "dispatched"
    # later stage is never pulled back
    p2 = db.get(PmProject, p.id)
    p2.lifecycle_stage = "handover"
    db.commit()
    assert lifecycle.on_units_changed(db, p2) is False and p2.lifecycle_stage == "handover"


def test_past_machine_stage_patch(client, db):
    partner = make_user(db, "lc.admin3@x.com", apps=("projects", "erp"), role="admin")
    m = Machine(serial_number="PEW-50", lifecycle_stage="closed")
    db.add(m)
    db.commit()
    # Back from Closed needs a reason.
    r = client.patch(f"{API}/erp/projects/{m.id}/lifecycle-stage", headers=auth(partner), json={"stage": "manufacturing"})
    assert r.status_code == 422 and "reason" in r.json()["detail"], r.text
    r = client.patch(f"{API}/erp/projects/{m.id}/lifecycle-stage", headers=auth(partner),
                     json={"stage": "manufacturing", "reason": "Still in the shop"})
    assert r.status_code == 200, r.text
    assert r.json()["lifecycle_stage"] == "manufacturing" and r.json()["serviceable"] is False
    assert r.json()["lifecycle_stage_label"] == "Manufacturing"
    assert client.patch(f"{API}/erp/projects/{m.id}/lifecycle-stage", headers=auth(partner), json={"stage": "bogus"}).status_code == 422


def test_past_machine_stage_patch_refused_for_linked_machine(client, db):
    partner = make_user(db, "lc.admin4@x.com", apps=("projects", "erp"), role="admin")
    p = make_project(db, partner)
    m = Machine(serial_number="PEW-901", pm_project_id=p.id)
    db.add(m)
    db.commit()
    r = client.patch(f"{API}/erp/projects/{m.id}/lifecycle-stage", headers=auth(partner), json={"stage": "closed"})
    assert r.status_code == 409 and "PEW-901" in r.json()["detail"]


def test_past_machine_stage_patch_needs_permission(client, db):
    nobody = make_user(db, "lc.nobody@x.com", apps=("erp",))
    m = Machine(serial_number="PEW-51", lifecycle_stage="closed")
    db.add(m)
    db.commit()
    r = client.patch(f"{API}/erp/projects/{m.id}/lifecycle-stage", headers=auth(nobody), json={"stage": "design"})
    assert r.status_code == 403
    db.expire_all()
    assert db.get(Machine, m.id).lifecycle_stage == "closed"


def test_service_request_refused_on_non_serviceable_machine(client, db):
    admin = make_user(db, "lc.admin@x.com", apps=("erp",), role="admin")
    early = Machine(serial_number="PEW-77", lifecycle_stage="manufacturing")
    ready = Machine(serial_number="PEW-78", lifecycle_stage="dispatched")
    db.add_all([early, ready])
    db.commit()
    body = {"issue_title": "Noise", "service_type": "repair_breakdown"}
    r = client.post(f"{API}/erp/service-requests", headers=auth(admin), json={**body, "project_id": early.id})
    assert r.status_code == 422
    assert "PEW-77" in r.json()["detail"] and "Manufacturing" in r.json()["detail"] and "Dispatched" in r.json()["detail"]
    r = client.post(f"{API}/erp/service-requests", headers=auth(admin), json={**body, "project_id": ready.id})
    assert r.status_code == 201, r.text


def test_machine_list_serviceable_only_filter(client, db):
    admin = make_user(db, "lc.admin2@x.com", apps=("erp",), role="admin")
    db.add_all([Machine(serial_number="PEW-60", lifecycle_stage="design"), Machine(serial_number="PEW-61", lifecycle_stage="closed")])
    db.commit()
    rows = client.get(f"{API}/erp/projects?serviceable_only=true", headers=auth(admin))
    assert rows.status_code == 200, rows.text
    assert [r["serial_number"] for r in rows.json()] == ["PEW-61"] and rows.json()[0]["serviceable"] is True
    assert len(client.get(f"{API}/erp/projects", headers=auth(admin)).json()) == 2


def test_pr_project_picker_lists_only_machines_before_dispatch(client, db):
    """Owner 2026-10-27: a PR's Project picker offers only machines still being built."""
    req = make_user(db, "lc.pr.picker@x.com", apps=("p2p",), role="admin")
    db.add_all([Machine(serial_number="PEW-901", lifecycle_stage="manufacturing"),
                Machine(serial_number="PEW-902", lifecycle_stage="dispatched"),
                Machine(serial_number="PEW-903", lifecycle_stage="closed")])
    db.commit()
    r = client.get(f"{API}/p2p/requests/projects", headers=auth(req))
    assert r.status_code == 200, r.text
    labels = [x["label"] for x in r.json()]
    assert "PEW-901" in labels and "PEW-902" not in labels and "PEW-903" not in labels
