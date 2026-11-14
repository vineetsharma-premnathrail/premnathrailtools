"""Buyer responsibility (2026-11-06): Procurement > Settings > Buyer responsibility
(GET/PUT /p2p/buyer-responsibility) and the line-buyer rule it feeds: buyer of the
item's Item Master category -> buyer of the item type -> Default buyer -> nobody.
Service Request requisitions use the same rule per line."""
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.p2p import buyer_responsibility as br
from app.modules.p2p.models.p2p_request import (
    P2PRequest, default_buyer_id, resolve_auto_buyer_id, resolve_line_buyer_id,
)
from app.modules.store.models.category import StoreItemCategory
from app.tests.p2p_workflow_helpers import master_item
from app.tests.test_erp_service_requests import make_user as erp_user  # a user who only holds the ERP module
from app.tests.test_p2p_requests import _purchaser, _requester, auth_header, make_user

URL = "/api/v1/p2p/buyer-responsibility"


def _admin(db):
    return make_user(db, "br.admin@premnathrail.com", role="admin")


def _cat(db, name, code, item_type=None, parent_id=None, active=True):
    c = StoreItemCategory(name=name, code=code, item_type=item_type, parent_id=parent_id, is_active=active)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def _put(client, user, buyers):
    return client.put(URL, json={"buyers": buyers}, headers=auth_header(user))


def _set(db, key, value):
    db.add(ModuleSetting(module_key="p2p", key=key, value=value))
    db.commit()


# ------------------------------------------------------------------ endpoints

def test_get_shape_sorted_and_unassigned(client, db):
    admin = _admin(db)
    b = _purchaser(db, "br.b@premnathrail.com")
    _purchaser(db, "br.a@premnathrail.com")
    gone = _purchaser(db, "br.gone@premnathrail.com")
    gone.is_active = False
    erp_user(db, "br.nobuyer@premnathrail.com")  # no p2p / purchase module
    db.commit()
    z = _cat(db, "Zinc", "ZNC", "material")
    e = _cat(db, "Electrical", "ELE", "material")
    _cat(db, "Retired", "OLD", "material", active=False)
    _cat(db, "Sub cat", "SUB", "material", parent_id=e.id)
    r = client.get(URL, headers=auth_header(admin))
    assert r.status_code == 200, r.text
    d = r.json()
    assert [c["code"] for c in d["categories"]] == ["ELE", "ZNC"]  # code ascending; inactive and sub-categories left out
    assert d["categories"][0] == {"id": e.id, "code": "ELE", "name": "Electrical", "item_type": "material",
                                  "item_type_label": "Material", "buyer_id": None}
    assert d["buyers"] == [] and d["unassigned_category_ids"] == [e.id, z.id] and d["can_edit"] is True
    names = [x["name"] for x in d["eligible_buyers"]]
    assert names == sorted(names, key=str.lower)
    assert "br.b" in names and "br.a" in names and "br.gone" not in names and "br.nobuyer" not in names
    assert {"id": b.id, "name": "br.b"} in d["eligible_buyers"]


def test_put_saves_many_categories_for_one_buyer_and_audits(client, db):
    admin = _admin(db)
    a = _purchaser(db, "br.a2@premnathrail.com")
    b = _purchaser(db, "br.b2@premnathrail.com")
    ele = _cat(db, "Electrical", "ELE", "material")
    hyd = _cat(db, "Hydraulic", "HYD", "material")
    raw = _cat(db, "Raw Material", "RAW", "material")
    r = _put(client, admin, [{"user_id": a.id, "category_ids": [ele.id, hyd.id]}, {"user_id": b.id, "category_ids": [raw.id]}])
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["buyers"] == [{"user_id": a.id, "user_name": "br.a2", "category_ids": [ele.id, hyd.id]},
                           {"user_id": b.id, "user_name": "br.b2", "category_ids": [raw.id]}]
    assert d["unassigned_category_ids"] == []
    assert {c["code"]: c["buyer_id"] for c in d["categories"]} == {"ELE": a.id, "HYD": a.id, "RAW": b.id}
    assert client.get(URL, headers=auth_header(admin)).json() == d
    audit = db.query(AuditLog).filter(AuditLog.field_name == br.MAP_KEY).all()
    assert len(audit) == 1 and audit[0].module_key == "p2p" and "Electrical" in audit[0].summary
    # Saving the same thing again changes nothing and writes no second audit row.
    assert _put(client, admin, [{"user_id": a.id, "category_ids": [hyd.id, ele.id]}, {"user_id": b.id, "category_ids": [raw.id]}]).status_code == 200
    assert db.query(AuditLog).filter(AuditLog.field_name == br.MAP_KEY).count() == 1
    # Moving a category and clearing a buyer: the whole map is replaced.
    r = _put(client, admin, [{"user_id": b.id, "category_ids": [ele.id]}, {"user_id": a.id, "category_ids": []}])
    assert [x["user_id"] for x in r.json()["buyers"]] == [b.id] and r.json()["unassigned_category_ids"] == [hyd.id, raw.id]
    assert db.query(AuditLog).filter(AuditLog.field_name == br.MAP_KEY).count() == 2


