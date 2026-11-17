"""Typing assist (read-only): the word list and "similar records" look-ups serve
only what the user's own list pages would show them.

The router is mounted on a local app here; the real app mounts it from main.py
with prefix /api/v1."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.jwt_handler import create_access_token
from app.core.config import settings
from app.db.session import get_db
from app.modules.accounts.models.vendor import Vendor
from app.modules.crm.models.organization import Organization
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.products.models.product import FinishedProduct
from app.modules.store.models.item import StoreItem
from app.modules.typing_assist import service
from app.modules.typing_assist.routes import router

VOCAB = "/api/v1/typing-assist/vocabulary"
SIMILAR = "/api/v1/typing-assist/similar"


@pytest.fixture
def api(db):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: db
    service.clear_cache()
    yield TestClient(app)
    service.clear_cache()


def _user(db, email, grants=(), role="user"):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, granular_permissions=list(grants))
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _item(db, code, name, **kw):
    db.add(StoreItem(item_code=code, item_name=name, **kw))
    db.commit()


def _vendor(db, code, name):
    db.add(Vendor(code=code, name=name, status="active", gst_registration_type="unregistered"))
    db.commit()


# ── Tokenising ──────────────────────────────────────────────────────────────

def test_tokenize_lowercases_and_keeps_words_of_2_to_30_characters():
    assert service.tokenize("Hydraulic PUMP, 5HP (M8-bolt)") == ["hydraulic", "pump", "5hp", "m8", "bolt"]
    assert service.tokenize("a 12 2024 x" + "y" * 31) == []          # too short, numbers only, too long
    assert service.tokenize(None) == []


def test_bigrams_are_consecutive_pairs_inside_one_field_only():
    words, bigrams = service.Counter(), service.Counter()
    service.count_text(words, bigrams, ["Hydraulic Pump Seal", "Pump"])
    assert bigrams[("hydraulic", "pump")] == 1 and bigrams[("pump", "seal")] == 1
    assert ("seal", "pump") not in bigrams            # no pair across two fields
    assert words["pump"] == 2


# ── Vocabulary: permission-gated sources ────────────────────────────────────

def test_vocabulary_has_item_words_only_with_store_view(api, db):
    _item(db, "01", "Hydraulic Pump", description="Gear pump for press", make="Bosch", specification="200 bar")
    _item(db, "02", "Hydraulic Hose")
    viewer = _user(db, "ta.store@premnathrail.com", ["store:items:view"])
    body = api.get(VOCAB, headers=_h(viewer)).json()
    assert body["sources"] == ["store_items"]
    words = dict(map(tuple, body["words"]))
    assert words["hydraulic"] == 2 and words["bosch"] == 1 and words["bar"] == 1
    assert ["hydraulic", "pump", 1] in body["bigrams"]
    assert "200" not in words                          # a bare number is not a word

    outsider = _user(db, "ta.nostore@premnathrail.com", ["hr:employees:view"])
    body = api.get(VOCAB, headers=_h(outsider)).json()
    assert "store_items" not in body["sources"]
    assert "hydraulic" not in dict(map(tuple, body["words"]))


def test_vocabulary_without_any_source_is_empty_and_needs_login(api, db):
    nobody = _user(db, "ta.nobody@premnathrail.com", [])
    assert api.get(VOCAB, headers=_h(nobody)).json() == {"words": [], "bigrams": [], "sources": []}
    assert api.get(VOCAB).status_code == 401


def test_vocabulary_reads_each_module_only_when_viewable(api, db):
    _item(db, "01", "Bearing Sleeve")
    _vendor(db, "V001", "Kumar Hydraulics Pvt Ltd")
    org = Organization(name="Northern Railway Workshop", org_scope="domestic")
    db.add(org)
    db.add(FinishedProduct(code="01", name="Rail Grinder", product_type="machine"))
    db.add(Project(serial_number="PEW-90", model_name="Rail Inspection Vehicle", client_company="Metro Corporation",
                   client_name="Mr Secret Person", client_email="private@example.com"))
    db.commit()
    everything = _user(db, "ta.all@premnathrail.com", ["store:items:view", "p2p:vendors:view", "crm:organizations:view",
                                                       "crm:products:view", "projects:all_projects:view"])
    body = api.get(VOCAB, headers=_h(everything)).json()
    assert set(body["sources"]) == {"store_items", "vendors", "organizations", "machines", "products"}
    words = dict(map(tuple, body["words"]))
    for w in ("bearing", "kumar", "northern", "grinder", "inspection", "metro"):
        assert w in words, w
    # Text only: no contact person, no email, no serial number.
    for private in ("secret", "person", "private", "example", "pew"):
        assert private not in words

    vendor_only = _user(db, "ta.vendor@premnathrail.com", ["p2p:vendors:view"])
    body = api.get(VOCAB, headers=_h(vendor_only)).json()
    assert body["sources"] == ["vendors"]
    assert "bearing" not in dict(map(tuple, body["words"]))


def test_vocabulary_machine_words_follow_the_machine_data_scope(api, db, monkeypatch):
    monkeypatch.setattr(settings, "DEFAULT_DATA_SCOPE", "assigned")
    mine = _user(db, "ta.mine@premnathrail.com", ["projects:all_projects:view"])
    other = _user(db, "ta.other@premnathrail.com", ["projects:all_projects:view"])
    db.add(Project(serial_number="PEW-1", model_name="Secretive Crane", created_by_id=other.id))
    db.add(Project(serial_number="PEW-2", model_name="Visible Trolley", created_by_id=mine.id))
    db.commit()
    words = dict(map(tuple, api.get(VOCAB, headers=_h(mine)).json()["words"]))
    assert "visible" in words and "secretive" not in words
    # The cache is per user when the scope narrows the source: the other user does not get mine.
    words = dict(map(tuple, api.get(VOCAB, headers=_h(other)).json()["words"]))
    assert "secretive" in words and "visible" not in words


def test_vocabulary_is_cached_for_the_same_source_set(api, db):
    _item(db, "01", "Hydraulic Pump")
    viewer = _user(db, "ta.cache@premnathrail.com", ["store:items:view"])
    assert "hydraulic" in dict(map(tuple, api.get(VOCAB, headers=_h(viewer)).json()["words"]))
    _item(db, "02", "Zirconium Rod")
    assert "zirconium" not in dict(map(tuple, api.get(VOCAB, headers=_h(viewer)).json()["words"]))  # cached 10 min
    service.clear_cache()
    assert "zirconium" in dict(map(tuple, api.get(VOCAB, headers=_h(viewer)).json()["words"]))


# ── Similar ─────────────────────────────────────────────────────────────────

def test_similar_finds_a_misspelt_item_name(api, db):
    _item(db, "0142", "Hydraulic Pump")
    _item(db, "0143", "Bearing 6205")
    viewer = _user(db, "ta.sim@premnathrail.com", ["store:items:view"])
    r = api.get(SIMILAR, params={"kind": "item", "q": "hydrolic pump"}, headers=_h(viewer))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "item" and body["query"] == "hydrolic pump"
    assert [m["name"] for m in body["matches"]] == ["Hydraulic Pump"]
    top = body["matches"][0]
    assert top["code"] == "0142" and top["id"] and 0.6 <= top["score"] < 1


def test_similar_exact_name_scores_one_and_word_order_does_not_matter(api, db):
    _item(db, "01", "Hydraulic Pump")
    viewer = _user(db, "ta.exact@premnathrail.com", ["store:items:view"])
    exact = api.get(SIMILAR, params={"kind": "item", "q": "HYDRAULIC  pump"}, headers=_h(viewer)).json()["matches"]
    assert exact[0]["score"] == 1.0
    swapped = api.get(SIMILAR, params={"kind": "item", "q": "pump hydraulic"}, headers=_h(viewer)).json()["matches"]
    assert swapped[0]["name"] == "Hydraulic Pump" and swapped[0]["score"] == 1.0


def test_similar_vendor_ignores_legal_form_words(api, db):
    _vendor(db, "V001", "Shree Ram Steels Pvt Ltd")
    _vendor(db, "V002", "Kumar Hydraulics")
    reader = _user(db, "ta.v@premnathrail.com", ["p2p:vendors:view"])
    m = api.get(SIMILAR, params={"kind": "vendor", "q": "M/s Shree Ram Steels Private Limited"}, headers=_h(reader)).json()["matches"]
    assert [x["code"] for x in m] == ["V001"] and m[0]["score"] == 1.0


def test_similar_organization_and_machine(api, db):
    db.add(Organization(name="Northern Railway Workshop", org_code="ORG-01", org_scope="domestic"))
    db.add(Project(serial_number="PEW-64A", model_name="Rail Grinder"))
    db.commit()
    user = _user(db, "ta.om@premnathrail.com", ["crm:organizations:view", "projects:all_projects:view"])
    m = api.get(SIMILAR, params={"kind": "organization", "q": "Nothern Railway Workshop"}, headers=_h(user)).json()["matches"]
    assert m[0]["code"] == "ORG-01" and m[0]["name"] == "Northern Railway Workshop"
    m = api.get(SIMILAR, params={"kind": "machine", "q": "rail grindr"}, headers=_h(user)).json()["matches"]
    # Machines: name = model + serial, code = serial.
    assert m[0]["code"] == "PEW-64A" and m[0]["name"] == "Rail Grinder PEW-64A"


def test_similar_machine_follows_the_machine_data_scope(api, db, monkeypatch):
    monkeypatch.setattr(settings, "DEFAULT_DATA_SCOPE", "assigned")
    mine = _user(db, "ta.ms1@premnathrail.com", ["projects:all_projects:view"])
    other = _user(db, "ta.ms2@premnathrail.com", ["projects:all_projects:view"])
    db.add(Project(serial_number="PEW-5", model_name="Rail Grinder", created_by_id=other.id))
    db.commit()
    assert api.get(SIMILAR, params={"kind": "machine", "q": "rail grinder"}, headers=_h(mine)).json()["matches"] == []
    assert len(api.get(SIMILAR, params={"kind": "machine", "q": "rail grinder"}, headers=_h(other)).json()["matches"]) == 1


@pytest.mark.parametrize("kind,grants,words", [
    ("item", ["hr:employees:view"], ["Store items", "Store › Items view access"]),
    ("vendor", ["hr:employees:view"], ["Vendors"]),
    ("organization", ["hr:employees:view"], ["CRM"]),
    ("machine", ["hr:employees:view"], ["Project Management"]),
])
def test_similar_without_view_permission_is_403_with_the_real_reason(api, db, kind, grants, words):
    _item(db, "01", "Hydraulic Pump")
    user = _user(db, f"ta.deny.{kind}@premnathrail.com", grants)
    r = api.get(SIMILAR, params={"kind": kind, "q": "hydraulic pump"}, headers=_h(user))
    assert r.status_code == 403, r.text
    detail = r.json()["detail"]
    for w in words:
        assert w in detail, detail
    assert "Hydraulic Pump" not in r.text            # nothing leaks in the refusal


def test_item_403_message_matches_the_spec(api, db):
    user = _user(db, "ta.msg@premnathrail.com", [])
    r = api.get(SIMILAR, params={"kind": "item", "q": "pump"}, headers=_h(user))
    assert r.status_code == 403
    assert r.json()["detail"] == ("You don't have permission to view Store items. "
                                  "Ask your admin for Store › Items view access.")


def test_similar_short_query_returns_empty_matches(api, db):
    _item(db, "01", "Hydraulic Pump")
    viewer = _user(db, "ta.short@premnathrail.com", ["store:items:view"])
    for q in ("", "hy", "  h "):
        r = api.get(SIMILAR, params={"kind": "item", "q": q}, headers=_h(viewer))
        assert r.status_code == 200 and r.json()["matches"] == []
    assert api.get(SIMILAR, params={"kind": "item", "q": "hydr"}, headers=_h(viewer)).json()["matches"]


def test_similar_limit_is_capped_at_ten_and_sorted_by_score_then_code(api, db):
    for n in range(15):
        _item(db, f"{n + 1:02d}", "Hydraulic Pump")
    _item(db, "99", "Hydraulic Pumps")                         # a little less than exact
    viewer = _user(db, "ta.limit@premnathrail.com", ["store:items:view"])
    big = api.get(SIMILAR, params={"kind": "item", "q": "hydraulic pump", "limit": 50}, headers=_h(viewer)).json()["matches"]
    assert len(big) == 10
    assert [m["code"] for m in big] == [f"{n + 1:02d}" for n in range(10)]    # all 1.0, code ascending
    default = api.get(SIMILAR, params={"kind": "item", "q": "hydraulic pump"}, headers=_h(viewer)).json()["matches"]
    assert len(default) == 5
    one = api.get(SIMILAR, params={"kind": "item", "q": "hydraulic pump", "limit": 1}, headers=_h(viewer)).json()["matches"]
    assert len(one) == 1
    assert api.get(SIMILAR, params={"kind": "item", "q": "hydraulic pump", "limit": 0}, headers=_h(viewer)).json()["matches"]


def test_similar_threshold_and_unknown_kind(api, db):
    _item(db, "01", "Hydraulic Pump")
    viewer = _user(db, "ta.thr@premnathrail.com", ["store:items:view"])
    assert api.get(SIMILAR, params={"kind": "item", "q": "welding electrode"}, headers=_h(viewer)).json()["matches"] == []
    r = api.get(SIMILAR, params={"kind": "customer", "q": "hydraulic"}, headers=_h(viewer))
    assert r.status_code == 422
    assert "item, vendor, organization, machine" in r.json()["detail"]


def test_similar_percent_and_underscore_are_plain_text(api, db):
    _item(db, "01", "Hydraulic Pump")
    viewer = _user(db, "ta.like@premnathrail.com", ["store:items:view"])
    assert api.get(SIMILAR, params={"kind": "item", "q": "%%%"}, headers=_h(viewer)).json()["matches"] == []
    assert api.get(SIMILAR, params={"kind": "item", "q": "___"}, headers=_h(viewer)).json()["matches"] == []


# ── Machines: the list route's app gate, cache keys, candidate cache ────────

def test_machines_need_the_erp_or_projects_app_as_well_as_the_tab(api, db, monkeypatch):
    """The Machines list route has two gates (app access, then the tab). Even
    if the tab check passed, a user with neither module gets a real 403."""
    monkeypatch.setattr(service, "_machines_tab_or_pm_project", lambda pm, d, u: u)
    db.add(Project(serial_number="PEW-7", model_name="Rail Grinder"))
    db.commit()
    nobody = _user(db, "ta.noapp@premnathrail.com", ["hr:employees:view"])
    r = api.get(SIMILAR, params={"kind": "machine", "q": "rail grinder"}, headers=_h(nobody))
    assert r.status_code == 403
    assert "ERP" in r.json()["detail"] or "Project Management" in r.json()["detail"]
    assert "machines" not in api.get(VOCAB, headers=_h(nobody)).json()["sources"]
    member = _user(db, "ta.app@premnathrail.com", ["projects:all_projects:view"])
    assert api.get(SIMILAR, params={"kind": "machine", "q": "rail grinder"}, headers=_h(member)).status_code == 200


def test_machine_cache_key_carries_the_user_and_every_scope_level(db, monkeypatch):
    monkeypatch.setattr(settings, "DEFAULT_DATA_SCOPE", "assigned")
    a = _user(db, "ta.k1@premnathrail.com", ["projects:all_projects:view"])
    b = _user(db, "ta.k2@premnathrail.com", ["projects:all_projects:view"])
    admin = _user(db, "ta.k3@premnathrail.com", [], role="admin")
    src = ["machines"]
    ka, kb = service._cache_key(db, a, src), service._cache_key(db, b, src)
    assert ka != kb                                              # narrowed: one entry per user
    assert service._cache_key(db, admin, src) == (frozenset(src), ())   # not narrowed: shared entry
    # Same user, a different scope level (e.g. a role change) is a different entry.
    monkeypatch.setattr(service, "user_scope", lambda user, module: "plant")
    assert service._cache_key(db, a, src) != ka


def test_similar_candidates_are_cached_for_a_minute_per_kind(api, db):
    _item(db, "01", "Hydraulic Pump")
    viewer = _user(db, "ta.cc@premnathrail.com", ["store:items:view"])
    params = {"kind": "item", "q": "zirconium rod"}
    assert api.get(SIMILAR, params=params, headers=_h(viewer)).json()["matches"] == []
    _item(db, "02", "Zirconium Rod")
    assert api.get(SIMILAR, params=params, headers=_h(viewer)).json()["matches"] == []   # still cached
    service.clear_cache()
    assert api.get(SIMILAR, params=params, headers=_h(viewer)).json()["matches"][0]["code"] == "02"


def test_query_is_cut_to_80_characters_and_caches_are_small(api, db):
    viewer = _user(db, "ta.len@premnathrail.com", ["store:items:view"])
    body = api.get(SIMILAR, params={"kind": "item", "q": "pump " * 40}, headers=_h(viewer)).json()
    assert len(body["query"]) <= 80
    assert service.MAX_QUERY == 80 and service.MAX_CACHE_ENTRIES <= 50


def test_short_or_mid_word_text_gets_no_substring_bonus(api, db):
    _item(db, "01", "Milling Cutter")
    _item(db, "02", "Hydraulic Pump")
    viewer = _user(db, "ta.bonus@premnathrail.com", ["store:items:view"])
    assert api.get(SIMILAR, params={"kind": "item", "q": "mil"}, headers=_h(viewer)).json()["matches"] == []
    assert api.get(SIMILAR, params={"kind": "item", "q": "ump"}, headers=_h(viewer)).json()["matches"] == []
    assert api.get(SIMILAR, params={"kind": "item", "q": "ydra"}, headers=_h(viewer)).json()["matches"] == []   # mid-word
    assert [m["code"] for m in api.get(SIMILAR, params={"kind": "item", "q": "mill"}, headers=_h(viewer)).json()["matches"]] == ["01"]
    assert [m["code"] for m in api.get(SIMILAR, params={"kind": "item", "q": "pump"}, headers=_h(viewer)).json()["matches"]] == ["02"]  # word start


def test_concurrent_cold_vocabulary_calls_compute_once(db, monkeypatch):
    import threading
    import time as _t
    service.clear_cache()
    viewer = _user(db, "ta.flight@premnathrail.com", ["store:items:view"])
    _item(db, "01", "Hydraulic Pump")
    calls = []

    def slow_texts(_db, _user, _src):
        calls.append(1)
        _t.sleep(0.2)
        return ["Hydraulic Pump"]

    monkeypatch.setattr(service, "_source_texts", slow_texts)
    # One SQLAlchemy session is not thread-safe: stub the permission / scope lookups that would use it.
    monkeypatch.setattr(service, "allowed_sources", lambda _db, _user: ["store_items"])
    monkeypatch.setattr(service, "_cache_key", lambda _db, _user, sources: (frozenset(sources), ()))
    out = []
    threads = [threading.Thread(target=lambda: out.append(service.get_vocabulary(db, viewer))) for _ in range(4)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert len(calls) == 1 and len(out) == 4 and all(o == out[0] for o in out)
    assert service._key_locks == {}
    service.clear_cache()
