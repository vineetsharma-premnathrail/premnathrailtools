"""Project Management: Customer PO number and Sales Order (SO) number are
required when a project is created, can be edited but never blanked, and are
plain text (no link to Sales)."""
from datetime import date, timedelta

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User

API = "/api/v1"
TODAY = date.today()
PO_MSG = "Customer PO number is required. Enter the customer's purchase order number for this project."
SO_MSG = "Sales order (SO) number is required. Enter the SO number this project is delivered under."


def _user(db, email, **flags):
    u = User(email=email, name=email.split("@")[0], role="user", assigned_apps=["projects"], is_active=True, **flags)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _body(pm_id, **extra):
    data = {"name": "Tamping", "client_name": "RVNL", "project_manager_id": pm_id,
            "customer_po_ref": "PO/2026/17", "sales_order_ref": "SO-4411",
            "start_date": str(TODAY), "target_handover_date": str(TODAY + timedelta(days=30))}
    data.update(extra)
    return data


@pytest.fixture
def w(client, db):
    return {"partner": _user(db, "po.partner@x.com", is_partner=True), "pm": _user(db, "po.pm@x.com"),
            "other": _user(db, "po.other@x.com")}


def _msgs(r):
    assert r.status_code == 422, r.text
    return " | ".join(e["msg"] for e in r.json()["errors"])


def test_create_stores_trimmed_po_and_so(client, w):
    r = client.post(f"{API}/projects", headers=_h(w["partner"]),
                    json=_body(w["pm"].id, customer_po_ref="  PO-7 ", sales_order_ref=" SO-8  "))
    assert r.status_code == 200, r.text
    assert r.json()["customer_po_ref"] == "PO-7" and r.json()["sales_order_ref"] == "SO-8"


@pytest.mark.parametrize("field,msg", [("customer_po_ref", PO_MSG), ("sales_order_ref", SO_MSG)])
@pytest.mark.parametrize("mode", ["missing", "blank", "spaces", "null"])
def test_create_requires_po_and_so(client, w, field, msg, mode):
    payload = _body(w["pm"].id)
    if mode == "missing":
        del payload[field]
    else:
        payload[field] = {"blank": "", "spaces": "   ", "null": None}[mode]
    assert msg in _msgs(client.post(f"{API}/projects", headers=_h(w["partner"]), json=payload))


def test_create_rejects_over_100_chars(client, w):
    r = client.post(f"{API}/projects", headers=_h(w["partner"]), json=_body(w["pm"].id, sales_order_ref="S" * 101))
    assert "at most 100 characters" in _msgs(r)


def test_create_still_needs_management(client, w):
    r = client.post(f"{API}/projects", headers=_h(w["other"]), json=_body(w["pm"].id))
    assert r.status_code in (401, 403)


def test_update_can_change_but_never_blank(client, w):
    p = client.post(f"{API}/projects", headers=_h(w["partner"]), json=_body(w["pm"].id)).json()
    url = f"{API}/projects/{p['id']}"
    r = client.patch(url, headers=_h(w["partner"]), json={"sales_order_ref": " SO-NEW ", "customer_po_ref": "PO-NEW"})
    assert r.status_code == 200, r.text
    assert r.json()["sales_order_ref"] == "SO-NEW" and r.json()["customer_po_ref"] == "PO-NEW"
    assert PO_MSG in _msgs(client.patch(url, headers=_h(w["partner"]), json={"customer_po_ref": "  "}))
    assert SO_MSG in _msgs(client.patch(url, headers=_h(w["partner"]), json={"sales_order_ref": None}))
    # Other edits do not need them.
    assert client.patch(url, headers=_h(w["partner"]), json={"name": "Renamed"}).status_code == 200
    assert client.get(url, headers=_h(w["partner"])).json()["sales_order_ref"] == "SO-NEW"


def test_update_denied_for_user_without_manage_rights(client, w):
    p = client.post(f"{API}/projects", headers=_h(w["partner"]), json=_body(w["pm"].id)).json()
    r = client.patch(f"{API}/projects/{p['id']}", headers=_h(w["other"]), json={"sales_order_ref": "SO-X"})
    assert r.status_code in (403, 404)


def test_list_search_matches_po_and_so(client, w):
    client.post(f"{API}/projects", headers=_h(w["partner"]),
                json=_body(w["pm"].id, customer_po_ref="ZZPO-991", sales_order_ref="QQSO-552"))
    for term in ("ZZPO-991", "QQSO-552"):
        r = client.get(f"{API}/projects", headers=_h(w["partner"]), params={"search": term})
        assert r.status_code == 200 and len(r.json()) == 1
    assert client.get(f"{API}/projects", headers=_h(w["partner"]), params={"search": "nomatch-xyz"}).json() == []
