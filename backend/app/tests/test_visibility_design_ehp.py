"""Role-wise UI visibility (core/visibility.py) on Design, Electrical and
Hydraulic & Pneumatic: the catalogue entries (Drawings, Changes, RRV Electrical
Jobs, Electrical Testing, Systems, Testing & Inspection) resolve to real tabs and
hold the coded values, required-holding sections are locked, and the server
refuses a dropdown value the role does not offer (422 with the real reason) on
create and on a changed edit; an unchanged value on an edit passes."""
import pytest

from app.auth.jwt_handler import create_access_token
from app.core import visibility
from app.core.permission_registry import MODULES
from app.core.visibility import VISIBILITY, clean_rules
from app.modules.design.models.change_request import DESIGN_ECR_SOURCES, DESIGN_ECR_URGENCIES
from app.modules.design.models.document import DESIGN_DISCIPLINES, DESIGN_DOCUMENT_TYPES, DesignDocument
from app.modules.electrical.models.job import ELECTRICAL_JOB_PRIORITIES
from app.modules.electrical.models.test_record import ELECTRICAL_TEST_PHASES, ELECTRICAL_TEST_TYPES
from app.modules.hydraulic.models.system import HYD_SYSTEM_TYPES
from app.modules.hydraulic.models.testing import HYD_TEST_TYPES
from app.modules.main.models.role import Role
from app.modules.main.models.user import User

API = "/api/v1"
DOC_KEY, ECR_KEY = "design:documents", "design:change_notices"
JOB_KEY, ETEST_KEY = "electrical:jobs", "electrical:testing"
SYS_KEY, HTEST_KEY = "hydraulic:systems", "hydraulic:testing"
KEYS = (DOC_KEY, ECR_KEY, JOB_KEY, ETEST_KEY, SYS_KEY, HTEST_KEY)


def _grants(*tabs, actions=("view", "create", "edit")):
    return [f"{t}:{a}" for t in tabs for a in actions]


def _user(db, email, apps):
    u = User(email=email, name=email.split("@")[0].title(), role="user", is_active=True, assigned_apps=list(apps),
             granular_permissions=[])
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _role(db, name, permissions, rules=None):
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


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _restricted(db, email, apps, tabs, key, rule):
    u = _user(db, email, apps)
    _give(db, u, _role(db, f"Narrow {email}", _grants(*tabs), {key: rule}))
    return u


# ---------- catalogue ----------

def test_catalogue_keys_resolve_and_hold_the_coded_values():
    for key in KEYS:
        assert key in VISIBILITY, key
        module, tab = key.split(":")
        assert tab in MODULES[module]["actions"], key
        entry = VISIBILITY[key]
        for item in (*entry["sections"].values(), *entry["options"].values(), *entry["tables"].values()):
            assert item["screen"] in entry["screens"], key
    assert list(VISIBILITY[DOC_KEY]["options"]["document_type"]["values"]) == list(DESIGN_DOCUMENT_TYPES)
    assert list(VISIBILITY[DOC_KEY]["options"]["discipline"]["values"]) == list(DESIGN_DISCIPLINES)
    assert list(VISIBILITY[ECR_KEY]["options"]["source"]["values"]) == list(DESIGN_ECR_SOURCES)
    assert list(VISIBILITY[ECR_KEY]["options"]["urgency"]["values"]) == list(DESIGN_ECR_URGENCIES)
    assert list(VISIBILITY[JOB_KEY]["options"]["priority"]["values"]) == list(ELECTRICAL_JOB_PRIORITIES)
    assert list(VISIBILITY[ETEST_KEY]["options"]["phase"]["values"]) == list(ELECTRICAL_TEST_PHASES)
    assert VISIBILITY[ETEST_KEY]["options"]["test_type"]["values"] == ELECTRICAL_TEST_TYPES
    assert list(VISIBILITY[SYS_KEY]["options"]["system_type"]["values"]) == list(HYD_SYSTEM_TYPES)
    assert list(VISIBILITY[HTEST_KEY]["options"]["test_type"]["values"]) == list(HYD_TEST_TYPES)


