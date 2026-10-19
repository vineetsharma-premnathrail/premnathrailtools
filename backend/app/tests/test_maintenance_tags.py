"""
Tests for Maintenance QR asset tags (routes/asset_tags.py): scan-resolver
lookup by code (incl. requester access and the 404 message), the QR SVG
endpoint, and the printable label sheet.
"""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.maintenance.routes.asset_tags import scan_url

BASE = "/api/v1/maintenance"


def make_user(db, email, apps=("maintenance",), role="user"):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def hdr(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def setup(client, db):
    branch = Branch(name="Faridabad Plant", code="FBD")
    db.add(branch)
    db.commit()
    db.refresh(branch)
    maint = make_user(db, "tag-m@premnathrail.com")
    h = hdr(maint)
    r = client.post(f"{BASE}/assets", json={"asset_code": "CNC/01", "name": "CNC Lathe", "branch_id": branch.id, "criticality": "A", "location_text": "Bay 2"}, headers=h)
    assert r.status_code == 200, r.text
    a1 = r.json()
    r = client.post(f"{BASE}/assets", json={"name": "Air Compressor", "branch_id": branch.id}, headers=h)
    assert r.status_code == 200, r.text
    return branch, maint, a1, r.json()


def test_by_code_lookup(client, db):
    branch, maint, a1, _ = setup(client, db)
    prod = make_user(db, "tag-p@premnathrail.com", apps=("production",))
    other = make_user(db, "tag-x@premnathrail.com", apps=("crm",))

    # Requester (production only) can resolve a scanned tag; code with a slash and lowercase still resolves.
    r = client.get(f"{BASE}/asset-lookup/by-code/cnc/01", headers=hdr(prod))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == a1["id"] and body["asset_code"] == "CNC/01"
    assert body["branch_name"] == "Faridabad Plant" and body["criticality"] == "A"
    assert body["open_requests"] == 0 and body["open_work_orders"] == 0
    assert body["can_raise_request"] is True and body["can_view_asset"] is False

    # Open request is counted.
    r = client.post(f"{BASE}/requests", json={"asset_id": a1["id"], "problem_description": "Spindle noise"}, headers=hdr(prod))
    assert r.status_code == 200, r.text
    body = client.get(f"{BASE}/asset-lookup/by-code/CNC%2F01", headers=hdr(maint)).json()
    assert body["open_requests"] == 1 and body["can_view_asset"] is True

    assert client.get(f"{BASE}/asset-lookup/by-code/CNC%2F01", headers=hdr(other)).status_code == 403


def test_by_code_404_message(client, db):
    _, maint, *_ = setup(client, db)
    r = client.get(f"{BASE}/asset-lookup/by-code/NOPE-99", headers=hdr(maint))
    assert r.status_code == 404
    assert r.json()["detail"] == "No asset with code 'NOPE-99' — check the tag or ask Maintenance to re-print it."


def test_by_code_reserved_words(client, db):
    """Codes that read as assets-router sub-paths must still resolve.

    The old lookup lived at /assets/by-code/{code}; a lower-case request such
    as /assets/by-code/history matched /assets/{asset_id}/history (asset_id =
    'by-code') and failed with 422. Routes are case-sensitive, so only the
    lower-case form ever clashed — that is what is requested here."""
    branch, maint, a1, _ = setup(client, db)
    h = hdr(maint)
    for code in ("HISTORY", "SPARES"):
        r = client.post(f"{BASE}/assets", json={"asset_code": code, "name": f"Asset {code}", "branch_id": branch.id}, headers=h)
        assert r.status_code == 200, r.text
        r = client.get(f"{BASE}/asset-lookup/by-code/{code.lower()}", headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["asset_code"] == code  # codes are stored upper-case
    # A slashed code ending in a sub-path word also resolves.
    r = client.post(f"{BASE}/assets", json={"asset_code": "LINE/history", "name": "Line asset", "branch_id": branch.id}, headers=h)
    assert r.status_code == 200, r.text
    r = client.get(f"{BASE}/asset-lookup/by-code/line/history", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["asset_code"] == "LINE/HISTORY"
    r = client.get(f"{BASE}/asset-lookup/by-code/CNC%2F01", headers=h)
    assert r.status_code == 200 and r.json()["id"] == a1["id"]


def test_qr_svg(client, db):
    _, maint, a1, _ = setup(client, db)
    prod = make_user(db, "tag-p2@premnathrail.com", apps=("production",))
    r = client.get(f"{BASE}/assets/{a1['id']}/qr.svg", headers=hdr(prod))
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("image/svg+xml")
    assert "<svg" in r.text and "</svg>" in r.text
    assert scan_url("CNC/01").endswith("/dashboard/maintenance/scan/CNC%2F01")
    assert client.get(f"{BASE}/assets/999999/qr.svg", headers=hdr(maint)).status_code == 404


def test_label_sheet(client, db):
    branch, maint, a1, a2 = setup(client, db)
    h = hdr(maint)
    r = client.get(f"{BASE}/asset-tags/sheet", params={"ids": f"{a1['id']},{a2['id']}"}, headers=h)
    assert r.status_code == 200, r.text
    labels = r.json()
    assert [l["id"] for l in sorted(labels, key=lambda l: l["id"])] == sorted([a1["id"], a2["id"]])
    assert all(l["qr_svg"].startswith("<svg") and l["qr_path"].endswith("/qr.svg") for l in labels)

    r = client.get(f"{BASE}/asset-tags/sheet", params={"branch_id": branch.id}, headers=h)
    assert r.status_code == 200 and len(r.json()) == 2

    r = client.get(f"{BASE}/asset-tags/sheet", params={"ids": ",".join(str(i) for i in range(1, 202))}, headers=h)
    assert r.status_code == 400 and "at most 200" in r.json()["detail"]
    assert client.get(f"{BASE}/asset-tags/sheet", headers=h).status_code == 400

    prod = make_user(db, "tag-p3@premnathrail.com", apps=("production",))
    assert client.get(f"{BASE}/asset-tags/sheet", params={"branch_id": branch.id}, headers=hdr(prod)).status_code == 403
