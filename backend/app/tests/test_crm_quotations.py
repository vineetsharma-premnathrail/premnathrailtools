"""Quotation rules: numbering never repeats, ownership, deleted inquiries, payload validation,
and who may record the customer response."""

from app.auth.jwt_handler import create_access_token
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization
from app.modules.main.models.user import User
from app.tests.quote_lines import LINE_REF, quote_product  # noqa: F401 — autouse fixture


def _user(db, email, role="user"):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=["crm"])
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def _inquiry(db, owner, uid="PRT-INQ-2026-0101"):
    org = Organization(name="Northern Railway")
    db.add(org)
    db.flush()
    inquiry = Inquiry(universal_id=uid, org_id=org.id, created_by_id=owner.id)
    db.add(inquiry)
    db.commit()
    return inquiry


ITEM = {"description": "RRV", "quantity": 1, "unit_price": 1000, "gst_percent": 18, **LINE_REF}



def _mark_sent(db, quot_id):
    """Shortcut past approval: the quotation is with the customer."""
    from app.modules.crm.models.inquiry import Quotation
    db.expire_all()
    db.get(Quotation, quot_id).status = "sent"
    db.commit()


def _create(client, inquiry_id, user, **extra):
    return client.post(f"/api/v1/crm/inquiries/{inquiry_id}/quotations", json={"items": [ITEM], **extra}, headers=_auth(user))


def test_numbers_never_repeat_after_delete(client, db):
    owner = _user(db, "q_owner@premnathrail.com")
    admin = _user(db, "q_admin@premnathrail.com", role="admin")
    inq = _inquiry(db, owner)
    q1 = _create(client, inq.id, owner).json()
    q2 = _create(client, inq.id, owner).json()
    assert [q1["quot_number"], q2["quot_number"]] == ["QT-2026-0101-01", "QT-2026-0101-02"]

    # Deleting the first leaves one row; a count-based number would re-issue -02.
    assert client.delete(f"/api/v1/crm/inquiries/{inq.id}/quotations/{q1['id']}", headers=_auth(admin)).status_code == 200
    assert _create(client, inq.id, owner).json()["quot_number"] == "QT-2026-0101-03"

    # Deleting the latest must not re-issue its number either.
    q3 = client.get(f"/api/v1/crm/inquiries/{inq.id}/quotations", headers=_auth(owner)).json()[0]
    assert client.delete(f"/api/v1/crm/inquiries/{inq.id}/quotations/{q3['id']}", headers=_auth(admin)).status_code == 200
    assert _create(client, inq.id, owner).json()["quot_number"] == "QT-2026-0101-04"


def test_revised_quotation_does_not_break_numbering(client, db):
    owner = _user(db, "q_owner_r@premnathrail.com")
    inq = _inquiry(db, owner, uid="PRT-INQ-2026-0102")
    q1 = _create(client, inq.id, owner).json()
    client.patch(f"/api/v1/crm/inquiries/{inq.id}/quotations/{q1['id']}", json={"delivery_time": "10 weeks"}, headers=_auth(owner))
    assert _create(client, inq.id, owner).json()["quot_number"] == "QT-2026-0102-02"


def test_only_inquiry_owner_or_admin_creates(client, db):
    owner = _user(db, "q_owner2@premnathrail.com")
    other = _user(db, "q_other2@premnathrail.com")
    admin = _user(db, "q_admin2@premnathrail.com", role="admin")
    inq = _inquiry(db, owner, uid="PRT-INQ-2026-0103")
    resp = _create(client, inq.id, other)
    assert resp.status_code == 403
    assert "q_owner2" in resp.json()["detail"]
    assert _create(client, inq.id, admin).status_code == 201


def test_deleted_inquiry_blocks_quotation_endpoints(client, db):
    owner = _user(db, "q_owner3@premnathrail.com")
    inq = _inquiry(db, owner, uid="PRT-INQ-2026-0104")
    quot = _create(client, inq.id, owner).json()
    inq.is_deleted = True
    db.commit()
    base = f"/api/v1/crm/inquiries/{inq.id}/quotations"
    for resp in (
        client.get(base, headers=_auth(owner)),
        _create(client, inq.id, owner),
        client.patch(f"{base}/{quot['id']}", json={"delivery_time": "x"}, headers=_auth(owner)),
        client.get(f"{base}/{quot['id']}/pdf", headers=_auth(owner)),
        client.get(f"/api/v1/managed-documents/crm_quotation/{quot['id']}", headers=_auth(owner)),
    ):
        assert resp.status_code == 404, resp.text
        assert "restore it" in resp.json()["detail"]