def test_category_with_two_buyers_is_refused_naming_both(client, db):
    admin = _admin(db)
    m = _purchaser(db, "manish@premnathrail.com")
    s = _purchaser(db, "suraj@premnathrail.com")
    ele = _cat(db, "Electrical", "ELE", "material")
    r = _put(client, admin, [{"user_id": m.id, "category_ids": [ele.id]}, {"user_id": s.id, "category_ids": [ele.id]}])
    assert r.status_code == 422
    assert r.json()["detail"] == "Electrical is with both manish and suraj — keep it with one buyer."
    assert client.get(URL, headers=auth_header(admin)).json()["buyers"] == []  # nothing saved


def test_bad_category_or_buyer_is_refused_with_the_fix(client, db):
    admin = _admin(db)
    a = _purchaser(db, "br.a3@premnathrail.com")
    ok = _cat(db, "Electrical", "ELE", "material")
    old = _cat(db, "Retired", "OLD", "material", active=False)
    sub = _cat(db, "Sub cat", "SUB", "material", parent_id=ok.id)
    left = _purchaser(db, "br.left@premnathrail.com")
    left.is_active = False
    db.commit()
    plain = erp_user(db, "br.plain@premnathrail.com")

    d = _put(client, admin, [{"user_id": a.id, "category_ids": [99999]}]).json()["detail"]
    assert "Category #99999" in d and "br.a3" in d and "reload" in d
    d = _put(client, admin, [{"user_id": a.id, "category_ids": [old.id]}]).json()["detail"]
    assert "Retired (OLD) is inactive" in d and "remove it from br.a3" in d
    d = _put(client, admin, [{"user_id": a.id, "category_ids": [sub.id]}]).json()["detail"]
    assert "Sub cat (SUB) is a sub-category" in d
    d = _put(client, admin, [{"user_id": 99999, "category_ids": [ok.id]}]).json()["detail"]
    assert "User #99999 does not exist" in d
    d = _put(client, admin, [{"user_id": left.id, "category_ids": [ok.id]}]).json()["detail"]
    assert "br.left is deactivated" in d
    d = _put(client, admin, [{"user_id": plain.id, "category_ids": [ok.id]}]).json()["detail"]
    assert "br.plain has no access to Procurement or Purchase" in d and "Users" in d
    r = client.put(URL, json={"nope": []}, headers=auth_header(admin))
    assert r.status_code == 422 and "buyers" in r.json()["detail"]
    assert client.get(URL, headers=auth_header(admin)).json()["buyers"] == []


def test_permissions_view_vs_edit(client, db):
    a = _purchaser(db, "br.a4@premnathrail.com")
    ele = _cat(db, "Electrical", "ELE", "material")
    nobody = erp_user(db, "br.nobody@premnathrail.com")  # no Procurement access at all
    assert client.get(URL, headers=auth_header(nobody)).status_code == 403
    assert _put(client, nobody, [{"user_id": a.id, "category_ids": [ele.id]}]).status_code == 403
    # Procurement users without the Settings > Edit grant cannot save.
    plain = _requester(db, "br.req@premnathrail.com")
    r = _put(client, plain, [{"user_id": a.id, "category_ids": [ele.id]}])
    assert r.status_code == 403
    assert db.query(ModuleSetting).filter(ModuleSetting.key == br.MAP_KEY).count() == 0


