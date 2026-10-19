"""R&D project origin + source: required fields per origin, the customer
requirement link, the source picker and the list filter."""
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


def test_internal_origins_need_note_and_proof(client, db):
    h = auth_header(make_user(db, "o2@premnathrail.com"))
    for origin in ("new_development", "process_research"):
        r = _post(client, h, origin=origin)
        assert r.status_code == 400 and "Who proposed it and why" in r.json()["detail"]
        r = _post(client, h, origin=origin, origin_note="MD asked for it")
        assert r.status_code == 400 and "proof document" in r.json()["detail"]
        r = _post(client, h, origin=origin, origin_note="MD asked for it", attachment_count=1)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["origin"] == origin and body["origin_note"] == "MD asked for it"
    assert body["project_type"] == "technology_research" and body["origin_label"] == "Process / technology research"


def test_improvement_rules(client, db):
    h = auth_header(make_user(db, "o3@premnathrail.com"))
    prod = _product(db)
    r = _post(client, h, origin="product_improvement")
    assert r.status_code == 400 and "existing product being improved" in r.json()["detail"]
    r = _post(client, h, origin="product_improvement", product_id=prod.id)
    assert r.status_code == 400 and "reason for the improvement" in r.json()["detail"]
    for reason, what in (("customer_complaint", "customer complaint"), ("ncr", "NCR"), ("service_report", "service request")):
        r = _post(client, h, origin="product_improvement", product_id=prod.id, improvement_reason=reason)
        assert r.status_code == 400 and f"Pick the {what}" in r.json()["detail"], r.text
    r = _post(client, h, origin="product_improvement", product_id=prod.id, improvement_reason="ncr", source_kind="ncr", source_id=99999)
    assert r.status_code == 404 and "no longer exists" in r.json()["detail"]
    r = _post(client, h, origin="product_improvement", product_id=prod.id, improvement_reason="cost_reduction")
    assert r.status_code == 400 and "Who proposed it and why" in r.json()["detail"]
    r = _post(client, h, origin="product_improvement", product_id=prod.id, improvement_reason="cost_reduction", origin_note="Casting too costly")
    assert r.status_code == 400 and "proof document" in r.json()["detail"]
    r = _post(client, h, origin="product_improvement", product_id=prod.id, improvement_reason="cost_reduction",
              origin_note="Casting too costly", attachment_count=1)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["project_type"] == "product_improvement" and body["product_name"] == "Battery Shunter (PRD-T1)"
    assert body["improvement_reason_label"] == "Cost reduction" and body["source_kind"] is None


def test_customer_requirement_links_requirement(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    r = client.post(BASE, json={"title": "Wagon", "objective": "Build", "origin": "customer_requirement"}, headers=auth(head))
    assert r.status_code == 400 and "customer inquiry or tender" in r.json()["detail"]

    # Engineer without access to the requirement can't pick it.
    r = client.post(BASE, json={"title": "Wagon", "objective": "Build", "origin": "customer_requirement",
                                "source_kind": "inquiry", "source_id": inq.id}, headers=auth(eng))
    assert r.status_code == 403 and "R&D head" in r.json()["detail"]
    assert client.get(f"{BASE}/source-options", params={"kind": "inquiry"}, headers=auth(eng)).json() == []

    options = client.get(f"{BASE}/source-options", params={"kind": "inquiry"}, headers=auth(head)).json()
    assert [o["id"] for o in options] == [inq.id]

    r = client.post(BASE, json={"title": "Wagon", "objective": "Build", "origin": "customer_requirement",
                                "source_kind": "inquiry", "source_id": inq.id}, headers=auth(head))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source_ref"] == options[0]["label"] and body["source_path"] == "/dashboard/rnd/requirements/inquiry"
    assert body["project_type"] == "new_product" and body["source_exists"] is True
    assert [x["record_id"] for x in body["linked_requirements"]] == [inq.id]
    links = db.query(RndRequirementProjectLink).filter(RndRequirementProjectLink.project_id == body["id"]).all()
    assert len(links) == 1

    # Re-saving the same source doesn't add a duplicate link.
    r = client.patch(f"{BASE}/{body['id']}", json={"source_kind": "inquiry", "source_id": inq.id}, headers=auth(head))
    assert r.status_code == 200, r.text
    assert db.query(RndRequirementProjectLink).filter(RndRequirementProjectLink.project_id == body["id"]).count() == 1


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
    r = client.patch(f"{BASE}/{old.id}", json={"origin": "process_research"}, headers=h)
    assert r.status_code == 400 and "Who proposed it and why" in r.json()["detail"]
    # No attachment needed when recording the origin of an existing project.
    r = client.patch(f"{BASE}/{old.id}", json={"origin": "process_research", "origin_note": "Old idea"}, headers=h)
    assert r.status_code == 200 and r.json()["project_type"] == "technology_research"


def test_list_origin_filter_and_product_options(client, db):
    from app.modules.rnd.models.project import RndProject
    user = make_user(db, "o6@premnathrail.com")
    h = auth_header(user)
    _product(db)
    a = _post(client, h, origin="new_development", origin_note="Idea", attachment_count=1).json()
    b = _post(client, h, origin="process_research", origin_note="Idea", attachment_count=1).json()
    legacy = RndProject(project_number="RND-2025-0002", title="Legacy", objective="x", lead_ids=[user.id], lead_id=user.id,
                        team_member_ids=[], created_by_id=user.id)
    db.add(legacy)
    db.commit()
    ids = lambda params: [p["id"] for p in client.get(BASE, params=params, headers=h).json()]  # noqa: E731
    assert ids({"origin": "new_development"}) == [a["id"]]
    assert ids({"origin": "process_research"}) == [b["id"]]
    assert ids({"origin": "not_recorded"}) == [legacy.id]
    opts = client.get(f"{BASE}/source-options", params={"kind": "product", "q": "shunter"}, headers=h).json()
    assert [o["label"] for o in opts] == ["Battery Shunter (PRD-T1)"]
    r = client.get(f"{BASE}/source-options", params={"kind": "nope"}, headers=h)
    assert r.status_code == 400 and "Unknown record type" in r.json()["detail"]
    # Complaint / NCR / service request pickers answer (empty here) without errors.
    for kind in ("quality_complaint", "ncr", "service_request", "tender"):
        assert client.get(f"{BASE}/source-options", params={"kind": kind, "q": "x"}, headers=h).status_code == 200
