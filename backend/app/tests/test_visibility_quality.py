"""Role-wise UI visibility in Quality (core/visibility.py, catalogue in
core/features/quality.py): NCR, Inspection Lots, Inspection Calls, CAPA and
Customer Complaints — form / page / list screens. Coded dropdown values
(NCR severity, manual lot type, CAPA type + severity, complaint source +
severity) are enforced by the server; the meta endpoints list every value
with `allowed` so the form can filter and still show a saved record's value."""
import pytest

from app.auth.jwt_handler import create_access_token
from app.core import visibility
from app.core.permission_registry import MODULES
from app.core.visibility import VISIBILITY, clean_rules
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.quality.models.capa import QUALITY_CAPA_ACTION_TYPES
from app.modules.quality.models.customer_complaint import QUALITY_COMPLAINT_SEVERITIES, QUALITY_COMPLAINT_SOURCE_LABELS
from app.modules.quality.models.inspection_plan import QUALITY_INSPECTION_TYPE_LABELS
from app.modules.quality.models.ncr import QUALITY_NCR_SEVERITIES
from app.modules.store.models.item import StoreItem

NCR_KEY = "quality:ncr"
LOTS_KEY = "quality:inspection_lots"
CALLS_KEY = "quality:inspection_calls"
CAPA_KEY = "quality:capa"
COMPLAINTS_KEY = "quality:complaints"
ALL_KEYS = (NCR_KEY, LOTS_KEY, CALLS_KEY, CAPA_KEY, COMPLAINTS_KEY)
# A Quality engineer: raises NCRs / lots / CAPAs / complaints and edits them.
QUALITY_GRANTS = ["quality:ncr:view", "quality:ncr:create", "quality:ncr:edit",
                  "quality:inspection_lots:view", "quality:inspection_lots:create", "quality:inspection_lots:edit",
                  "quality:inspection_calls:view", "quality:inspection_calls:create", "quality:inspection_calls:edit",
                  "quality:capa:view", "quality:capa:create", "quality:capa:edit",
                  "quality:complaints:view", "quality:complaints:create", "quality:complaints:edit"]