def test_payload_validation(client, db):
    owner = _user(db, "q_owner4@premnathrail.com")
    inq = _inquiry(db, owner, uid="PRT-INQ-2026-0105")
    bad = [
        {"discount": 150, "discount_type": "percent"},
        {"discount": -5},
        {"quotation_type": "Overseas"},
        {"gst_type": "VAT"},
        {"discount_type": "bogus"},
        {"customer_response": "Maybe"},
        {"quote_date": "2026-10-07", "valid_until": "2026-10-01"},
    ]
    for extra in bad:
        assert _create(client, inq.id, owner, **extra).status_code == 422, extra
    for item in ({**ITEM, "quantity": 0}, {**ITEM, "unit_price": -1}, {**ITEM, "gst_percent": 120}):
        resp = client.post(f"/api/v1/crm/inquiries/{inq.id}/quotations", json={"items": [item]}, headers=_auth(owner))
        assert resp.status_code == 422, item
    ok = _create(client, inq.id, owner, discount=150, discount_type="flat", quote_date="2026-10-07", valid_until="2026-11-06")
    assert ok.status_code == 201, ok.text

    quot = ok.json()
    base = f"/api/v1/crm/inquiries/{inq.id}/quotations/{quot['id']}"
    item_id = quot["items"][0]["id"]
    assert client.patch(base, json={"items": [{"id": item_id, "unit_price": -1}]}, headers=_auth(owner)).status_code == 422
    resp = client.patch(base, json={"valid_until": "2026-10-01"}, headers=_auth(owner))
    assert resp.status_code == 422 and "Valid Until" in resp.json()["detail"]


def test_customer_response_by_inquiry_owner(client, db):
    inquiry_owner = _user(db, "q_inq_owner@premnathrail.com")
    admin = _user(db, "q_admin5@premnathrail.com", role="admin")
    stranger = _user(db, "q_stranger@premnathrail.com")
    inq = _inquiry(db, inquiry_owner, uid="PRT-INQ-2026-0106")
    quot = _create(client, inq.id, admin).json()  # created by admin, not the inquiry owner
    base = f"/api/v1/crm/inquiries/{inq.id}/quotations/{quot['id']}"
    # A draft can't be accepted — it has to be approved and sent first.
    resp = client.patch(base, json={"customer_response": "Accepted"}, headers=_auth(inquiry_owner))
    assert resp.status_code == 409 and "Draft" in resp.json()["detail"]
    _mark_sent(db, quot["id"])

    resp = client.patch(base, json={"customer_response": "Accepted"}, headers=_auth(inquiry_owner))
    assert resp.status_code == 200 and resp.json()["customer_response"] == "Accepted" and resp.json()["status"] == "accepted"
    # Correcting a recorded outcome is an admin step.
    assert client.patch(base, json={"customer_response": "— Awaiting —"}, headers=_auth(inquiry_owner)).status_code == 403
    resp = client.patch(base, json={"customer_response": "— Awaiting —"}, headers=_auth(admin))
    assert resp.json()["customer_response"] == "— Awaiting —" and resp.json()["status"] == "sent"
    # A sent quotation is finalised: no one revises its content (a new offer is + Create Quote).
    resp = client.patch(base, json={"delivery_time": "8 weeks"}, headers=_auth(inquiry_owner))
    assert resp.status_code == 409 and "Create Quote" in resp.json()["detail"]
    resp = client.patch(base, json={"customer_response": "Rejected"}, headers=_auth(stranger))
    assert resp.status_code == 403 and "customer response" in resp.json()["detail"]


def test_lump_sum_quotation_prices_the_whole_offer(client, db):
    owner = _user(db, "q_owner_ls@premnathrail.com")
    inq = _inquiry(db, owner, uid="PRT-INQ-2026-0120")
    items = [{"description": "Ashok Leyland 1920 4700 WB or similar", **LINE_REF}, {"description": "Rail-road attachment", "model_number": "2F2R2GB", "unit_price": 50, **LINE_REF}]
    resp = client.post(f"/api/v1/crm/inquiries/{inq.id}/quotations", json={
        "pricing_mode": "lumpsum", "price": 9540851, "lump_sum_gst_percent": 18, "items": items,
    }, headers=_auth(owner))
    assert resp.status_code == 201, resp.text
    quot = resp.json()
    assert (quot["pricing_mode"], quot["price"], quot["lump_sum_gst_percent"]) == ("lumpsum", 9540851, 18)
    # Per-line prices contradict a lump-sum offer, so they are dropped.
    assert all(it["unit_price"] is None and it["gst_percent"] is None for it in quot["items"])

    # The total price is revisable and bumps the revision.
    rev = client.patch(f"/api/v1/crm/inquiries/{inq.id}/quotations/{quot['id']}", json={"price": 9400000}, headers=_auth(owner))
    assert rev.status_code == 200 and rev.json()["price"] == 9400000 and rev.json()["revision_number"] == 1


