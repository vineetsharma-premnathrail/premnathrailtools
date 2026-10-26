"""An inquiry sent to Sales (a live sales order raised from it) is read-only for
everyone, admins included: no edit, no new Technical Requirement to R&D. The
detail view names the order. Cancelling the order unlocks the inquiry."""
from app.tests.test_sales import BASE, create_order, hdr, make_user, setup_customer, setup_people

CRM = "/api/v1/crm/inquiries"


def test_inquiry_locked_once_sent_to_sales(client, db):
    maker, _, _, _ = setup_people(db)
    _, inq, _ = setup_customer(db)
    admin = make_user(db, "crm-admin@premnathrail.com", apps=("crm",), role="admin")

    # Before Sales has it: editable, no order named.
    r = client.get(f"{CRM}/{inq.id}", headers=hdr(admin))
    assert r.status_code == 200, r.text
    assert r.json()["sales_order_number"] is None
    r = client.patch(f"{CRM}/{inq.id}", json={"product_spec": "1676mm BG"}, headers=hdr(admin))
    assert r.status_code == 200, r.text

    so = create_order(client, db, maker, inq)

    # Sent to Sales (even as a draft): the detail view names the order ...
    r = client.get(f"{CRM}/{inq.id}", headers=hdr(admin))
    assert r.json()["sales_order_number"] == f"Draft #{so['id']}"

    # ... and nobody can edit it, not even an admin.
    r = client.patch(f"{CRM}/{inq.id}", json={"product_spec": "changed"}, headers=hdr(admin))
    assert r.status_code == 409, r.text
    assert "sent to Sales" in r.json()["detail"] and "cancel" in r.json()["detail"].lower()
    r = client.post(f"{CRM}/{inq.id}/technical-offer-request", json={}, headers=hdr(admin))
    assert r.status_code == 409, r.text

    # Cancelling the order in Sales unlocks it.
    r = client.post(f"{BASE}/orders/{so['id']}/cancel", json={"reason": "Raised by mistake"}, headers=hdr(maker))
    assert r.status_code == 200, r.text
    r = client.patch(f"{CRM}/{inq.id}", json={"product_spec": "changed"}, headers=hdr(admin))
    assert r.status_code == 200, r.text
    assert client.get(f"{CRM}/{inq.id}", headers=hdr(admin)).json()["sales_order_number"] is None
