"""Vendor 'Created by' (auto, server-side) and 'Referred by' (employee /
external / direct), identical on the Finance and Procurement routes."""
import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.accounts.models.vendor import Vendor
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User

FIN = "/api/v1/accounts/vendors"
PROC = "/api/v1/p2p/vendors"
GRANTS = ["accounts:vendors:view", "accounts:vendors:create", "accounts:vendors:edit",
          "p2p:vendors:view", "p2p:vendors:create", "p2p:vendors:edit", "p2p:vendors:import"]


def _user(db, email, **kw):
    u = User(email=email, name=email.split("@")[0].title(), role="user", is_active=True, granular_permissions=GRANTS, **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


@pytest.fixture
def who(db):
    return _user(db, "maker@premnathrail.com"), _user(db, "ref@premnathrail.com")


def _fin(name, **extra):
    return {"code": f"V-{name}", "name": name, "gst_registration_type": "unregistered", **extra}


def _proc(name, **extra):
    return {"name": name, **extra}


def test_created_by_auto_set_and_not_overridable(client, db, who):
    maker, other = who
    r = client.post(FIN, headers=_h(maker), json=_fin("FinCo", created_by_id=other.id, created_by_name="Fake"))
    assert r.status_code == 201, r.text
    assert r.json()["created_by_id"] == maker.id and r.json()["created_by_name"] == maker.name
    r = client.post(PROC, headers=_h(maker), json=_proc("ProcCo", created_by_id=other.id))
    assert r.status_code == 201, r.text
    assert r.json()["created_by_id"] == maker.id and r.json()["created_by_name"] == maker.name
    # An edit by someone else never changes the creator.
    vid = r.json()["id"]
    assert client.patch(f"{PROC}/{vid}", headers=_h(other), json={"city": "Pune", "created_by_id": other.id}).status_code == 200
    assert db.get(Vendor, vid).created_by_id == maker.id


@pytest.mark.parametrize("base,mk", [(FIN, _fin), (PROC, _proc)])
def test_referral_validation_same_on_both_routes(client, db, who, base, mk):
    maker, ref = who
    h = _h(maker)
    r = client.post(base, headers=h, json=mk("A", referral_type="employee"))
    assert r.status_code == 422 and "Pick the employee" in r.json()["detail"]
    r = client.post(base, headers=h, json=mk("B", referral_type="employee", referred_by_user_id=999999))
    assert r.status_code == 422 and "doesn't exist or is inactive" in r.json()["detail"]
    r = client.post(base, headers=h, json=mk("C", referral_type="external"))
    assert r.status_code == 422 and "Enter the name" in r.json()["detail"]
    r = client.post(base, headers=h, json=mk("D", referral_type="bogus"))
    assert r.status_code == 422 and "must be one of" in r.json()["detail"]
    r = client.post(base, headers=h, json=mk("E", referred_by_name="Someone"))
    assert r.status_code == 422 and "Choose how the vendor was referred" in r.json()["detail"]

    r = client.post(base, headers=h, json=mk("F", referral_type="employee", referred_by_user_id=ref.id, referred_by_name="junk"))
    assert r.status_code == 201, r.text
    j = r.json()
    assert (j["referral_type"], j["referred_by_user_id"], j["referred_by_name"]) == ("employee", ref.id, None)
    assert j["referred_by_label"] == ref.name
    r = client.post(base, headers=h, json=mk("G", referral_type="external", referred_by_name="  Raj Traders ", referred_by_phone="98765", referred_by_user_id=ref.id))
    j = r.json()
    assert r.status_code == 201 and j["referred_by_name"] == "Raj Traders" and j["referred_by_user_id"] is None
    assert j["referred_by_label"] == "Raj Traders (98765)"
    r = client.post(base, headers=h, json=mk("H", referral_type="direct", referred_by_name="x"))
    assert r.status_code == 201 and r.json()["referred_by_name"] is None and r.json()["referred_by_label"] == "Direct (no referral)"
    # Not recorded (older / integration vendors) stays blank, never guessed.
    r = client.post(base, headers=h, json=mk("I"))
    assert r.status_code == 201 and r.json()["referral_type"] is None and r.json()["referred_by_label"] is None

    # Update: switch type clears the old details; the answer can't be blanked.
    vid = client.post(base, headers=h, json=mk("J", referral_type="external", referred_by_name="Old")).json()["id"]
    r = client.patch(f"{base}/{vid}", headers=h, json={"referral_type": "employee", "referred_by_user_id": ref.id})
    assert r.status_code == 200 and r.json()["referred_by_name"] is None and r.json()["referred_by_user_id"] == ref.id
    r = client.patch(f"{base}/{vid}", headers=h, json={"referral_type": None})
    assert r.status_code == 422 and "can't be cleared" in r.json()["detail"]
    r = client.patch(f"{base}/{vid}", headers=h, json={"city": "Pune"})  # untouched referral stays
    assert r.status_code == 200 and r.json()["referral_type"] == "employee"


def test_lists_show_creator_and_referrer_and_audit(client, db, who):
    maker, ref = who
    h = _h(maker)
    client.post(FIN, headers=h, json=_fin("ListCo", referral_type="employee", referred_by_user_id=ref.id))
    old = Vendor(code="V-OLD", name="Old Vendor", gst_registration_type="unregistered", status="active")
    db.add(old)
    db.commit()
    for url in (FIN, PROC):
        rows = {x["name"]: x for x in client.get(url, headers=h).json()}
        assert rows["ListCo"]["created_by_name"] == maker.name and rows["ListCo"]["referred_by_label"] == ref.name
        assert rows["Old Vendor"]["created_by_name"] is None and rows["Old Vendor"]["referred_by_label"] is None
    vid = next(x["id"] for x in client.get(FIN, headers=h).json() if x["name"] == "ListCo")
    # Finance PATCH is audited (field names only; bank numbers never logged).
    r = client.patch(f"{FIN}/{vid}", headers=h, json={"referral_type": "direct"})
    assert r.status_code == 200, r.text
    summaries = [a.summary for a in db.query(AuditLog).filter(AuditLog.entity_type == "vendor", AuditLog.entity_id == vid).all()]
    assert any("referred by" in s for s in summaries) and any("added by" in s for s in summaries)


def test_import_referred_by_column(client, db, who):
    maker, ref = who
    csv = ("Company Name *,Referred By\nImp One,ref@premnathrail.com\nImp Two,Direct\nImp Three,Mr Shah\nImp Four,\n").encode()
    r = client.post(f"{PROC}/import", headers=_h(maker), files={"file": ("v.csv", csv, "text/csv")})
    assert r.status_code == 200 and len(r.json()["created"]) == 4, r.text
    by = {v.name: v for v in db.query(Vendor).all()}
    assert (by["Imp One"].referral_type, by["Imp One"].referred_by_user_id) == ("employee", ref.id)
    assert by["Imp Two"].referral_type == "direct"
    assert (by["Imp Three"].referral_type, by["Imp Three"].referred_by_name) == ("external", "Mr Shah")
    assert by["Imp Four"].referral_type is None
    assert all(by[n].created_by_id == maker.id for n in ("Imp One", "Imp Four"))