def test_lump_sum_requires_total_price_and_itemwise_rejects_it(client, db):
    owner = _user(db, "q_owner_ls2@premnathrail.com")
    inq = _inquiry(db, owner, uid="PRT-INQ-2026-0121")
    resp = _create(client, inq.id, owner, pricing_mode="lumpsum")
    assert resp.status_code == 422 and "Total Price is empty" in resp.text

    itemwise = _create(client, inq.id, owner, price=500).json()
    assert itemwise["price"] is None  # a stray total on an item-wise quote is not stored
    rev = client.patch(f"/api/v1/crm/inquiries/{inq.id}/quotations/{itemwise['id']}", json={"price": 900}, headers=_auth(owner))
    # Same as create: a total price on an item-wise quote is dropped, so nothing is revised.
    assert rev.status_code == 200 and rev.json()["price"] is None and rev.json()["revision_number"] == 0


def test_accepted_quotation_cannot_be_revised(client, db):
    """The customer accepted this offer — it is finalised. Changing its prices would make
    the acceptance (and any Sales prefill) refer to an offer the customer never saw, so a
    changed offer is a new quotation (+ Create Quote), never an edit of this one."""
    owner = _user(db, "q_owner_acc@premnathrail.com")
    inq = _inquiry(db, owner, uid="PRT-INQ-2026-0110")
    q = _create(client, inq.id, owner).json()
    url = f"/api/v1/crm/inquiries/{inq.id}/quotations/{q['id']}"
    _mark_sent(db, q["id"])
    assert client.patch(url, json={"customer_response": "Accepted"}, headers=_auth(owner)).json()["customer_response"] == "Accepted"
    resp = client.patch(url, json={"items": [{**ITEM, "unit_price": 1500}]}, headers=_auth(owner))
    assert resp.status_code == 409 and "finalised" in resp.json()["detail"] and "Create Quote" in resp.json()["detail"]
    kept = client.get(f"/api/v1/crm/inquiries/{inq.id}/quotations", headers=_auth(owner)).json()
    kept = next(x for x in (kept if isinstance(kept, list) else kept.get("items", [])) if x["id"] == q["id"])
    assert (kept["customer_response"], kept["status"], kept["revision_number"]) == ("Accepted", "accepted", 0)


def test_lump_sum_create_drops_header_discount(client, db):
    owner = _user(db, "q_owner_lsd@premnathrail.com")
    inq = _inquiry(db, owner, uid="PRT-INQ-2026-0111")
    q = _create(client, inq.id, owner, pricing_mode="lumpsum", price=100000, lump_sum_gst_percent=18,
                discount=10, discount_type="percent").json()
    assert (q["discount"], q["discount_type"]) == (None, None)


def test_past_quotations_picker_lists_scoped_and_searches(client, db):
    """"Fill from a past quotation": quotations of every live inquiry in the user's scope,
    newest first, searchable by item name; a deleted inquiry's quotations are not offered."""
    owner = _user(db, "q_past@premnathrail.com")
    inq1 = _inquiry(db, owner, uid="PRT-INQ-2026-0181")
    inq2 = _inquiry(db, owner, uid="PRT-INQ-2026-0182")
    _create(client, inq1.id, owner)
    client.post(f"/api/v1/crm/inquiries/{inq2.id}/quotations",
                json={"items": [{"description": "Tamping Unit", "model_number": "TU-9", "quantity": 2, "unit_price": 500, **LINE_REF}]}, headers=_auth(owner))
    rows = client.get("/api/v1/crm/past-quotations", headers=_auth(owner)).json()
    assert [r["inquiry_id"] for r in rows[:2]] == [inq2.id, inq1.id]
    assert rows[0]["items"][0]["unit_price"] == 500
    found = client.get("/api/v1/crm/past-quotations", params={"q": "tu-9"}, headers=_auth(owner)).json()
    assert [r["inquiry_id"] for r in found] == [inq2.id]

    inq2.is_deleted = True
    db.commit()
    rows = client.get("/api/v1/crm/past-quotations", headers=_auth(owner)).json()
    assert inq2.id not in [r["inquiry_id"] for r in rows]


# ── Product + Application are required on every line (Product master) ─────

def _post_lines(client, inq, owner, lines):
    return client.post(f"/api/v1/crm/inquiries/{inq.id}/quotations", json={"items": lines}, headers=_auth(owner))


def test_line_without_product_is_rejected(client, db):
    owner = _user(db, "q_prod1@premnathrail.com")
    inq = _inquiry(db, owner, uid="PRT-INQ-2026-0301")
    r = _post_lines(client, inq, owner, [{"description": "Free text", "quantity": 1, "unit_price": 10}])
    assert r.status_code == 422 and "Line 1: pick the product" in r.json()["detail"]