@pytest.mark.parametrize("key,section", [
    (DOC_KEY, "document"), (DOC_KEY, "detail_summary"), (DOC_KEY, "detail_revision"),
    (ECR_KEY, "request"), (ECR_KEY, "affected_items"), (ECR_KEY, "detail_items"),
    (JOB_KEY, "rrv_job"), (ETEST_KEY, "test"), (ETEST_KEY, "reading_result"),
    (SYS_KEY, "system"), (HTEST_KEY, "test"), (HTEST_KEY, "subject"),
])
def test_required_holding_sections_are_locked(key, section):
    assert VISIBILITY[key]["sections"][section]["locked"]
    with pytest.raises(ValueError) as e:
        clean_rules({key: {"hidden_sections": [section]}})
    assert "holds a required field" in str(e.value)


def test_tables_never_offer_number_status_or_money_columns():
    banned = {"doc_number", "number", "status", "result", "cost", "total_cost", "ecr", "job_no", "system_no", "test_no"}
    for key in KEYS:
        for table in VISIBILITY[key]["tables"].values():
            assert not banned & set(table["columns"]), key


def test_clean_rules_accepts_optional_sections_columns_and_values():
    rule = {DOC_KEY: {"hidden_sections": ["customer"], "options": {"discipline": ["mechanical"]},
                      "hidden_columns": {"documents": ["owner"]}}}
    assert clean_rules(rule) == rule


# ---------- Design ----------

def test_document_create_refuses_a_type_the_role_does_not_offer(client, db):
    u = _restricted(db, "dv1@premnathrail.com", ["design"], ["design:documents"], DOC_KEY,
                    {"options": {"document_type": ["part_drawing"], "discipline": ["mechanical"]}})
    r = client.post(f"{API}/design/documents", json={"title": "Bracket", "document_type": "ga_drawing", "discipline": "mechanical"},
                    headers=_h(u))
    assert r.status_code == 422, r.text
    assert "Type 'GA Drawing' isn't available to your role" in r.json()["detail"]
    assert "Part Drawing" in r.json()["detail"] and "Visibility" in r.json()["detail"]
    r = client.post(f"{API}/design/documents", json={"title": "Bracket", "document_type": "part_drawing", "discipline": "electrical"},
                    headers=_h(u))
    assert r.status_code == 422 and "Discipline 'Electrical'" in r.json()["detail"]
    r = client.post(f"{API}/design/documents", json={"title": "Bracket", "document_type": "part_drawing", "discipline": "mechanical"},
                    headers=_h(u))
    assert r.status_code == 201, r.text


def test_document_edit_checks_only_a_changed_discipline(client, db):
    admin = User(email="dadm@premnathrail.com", name="Adm", role="admin", is_active=True)
    db.add(admin)
    db.commit()
    doc = client.post(f"{API}/design/documents", json={"title": "Frame", "document_type": "ga_drawing", "discipline": "structural"},
                      headers=_h(admin)).json()
    u = _restricted(db, "dv2@premnathrail.com", ["design"], ["design:documents"], DOC_KEY, {"options": {"discipline": ["mechanical"]}})
    db.query(DesignDocument).filter_by(id=doc["id"]).update({"owner_id": u.id})
    db.commit()
    same = client.patch(f"{API}/design/documents/{doc['id']}", json={"title": "Frame v2", "discipline": "structural"}, headers=_h(u))
    assert same.status_code == 200, same.text
    other = client.patch(f"{API}/design/documents/{doc['id']}", json={"discipline": "civil"}, headers=_h(u))
    assert other.status_code == 422 and "Discipline 'Civil'" in other.json()["detail"]


def test_ecr_create_refuses_a_source_or_urgency_the_role_does_not_offer(client, db):
    u = _restricted(db, "dv3@premnathrail.com", ["design"], ["design:change_notices"], ECR_KEY,
                    {"options": {"source": ["production"], "urgency": ["normal", "high"]}})
    body = {"title": "Thicker gusset", "reason": "Cracks at weld", "proposed_change": "12 mm plate", "items": []}
    r = client.post(f"{API}/design/change-requests", json={**body, "source": "customer", "urgency": "normal"}, headers=_h(u))
    assert r.status_code == 422 and "Source 'Customer' isn't available to your role" in r.json()["detail"]
    r = client.post(f"{API}/design/change-requests", json={**body, "source": "production", "urgency": "critical"}, headers=_h(u))
    assert r.status_code == 422 and "Urgency 'Critical'" in r.json()["detail"]
    # The schema default source ("design") is checked too: a narrowed role must send an allowed one.
    r = client.post(f"{API}/design/change-requests", json={**body, "urgency": "normal"}, headers=_h(u))
    assert r.status_code == 422 and "Source 'Design'" in r.json()["detail"]
    # Allowed values pass the visibility check and reach the item validation.
    r = client.post(f"{API}/design/change-requests", json={**body, "source": "production", "urgency": "high"}, headers=_h(u))
    assert r.status_code == 400 and "released drawing or BOM" in r.json()["detail"]


