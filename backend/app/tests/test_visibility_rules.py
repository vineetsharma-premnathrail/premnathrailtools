"""Role-wise UI visibility (core/visibility.py): which sections, dropdown
values and table columns a role's members see — first applied to Procurement
> Purchase Requisitions. Dropdown values are also enforced by the server."""
import pytest
from fastapi import HTTPException

from app.core import visibility
from app.core.permission_registry import MODULES
from app.core.visibility import VISIBILITY, clean_rules, effective, ensure_option_allowed
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    BASE as PR_BASE, _create_payload, _create_pr, _requester, _sqlite_number_series, auth_header, link_items,
    set_pr_workflow,
)

KEY = "p2p:purchase_requisitions"
VIEW = ["p2p:purchase_requisitions:view", "p2p:purchase_requisitions:create"]
ROLES_API = "/api/v1/roles"


def _user(db, email, **kw):
    u = User(email=email, name=email.split("@")[0].title(), role="user", is_active=True, granular_permissions=[], **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _role(db, name, rules=None, permissions=tuple(VIEW), **kw):
    r = Role(name=name, permissions=list(permissions), visibility_rules=rules or {}, **kw)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def _purposes(client, user) -> list[dict]:
    r = client.get(f"{PR_BASE}/meta", headers=auth_header(user))
    assert r.status_code == 200, r.text
    return r.json()["purposes"]


def _allowed_codes(client, user) -> list[str]:
    """Purposes /meta flags `allowed` for this user (it lists every purpose)."""
    return [p["code"] for p in _purposes(client, user) if p["allowed"]]


def _give(db, user, *roles):
    user.roles = list(roles)
    db.commit()
    db.refresh(user)
    user.__dict__.pop("_visibility_effective_cache", None)


# ---------- catalogue ----------

def test_every_catalogue_key_resolves_to_a_tab_or_feature():
    assert KEY in VISIBILITY
    for key, entry in VISIBILITY.items():
        module, tabfeat = key.split(":", 1)
        tab, _, feature = tabfeat.partition(".")
        assert tab in MODULES[module]["actions"], key
        if feature:
            assert feature in MODULES[module]["features"][tab], key
        assert entry["label"]
        for spec in entry["options"].values():
            assert spec["values"] and all(isinstance(v, str) for v in spec["values"]), key


def test_pr_catalogue_matches_the_coded_values():
    from app.modules.p2p.models.p2p_request import P2P_PURPOSES, P2P_REQUEST_PRIORITIES

    cat = visibility.catalog()[KEY]
    assert cat["options"]["purpose"]["values"] == P2P_PURPOSES
    assert list(cat["options"]["priority"]["values"]) == list(P2P_REQUEST_PRIORITIES)
    assert cat["sections"]["purpose_charging"]["locked"] and cat["sections"]["item_details"]["locked"]
    assert not cat["sections"]["remarks"]["locked"]
    assert set(cat["tables"]) == {"requisitions", "form_items", "detail_lines"}
    # the catalogue returned is a copy
    cat["sections"].clear()
    assert VISIBILITY[KEY]["sections"]


# ---------- clean_rules ----------

def test_clean_rules_passes_valid_rules_and_drops_empty_ones():
    out = clean_rules({
        KEY: {"hidden_sections": ["remarks", "remarks"], "options": {"purpose": ["stock", "capital"]},
              "hidden_columns": {"requisitions": ["priority"], "form_items": []}},
        "nothing:here": {},
    })
    assert out == {KEY: {"hidden_sections": ["remarks"], "options": {"purpose": ["capital", "stock"]},
                         "hidden_columns": {"requisitions": ["priority"]}}}
    assert clean_rules(None) == {} and clean_rules({KEY: {}}) == {}
    # every value ticked = no restriction = nothing stored
    from app.modules.p2p.models.p2p_request import P2P_PURPOSES
    assert clean_rules({KEY: {"options": {"purpose": list(P2P_PURPOSES)}}}) == {}


@pytest.mark.parametrize("rule,fragment", [
    ({KEY: {"hidden_sections": ["nope"]}}, "isn't in the current catalogue"),
    ({KEY: {"options": {"nope": ["a"]}}}, "isn't in the current catalogue"),
    ({KEY: {"options": {"purpose": ["bogus"]}}}, "isn't in the current catalogue"),
    ({KEY: {"hidden_columns": {"nope": ["a"]}}}, "isn't in the current catalogue"),
    ({KEY: {"hidden_columns": {"requisitions": ["nope"]}}}, "isn't in the current catalogue"),
])
def test_clean_rules_refuses_unknown_names(rule, fragment):
    with pytest.raises(ValueError) as e:
        clean_rules(rule)
    assert fragment in str(e.value) and "reload" in str(e.value)


def test_clean_rules_drops_a_stale_screen_key_instead_of_refusing(caplog):
    with caplog.at_level("WARNING"):
        out = clean_rules({"nope:key": {"hidden_sections": ["x"]}, KEY: {"hidden_sections": ["remarks"]}})
    assert out == {KEY: {"hidden_sections": ["remarks"]}}
    assert "nope:key" in caplog.text


@pytest.mark.parametrize("rule", [
    [],  # handled as empty -> not malformed
])
def test_clean_rules_empty_rule_is_dropped(rule):
    assert clean_rules({KEY: rule}) == {}


@pytest.mark.parametrize("rule", [
    "remarks",
    {"hidden_sections": "remarks"},
    {"hidden_sections": {"remarks": True}},
    {"hidden_sections": [1]},
    {"options": ["purpose"]},
    {"options": {"purpose": "stock"}},
    {"options": {"purpose": [["stock"]]}},
    {"hidden_columns": ["priority"]},
    {"hidden_columns": {"requisitions": "priority"}},
])
def test_clean_rules_refuses_malformed_shapes(rule):
    with pytest.raises(ValueError) as e:
        clean_rules({KEY: rule})
    assert "is malformed — reload the page and set it again." in str(e.value)
    with pytest.raises(ValueError):
        clean_rules([KEY])  # the whole value must be an object


def test_clean_rules_refuses_hiding_request_details_while_standard_priority_is_left_out():
    with pytest.raises(ValueError) as e:
        clean_rules({KEY: {"hidden_sections": ["request_details"], "options": {"priority": ["urgent"]}}})
    assert str(e.value) == ("Request Details can't be hidden while Priority leaves out Standard: the form could never be "
                            "submitted. Show the section, or allow Standard.")
    # fine when Standard stays allowed, or when priority is not restricted
    assert clean_rules({KEY: {"hidden_sections": ["request_details"], "options": {"priority": ["standard"]}}})
    assert clean_rules({KEY: {"hidden_sections": ["request_details"]}})
    assert clean_rules({KEY: {"options": {"priority": ["urgent"]}}})


def test_clean_rules_refuses_locked_section_and_empty_options():
    with pytest.raises(ValueError) as e:
        clean_rules({KEY: {"hidden_sections": ["purpose_charging"]}})
    assert str(e.value) == "'Purpose & Charging' holds a required field, so it can't be hidden. Leave it visible."
    with pytest.raises(ValueError) as e:
        clean_rules({KEY: {"options": {"purpose": []}}})
    assert str(e.value) == "Pick at least one Purpose value, or reset it to all values."


# ---------- effective() ----------

def test_no_relevant_role_or_no_rule_means_no_restriction(db):
    u = _user(db, "plain@premnathrail.com")
    assert effective(u) == {}
    _give(db, u, _role(db, "Open PR", {}))
    assert effective(u) == {}
    # a role that restricts but does not open the tab does not count (and gives nothing)
    u2 = _user(db, "other@premnathrail.com")
    _give(db, u2, _role(db, "Store only", {KEY: {"options": {"purpose": ["stock"]}}}, permissions=("store:items:view",)))
    assert effective(u2) == {}


def test_single_role_restriction_is_reported_sorted(db):
    u = _user(db, "keeper@premnathrail.com")
    _give(db, u, _role(db, "Store Keeper", {KEY: {
        "hidden_sections": ["remarks", "attachments"], "options": {"purpose": ["stock", "capital"]},
        "hidden_columns": {"requisitions": ["priority", "category"]}}}))
    assert effective(u) == {KEY: {
        "hidden_sections": ["attachments", "remarks"], "options": {"purpose": ["capital", "stock"]},
        "hidden_columns": {"requisitions": ["category", "priority"]}}}


def test_union_across_roles(db):
    u = _user(db, "two@premnathrail.com")
    a = _role(db, "A", {KEY: {"hidden_sections": ["remarks", "attachments"], "options": {"purpose": ["stock"]},
                               "hidden_columns": {"requisitions": ["priority", "project"]}}})
    b = _role(db, "B", {KEY: {"hidden_sections": ["remarks"], "options": {"purpose": ["capital"], "priority": ["urgent"]},
                               "hidden_columns": {"requisitions": ["priority"]}}})
    _give(db, u, a, b)
    got = effective(u)[KEY]
    assert got["hidden_sections"] == ["remarks"]                  # hidden only if every role hides it
    assert got["options"] == {"purpose": ["capital", "stock"]}    # allowed = union; priority: role A offers all
    assert got["hidden_columns"] == {"requisitions": ["priority"]}

    # a second role that opens the tab with NO rule lifts every restriction
    _give(db, u, a, _role(db, "Plain", {}))
    assert effective(u) == {}


def test_applies_to_everyone_role_counts(db):
    u = _user(db, "all@premnathrail.com")
    _role(db, "Everyone", {KEY: {"options": {"purpose": ["department"]}}}, is_default=True)
    assert effective(u) == {KEY: {"options": {"purpose": ["department"]}}}


def test_admin_and_partner_are_never_restricted(db):
    rules = {KEY: {"options": {"purpose": ["stock"]}}}
    role = _role(db, "Restricted", rules)
    admin = _user(db, "admin@premnathrail.com")
    admin.role = "admin"
    partner = _user(db, "partner@premnathrail.com", is_partner=True)
    _give(db, admin, role)
    _give(db, partner, role)
    assert effective(admin) == {} and effective(partner) == {}
    assert visibility.allowed_values(partner, KEY, "purpose") is None
    ensure_option_allowed(partner, KEY, "purpose", "customer_order")


def test_cache_follows_role_changes(db):
    u = _user(db, "cache@premnathrail.com")
    role = _role(db, "Cached", {KEY: {"options": {"purpose": ["stock"]}}})
    _give(db, u, role)
    assert visibility.allowed_values(u, KEY, "purpose") == {"stock"}
    role.visibility_rules = {KEY: {"options": {"purpose": ["capital"]}}}
    db.commit()
    assert visibility.allowed_values(u, KEY, "purpose") == {"capital"}


def test_helpers_filter_and_hide(db):
    u = _user(db, "helpers@premnathrail.com")
    _give(db, u, _role(db, "H", {KEY: {"hidden_sections": ["remarks"], "options": {"purpose": ["stock"]}}}))
    rows = [{"code": "stock"}, {"code": "capital"}]
    assert visibility.filter_options(u, KEY, "purpose", rows) == [{"code": "stock"}]
    assert visibility.filter_options(u, KEY, "priority", rows, value_of=lambda r: r["code"]) == rows
    assert visibility.section_hidden(u, KEY, "remarks") and not visibility.section_hidden(u, KEY, "attachments")


def test_ensure_option_allowed_message_names_label_allowed_values_and_where_to_widen(db):
    u = _user(db, "msg@premnathrail.com")
    _give(db, u, _role(db, "M", {KEY: {"options": {"purpose": ["stock"]}}}))
    with pytest.raises(HTTPException) as e:
        ensure_option_allowed(u, KEY, "purpose", "customer_order")
    assert e.value.status_code == 422
    assert e.value.detail == (
        "Purpose 'Project' isn't available to your role — you can pick: Store stock refill. Ask an admin to widen it in "
        "Organization › Role & Permissions › Procurement › Purchase Requisitions › Visibility.")
    ensure_option_allowed(u, KEY, "purpose", "stock")
    ensure_option_allowed(u, KEY, "purpose", None)  # empty = the form's own validation


def test_ensure_option_allowed_refuses_a_non_string_value_with_422_not_a_crash(db):
    u = _user(db, "nonstr@premnathrail.com")
    _give(db, u, _role(db, "NS", {KEY: {"options": {"purpose": ["stock"]}}}))
    for bad in (["stock"], {"a": 1}, 5):
        with pytest.raises(HTTPException) as e:
            ensure_option_allowed(u, KEY, "purpose", bad)
        assert e.value.status_code == 422 and e.value.detail.startswith("Purpose must be one of: Store stock refill")


def test_unregistered_key_or_dropdown_never_raises_a_key_error(db, caplog):
    """A coding slip (key / dropdown nobody registered) is logged once and skipped, never a 500; an unrestricted
    user returns before the catalogue is read at all."""
    import logging

    u = _user(db, "unreg@premnathrail.com")
    _give(db, u, _role(db, "Plain", {}))
    with caplog.at_level(logging.ERROR, logger="app.core.visibility"):
        visibility.ensure_option_allowed(u, "nope:nothing", "anything", "x")
        visibility.ensure_option_given(u, "nope:nothing", "anything", None)
    assert not caplog.records  # allowed is None: no catalogue read, nothing to log
    # With a restriction on a real key, a dropdown that is not registered is logged once and skipped.
    _give(db, u, _role(db, "Narrow", {KEY: {"options": {"purpose": ["stock"]}}}))
    monkey_key = "p2p:purchase_requisitions"
    original = visibility.allowed_values
    visibility.allowed_values = lambda user, key, dropdown: {"x"} if dropdown == "ghost_dropdown" else original(user, key, dropdown)
    try:
        with caplog.at_level(logging.ERROR, logger="app.core.visibility"):
            visibility.ensure_option_allowed(u, monkey_key, "ghost_dropdown", "y")
            visibility.ensure_option_allowed(u, monkey_key, "ghost_dropdown", "y")
            visibility.ensure_option_given(u, monkey_key, "ghost_dropdown", None)
    finally:
        visibility.allowed_values = original
    errors = [r for r in caplog.records if "not registered in the catalogue" in r.getMessage()]
    assert len(errors) == 1, [r.getMessage() for r in caplog.records]
    # The registered dropdown still works as before.
    with pytest.raises(HTTPException):
        ensure_option_allowed(u, KEY, "purpose", "customer_order")


def test_stale_stored_values_fail_closed_not_open(db):
    u = _user(db, "stale@premnathrail.com")
    _give(db, u, _role(db, "Stale", {KEY: {"options": {"purpose": ["retired_purpose"]}}}))
    assert visibility.allowed_values(u, KEY, "purpose") == set()  # nothing allowed, not "no restriction"
    assert effective(u) == {KEY: {"options": {"purpose": []}}}
    with pytest.raises(HTTPException) as e:
        ensure_option_allowed(u, KEY, "purpose", "stock")
    assert e.value.status_code == 422
    assert e.value.detail == ("Your role's Purpose visibility points at values that no longer exist — ask an admin to open the "
                              "role and save its Visibility again.")
    with pytest.raises(HTTPException) as e:
        visibility.ensure_option_given(u, KEY, "purpose", None)
    assert "no longer exist" in e.value.detail
    # a second role that offers every value still lifts it (union)
    _give(db, u, _role(db, "Stale 2", {KEY: {"options": {"purpose": ["retired_purpose"]}}}), _role(db, "Plain stale", {}))
    assert visibility.allowed_values(u, KEY, "purpose") is None


# ---------- PR routes ----------

def test_meta_lists_every_purpose_and_flags_the_allowed_ones(client, db):
    req = _requester(db, "vis.meta@premnathrail.com")
    rows = _purposes(client, req)
    assert len(rows) == 6 and all(p["allowed"] is True for p in rows)  # no rule: all six allowed
    keeper = _role(db, "Store Keeper", {KEY: {"options": {"purpose": ["stock"]}}})
    _give(db, req, keeper)
    rows = _purposes(client, req)
    assert [p["code"] for p in rows if p["allowed"]] == ["stock"]
    assert len(rows) == 6  # the rest is still listed (an old requisition keeps its own purpose), flagged not allowed
    assert all({"code", "label", "allowed", "categories", "default_category", "item_types"} <= set(p) for p in rows)
    # union with a role that opens the tab without a Purpose rule
    _give(db, req, keeper, _role(db, "Wide", {}))
    assert all(p["allowed"] for p in _purposes(client, req))


def test_create_refuses_a_purpose_or_priority_the_role_does_not_offer(client, db):
    req = _requester(db, "vis.create@premnathrail.com")
    _give(db, req, _role(db, "Stock only", {KEY: {"options": {"purpose": ["stock"], "priority": ["standard"]}}}))
    set_pr_workflow(db, [_user(db, "vis.approver@premnathrail.com").id], req)

    r = client.post(PR_BASE, json=link_items(db, _create_payload(purpose="customer_order")), headers=auth_header(req))
    assert r.status_code == 422
    assert "Purpose 'Project' isn't available to your role" in r.json()["detail"]
    assert "Store stock refill" in r.json()["detail"] and "Visibility" in r.json()["detail"]

    r = client.post(PR_BASE, json=link_items(db, _create_payload(purpose="stock", priority="urgent")), headers=auth_header(req))
    assert r.status_code == 422
    assert "Priority 'Urgent' isn't available to your role" in r.json()["detail"]


def test_create_without_rule_is_unchanged(client, db):
    req = _requester(db, "vis.free@premnathrail.com")
    _create_pr(client, req, purpose="customer_order", priority="urgent")  # asserts 200


def test_edit_checks_only_a_changed_value(client, db):
    req = _requester(db, "vis.edit@premnathrail.com")
    pr = _create_pr(client, req, purpose="customer_order")
    # The role is narrowed AFTER the requisition was raised with a now-disallowed purpose.
    _give(db, req, _role(db, "Narrowed", {KEY: {"options": {"purpose": ["stock"]}}}))
    body = link_items(db, _create_payload(purpose="customer_order"))
    r = client.put(f"{PR_BASE}/{pr['id']}", json=body, headers=auth_header(req))
    assert r.status_code != 422, r.text  # unchanged purpose is not refused by Visibility
    body = link_items(db, _create_payload(purpose="capital"))
    r = client.put(f"{PR_BASE}/{pr['id']}", json=body, headers=auth_header(req))
    assert r.status_code == 422 and "Purpose 'Asset / capital purchase' isn't available to your role" in r.json()["detail"]


# ---------- role routes + /auth/me ----------

def test_roles_catalog_and_role_routes_carry_visibility(client, db):
    admin = _user(db, "vis.admin@premnathrail.com")
    admin.role = "admin"
    db.commit()
    h = auth_header(admin)

    cat = client.get(f"{ROLES_API}/catalog", headers=h).json()
    assert KEY in cat["visibility"]
    assert set(cat["visibility"][KEY]) == {"label", "screens", "sections", "options", "tables"}

    rule = {KEY: {"hidden_sections": ["remarks"], "options": {"purpose": ["stock"]}}}
    r = client.post(ROLES_API, json={"name": "Vis Role", "permissions": VIEW, "visibility_rules": rule}, headers=h)
    assert r.status_code == 200, r.text
    role_id = r.json()["id"]
    assert r.json()["visibility_rules"] == rule

    # PATCH with visibility_rules omitted leaves it unchanged
    r = client.patch(f"{ROLES_API}/{role_id}", json={"name": "Vis Role", "permissions": VIEW}, headers=h)
    assert r.status_code == 200 and r.json()["visibility_rules"] == rule

    # a locked section / empty dropdown is refused with the real reason
    r = client.patch(f"{ROLES_API}/{role_id}", json={"name": "Vis Role", "permissions": VIEW, "visibility_rules": {
        KEY: {"hidden_sections": ["purpose_charging"]}}}, headers=h)
    assert r.status_code == 422 and "holds a required field" in r.json()["detail"]
    r = client.patch(f"{ROLES_API}/{role_id}", json={"name": "Vis Role", "permissions": VIEW, "visibility_rules": {
        KEY: {"options": {"purpose": []}}}}, headers=h)
    assert r.status_code == 422 and "Pick at least one Purpose value" in r.json()["detail"]

    # copy keeps the rule; an explicit {} clears it
    r = client.post(f"{ROLES_API}/{role_id}/copy", json={"name": "Vis Role copy"}, headers=h)
    assert r.status_code == 200 and r.json()["visibility_rules"] == rule
    r = client.patch(f"{ROLES_API}/{role_id}", json={"name": "Vis Role", "permissions": VIEW, "visibility_rules": {}}, headers=h)
    assert r.status_code == 200 and r.json()["visibility_rules"] == {}


def test_roles_catalog_is_gated(client, db):
    nobody = _user(db, "vis.nobody@premnathrail.com")
    assert client.get(f"{ROLES_API}/catalog", headers=auth_header(nobody)).status_code == 403


def test_auth_me_carries_only_effective_restrictions(client, db):
    u = _user(db, "vis.me@premnathrail.com")
    assert client.get("/api/v1/auth/me", headers=auth_header(u)).json()["visibility"] == {}
    _give(db, u, _role(db, "Me", {KEY: {"hidden_sections": ["remarks"], "options": {"purpose": ["stock", "capital"]},
                                          "hidden_columns": {"form_items": ["ship_to", "make"]}}}))
    assert client.get("/api/v1/auth/me", headers=auth_header(u)).json()["visibility"] == {KEY: {
        "hidden_sections": ["remarks"], "options": {"purpose": ["capital", "stock"]},
        "hidden_columns": {"form_items": ["make", "ship_to"]}}}


# ---------- end to end: Store Keeper (Purpose = Store stock refill only) ----------

def test_store_keeper_end_to_end_meta_refusal_and_allowed_purpose(client, db):
    req = _requester(db, "vis.keeper.e2e@premnathrail.com")
    _give(db, req, _role(db, "Store Keeper e2e", {KEY: {"options": {"purpose": ["stock"]}}}))
    set_pr_workflow(db, [_user(db, "vis.keeper.approver@premnathrail.com").id], req)
    h = auth_header(req)

    purposes = client.get(f"{PR_BASE}/meta", headers=h).json()["purposes"]
    assert [p["code"] for p in purposes if p["allowed"]] == ["stock"]
    assert {p["label"] for p in purposes if p["allowed"]} == {"Store stock refill"}

    r = client.post(PR_BASE, json=link_items(db, _create_payload(purpose="customer_order")), headers=h)
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "Store stock refill" in detail and "Role & Permissions" in detail and "Ask an admin" in detail

    # The one allowed purpose is not refused by Visibility (any later business rule would be a different message).
    r = client.post(PR_BASE, json=link_items(db, _create_payload(purpose="stock")), headers=h)
    assert "isn't available to your role" not in r.text, r.text
    assert r.status_code == 200, r.text
    assert r.json()["purpose"] == "stock"


# ---------- union: which roles count ----------

def test_second_role_that_does_not_open_the_tab_keeps_the_restriction(client, db):
    req = _requester(db, "vis.noview@premnathrail.com")
    keeper = _role(db, "Keeper noview", {KEY: {"options": {"purpose": ["stock"]}}})
    # No Purchase Requisitions view grant and no rule: it is not "a role that opens the tab".
    elsewhere = _role(db, "Elsewhere", {}, permissions=("store:items:view",))
    _give(db, req, keeper, elsewhere)
    assert effective(req) == {KEY: {"options": {"purpose": ["stock"]}}}
    assert _allowed_codes(client, req) == ["stock"]


def test_an_inactive_wide_role_does_not_lift_the_restriction(db):
    u = _user(db, "vis.inactive@premnathrail.com")
    keeper = _role(db, "Keeper inactive", {KEY: {"options": {"purpose": ["stock"]}}})
    wide = _role(db, "Wide inactive", {}, is_active=False)
    _give(db, u, keeper, wide)
    assert visibility.allowed_values(u, KEY, "purpose") == {"stock"}
    wide.is_active = True
    db.commit()
    _give(db, u, keeper, wide)
    assert visibility.allowed_values(u, KEY, "purpose") is None


def test_second_role_with_no_rule_lets_the_member_raise_any_purpose(client, db):
    req = _requester(db, "vis.wide.create@premnathrail.com")
    _give(db, req, _role(db, "Keeper wide", {KEY: {"options": {"purpose": ["stock"]}}}), _role(db, "Plain wide", {}))
    r = client.post(PR_BASE, json=link_items(db, _create_payload(purpose="customer_order")), headers=auth_header(req))
    assert "isn't available to your role" not in r.text, r.text


# ---------- editing an existing requisition ----------

def test_edit_with_unrelated_change_succeeds_and_changed_purpose_is_refused(client, db):
    req = _requester(db, "vis.edit2@premnathrail.com")
    pr = _create_pr(client, req, purpose="customer_order")
    _give(db, req, _role(db, "Narrowed 2", {KEY: {"options": {"purpose": ["stock"]}}}))
    h = auth_header(req)

    body = link_items(db, _create_payload(purpose="customer_order", project_label="Project Beta"))
    r = client.put(f"{PR_BASE}/{pr['id']}", json=body, headers=h)
    assert "isn't available to your role" not in r.text, r.text
    assert r.status_code == 200, r.text
    assert r.json()["project_label"] == "Project Beta"

    r = client.put(f"{PR_BASE}/{pr['id']}", json=link_items(db, _create_payload(purpose="development")), headers=h)
    assert r.status_code == 422
    assert "Purpose 'New development' isn't available to your role" in r.json()["detail"]
    assert "Store stock refill" in r.json()["detail"]


# ---------- role routes ----------

def _admin_headers(db, email):
    admin = _user(db, email)
    admin.role = "admin"
    db.commit()
    return auth_header(admin)


def _new_role(client, h, name, rules=None):
    body = {"name": name, "permissions": VIEW}
    if rules is not None:
        body["visibility_rules"] = rules
    r = client.post(ROLES_API, json=body, headers=h)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _patch_rules(client, h, role_id, name, rules):
    return client.patch(f"{ROLES_API}/{role_id}", json={"name": name, "permissions": VIEW, "visibility_rules": rules}, headers=h)


def test_role_save_refuses_hiding_a_locked_section_and_names_it(client, db):
    h = _admin_headers(db, "vis.admin.locked@premnathrail.com")
    role_id = _new_role(client, h, "Locked test")
    for section, label in (("purpose_charging", "Purpose & Charging"), ("item_details", "Item Details")):
        r = _patch_rules(client, h, role_id, "Locked test", {KEY: {"hidden_sections": ["remarks", section]}})
        assert r.status_code == 422, r.text
        assert label in r.json()["detail"] and "can't be hidden" in r.json()["detail"]
    # nothing was saved by the refused attempts
    assert client.get(f"{ROLES_API}/{role_id}", headers=h).json()["visibility_rules"] == {}
    # the same via create
    r = client.post(ROLES_API, json={"name": "Locked on create", "permissions": VIEW,
                                     "visibility_rules": {KEY: {"hidden_sections": ["purpose_charging"]}}}, headers=h)
    assert r.status_code == 422 and "Purpose & Charging" in r.json()["detail"]


def test_role_save_refuses_an_empty_dropdown_and_unknown_names(client, db):
    h = _admin_headers(db, "vis.admin.bad@premnathrail.com")
    role_id = _new_role(client, h, "Bad rules")
    r = _patch_rules(client, h, role_id, "Bad rules", {KEY: {"options": {"purpose": []}}})
    assert r.status_code == 422 and "at least one" in r.json()["detail"]
    for rule in ({KEY: {"hidden_sections": ["no_such_section"]}},
                 {KEY: {"options": {"purpose": ["no_such_value"]}}},
                 {KEY: {"hidden_columns": {"requisitions": ["no_such_column"]}}}):
        r = _patch_rules(client, h, role_id, "Bad rules", rule)
        assert r.status_code == 422, rule
        assert "reload" in r.json()["detail"] and "catalogue" in r.json()["detail"], r.text
    assert client.get(f"{ROLES_API}/{role_id}", headers=h).json()["visibility_rules"] == {}


def test_valid_rule_round_trips_and_all_values_ticked_is_stored_as_no_restriction(client, db):
    from app.modules.p2p.models.p2p_request import P2P_PURPOSES

    h = _admin_headers(db, "vis.admin.rt@premnathrail.com")
    rule = {KEY: {"hidden_sections": ["attachments", "remarks"], "options": {"purpose": ["capital", "stock"]},
                  "hidden_columns": {"form_items": ["ship_to"], "requisitions": ["priority"]}}}
    role_id = _new_role(client, h, "Round trip")
    r = _patch_rules(client, h, role_id, "Round trip", rule)
    assert r.status_code == 200 and r.json()["visibility_rules"] == rule
    assert client.get(f"{ROLES_API}/{role_id}", headers=h).json()["visibility_rules"] == rule
    listed = {x["id"]: x for x in client.get(ROLES_API, headers=h).json()}
    assert listed[role_id]["visibility_rules"] == rule
    db.expire_all()
    assert db.get(Role, role_id).visibility_rules == rule  # stored as the cleaned override

    # every Purpose value ticked = no restriction = nothing stored
    r = _patch_rules(client, h, role_id, "Round trip", {KEY: {"options": {"purpose": list(P2P_PURPOSES)}}})
    assert r.status_code == 200 and r.json()["visibility_rules"] == {}
    db.expire_all()
    assert db.get(Role, role_id).visibility_rules == {}


def test_role_without_edit_cannot_save_visibility(client, db):
    nobody = _user(db, "vis.noedit@premnathrail.com")
    r = client.post(ROLES_API, json={"name": "Nope", "permissions": VIEW,
                                     "visibility_rules": {KEY: {"hidden_sections": ["remarks"]}}}, headers=auth_header(nobody))
    assert r.status_code == 403 and r.json()["detail"]


def test_saved_role_rule_takes_effect_for_its_member(client, db):
    h = _admin_headers(db, "vis.admin.live@premnathrail.com")
    role_id = _new_role(client, h, "Live rule", {KEY: {"options": {"purpose": ["stock"]}}})
    member = _requester(db, "vis.member.live@premnathrail.com")
    _give(db, member, db.get(Role, role_id))
    assert _allowed_codes(client, member) == ["stock"]
    # the admin widens it; the member sees every purpose on the next load
    assert _patch_rules(client, h, role_id, "Live rule", {}).status_code == 200
    db.expire_all()
    member = db.get(User, member.id)
    assert len(_allowed_codes(client, member)) == 6


# ---------- /auth/me ----------

def test_auth_me_visibility_is_empty_for_admin_and_partner(client, db):
    rules = {KEY: {"hidden_sections": ["remarks"], "options": {"purpose": ["stock"]}}}
    role = _role(db, "Restricted me", rules)
    admin = _user(db, "vis.me.admin@premnathrail.com")
    admin.role = "admin"
    partner = _user(db, "vis.me.partner@premnathrail.com", is_partner=True)
    _give(db, admin, role)
    _give(db, partner, role)
    for u in (admin, partner):
        r = client.get("/api/v1/auth/me", headers=auth_header(u))
        assert r.status_code == 200 and r.json()["visibility"] == {}, u.email


def test_auth_me_lists_only_keys_with_an_effective_restriction(client, db):
    u = _user(db, "vis.me.partial@premnathrail.com")
    # A rule that restricts nothing once the union is taken (second role has no rule) leaves visibility empty.
    _give(db, u, _role(db, "Narrow me", {KEY: {"hidden_sections": ["remarks"]}}), _role(db, "Plain me", {}))
    assert client.get("/api/v1/auth/me", headers=auth_header(u)).json()["visibility"] == {}
    # A role that does not open the tab contributes nothing.
    u2 = _user(db, "vis.me.noview@premnathrail.com")
    _give(db, u2, _role(db, "No view me", {KEY: {"hidden_sections": ["remarks"]}}, permissions=("store:items:view",)))
    assert client.get("/api/v1/auth/me", headers=auth_header(u2)).json()["visibility"] == {}


# ---------- /roles/catalog ----------

def test_roles_catalog_describes_the_requisition_screen(client, db):
    h = _admin_headers(db, "vis.admin.cat@premnathrail.com")
    entry = client.get(f"{ROLES_API}/catalog", headers=h).json()["visibility"][KEY]
    assert set(entry["tables"]) == {"requisitions", "form_items", "detail_lines"}
    assert {"category", "project", "required_by", "priority"} <= set(entry["tables"]["requisitions"]["columns"])
    assert {"make", "part_code", "uom", "in_stock", "ship_to"} <= set(entry["tables"]["form_items"]["columns"])
    assert set(entry["options"]) == {"purpose", "priority"}
    assert len(entry["options"]["purpose"]["values"]) == 6
    assert set(entry["options"]["priority"]["values"]) == {"standard", "urgent"}
    assert entry["sections"]["purpose_charging"]["locked"] is True
    assert entry["sections"]["item_details"]["locked"] is True
    assert {"request_details", "remarks", "attachments"} <= set(entry["sections"])
    assert all(not entry["sections"][s]["locked"] for s in ("request_details", "remarks", "attachments"))


# ---------- review fixes ----------

def _restricted_requester(db, email, rules=None):
    req = _requester(db, email)
    _give(db, req, _role(db, f"Keeper {email}", rules or {KEY: {"options": {"purpose": ["stock"]}}}))
    set_pr_workflow(db, [_user(db, f"appr.{email}").id], req)
    return req


def test_post_without_purpose_is_refused_for_a_restricted_role_but_a_draft_is_not(client, db):
    req = _restricted_requester(db, "vis.nopurpose@premnathrail.com")
    h = auth_header(req)
    r = client.post(PR_BASE, json=link_items(db, _create_payload()), headers=h)  # no purpose at all
    assert r.status_code == 422
    assert r.json()["detail"] == "Pick a Purpose — your role allows: Store stock refill."
    r = client.post(PR_BASE, json=link_items(db, _create_payload(purpose="")), headers=h)
    assert r.status_code == 422 and r.json()["detail"].startswith("Pick a Purpose")
    r = client.post(PR_BASE, json=link_items(db, _create_payload(save_as_draft=True)), headers=h)
    assert r.status_code == 200, r.text  # a draft may be saved without; it cannot be submitted that way
    draft = r.json()
    r = client.put(f"{PR_BASE}/{draft['id']}", json=link_items(db, _create_payload()), headers=h)  # draft -> submit, no purpose
    assert r.status_code == 422 and r.json()["detail"].startswith("Pick a Purpose")
    r = client.put(f"{PR_BASE}/{draft['id']}", json=link_items(db, _create_payload(purpose="stock")), headers=h)
    assert r.status_code == 200, r.text


def test_post_without_purpose_is_unchanged_for_an_unrestricted_member(client, db):
    req = _requester(db, "vis.nopurpose.free@premnathrail.com")
    set_pr_workflow(db, [_user(db, "appr.nopurpose.free@premnathrail.com").id], req)
    r = client.post(PR_BASE, json=link_items(db, _create_payload()), headers=auth_header(req))
    assert r.status_code == 200, r.text


def test_edit_cannot_blank_the_purpose_of_a_requisition_that_has_one(client, db):
    req = _requester(db, "vis.blank@premnathrail.com")
    pr = _create_pr(client, req, purpose="stock")
    _give(db, req, _role(db, "Blank test", {KEY: {"options": {"purpose": ["stock"]}}}))
    r = client.put(f"{PR_BASE}/{pr['id']}", json=link_items(db, _create_payload()), headers=auth_header(req))
    assert r.status_code == 422 and r.json()["detail"].startswith("Pick a Purpose")


def test_import_is_refused_for_a_purpose_restricted_role(client, db):
    req = _requester(db, "vis.import@premnathrail.com")
    _give(db, req, _role(db, "Import keeper", {KEY: {"options": {"purpose": ["stock"]}}}))
    csv = b"PR Ref,Category Code,Project Type,Project\nA,RAW,existing,P\n"
    r = client.post(f"{PR_BASE}/import", files={"file": ("pr.csv", csv, "text/csv")}, headers=auth_header(req))
    assert r.status_code == 422, r.text
    assert r.json()["detail"].startswith("Your role limits the Purpose of requisitions, and the import file has no Purpose column")
    assert "ask an admin to widen Purpose for your role" in r.json()["detail"]


def test_import_still_reaches_row_checks_for_an_unrestricted_member(client, db):
    req = _requester(db, "vis.import.free@premnathrail.com")
    csv = b"PR Ref,Category Code,Project Type,Project\nA,RAW,existing,P\n"
    r = client.post(f"{PR_BASE}/import", files={"file": ("pr.csv", csv, "text/csv")}, headers=auth_header(req))
    assert r.status_code != 422 or "limits the Purpose" not in r.text


def test_priority_urgent_only_role_refuses_the_default_priority(client, db):
    req = _restricted_requester(db, "vis.urgent@premnathrail.com",
                                {KEY: {"options": {"priority": ["urgent"], "purpose": ["stock"]}}})
    h = auth_header(req)
    # The form now preselects an allowed value; a body that leaves the default 'standard' is refused.
    r = client.post(PR_BASE, json=link_items(db, _create_payload(purpose="stock")), headers=h)
    assert r.status_code == 422 and "Priority 'Standard' isn't available to your role" in r.json()["detail"]
    r = client.post(PR_BASE, json=link_items(db, _create_payload(purpose="stock", priority="urgent")), headers=h)
    assert r.status_code == 200, r.text


def test_purchase_desk_patch_checks_only_a_changed_priority(client, db):
    from app.tests.test_p2p_requests import _purchaser

    req = _requester(db, "vis.patch.req@premnathrail.com")
    pr = _create_pr(client, req)  # priority standard
    pr_urgent = _create_pr(client, req, priority="urgent")
    desk = _purchaser(db, "vis.patch.desk@premnathrail.com")
    _give(db, desk, _role(db, "Desk standard only", {KEY: {"options": {"priority": ["standard"]}}},
                          permissions=(*VIEW, "p2p:purchase_requisitions:edit")))
    h = auth_header(desk)

    r = client.patch(f"{PR_BASE}/{pr['id']}", json={"priority": "urgent"}, headers=h)
    assert r.status_code == 422 and "Priority 'Urgent' isn't available to your role" in r.json()["detail"], r.text
    r = client.patch(f"{PR_BASE}/{pr['id']}", json={"priority": "standard", "remarks": "unchanged priority"}, headers=h)
    assert r.status_code == 200, r.text
    # an old requisition that already holds a now-disallowed priority stays editable
    r = client.patch(f"{PR_BASE}/{pr_urgent['id']}", json={"priority": "urgent", "remarks": "still urgent"}, headers=h)
    assert r.status_code == 200, r.text
    r = client.patch(f"{PR_BASE}/{pr_urgent['id']}", json={"remarks": "no priority sent"}, headers=h)
    assert r.status_code == 200, r.text


def _manager(db, email):
    """A non-admin who may edit roles and holds the Purchase Requisitions grants."""
    mgr = _user(db, email)
    role = _role(db, f"Role manager {email}", permissions=("organization:roles:view", "organization:roles:create",
                                                          "organization:roles:edit", *VIEW))
    _give(db, mgr, role)
    return mgr, role


def _patch_role(client, h, role, rules, **extra):
    return client.patch(f"{ROLES_API}/{role.id}", json={
        "name": role.name, "permissions": list(role.permissions), "visibility_rules": rules, **extra}, headers=h)


def test_non_admin_cannot_change_visibility_of_a_role_they_hold_or_a_default_role(client, db):
    mgr, own = _manager(db, "vis.mgr@premnathrail.com")
    h = auth_header(mgr)
    msg = "You can't change the visibility of a role you hold yourself or of a role that applies to everyone — ask an admin."
    narrow = {KEY: {"options": {"purpose": ["stock"]}}}

    r = _patch_role(client, h, own, narrow)
    assert r.status_code == 403 and r.json()["detail"] == msg
    db.expire_all()
    assert db.get(Role, own.id).visibility_rules == {}

    everyone = _role(db, "Everyone default", {}, is_default=True)
    r = _patch_role(client, h, everyone, narrow)
    assert r.status_code == 403 and r.json()["detail"] == msg

    r = client.post(ROLES_API, json={"name": "New default", "permissions": VIEW, "is_default": True,
                                     "visibility_rules": narrow}, headers=h)
    assert r.status_code == 403 and r.json()["detail"] == msg

    # another role they do not hold, not applying to everyone: allowed
    other = _role(db, "Other role", {})
    r = _patch_role(client, h, other, narrow)
    assert r.status_code == 200, r.text
    r = client.post(ROLES_API, json={"name": "Plain new", "permissions": VIEW, "visibility_rules": narrow}, headers=h)
    assert r.status_code == 200, r.text
    r = client.post(f"{ROLES_API}/{other.id}/copy", json={"name": "Other copy"}, headers=h)
    assert r.status_code == 200, r.text


def test_non_admin_may_resave_their_own_role_with_unchanged_visibility(client, db):
    mgr, own = _manager(db, "vis.mgr.same@premnathrail.com")
    narrow = {KEY: {"options": {"purpose": ["stock"]}}}
    own.visibility_rules = narrow
    db.commit()
    r = _patch_role(client, auth_header(mgr), own, narrow)  # the editor sends everything back unchanged
    assert r.status_code == 200, r.text
    r = _patch_role(client, auth_header(mgr), own, {})  # clearing = loosening: refused
    assert r.status_code == 403


def test_admin_may_change_visibility_of_any_role(client, db):
    h = _admin_headers(db, "vis.admin.any@premnathrail.com")
    everyone = _role(db, "Everyone admin", {}, is_default=True)
    assert _patch_role(client, h, everyone, {KEY: {"options": {"purpose": ["stock"]}}}).status_code == 200


def test_role_create_and_copy_audit_carry_visibility_and_assign_rules(client, db):
    from app.modules.main.models.audit_log import AuditLog

    h = _admin_headers(db, "vis.admin.audit@premnathrail.com")
    rule = {KEY: {"hidden_sections": ["remarks"]}}
    role_id = _new_role(client, h, "Audited", rule)
    client.post(f"{ROLES_API}/{role_id}/copy", json={"name": "Audited copy"}, headers=h)
    created = db.query(AuditLog).filter(AuditLog.entity_type == "role", AuditLog.action == "created").all()
    assert len(created) == 2
    for entry in created:
        assert '"visibility_rules"' in entry.new_value and '"assignee_rules"' in entry.new_value
        assert "remarks" in entry.new_value


# ---------- screens (spec v2) ----------

def test_pr_catalogue_has_three_screens_and_every_item_names_one():
    cat = visibility.catalog()[KEY]
    assert cat["screens"] == {"form": "New Requisition form", "detail": "Requisition page", "list": "Requisitions list"}
    for group in ("sections", "options", "tables"):
        for name, item in cat[group].items():
            assert item["screen"] in cat["screens"], (group, name)
    assert cat["sections"]["remarks"]["screen"] == "form"
    assert cat["options"]["purpose"]["screen"] == "form" and cat["options"]["priority"]["screen"] == "form"
    assert cat["tables"]["form_items"]["screen"] == "form" and cat["tables"]["requisitions"]["screen"] == "list"
    detail_sections = {k for k, v in cat["sections"].items() if v["screen"] == "detail"}
    assert {"detail_header", "detail_lines", "detail_purchase_order", "detail_attachments", "detail_history",
            "detail_approval_flow", "detail_tracker"} <= detail_sections
    # what is needed to understand / act on the requisition can't be hidden
    assert cat["sections"]["detail_header"]["locked"] and cat["sections"]["detail_lines"]["locked"]
    assert not cat["sections"]["detail_purchase_order"]["locked"]
    assert cat["tables"]["detail_lines"]["screen"] == "detail"
    assert set(cat["tables"]["detail_lines"]["columns"]) == {"make", "part_code", "uom", "in_stock", "ship_to", "buyer"}


def test_every_entry_has_screens_and_every_item_names_one_of_them():
    # Modules declare their own screens (form / page / list); an entry without screens gets one
    # default screen named like the entry. Either way every item must point at a declared screen.
    for key, entry in visibility.catalog().items():
        assert entry["screens"], key
        if list(entry["screens"]) == ["main"]:
            assert entry["screens"] == {"main": entry["label"]}, key
        for group in ("sections", "options", "tables"):
            assert all(item["screen"] in entry["screens"] for item in entry[group].values()), key


def test_register_visibility_refuses_an_unknown_screen_and_accepts_the_old_form():
    from app.core.visibility import register_visibility

    key = "p2p:vendors"
    before = VISIBILITY.get(key)
    try:
        with pytest.raises(AssertionError, match="unknown screen 'nope'"):
            register_visibility("p2p", "vendors", label="X", screens=(("a", "A"),),
                                sections=(("s", "S", "hint", False, "nope"),))
        with pytest.raises(AssertionError, match="unknown screen 'x'"):
            register_visibility("p2p", "vendors", label="X", tables=(("t", "T", {"c": "C"}, "x"),))
        with pytest.raises(AssertionError, match="unknown screen"):
            register_visibility("p2p", "vendors", label="X", screens=(("a", "A"),),
                                options=(("o", "O", {"v": "V"}, "hint", "b"),))
        assert VISIBILITY.get(key) == before  # nothing half-registered
        # the pre-screens call shape keeps working
        register_visibility("p2p", "vendors", label="Vendors list", sections=(("s", "S", "hint", False),),
                            options=(("o", "O", {"v": "V"}, "hint"),), tables=(("t", "T", {"c": "C"}),))
        entry = VISIBILITY[key]
        assert entry["screens"] == {"main": "Vendors list"} and entry["sections"]["s"]["screen"] == "main"
        # two screens: the first is the default
        register_visibility("p2p", "vendors", label="V", screens=(("one", "One"), ("two", "Two")),
                            sections=(("s", "S", "hint", False), ("s2", "S2", "hint", False, "two")))
        assert VISIBILITY[key]["sections"]["s"]["screen"] == "one" and VISIBILITY[key]["sections"]["s2"]["screen"] == "two"
    finally:
        if before is None:
            VISIBILITY.pop(key, None)
        else:
            VISIBILITY[key] = before


def test_rules_on_detail_items_are_stored_unchanged_and_resolved(db):
    rule = {KEY: {"hidden_sections": ["detail_history", "detail_tracker"], "hidden_columns": {"detail_lines": ["buyer", "make"]}}}
    assert clean_rules(rule) == {KEY: {"hidden_sections": ["detail_history", "detail_tracker"],
                                       "hidden_columns": {"detail_lines": ["buyer", "make"]}}}
    with pytest.raises(ValueError, match="holds a required field"):
        clean_rules({KEY: {"hidden_sections": ["detail_lines"]}})
    with pytest.raises(ValueError, match="holds a required field"):
        clean_rules({KEY: {"hidden_sections": ["detail_header"]}})
    u = _user(db, "detail@premnathrail.com")
    _give(db, u, _role(db, "Detail", rule))
    assert effective(u)[KEY]["hidden_sections"] == ["detail_history", "detail_tracker"]
    assert visibility.section_hidden(u, KEY, "detail_history") and not visibility.section_hidden(u, KEY, "detail_purchase_order")
