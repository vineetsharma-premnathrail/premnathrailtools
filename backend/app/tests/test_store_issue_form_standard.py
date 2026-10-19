"""Material Issue form standard (store/issue_forms.py, 2026-10-12): each issue
type asks for its own "against" fields; the form and the server read the
same ISSUE_FORMS so they can't disagree."""
from datetime import date, timedelta

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.accounts.models.vendor import Vendor
from app.modules.crm.models.organization import Organization
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.quality.models.ncr import QualityNcr
from app.modules.store.issue_forms import FIELDS, ISSUE_FORMS
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.tests._stock_seed import seed_opening_stock

API = "/api/v1/store/material-issues"
LATER = (date.today() + timedelta(days=14)).isoformat()


def _user(db, email, **flags):
    u = User(email=email, name=email.split("@")[0], role="user", is_active=True, assigned_apps=["store"], **flags)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


@pytest.fixture
def env(db):
    keeper = _user(db, "ifs.keeper@premnathrail.com")
    manager = _user(db, "ifs.manager@premnathrail.com")
    branch = Branch(name="Plant IFS", code="IFS")
    dept = Department(name="Office", code="OFF-IFS")
    loc = StoreLocation(name="IFS Store", code="IFS", manager_user_id=manager.id)
    item = StoreItem(item_code="MT-IFS-0001", item_name="Hex bolt", uom="NOS", item_type="material")
    vendor = Vendor(code="V-IFS", name="Shree Platers", status="active")
    customer = Organization(name="Central Railway")
    project = Project(serial_number="PRT-IFS-01", model_name="Tamper", client_company="Central Railway")
    db.add_all([branch, dept, loc, item, vendor, customer, project])
    db.flush()
    asset = MaintenanceAsset(asset_code="AS-IFS-1", name="Lathe 1", branch_id=branch.id)
    ncr = QualityNcr(ncr_number="NCR-IFS-1", source="in_process", item_name="Hex bolt", description="Thread damage",
                     ncr_date=date.today())
    from app.modules.erp.models.service_request import ServiceRequest
    sr = ServiceRequest(request_number="SR-IFS-1", project_id=project.id, issue_title="Hydraulic leak", status="open")
    db.add_all([asset, ncr, sr])
    db.commit()
    seed_opening_stock(db, item.id, loc.id, 500, created_by_id=manager.id)
    return {"keeper": keeper, "manager": manager, "dept": dept, "loc": loc, "item": item, "vendor": vendor,
            "customer": customer, "project": project, "asset": asset, "ncr": ncr, "sr": sr}


def _post(client, env, user=None, **body):
    return client.post(API, json={"location_id": env["loc"].id, "items": [{"item_id": env["item"].id, "quantity": 1}], **body},
                       headers=_h(user or env["keeper"]))


def _minimal(env) -> dict[str, dict]:
    """A minimal valid payload per issue type."""
    return {
        "production": {},
        "maintenance": {"asset_id": env["asset"].id},
        "project": {"erp_project_id": env["project"].id, "challan_number": "DC-P1"},
        "general": {"department_id": env["dept"].id},
        "rework": {"project_or_work_order": "WO-77"},
        "testing": {"ncr_id": env["ncr"].id, "destructive": True},
        "job_work": {"vendor_id": env["vendor"].id, "process": "plating", "expected_return_date": LATER, "challan_number": "DC-J1"},
        "scrap": {"remarks": "Corroded beyond use"},
        "customer_sample": {"customer_id": env["customer"].id, "purpose": "sample", "returnable": False, "challan_number": "DC-S1"},
        "dispatch": {"erp_project_id": env["project"].id, "challan_number": "DC-D1"},
        "service": {"service_request_id": env["sr"].id, "challan_number": "DC-SR1"},
    }


# A field whose absence the type must refuse, and the label the 422 names.
_REQUIRED_PROBE = {
    "maintenance": ("asset_id", "Machine / asset"),
    "project": ("challan_number", "Delivery challan no."),
    "general": ("department_id", "Department"),
    "rework": ("project_or_work_order", "Work order no."),
    "testing": ("destructive", "Destructive test?"),
    "job_work": ("vendor_id", "Vendor"),
    "customer_sample": ("customer_id", "Customer"),
    "dispatch": ("erp_project_id", "Project / machine (order)"),
    "service": ("service_request_id", "Service request"),
}