# ---------- Electrical ----------

def test_job_priority_refused_outside_the_role_and_meta_carries_allowed(client, db):
    u = _restricted(db, "ev1@premnathrail.com", ["electrical"], ["electrical:jobs"], JOB_KEY, {"options": {"priority": ["standard"]}})
    r = client.post(f"{API}/electrical/jobs", json={"title": "RRV-450 electrical", "priority": "urgent"}, headers=_h(u))
    assert r.status_code == 422 and "Priority 'Urgent' isn't available to your role" in r.json()["detail"]
    job = client.post(f"{API}/electrical/jobs", json={"title": "RRV-450 electrical"}, headers=_h(u))
    assert job.status_code == 200, job.text
    jid = job.json()["id"]
    assert client.patch(f"{API}/electrical/jobs/{jid}", json={"title": "Renamed", "priority": "standard"}, headers=_h(u)).status_code == 200
    r = client.patch(f"{API}/electrical/jobs/{jid}", json={"priority": "urgent"}, headers=_h(u))
    assert r.status_code == 422 and "Priority 'Urgent'" in r.json()["detail"]
    meta = client.get(f"{API}/electrical/lookups/meta", headers=_h(u)).json()
    assert meta["allowed"]["job_priority"] == ["standard"] and meta["allowed"]["test_type"] is None
    assert set(meta["test_types"]) == set(ELECTRICAL_TEST_TYPES)  # the full list stays for labels


def test_electrical_test_phase_and_type_refused_outside_the_role(client, db):
    u = _restricted(db, "ev2@premnathrail.com", ["electrical"], ["electrical:jobs", "electrical:testing"], ETEST_KEY,
                    {"options": {"phase": ["factory"], "test_type": ["continuity", "polarity"]}})
    jid = client.post(f"{API}/electrical/jobs", json={"title": "RRV test job"}, headers=_h(u)).json()["id"]
    body = {"phase": "factory", "test_type": "continuity", "result": "pass", "test_date": "2026-11-01"}
    r = client.post(f"{API}/electrical/jobs/{jid}/tests", json={**body, "phase": "commissioning"}, headers=_h(u))
    assert r.status_code == 422 and "Phase 'Commissioning'" in r.json()["detail"]
    r = client.post(f"{API}/electrical/jobs/{jid}/tests", json={**body, "test_type": "hipot"}, headers=_h(u))
    assert r.status_code == 422 and "Test Type 'High Voltage (Hi-pot)'" in r.json()["detail"]
    assert client.post(f"{API}/electrical/jobs/{jid}/tests", json=body, headers=_h(u)).status_code == 200


# ---------- Hydraulic & Pneumatic ----------

def test_system_type_refused_outside_the_role(client, db):
    u = _restricted(db, "hv1@premnathrail.com", ["hydraulic"], ["hydraulic:systems"], SYS_KEY, {"options": {"system_type": ["pneumatic"]}})
    r = client.post(f"{API}/hydraulic/systems", json={"name": "Power pack"}, headers=_h(u))  # default type Hydraulic
    assert r.status_code == 422 and "Type 'Hydraulic' isn't available to your role" in r.json()["detail"]
    r = client.post(f"{API}/hydraulic/systems", json={"name": "Brake air", "system_type": "pneumatic"}, headers=_h(u))
    assert r.status_code == 200, r.text


def test_hydraulic_test_type_refused_on_create_and_changed_edit(client, db):
    u = _restricted(db, "hv2@premnathrail.com", ["hydraulic"], ["hydraulic:systems", "hydraulic:testing"], HTEST_KEY,
                    {"options": {"test_type": ["leak_test"]}})
    sid = client.post(f"{API}/hydraulic/systems", json={"name": "Power pack"}, headers=_h(u)).json()["id"]
    body = {"title": "Leak check", "system_id": sid, "readings": []}
    r = client.post(f"{API}/hydraulic/tests", json={**body, "test_type": "proof_test"}, headers=_h(u))
    assert r.status_code == 422 and "Test Type 'Proof Test' isn't available to your role" in r.json()["detail"]
    t = client.post(f"{API}/hydraulic/tests", json={**body, "test_type": "leak_test"}, headers=_h(u))
    assert t.status_code == 200, t.text
    tid = t.json()["id"]
    assert client.patch(f"{API}/hydraulic/tests/{tid}", json={"test_type": "leak_test", "title": "Leak check 2"}, headers=_h(u)).status_code == 200
    r = client.patch(f"{API}/hydraulic/tests/{tid}", json={"test_type": "flow_test"}, headers=_h(u))
    assert r.status_code == 422 and "Test Type 'Flow Test'" in r.json()["detail"]


