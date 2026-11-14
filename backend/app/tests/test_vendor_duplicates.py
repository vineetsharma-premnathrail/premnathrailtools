"""Vendor duplicates (owner, 2026-11-14): Procurement › Vendors › Find
duplicates lists probable duplicates in one click, and one GSTIN belongs to one
vendor on every path that saves a vendor (Procurement, Finance, direct)."""
import pytest
from fastapi import HTTPException

from app.modules.accounts.models.vendor import Vendor
from app.modules.p2p.routes.vendor_duplicates import find_duplicate_groups, name_key
from app.tests.test_p2p_requests import auth_header, make_user

URL = "/api/v1/p2p/vendor-duplicates"


def _v(db, code, name, gstin=None, pan=None, **kw):
    v = Vendor(code=code, name=name, gstin=gstin, pan=pan, status=kw.pop("status", "active"),
               gst_registration_type="regular" if gstin else "unregistered", **kw)
    db.add(v)
    db.commit()
    return v


def _kinds(groups):
    return {(g["kind"], tuple(v["code"] for v in g["vendors"])) for g in groups}


def test_name_key_ignores_case_punctuation_and_legal_form():
    assert name_key("M/s Shree Ram Steels Pvt. Ltd.") == name_key("shree ram steels private limited") == "shree ram steels"
    assert name_key("A & B Engineers") == name_key("A and B Engineers")


def test_groups_same_name_similar_name_gstin_and_pan(db):
    _v(db, "V001", "Shree Ram Steels Pvt Ltd")
    _v(db, "V002", "M/s. SHREE RAM STEELS")
    _v(db, "V003", "Shree Ram Steel")               # typo: similar
    _v(db, "V004", "Kumar Hydraulics")
    # Old data from before the GSTIN rule: written straight to the table.
    db.execute(Vendor.__table__.insert(), [
        {"code": "V005", "name": "Alpha Tools", "gstin": "06AAACA1234A1Z5", "status": "active", "gst_registration_type": "regular"},
        {"code": "V006", "name": "Beta Tools", "gstin": "06aaaca1234a1z5", "status": "active", "gst_registration_type": "regular"},
    ])
    db.commit()
    _v(db, "V007", "Gamma Gears Haryana", pan="AAACG1111A")
    _v(db, "V008", "Gamma Gears Maharashtra", pan="AAACG1111A", gstin="27AAACG1111A1Z5")
    kinds = _kinds(find_duplicate_groups(db))
    assert ("same_name", ("V001", "V002")) in kinds
    assert ("similar_name", ("V001", "V002", "V003")) in kinds
    assert ("same_gstin", ("V005", "V006")) in kinds
    assert ("same_pan", ("V007", "V008")) in kinds
    assert not any("V004" in codes for _k, codes in kinds)


def test_endpoint_needs_vendor_read_access(client, db):
    _v(db, "V010", "Delta Castings")
    _v(db, "V011", "Delta Castings Pvt Ltd")
    reader = make_user(db, "dup.reader@premnathrail.com", assigned_apps=("purchase",))
    r = client.get(URL, headers=auth_header(reader))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["counts"]["same_name"] == 1 and body["vendors_checked"] == 2
    assert {v["code"] for v in body["groups"][0]["vendors"]} == {"V010", "V011"}
    outsider = make_user(db, "dup.outsider@premnathrail.com", assigned_apps=("hr",))
    r = client.get(URL, headers=auth_header(outsider))
    assert r.status_code == 403 and "Vendors" in r.json()["detail"]


def test_one_gstin_one_vendor_on_insert_and_change(db):
    _v(db, "V020", "First Co", gstin="06AAACF1234A1Z5")
    with pytest.raises(HTTPException) as e:
        _v(db, "V021", "Second Co", gstin=" 06aaacf1234a1z5 ")
    assert e.value.status_code == 409 and "First Co (V020)" in e.value.detail
    db.rollback()
    other = _v(db, "V022", "Third Co", gstin="06AAACT1234A1Z5")
    other.gstin = "06AAACF1234A1Z5"
    with pytest.raises(HTTPException):
        db.commit()
    db.rollback()


def test_old_shared_gstin_does_not_block_other_edits(db):
    db.execute(Vendor.__table__.insert(), [
        {"code": "V030", "name": "Old One", "gstin": "06AAACO1234A1Z5", "status": "active", "gst_registration_type": "regular"},
        {"code": "V031", "name": "Old Two", "gstin": "06AAACO1234A1Z5", "status": "active", "gst_registration_type": "regular"},
    ])
    db.commit()
    v = db.query(Vendor).filter(Vendor.code == "V031").one()
    v.city = "Gurugram"  # GSTIN unchanged: allowed
    db.commit()
    assert db.query(Vendor).filter(Vendor.code == "V031").one().city == "Gurugram"


def test_finance_create_refuses_a_used_gstin(client, db):
    _v(db, "V040", "Used GST Co", gstin="06AAACU1234A1Z4")
    admin = make_user(db, "dup.fin@premnathrail.com", role="admin")
    r = client.post("/api/v1/accounts/vendors", headers=auth_header(admin),
                    json={"code": "V041", "name": "Another Co", "gstin": "06AAACU1234A1Z4", "gst_registration_type": "regular"})
    assert r.status_code == 409, r.text
    assert "Used GST Co (V040)" in r.json()["detail"]