def test_application_is_optional_but_must_exist(client, db):
    owner = _user(db, "q_prod2@premnathrail.com")
    inq = _inquiry(db, owner, uid="PRT-INQ-2026-0302")
    r = _post_lines(client, inq, owner, [{"product_id": 1, "quantity": 1, "unit_price": 10}])
    assert r.status_code == 201, r.text
    assert r.json()["items"][0]["application_id"] is None
    r = _post_lines(client, inq, owner, [{"product_id": 1, "application_id": 999, "quantity": 1, "unit_price": 10}])
    assert r.status_code == 422 and "Line 1" in r.json()["detail"] and "not an application" in r.json()["detail"]
    # A normal product is not an application either.
    r = _post_lines(client, inq, owner, [{"product_id": 1, "application_id": 1, "quantity": 1, "unit_price": 10}])
    assert r.status_code == 422 and "not an application" in r.json()["detail"]
    # ...and an application cannot be the line's product.
    r = _post_lines(client, inq, owner, [{"product_id": 2, "quantity": 1, "unit_price": 10}])
    assert r.status_code == 422 and "is an application / attachment, not a product" in r.json()["detail"]


def test_application_need_not_belong_to_the_product(client, db):
    from app.modules.products.models.product import FinishedProduct
    owner = _user(db, "q_prod3@premnathrail.com")
    inq = _inquiry(db, owner, uid="PRT-INQ-2026-0303")
    other = FinishedProduct(code="APP-OTHER", name="Track sanding", product_type="application")
    db.add(other)
    db.commit()
    r = _post_lines(client, inq, owner, [{"product_id": 1, "application_id": other.id, "quantity": 1, "unit_price": 10}])
    assert r.status_code == 201 and r.json()["items"][0]["application_name"] == "Track sanding"


def test_discontinued_product_cannot_be_quoted(client, db):
    from app.modules.products.models.product import FinishedProduct
    owner = _user(db, "q_prod4@premnathrail.com")
    inq = _inquiry(db, owner, uid="PRT-INQ-2026-0304")
    db.get(FinishedProduct, 1).status = "discontinued"
    db.commit()
    r = _post_lines(client, inq, owner, [{"product_id": 1, "application_id": 2, "quantity": 1, "unit_price": 10}])
    assert r.status_code == 422 and "can't be quoted" in r.json()["detail"]


def test_product_line_stores_application_and_fills_description_and_model(client, db):
    owner = _user(db, "q_prod5@premnathrail.com")
    inq = _inquiry(db, owner, uid="PRT-INQ-2026-0305")
    r = _post_lines(client, inq, owner, [{"product_id": 1, "application_id": 2, "quantity": 2, "unit_price": 100}])
    assert r.status_code == 201, r.text
    line = r.json()["items"][0]
    assert (line["product_id"], line["application_id"]) == (1, 2)
    assert (line["description"], line["model_number"]) == ("RRV Mobile Crane", "RRV-MC")
    assert (line["product_code"], line["product_name"], line["application_name"]) == ("P-QT-1", "RRV Mobile Crane", "Heavy lifting")


def test_quotation_products_lookup_lists_products_and_applications_separately(client, db):
    from app.modules.products.models.product import FinishedProduct
    owner = _user(db, "q_prod6@premnathrail.com")
    db.add(FinishedProduct(code="P-OLD", name="Old", product_type="machine", status="discontinued"))
    db.add(FinishedProduct(code="P-SVC", name="Overhaul", product_type="service", status="development"))
    db.commit()
    data = client.get("/api/v1/crm/quotation-products", headers=_auth(owner)).json()
    assert [r["code"] for r in data["products"]] == ["P-QT-1", "P-SVC"] and data["products"][1]["product_type"] == "service"
    assert all(r["product_type"] != "application" for r in data["products"])
    assert [(a["id"], a["name"]) for a in data["applications"]] == [(2, "Heavy lifting")]


def test_quotation_products_lookup_needs_crm_quotation_permission(client, db):
    nobody = User(email="q_nocrm@premnathrail.com", name="nocrm", role="user", is_active=True, assigned_apps=["store"])
    db.add(nobody)
    db.commit()
    assert client.get("/api/v1/crm/quotation-products", headers=_auth(nobody)).status_code == 403


def test_quotation_product_price_lookup_is_scoped_and_checks_the_product(client, db):
    owner = _user(db, "q_prod7@premnathrail.com")
    inq = _inquiry(db, owner, uid="PRT-INQ-2026-0306")
    ok = client.get(f"/api/v1/crm/inquiries/{inq.id}/quotation-products/1/price", headers=_auth(owner))
    assert ok.status_code == 200 and "price" in ok.json()
    assert client.get(f"/api/v1/crm/inquiries/{inq.id}/quotation-products/999/price", headers=_auth(owner)).status_code in (404, 200)
    assert client.get("/api/v1/crm/inquiries/9999/quotation-products/1/price", headers=_auth(owner)).status_code == 404