@pytest.mark.parametrize("key,dropdown,value", [
    (DOC_KEY, "document_type", "ga_drawing"), (ECR_KEY, "urgency", "critical"), (JOB_KEY, "priority", "urgent"),
    (ETEST_KEY, "test_type", "hipot"), (SYS_KEY, "system_type", "hydraulic"), (HTEST_KEY, "test_type", "proof_test"),
])
def test_admin_and_partner_are_never_restricted(db, key, dropdown, value):
    first = next(v for v in VISIBILITY[key]["options"][dropdown]["values"] if v != value)
    rule = {key: {"options": {dropdown: [first]}}}
    module, tab = key.split(":")
    for email, extra in (("adm-" + tab + "@premnathrail.com", {"role": "admin"}), ("ptn-" + tab + "@premnathrail.com", {"is_partner": True})):
        u = User(email=email, name="X", is_active=True, granular_permissions=[], **{"role": "user", **extra})
        db.add(u)
        db.commit()
        _give(db, u, _role(db, f"R {email}", _grants(key), rule))
        visibility.ensure_option_allowed(u, key, dropdown, value)  # no exception


# ---------- normalised priority (L1) and the medium that is really stored (L2) ----------

def test_electrical_job_blank_priority_is_checked_as_standard(client, db):
    u = _restricted(db, "ev3@premnathrail.com", ["electrical"], ["electrical:jobs"], JOB_KEY, {"options": {"priority": ["urgent"]}})
    r = client.post(f"{API}/electrical/jobs", json={"title": "RRV-451 electrical", "priority": ""}, headers=_h(u))
    assert r.status_code == 422 and "Priority 'Standard' isn't available to your role — you can pick: Urgent." in r.json()["detail"]
    r = client.post(f"{API}/electrical/jobs", json={"title": "RRV-451 electrical", "priority": "Urgent"}, headers=_h(u))
    assert r.status_code == 200, r.text


def test_hydraulic_test_medium_is_checked_after_the_system_decides_it(client, db):
    """The medium stored on a test comes from the picked system, not from what the form sent."""
    u = _restricted(db, "hv3@premnathrail.com", ["hydraulic"], ["hydraulic:systems", "hydraulic:testing"], HTEST_KEY,
                    {"options": {"system_type": ["pneumatic"]}})
    hyd = client.post(f"{API}/hydraulic/systems", json={"name": "Power pack"}, headers=_h(u)).json()["id"]
    pneu = client.post(f"{API}/hydraulic/systems", json={"name": "Brake air", "system_type": "pneumatic"}, headers=_h(u)).json()["id"]
    body = {"title": "Leak check", "test_type": "leak_test", "readings": []}
    # Sending 'pneumatic' with a hydraulic system is no way round the rule: the system's medium is what is stored.
    r = client.post(f"{API}/hydraulic/tests", json={**body, "system_id": hyd, "system_type": "pneumatic"}, headers=_h(u))
    assert r.status_code == 422 and "Medium 'Hydraulic' isn't available to your role — you can pick: Pneumatic." in r.json()["detail"]
    # The form's default 'hydraulic' with a pneumatic system stores pneumatic, which the role may pick.
    r = client.post(f"{API}/hydraulic/tests", json={**body, "system_id": pneu}, headers=_h(u))
    assert r.status_code == 200, r.text
    assert r.json()["system_type"] == "pneumatic"
    tid = r.json()["id"]
    # Edit: same system passes; switching to a hydraulic system changes the medium and is refused.
    assert client.patch(f"{API}/hydraulic/tests/{tid}", json={"system_id": pneu, "title": "Leak check 2"}, headers=_h(u)).status_code == 200
    r = client.patch(f"{API}/hydraulic/tests/{tid}", json={"system_id": hyd}, headers=_h(u))
    assert r.status_code == 422 and "Medium 'Hydraulic' isn't available" in r.json()["detail"]