def test_form_standard_lists_every_active_issue_type(client, db, env):
    h = _h(env["keeper"])
    active = [t["value"] for t in client.get("/api/v1/store/doc-types/issue", headers=h).json()]
    r = client.get(f"{API}/form-standard", headers=h)
    assert r.status_code == 200, r.text
    std = r.json()
    for t in active:
        assert t in std, f"issue type {t} missing from the form standard"
        assert [f["key"] for f in std[t]["fields"]] == list(ISSUE_FORMS[t]["fields"])
        for f in std[t]["fields"]:
            assert f["rule"] == ISSUE_FORMS[t]["fields"][f["key"]] and f["label"] == FIELDS[f["key"]]["label"]
    assert std["scrap"]["manager_only"] is True and std["scrap"]["remarks_label"]
    assert std["job_work"]["leaves_factory"] is True and std["production"]["leaves_factory"] is False
    process = next(f for f in std["job_work"]["fields"] if f["key"] == "process")
    assert set(process["options"]) == {"machining", "plating", "heat_treatment", "fabrication", "outside_testing", "other"}


@pytest.mark.parametrize("issue_type", list(ISSUE_FORMS))
def test_each_type_posts_with_its_minimal_payload(client, db, env, issue_type):
    user = env["manager"] if issue_type == "scrap" else env["keeper"]
    r = _post(client, env, user, issue_type=issue_type, **_minimal(env)[issue_type])
    assert r.status_code == 200, r.text
    assert r.json()["issue_type"] == issue_type


@pytest.mark.parametrize("issue_type", list(_REQUIRED_PROBE))
def test_missing_required_field_is_named(client, db, env, issue_type):
    field, label = _REQUIRED_PROBE[issue_type]
    body = {k: v for k, v in _minimal(env)[issue_type].items() if k != field}
    r = _post(client, env, issue_type=issue_type, **body)
    assert r.status_code == 422, r.text
    assert r.json()["detail"].startswith("Issue type '") and label in r.json()["detail"]


def test_scrap_needs_remarks(client, db, env):
    r = _post(client, env, env["manager"], issue_type="scrap")
    assert r.status_code == 422 and "Remarks" in r.json()["detail"]


def test_fields_not_listed_for_the_type_are_cleared(client, db, env):
    r = _post(client, env, issue_type="production", customer_id=env["customer"].id, challan_number="DC-X",
              vendor_id=env["vendor"].id, expected_return_date=LATER, project_or_work_order="WO-5")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["customer_id"] is None and body["challan_number"] is None and body["vendor_name"] is None
    assert body["expected_return_date"] is None
    assert body["project_or_work_order"] == "WO-5"  # common field, kept


def test_scrap_is_store_manager_only(client, db, env):
    plain = _post(client, env, issue_type="scrap", remarks="Rusted")
    assert plain.status_code == 403 and "Store Manager" in plain.json()["detail"]
    assert _post(client, env, env["manager"], issue_type="scrap", remarks="Rusted").status_code == 200
    flagged = _user(db, "ifs.flagged@premnathrail.com", is_store_manager=True)
    assert _post(client, env, flagged, issue_type="scrap", remarks="Rusted").status_code == 200


def test_customer_sample_return_date_only_when_returnable(client, db, env):
    base = {"issue_type": "customer_sample", "customer_id": env["customer"].id, "purpose": "trial", "challan_number": "DC-S2"}
    assert _post(client, env, **base, returnable=False).status_code == 200
    miss = _post(client, env, **base, returnable=True)
    assert miss.status_code == 422 and "Expected return date" in miss.json()["detail"]
    ok = _post(client, env, **base, returnable=True, expected_return_date=LATER)
    assert ok.status_code == 200 and ok.json()["expected_return_date"] == LATER


def test_job_work_vendor_name_comes_from_vendor_master(client, db, env):
    r = _post(client, env, issue_type="job_work", vendor_name="Some other name", **_minimal(env)["job_work"])
    assert r.status_code == 200, r.text
    assert r.json()["vendor_name"] == "Shree Platers"
    unknown = _post(client, env, issue_type="job_work", **{**_minimal(env)["job_work"], "vendor_id": 999999})
    assert unknown.status_code == 422 and "wasn't found" in unknown.json()["detail"]


def test_lookups(client, db, env):
    h = _h(env["keeper"])
    deps = client.get(f"{API}/lookups/departments", headers=h)
    assert deps.status_code == 200 and {"id": env["dept"].id, "label": "Office"} in deps.json()
    vendors = client.get(f"{API}/lookups/vendors", headers=h).json()
    assert any(v["id"] == env["vendor"].id for v in vendors)
    assert client.get(f"{API}/lookups/nonsense", headers=h).status_code == 404
