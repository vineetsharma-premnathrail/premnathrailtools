"""Tamper-proof record references (core/record_ref.py, middleware/record_refs.py)."""
from app.core.record_ref import decode_ref, encode_ref
from app.tests.test_crm_data_scope import API, _auth, _seed

REFS = {"X-Record-Refs": "1"}


def test_round_trip_and_tampering():
    for record_id in (1, 124, 125, 99_999_999):
        ref = encode_ref(record_id)
        assert len(ref) == 19 and (record_id < 1000 or str(record_id) not in ref)
        assert decode_ref(ref) == record_id
    a, b = encode_ref(124), encode_ref(125)
    assert a[:8] != b[:8]  # neighbours don't look alike
    for i in range(len(a)):  # any single-character edit is rejected
        swapped = a[:i] + ("A" if a[i] != "A" else "B") + a[i + 1:]
        assert decode_ref(swapped) is None
    assert decode_ref("124") is None and decode_ref("") is None


def test_responses_carry_refs_only_when_asked(client, db):
    alice, _bob, rows = _seed(db)
    h = _auth(alice)
    plain = client.get(f"{API}/organizations/{rows[alice.id]['org']}/detail", headers=h).json()
    assert "id_ref" not in plain
    body = client.get(f"{API}/organizations/{rows[alice.id]['org']}/detail", headers={**h, **REFS}).json()
    assert decode_ref(body["id_ref"]) == rows[alice.id]["org"]
    listed = client.get(f"{API}/organizations", headers={**h, **REFS}).json()
    assert all(decode_ref(r["id_ref"]) == r["id"] for r in listed)


def test_resolve_endpoint(client, db):
    alice, _bob, _rows = _seed(db)
    h = _auth(alice)
    assert client.get(f"/api/v1/refs/{encode_ref(124)}", headers=h).json() == {"id": 124}
    bad = encode_ref(124)[:-1] + ("A" if encode_ref(124)[-1] != "A" else "B")
    r = client.get(f"/api/v1/refs/{bad}", headers=h)
    assert r.status_code == 404 and "link is invalid" in r.json()["detail"]
    assert client.get(f"/api/v1/refs/{encode_ref(124)}").status_code == 401
