"""GSTIN / state entered on a draft sales order fill the CRM organisation
when it has none yet (owner, 2026-10-28)."""
from app.modules.crm.models.organization import Organization
from app.tests.test_sales import BASE, create_order, hdr, setup_customer, setup_people


def test_gstin_added_on_order_is_saved_to_the_crm_organisation(client, db):
    maker, *_ = setup_people(db)
    org, inq, _ = setup_customer(db, qty=1, price=1000000)
    org.gst_number, org.state, org.gst_state_code = None, None, None
    db.add(Organization(name="Other Customer", gst_number="29AAAGO1234F1Z5"))
    db.commit()
    so = create_order(client, db, maker, inq)
    assert so["customer_gstin"] is None

    r = client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker))
    assert r.status_code == 422 and "Customer GST on this order" in str(r.json()["detail"])

    r = client.patch(f"{BASE}/orders/{so['id']}", json={"customer_gstin": "27ABCDE"}, headers=hdr(maker))
    assert r.status_code == 422 and "15-character GSTIN" in str(r.json())
    # Another organisation's GSTIN is refused with the holder's name.
    r = client.patch(f"{BASE}/orders/{so['id']}", json={"customer_gstin": "29AAAGO1234F1Z5"}, headers=hdr(maker))
    assert r.status_code == 409 and "Other Customer" in r.json()["detail"]

    r = client.patch(f"{BASE}/orders/{so['id']}", json={"customer_gstin": "27aaagc9999f1z5", "customer_state": "Maharashtra"}, headers=hdr(maker))
    assert r.status_code == 200, r.text
    assert r.json()["customer_gstin"] == "27AAAGC9999F1Z5" and r.json()["place_of_supply_state_code"] == "27"
    db.refresh(org)
    assert (org.gst_number, org.gst_state_code, org.state) == ("27AAAGC9999F1Z5", "27", "Maharashtra")

    # An organisation that already has a GSTIN keeps it (the order may carry a branch GSTIN).
    r = client.patch(f"{BASE}/orders/{so['id']}", json={"customer_gstin": "27AAAGC8888F1Z5"}, headers=hdr(maker))
    assert r.status_code == 200 and r.json()["customer_gstin"] == "27AAAGC8888F1Z5"
    db.refresh(org)
    assert org.gst_number == "27AAAGC9999F1Z5"