BASE = "/api/v1/quality"


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _user(db, email, **kw):
    u = User(email=email, name=email.split("@")[0].title(), role="user", is_active=True, assigned_apps=["quality"],
             granular_permissions=[], **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _role(db, name, rules=None, permissions=tuple(QUALITY_GRANTS)):
    r = Role(name=name, permissions=list(permissions), visibility_rules=rules or {})
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def _give(db, user, *roles):
    user.roles = list(roles)
    db.commit()
    db.refresh(user)
    user.__dict__.pop("_visibility_effective_cache", None)


@pytest.fixture
def item(db):
    i = StoreItem(item_code="0101", item_name="Hydraulic hose", uom="NOS", item_type="material", standard_cost=120)
    db.add(i)
    db.commit()
    db.refresh(i)
    return i


@pytest.fixture
def minor_only(db):
    """A Quality engineer whose role allows only Minor NCRs / CAPAs / complaints raised
    by email, corrective CAPAs and stock re-inspection lots."""
    u = _user(db, "vis.qminor@premnathrail.com")
    _give(db, u, _role(db, "Minor-only engineer", {
        NCR_KEY: {"options": {"severity": ["minor"]}, "hidden_sections": ["stock"]},
        LOTS_KEY: {"options": {"inspection_type": ["stock_reinspection"]}},
        CAPA_KEY: {"options": {"action_type": ["corrective"], "severity": ["minor"]}},
        COMPLAINTS_KEY: {"options": {"source": ["email"], "severity": ["minor"]}},
    }))
    return u


@pytest.fixture
def open_engineer(db):
    """A Quality engineer whose role sets no visibility rule at all."""
    u = _user(db, "vis.qopen@premnathrail.com")
    _give(db, u, _role(db, "Open engineer"))
    return u


def _ncr(**over):
    return {"source": "internal", "severity": "minor", "item_name": "Loose bolt", "description": "Bolt found loose on the frame.", **over}


def _capa(**over):
    return {"title": "Weld cracks on the frame", "action_type": "corrective", "severity": "minor", **over}


def _complaint(**over):
    return {"source": "email", "severity": "minor", "customer_name": "Sample Railways", "description": "Hose leaked on site.", **over}


def _lot(item, **over):
    return {"inspection_type": "stock_reinspection", "item_id": item.id, "quantity": 5, "take_from_free": False, **over}


# ---------- catalogue ----------

def test_quality_catalogue_keys_resolve_to_tabs():
    for key in ALL_KEYS:
        assert key in VISIBILITY, key
        module, tab = key.split(":", 1)
        assert tab in MODULES[module]["actions"], key


def test_quality_catalogue_matches_the_coded_values():
    cat = visibility.catalog()
    assert list(cat[NCR_KEY]["options"]["severity"]["values"]) == list(QUALITY_NCR_SEVERITIES)
    assert list(cat[CAPA_KEY]["options"]["action_type"]["values"]) == list(QUALITY_CAPA_ACTION_TYPES)
    assert list(cat[CAPA_KEY]["options"]["severity"]["values"]) == list(QUALITY_NCR_SEVERITIES)
    assert cat[COMPLAINTS_KEY]["options"]["source"]["values"] == QUALITY_COMPLAINT_SOURCE_LABELS
    assert list(cat[COMPLAINTS_KEY]["options"]["severity"]["values"]) == list(QUALITY_COMPLAINT_SEVERITIES)
    # Manual lot types: the coded inspection types without the two the system raises itself.
    lot_types = cat[LOTS_KEY]["options"]["inspection_type"]["values"]
    assert set(lot_types) == set(QUALITY_INSPECTION_TYPE_LABELS) - {"incoming", "first_article"}
    assert all(lot_types[t] == QUALITY_INSPECTION_TYPE_LABELS[t] for t in lot_types)
    # Inspection calls offer no coded dropdown: the agency is a Settings master list (data).
    assert cat[CALLS_KEY]["options"] == {}


def test_quality_every_item_sits_on_a_declared_screen():
    for key in ALL_KEYS:
        entry = VISIBILITY[key]
        assert set(entry["screens"]) == {"form", "detail", "list"}, key
        for kind in ("sections", "options", "tables"):
            for code, spec in entry[kind].items():
                assert spec["screen"] in entry["screens"], (key, kind, code)
        assert all(code.startswith("detail_") for code, s in entry["sections"].items() if s["screen"] == "detail"), key
        assert all(s["screen"] == "list" for s in entry["tables"].values() if not s["label"].endswith("page")), key


def test_quality_required_holding_and_workflow_sections_are_locked():
    s = {k: VISIBILITY[k]["sections"] for k in ALL_KEYS}
    assert s[NCR_KEY]["non_conformance"]["locked"] and not s[NCR_KEY]["stock"]["locked"]
    assert s[NCR_KEY]["detail_disposition"]["locked"] and s[NCR_KEY]["detail_closure"]["locked"]
    assert not s[NCR_KEY]["detail_approval"]["locked"] and not s[NCR_KEY]["detail_origin"]["locked"]
    assert s[LOTS_KEY]["lot"]["locked"] and s[LOTS_KEY]["stock"]["locked"] and not s[LOTS_KEY]["remarks"]["locked"]
    assert s[LOTS_KEY]["detail_results"]["locked"] and s[LOTS_KEY]["detail_usage_decision"]["locked"]
    assert s[CALLS_KEY]["order"]["locked"] and s[CALLS_KEY]["material"]["locked"] and s[CALLS_KEY]["call"]["locked"]
    assert not s[CALLS_KEY]["remarks"]["locked"] and s[CALLS_KEY]["detail_result"]["locked"]
    assert s[CAPA_KEY]["problem"]["locked"] and not s[CAPA_KEY]["owner"]["locked"] and not s[CAPA_KEY]["linked_ncrs"]["locked"]
    assert s[CAPA_KEY]["detail_root_cause"]["locked"] and s[CAPA_KEY]["detail_actions"]["locked"]
    assert s[COMPLAINTS_KEY]["origin"]["locked"] and s[COMPLAINTS_KEY]["failure"]["locked"] and not s[COMPLAINTS_KEY]["photos"]["locked"]
    assert s[COMPLAINTS_KEY]["detail_response"]["locked"] and not s[COMPLAINTS_KEY]["detail_traceability"]["locked"]


def test_quality_tables_never_offer_number_status_or_money_columns():
    banned = {"number", "status", "value", "rate", "cost", "amount", "price", "total"}
    for key in ALL_KEYS:
        for table, spec in VISIBILITY[key]["tables"].items():
            for col in spec["columns"]:
                assert not (set(col.lower().split("_")) & banned), (key, table, col)
            assert "ncr_number" not in spec["columns"] and "lot_number" not in spec["columns"]


def test_clean_rules_accepts_quality_rules_and_refuses_locked_sections():
    out = clean_rules({NCR_KEY: {"options": {"severity": ["minor", "major"]}, "hidden_columns": {"ncrs": ["source"]}},
                       CAPA_KEY: {"hidden_sections": ["linked_ncrs"], "options": {"action_type": ["corrective"]}},
                       LOTS_KEY: {"hidden_sections": ["remarks"], "hidden_columns": {"detail_results": ["gauge"]}}})
    assert out == {NCR_KEY: {"options": {"severity": ["major", "minor"]}, "hidden_columns": {"ncrs": ["source"]}},
                   CAPA_KEY: {"hidden_sections": ["linked_ncrs"], "options": {"action_type": ["corrective"]}},
                   LOTS_KEY: {"hidden_sections": ["remarks"], "hidden_columns": {"detail_results": ["gauge"]}}}
    with pytest.raises(ValueError) as e:
        clean_rules({LOTS_KEY: {"hidden_sections": ["detail_results"]}})
    assert str(e.value) == "'Results' holds a required field, so it can't be hidden. Leave it visible."
    with pytest.raises(ValueError) as e:
        clean_rules({COMPLAINTS_KEY: {"hidden_sections": ["failure"]}})
    assert str(e.value) == "'What failed' holds a required field, so it can't be hidden. Leave it visible."


# ---------- NCR ----------

def test_ncr_create_refuses_a_severity_outside_the_role_with_the_real_reason(client, db, minor_only):
    r = client.post(f"{BASE}/ncr", json=_ncr(severity="critical"), headers=_h(minor_only))
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == (
        "Severity 'Critical' isn't available to your role — you can pick: Minor. Ask an admin to widen it in "
        f"Organization › Role & Permissions › Quality › {MODULES['quality']['subtabs']['ncr']} › Visibility.")


def test_ncr_create_and_edit_follow_the_rule(client, db, minor_only, open_engineer):
    r = client.post(f"{BASE}/ncr", json=_ncr(), headers=_h(minor_only))
    assert r.status_code == 200, r.text
    ncr_id = r.json()["id"]
    # Changing to a value the role doesn't offer is refused; touching other fields is not.
    r = client.patch(f"{BASE}/ncr/{ncr_id}", json={"severity": "major"}, headers=_h(minor_only))
    assert r.status_code == 422 and "Severity 'Major' isn't available to your role" in r.json()["detail"]
    r = client.patch(f"{BASE}/ncr/{ncr_id}", json={"remarks": "noted"}, headers=_h(minor_only))
    assert r.status_code == 200, r.text
    # An NCR another role made Major keeps its value when only remarks change.
    r = client.post(f"{BASE}/ncr", json=_ncr(severity="major"), headers=_h(open_engineer))
    assert r.status_code == 200, r.text
    major_id = r.json()["id"]
    r = client.patch(f"{BASE}/ncr/{major_id}", json={"remarks": "seen", "severity": "major"}, headers=_h(minor_only))
    assert r.status_code == 200, r.text


def test_ncr_meta_lists_every_severity_and_flags_the_allowed_ones(client, db, minor_only, open_engineer):
    r = client.get(f"{BASE}/ncr/meta", headers=_h(minor_only))
    assert r.status_code == 200, r.text
    assert r.json()["severities"] == list(QUALITY_NCR_SEVERITIES)  # the old key is untouched
    assert {o["value"]: o["allowed"] for o in r.json()["severity_options"]} == {"minor": True, "major": False, "critical": False}
    r = client.get(f"{BASE}/ncr/meta", headers=_h(open_engineer))
    assert all(o["allowed"] for o in r.json()["severity_options"])


# ---------- CAPA ----------

def test_capa_create_refuses_type_and_severity_outside_the_role(client, db, minor_only):
    r = client.post(f"{BASE}/capa", json=_capa(action_type="preventive"), headers=_h(minor_only))
    assert r.status_code == 422, r.text
    assert r.json()["detail"].startswith("Type 'Preventive' isn't available to your role — you can pick: Corrective.")
    r = client.post(f"{BASE}/capa", json=_capa(severity="major"), headers=_h(minor_only))
    assert r.status_code == 422 and r.json()["detail"].startswith("Severity 'Major' isn't available to your role — you can pick: Minor.")
    r = client.post(f"{BASE}/capa", json=_capa(), headers=_h(minor_only))
    assert r.status_code == 200, r.text
    capa_id = r.json()["id"]
    r = client.patch(f"{BASE}/capa/{capa_id}", json={"severity": "critical"}, headers=_h(minor_only))
    assert r.status_code == 422 and "Severity 'Critical' isn't available" in r.json()["detail"]
    r = client.patch(f"{BASE}/capa/{capa_id}", json={"title": "Weld cracks on the frame (rev)", "severity": "minor"}, headers=_h(minor_only))
    assert r.status_code == 200, r.text


def test_capa_meta_carries_allowed_flags(client, db, minor_only):
    r = client.get(f"{BASE}/capa/meta", headers=_h(minor_only))
    assert r.status_code == 200, r.text
    assert {o["value"]: o["allowed"] for o in r.json()["action_types"]} == {"corrective": True, "preventive": False}
    assert {o["value"]: o["allowed"] for o in r.json()["severity_options"]} == {"minor": True, "major": False, "critical": False}
    assert r.json()["triggers"]  # the keys the CAPA page already uses stay


# ---------- Customer complaints ----------

def test_complaint_create_refuses_source_and_severity_outside_the_role(client, db, minor_only):
    r = client.post(f"{BASE}/complaints", json=_complaint(source="phone"), headers=_h(minor_only))
    assert r.status_code == 422, r.text
    assert r.json()["detail"].startswith("Source 'Phone call' isn't available to your role — you can pick: Email / letter.")
    r = client.post(f"{BASE}/complaints", json=_complaint(severity="critical"), headers=_h(minor_only))
    assert r.status_code == 422 and r.json()["detail"].startswith("Severity 'Critical' isn't available to your role")
    r = client.post(f"{BASE}/complaints", json=_complaint(), headers=_h(minor_only))
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    r = client.patch(f"{BASE}/complaints/{cid}", json={"severity": "major"}, headers=_h(minor_only))
    assert r.status_code == 422 and "Severity 'Major' isn't available" in r.json()["detail"]
    r = client.patch(f"{BASE}/complaints/{cid}", json={"contact_person": "Mr Rao", "source": "email"}, headers=_h(minor_only))
    assert r.status_code == 200, r.text


def test_complaint_meta_carries_allowed_flags(client, db, minor_only):
    r = client.get(f"{BASE}/complaints/meta", headers=_h(minor_only))
    assert r.status_code == 200, r.text
    assert r.json()["sources"] == QUALITY_COMPLAINT_SOURCE_LABELS  # the old key is untouched
    flags = {o["value"]: o["allowed"] for o in r.json()["source_options"]}
    assert flags["email"] and not flags["phone"] and set(flags) == set(QUALITY_COMPLAINT_SOURCE_LABELS)
    assert {o["value"]: o["allowed"] for o in r.json()["severity_options"]} == {"minor": True, "major": False, "critical": False}


# ---------- Inspection lots ----------

def test_manual_lot_create_refuses_a_type_outside_the_role(client, db, item, minor_only, open_engineer):
    r = client.post(f"{BASE}/inspection-lots", json=_lot(item, inspection_type="final"), headers=_h(minor_only))
    assert r.status_code == 422, r.text
    assert r.json()["detail"].startswith("Inspection type 'Final (production)' isn't available to your role — you can pick: Stock re-inspection.")
    r = client.post(f"{BASE}/inspection-lots", json=_lot(item), headers=_h(minor_only))
    assert r.status_code == 200, r.text
    # The system's own refusals come first and are unchanged.
    r = client.post(f"{BASE}/inspection-lots", json=_lot(item, inspection_type="incoming"), headers=_h(open_engineer))
    assert r.status_code == 422 and "created automatically by the GRN" in r.json()["detail"]


def test_lots_meta_lists_manual_types_with_allowed_flags(client, db, minor_only, open_engineer):
    r = client.get(f"{BASE}/inspection-lots/meta", headers=_h(minor_only))
    assert r.status_code == 200, r.text
    flags = {o["value"]: o["allowed"] for o in r.json()["inspection_types"]}
    assert set(flags) == set(QUALITY_INSPECTION_TYPE_LABELS) - {"incoming", "first_article"}
    assert flags == {t: t == "stock_reinspection" for t in flags}
    r = client.get(f"{BASE}/inspection-lots/meta", headers=_h(open_engineer))
    assert all(o["allowed"] for o in r.json()["inspection_types"])


# ---------- Without a rule ----------

def test_create_without_rule_is_unchanged(client, db, item, open_engineer):
    assert client.post(f"{BASE}/ncr", json=_ncr(severity="critical"), headers=_h(open_engineer)).status_code == 200
    assert client.post(f"{BASE}/capa", json=_capa(action_type="preventive", severity="critical"), headers=_h(open_engineer)).status_code == 200
    assert client.post(f"{BASE}/complaints", json=_complaint(source="site_visit", severity="major"), headers=_h(open_engineer)).status_code == 200
    assert client.post(f"{BASE}/inspection-lots", json=_lot(item, inspection_type="final"), headers=_h(open_engineer)).status_code == 200
