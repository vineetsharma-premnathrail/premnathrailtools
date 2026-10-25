"""Vendor lists load in code order (A->Z / 0->max), not name order."""
import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.accounts.models.vendor import Vendor
from app.modules.main.models.user import User

URLS = ["/api/v1/accounts/vendors", "/api/v1/p2p/vendors"]
GRANTS = ["accounts:vendors:view", "p2p:vendors:view"]


@pytest.fixture
def headers(db):
    u = User(email="sorter@premnathrail.com", name="Sorter", role="user", is_active=True, granular_permissions=GRANTS)
    db.add(u)
    db.commit()
    db.refresh(u)
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


@pytest.mark.parametrize("url", URLS)
def test_vendor_list_sorted_by_code_not_name(client, db, headers, url):
    # Names are in the opposite order to the codes on purpose.
    for code, name in [("V-0003", "Alpha"), ("V-0001", "Zulu"), ("V-0002", "Mike")]:
        db.add(Vendor(code=code, name=name, gst_registration_type="unregistered", status="active"))
    db.commit()
    r = client.get(url, headers=headers)
    assert r.status_code == 200, r.text
    assert [v["code"] for v in r.json()] == ["V-0001", "V-0002", "V-0003"]