def test_saved_map_is_not_listed_in_generic_settings(client, db):
    admin = _admin(db)
    a = _purchaser(db, "br.a5@premnathrail.com")
    ele = _cat(db, "Electrical", "ELE", "material")
    assert _put(client, admin, [{"user_id": a.id, "category_ids": [ele.id]}]).status_code == 200
    d = client.get("/api/v1/p2p/settings", headers=auth_header(admin)).json()
    assert br.MAP_KEY not in d["values"] and not any(s["group"] == "buyers" for s in d["specs"])
    # Category-wise only (2026-11-14): no Default buyer, no item-type buyers.
    assert "default_buyer" not in d["values"] and not any(s["key"].startswith("buyer_type_") for s in d["specs"])
    assert not any(s["group"] == "line_buyers" for s in d["specs"])


# ---------------------------------------------------------------- resolution

def _owner(db, cat, user):
    m = br.load_map(db)
    m[cat.id] = user.id
    row = db.query(ModuleSetting).filter(ModuleSetting.key == br.MAP_KEY).first()
    value = {str(k): v for k, v in m.items()}
    if row is None:
        db.add(ModuleSetting(module_key="p2p", key=br.MAP_KEY, value=value))
    else:
        row.value = value
    db.commit()


def test_line_buyer_is_the_category_buyer_or_none(db):
    x = _purchaser(db, "res.x@premnathrail.com")
    t = _purchaser(db, "res.t@premnathrail.com")
    ele = _cat(db, "Electrical", "ELE", "material")
    item = master_item(db, "Relay 24V", item_type="material", category="Electrical")
    plain = master_item(db, "Loose bolt", item_type="material", category="Fasteners")
    # Nothing configured: nobody (the requisition's main buyer applies later).
    assert resolve_line_buyer_id(db, "material", item_id=item.id) is None
    assert resolve_line_buyer_id(db, "material") is None  # old two-argument callers
    # Old Default / item-type buyer rows left in the database are never read (removed 2026-11-14).
    _set(db, "default_buyer", t.id)
    _set(db, "buyer_type_material", t.id)
    assert resolve_line_buyer_id(db, "material", item_id=item.id) is None
    assert default_buyer_id(db) is None and resolve_auto_buyer_id(db, "ELE") is None
    # The category buyer; an item of a category with no buyer gets nobody.
    _owner(db, ele, x)
    assert resolve_line_buyer_id(db, "material", item_id=item.id) == x.id
    assert resolve_line_buyer_id(db, "material", item_id=plain.id) is None
    assert resolve_line_buyer_id(db, None, item_id=item.id) == x.id  # item type read from the item
    # The category may also be passed as text (name or code, any case).
    assert resolve_line_buyer_id(db, "material", "ELECTRICAL") == x.id
    assert resolve_line_buyer_id(db, "material", "ele") == x.id
    # A buyer who has left: the line gets nobody.
    x.is_active = False
    db.commit()
    assert resolve_line_buyer_id(db, "material", item_id=item.id) is None


def test_same_category_name_under_two_types_prefers_the_items_type(db):
    mat = _purchaser(db, "res.mat@premnathrail.com")
    svc = _purchaser(db, "res.svc@premnathrail.com")
    c_mat = _cat(db, "Other", "OTH-M", "material")
    c_svc = _cat(db, "Other", "OTH-S", "service")
    _owner(db, c_mat, mat)
    _owner(db, c_svc, svc)
    assert resolve_line_buyer_id(db, "service", "Other") == svc.id
    assert resolve_line_buyer_id(db, "material", "Other") == mat.id
    # Inactive and sub-categories are never matched.
    c_svc.is_active = False
    db.commit()
    assert resolve_line_buyer_id(db, "service", "Other") == mat.id  # only the active "Other" is left


def test_hard_coded_buyers_are_gone(db):
    from app.modules.p2p.models import p2p_request as m
    from app.modules.p2p import settings  # noqa: F401 — registers the p2p settings
    make_user(db, "manish.kumar@premnathrail.com", assigned_apps=("p2p",))
    assert not hasattr(m, "P2P_CATEGORY_AUTO_BUYERS")
    assert not hasattr(m, "standard_buyer_id") and not hasattr(m, "P2P_ITEM_TYPE_STANDARD_CATEGORY")
    from app.core.settings_framework import get_def
    keys = set(get_def("p2p").specs)
    assert not [k for k in keys if k.startswith("buyer_") or k == "default_buyer"]
    assert "buyers" not in get_def("p2p").groups and "line_buyers" not in get_def("p2p").groups
    assert not hasattr(m, "P2P_ITEM_TYPE_BUYER_TYPES")
    assert resolve_auto_buyer_id(db, "ELE") is None
    assert resolve_line_buyer_id(db, "material") is None


