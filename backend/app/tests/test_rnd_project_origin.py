"""R&D project origin (Existing Projects / New Project): required fields per origin, the optional
customer requirement link, the source picker and the list filter."""
from app.modules.rnd.models.requirement_work import RndRequirementProjectLink
from app.tests.test_cov_crm_quotations_rnd import auth, tor_env  # noqa: F401 — fixture
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture
from app.tests.test_rnd_requirement_work import _setup
from app.tests.test_rnd_projects import auth_header, make_user

BASE = "/api/v1/rnd/projects"


def _post(client, h, **kw):
    return client.post(BASE, json={"title": "Bogie", "objective": "Lighter frame", **kw}, headers=h)


def _product(db):
    from app.modules.products.models.product import FinishedProduct
    p = FinishedProduct(code="PRD-T1", name="Battery Shunter", product_type="vehicle")
    db.add(p)
    db.commit()
    return p


def test_origin_required(client, db):
    h = auth_header(make_user(db, "o1@premnathrail.com"))
    r = _post(client, h)
    assert r.status_code == 400 and "origin is required" in r.json()["detail"]
    r = _post(client, h, origin="whatever")
    assert r.status_code == 400 and "Unknown project origin" in r.json()["detail"]
    # The four retired origins are not accepted any more (AC-41: exactly two options).
    for old in ("customer_requirement", "product_improvement", "new_development", "process_research"):
        r = _post(client, h, origin=old)
        assert r.status_code == 400 and "Existing Projects, New Project" in r.json()["detail"], old


def test_new_project_needs_note_and_proof(client, db):
    h = auth_header(make_user(db, "o2@premnathrail.com"))
    r = _post(client, h, origin="new_project")
    assert r.status_code == 400 and "Who proposed it and why" in r.json()["detail"]
    r = _post(client, h, origin="new_project", origin_note="MD asked for it")
    assert r.status_code == 400 and "proof document" in r.json()["detail"]
    r = _post(client, h, origin="new_project", origin_note="MD asked for it", attachment_count=1)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["origin"] == "new_project" and body["origin_note"] == "MD asked for it"
    assert body["project_type"] == "new_product" and body["origin_label"] == "New Project" and body["priority"] == "standard"


def _machine(db):
    from app.modules.erp.models.project import Project as Machine
    m = Machine(serial_number="PEW-31", model_name="Battery Shunter", client_company="CR")
    db.add(m)
    db.commit()
    return m


def test_improvement_rules(client, db):
    """Owner 2026-10-27: an improvement names the existing project (machine) and a reason — nothing more."""
    h = auth_header(make_user(db, "o3@premnathrail.com"))
    m = _machine(db)
    r = _post(client, h, origin="existing_projects")
    assert r.status_code == 400 and r.json()["detail"] == "Pick the existing project being improved (PEW number)."
    r = _post(client, h, origin="existing_projects", machine_id=m.id)
    assert r.status_code == 400 and "reason for the improvement" in r.json()["detail"]
    r = _post(client, h, origin="existing_projects", machine_id=99999, improvement_reason="ncr")
    assert r.status_code == 400 and "no longer exists" in r.json()["detail"]
    for reason in ("customer_complaint", "ncr", "service_report", "cost_reduction", "production_difficulty"):
        r = _post(client, h, origin="existing_projects", machine_id=m.id, improvement_reason=reason)
        assert r.status_code == 200, (reason, r.text)
    body = r.json()
    assert body["project_type"] == "product_improvement" and body["machine_label"] == "PEW-31 — Battery Shunter — CR"
    assert body["improvement_reason_label"] == "Production difficulty" and body["source_kind"] is None
    opts = client.get(f"{BASE}/source-options", params={"kind": "machine", "q": "pew-31"}, headers=h).json()
    assert [o["id"] for o in opts] == [m.id]