def test_service_request_pr_lines_go_to_their_category_buyers(client, db):
    from app.tests.test_erp_service_requests import _make_sr, make_project
    from app.tests.test_erp_service_requests import auth_header as erp_header

    x = _purchaser(db, "sr.x@premnathrail.com")
    y = _purchaser(db, "sr.y@premnathrail.com")
    _owner(db, _cat(db, "Electrical", "ELE", "material"), x)
    _owner(db, _cat(db, "Hydraulic", "HYD", "material"), y)
    user = erp_user(db, "sr.user@premnathrail.com", erp_permissions=["sr_create", "sr_edit"])
    sr = _make_sr(client, user, make_project(db, "SN-BR-1"))
    plain = master_item(db, "Plain washer", item_type="material", category="Fasteners")
    hyd = master_item(db, "Hose 1in", item_type="material", category="Hydraulic")
    ele = master_item(db, "Contactor", item_type="material", category="Electrical")
    r = client.post(
        f"/api/v1/erp/service-requests/{sr['id']}/raise-pr",
        json={"category_code": "OTH", "items": [
            {"store_item_id": hyd.id, "quantity": 1, "project_inhouse": "Project"},
            {"store_item_id": ele.id, "quantity": 1, "project_inhouse": "Project"},
            {"store_item_id": plain.id, "quantity": 1, "project_inhouse": "Project"}]},
        headers=erp_header(user))
    assert r.status_code == 201, r.text
    pr = db.get(P2PRequest, r.json()["id"])
    by_item = {row.store_item_id: row.buyer_id for row in pr.items}
    assert by_item == {hyd.id: y.id, ele.id: x.id, plain.id: y.id}  # Fasteners has no buyer: the main buyer
    assert pr.assigned_buyer_id == y.id  # the buyer of the first line


# ------------------------------------------------- duties, cache, conflicts

def test_buyer_duties_for_the_exit_checklist(db):
    x = _purchaser(db, "duty.x@premnathrail.com")
    _owner(db, _cat(db, "Electrical", "ELE", "material"), x)
    _owner(db, _cat(db, "PPE", "PPE", "consumable"), x)
    d = br.buyer_duties(db, x.id)
    assert d == {"categories": ["Electrical", "PPE"]}
    assert br.buyer_duties(db, 999999) == {"categories": []}


def test_resolution_loads_categories_once_per_session(db):
    from sqlalchemy import event
    x = _purchaser(db, "cache.x@premnathrail.com")
    _owner(db, _cat(db, "Electrical", "ELE", "material"), x)
    items = [master_item(db, f"Cache relay {i}", item_type="material", category="Electrical") for i in range(5)]
    seen = []
    engine = db.get_bind()

    def count(conn, cursor, statement, *a):
        if "store_item_categories" in statement:
            seen.append(statement)
    event.listen(engine, "before_cursor_execute", count)
    try:
        assert [resolve_line_buyer_id(db, "material", item_id=i.id) for i in items] == [x.id] * 5
    finally:
        event.remove(engine, "before_cursor_execute", count)
    assert len(seen) == 1


def test_stale_editor_is_refused_with_409(client, db):
    admin = _admin(db)
    a = _purchaser(db, "ver.a@premnathrail.com")
    b = _purchaser(db, "ver.b@premnathrail.com")
    ele = _cat(db, "Electrical", "ELE", "material")
    first = _put(client, admin, [{"user_id": a.id, "category_ids": [ele.id]}]).json()
    assert first["version"]
    # Another editor changes it; the first editor's older version is refused.
    assert _put(client, admin, [{"user_id": b.id, "category_ids": [ele.id]}]).status_code == 200
    r = client.put(URL, json={"buyers": [{"user_id": a.id, "category_ids": [ele.id]}], "version": first["version"]}, headers=auth_header(admin))
    assert r.status_code == 409
    assert r.json()["detail"] == "Someone else just changed buyer responsibility — reload and make your change again."
    assert client.get(URL, headers=auth_header(admin)).json()["buyers"][0]["user_id"] == b.id