def test_new_project_can_link_a_customer_requirement(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    outsider = make_user(db, "o4.out@premnathrail.com", assigned_apps=["design"])
    body = {"title": "Wagon", "objective": "Build", "origin": "new_project", "origin_note": "Customer asked", "attachment_count": 1}
    # The requirement is optional.
    assert client.post(BASE, json=body, headers=auth(head)).status_code == 200
    r = client.post(BASE, json={**body, "source_kind": "inquiry"}, headers=auth(head))
    assert r.status_code == 400 and "Pick the customer requirement" in r.json()["detail"]

    # Someone with no access to the requirement can't pick it (and doesn't even see it in the list).
    assert client.get(f"{BASE}/source-options", params={"kind": "inquiry"}, headers=auth(outsider)).status_code in (200, 403)
    r = client.post(BASE, json={**body, "source_kind": "inquiry", "source_id": inq.id}, headers=auth(outsider))
    assert r.status_code in (403, 400)

    options = client.get(f"{BASE}/source-options", params={"kind": "inquiry"}, headers=auth(head)).json()
    assert [o["id"] for o in options] == [inq.id] and options[0]["label"].startswith("RDR-")   # listed by R&D ID
    r = client.post(BASE, json={**body, "source_kind": "inquiry", "source_id": inq.id}, headers=auth(head))
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["source_ref"] == options[0]["label"] and got["source_path"] == "/dashboard/rnd/requirements/inquiry"
    assert got["project_type"] == "new_product" and got["source_exists"] is True
    assert [x["record_id"] for x in got["linked_requirements"]] == [inq.id]
    assert db.query(RndRequirementProjectLink).filter(RndRequirementProjectLink.project_id == got["id"]).count() == 1

    # Re-saving the same source doesn't add a duplicate link.
    r = client.patch(f"{BASE}/{got['id']}", json={"source_kind": "inquiry", "source_id": inq.id}, headers=auth(head))
    assert r.status_code == 200, r.text
    assert db.query(RndRequirementProjectLink).filter(RndRequirementProjectLink.project_id == got["id"]).count() == 1


def test_update_validates_and_old_rows_can_be_set(client, db):
    from app.modules.rnd.models.project import RndProject
    user = make_user(db, "o5@premnathrail.com")
    h = auth_header(user)
    old = RndProject(project_number="RND-2025-0001", title="Legacy", objective="x", lead_ids=[user.id], lead_id=user.id,
                     team_member_ids=[], created_by_id=user.id)
    db.add(old)
    db.commit()
    assert client.get(f"{BASE}/{old.id}", headers=h).json()["origin"] is None
    # Unrelated edits on a legacy row don't require an origin.
    assert client.patch(f"{BASE}/{old.id}", json={"title": "Legacy 2"}, headers=h).status_code == 200
    r = client.patch(f"{BASE}/{old.id}", json={"origin": "new_project"}, headers=h)
    assert r.status_code == 400 and "Who proposed it and why" in r.json()["detail"]
    # No attachment needed when recording the origin of an existing project.
    r = client.patch(f"{BASE}/{old.id}", json={"origin": "new_project", "origin_note": "Old idea"}, headers=h)
    assert r.status_code == 200 and r.json()["project_type"] == "new_product"


def test_list_origin_filter_and_product_options(client, db):
    from app.modules.rnd.models.project import RndProject
    user = make_user(db, "o6@premnathrail.com")
    h = auth_header(user)
    _product(db)
    m = _machine(db)
    a = _post(client, h, origin="new_project", origin_note="Idea", attachment_count=1).json()
    b = _post(client, h, origin="existing_projects", machine_id=m.id, improvement_reason="ncr").json()
    legacy = RndProject(project_number="RND-2025-0002", title="Legacy", objective="x", lead_ids=[user.id], lead_id=user.id,
                        team_member_ids=[], created_by_id=user.id)
    db.add(legacy)
    db.commit()
    ids = lambda params: [p["id"] for p in client.get(BASE, params=params, headers=h).json()]  # noqa: E731
    assert ids({"origin": "new_project"}) == [a["id"]]
    assert ids({"origin": "existing_projects"}) == [b["id"]]
    assert ids({"origin": "not_recorded"}) == [legacy.id]
    opts = client.get(f"{BASE}/source-options", params={"kind": "product", "q": "shunter"}, headers=h).json()
    assert [o["label"] for o in opts] == ["Battery Shunter (PRD-T1)"]
    r = client.get(f"{BASE}/source-options", params={"kind": "nope"}, headers=h)
    assert r.status_code == 400 and "Unknown record type" in r.json()["detail"]
    # Complaint / NCR / service request pickers answer (empty here) without errors.
    for kind in ("quality_complaint", "ncr", "service_request", "tender"):
        assert client.get(f"{BASE}/source-options", params={"kind": kind, "q": "x"}, headers=h).status_code == 200
