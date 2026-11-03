"""Role-wise UI visibility (core/visibility.py) applied to CRM: Customer
Organizations (form / page / list) and Inquiries & Tenders (inquiry form, tender
form, inquiry page, tender page, list). Dropdown values are enforced by the
server; sections and columns are hidden on screen only."""
import io

from app.core.priority import PRIORITIES
from app.core.visibility import VISIBILITY, catalog, clean_rules, effective
from app.modules.crm.models.inquiry import INQ_STATUSES
from app.modules.crm.models.tender import TND_STATUSES
from app.modules.crm.services.org_scope import ORG_SCOPES
from app.modules.main.models.role import Role
from app.tests.test_crm import auth_header, inquiry_payload, make_user

ORG_KEY = "crm:organizations"
INQ_KEY = "crm:inquiries_tenders"
ORGS = "/api/v1/crm/organizations"
INQUIRIES = "/api/v1/crm/inquiries"
TENDERS = "/api/v1/crm/tenders"
GRANTS = [f"{tab}:{action}" for tab in (ORG_KEY, INQ_KEY) for action in ("view", "create", "edit")]


def _role(db, name, rules=None, permissions=tuple(GRANTS)):
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


def _org(client, user, name="Vis Org", **extra):
    r = client.post(ORGS, json={"org_scope": "domestic", "org_type": "Customer", "name": name, **extra}, headers=auth_header(user))
    assert r.status_code == 201, r.text
    return r.json()


# ---------- catalogue ----------

def test_crm_catalogue_keys_resolve_and_match_the_coded_lists():
    org, inq = VISIBILITY[ORG_KEY], VISIBILITY[INQ_KEY]
    assert set(org["options"]["org_scope"]["values"]) == set(ORG_SCOPES)
    assert set(inq["options"]["inquiry_priority"]["values"]) == set(PRIORITIES)
    assert set(inq["options"]["tender_priority"]["values"]) == set(PRIORITIES)
    assert list(inq["options"]["inquiry_status"]["values"]) == INQ_STATUSES
    assert list(inq["options"]["tender_status"]["values"]) == TND_STATUSES
    # Sections that hold a required field are locked; the optional ones are not.
    assert org["sections"]["details"]["locked"] and org["sections"]["address"]["locked"]
    assert not org["sections"]["contact_registration"]["locked"] and not org["sections"]["contact_persons"]["locked"]
    assert not inq["sections"]["inq_project_details"]["locked"]
    assert all(inq["sections"][s]["locked"] for s in ("inq_company", "inq_basic", "inq_product", "tnd_info", "tnd_dates", "tnd_basic", "tnd_customer"))
    # Never the code / name column of a list.
    assert "name" not in org["tables"]["organizations"]["columns"]
    assert "universal_id" not in inq["tables"]["inquiries_tenders"]["columns"]


def test_crm_catalogue_screens_and_every_item_names_one():
    cat = catalog()
    org, inq = cat[ORG_KEY], cat[INQ_KEY]
    assert list(org["screens"]) == ["form", "detail", "list"]
    assert list(inq["screens"]) == ["inquiry_form", "tender_form", "inquiry_detail", "tender_detail", "list"]
    for entry in (org, inq):
        for group in ("sections", "options", "tables"):
            for name, item in entry[group].items():
                assert item["screen"] in entry["screens"], (group, name)
    # Forms
    assert {k for k, v in org["sections"].items() if v["screen"] == "form"} == {"details", "address", "contact_registration", "contact_persons"}
    assert org["options"]["org_scope"]["screen"] == "form" and org["tables"]["organizations"]["screen"] == "list"
    assert inq["options"]["inquiry_priority"]["screen"] == "inquiry_form" and inq["options"]["inquiry_status"]["screen"] == "inquiry_form"
    assert inq["options"]["tender_priority"]["screen"] == "tender_form" and inq["options"]["tender_status"]["screen"] == "tender_form"
    assert inq["tables"]["inquiries_tenders"]["screen"] == "list"
    # Record pages: the header is locked, the optional blocks and sub-tabs are not.
    org_detail = {k: v for k, v in org["sections"].items() if v["screen"] == "detail"}
    assert org_detail["detail_header"]["locked"] and all(not v["locked"] for k, v in org_detail.items() if k != "detail_header")
    assert {"detail_contacts", "detail_inquiries", "detail_tenders", "detail_audit", "detail_address"} <= set(org_detail)
    inq_detail = {k: v for k, v in inq["sections"].items() if v["screen"] == "inquiry_detail"}
    assert inq_detail["inq_detail_header"]["locked"] and all(not v["locked"] for k, v in inq_detail.items() if k != "inq_detail_header")
    assert {"inq_detail_quotations", "inq_detail_documents", "inq_detail_followups", "inq_detail_timeline", "inq_detail_customer"} <= set(inq_detail)
    tnd_detail = {k: v for k, v in inq["sections"].items() if v["screen"] == "tender_detail"}
    assert tnd_detail["tnd_detail_header"]["locked"] and {"tnd_detail_dates", "tnd_detail_documents", "tnd_detail_followups"} <= set(tnd_detail)


def test_clean_rules_accepts_crm_rules_and_refuses_locked_sections():
    rule = {ORG_KEY: {"hidden_sections": ["contact_persons", "detail_audit"], "options": {"org_scope": ["domestic"]},
                      "hidden_columns": {"organizations": ["railway_zone", "created_by_name"]}},
            INQ_KEY: {"hidden_sections": ["inq_project_details", "tnd_detail_dates"], "options": {"inquiry_status": ["Lead", "Requirement Received"]}}}
    assert clean_rules(rule) == {
        ORG_KEY: {"hidden_sections": ["contact_persons", "detail_audit"], "options": {"org_scope": ["domestic"]},
                  "hidden_columns": {"organizations": ["created_by_name", "railway_zone"]}},
        INQ_KEY: {"hidden_sections": ["inq_project_details", "tnd_detail_dates"], "options": {"inquiry_status": ["Lead", "Requirement Received"]}},
    }
    for locked, label in (("inq_company", "Company Information"), ("inq_detail_header", "Record summary & actions"), ("detail_header", "Record summary")):
        key = ORG_KEY if locked.startswith("detail_") else INQ_KEY
        try:
            clean_rules({key: {"hidden_sections": [locked]}})
        except ValueError as e:
            assert label in str(e) and "required field" in str(e)
        else:
            raise AssertionError(f"locked section {locked} must not be hideable")


# ---------- organizations ----------

def test_org_scope_refused_when_the_role_does_not_offer_it(client, db):
    user = make_user(db, "vis.crm.org@premnathrail.com")
    _give(db, user, _role(db, "Domestic BD", {ORG_KEY: {"options": {"org_scope": ["domestic"]}}}))
    assert effective(user)[ORG_KEY]["options"]["org_scope"] == ["domestic"]

    r = client.post(ORGS, json={"org_scope": "international", "org_type": "Private Company", "name": "Abroad Ltd", "country": "Germany"},
                    headers=auth_header(user))
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert "Organization Scope 'International' isn't available to your role" in detail
    assert "Domestic" in detail and "Customer Organizations" in detail and "Visibility" in detail

    org = _org(client, user, "Home Ltd")  # the allowed scope passes
    assert org["org_scope"] == "domestic"


def test_org_scope_checked_only_when_it_changes(client, db):
    user = make_user(db, "vis.crm.orgedit@premnathrail.com")
    org = client.post(ORGS, json={"org_scope": "international", "org_type": "Private Company", "name": "Was Abroad", "country": "France"},
                      headers=auth_header(user)).json()
    _give(db, user, _role(db, "Domestic only", {ORG_KEY: {"options": {"org_scope": ["domestic"]}}}))
    # Sending the saved (now disallowed) scope back unchanged is fine.
    r = client.patch(f"{ORGS}/{org['id']}", json={"org_scope": "international", "city": "Lyon"}, headers=auth_header(user))
    assert r.status_code == 200, r.text
    # A user limited to Domestic who tries to switch a domestic org to International is refused.
    home = _org(client, user, "Home Two")
    r = client.patch(f"{ORGS}/{home['id']}", json={"org_scope": "international", "country": "Spain"}, headers=auth_header(user))
    assert r.status_code == 422 and "Organization Scope 'International' isn't available" in r.json()["detail"]


def test_org_without_rule_is_unchanged(client, db):
    user = make_user(db, "vis.crm.free@premnathrail.com")
    _give(db, user, _role(db, "Wide CRM", {}))
    r = client.post(ORGS, json={"org_scope": "international", "org_type": "Private Company", "name": "Free Abroad", "country": "Italy"},
                    headers=auth_header(user))
    assert r.status_code == 201, r.text


# ---------- inquiries ----------

def test_inquiry_priority_and_status_refused_outside_the_role(client, db):
    user = make_user(db, "vis.crm.inq@premnathrail.com")
    org = _org(client, user, "Inq Vis Org")
    _give(db, user, _role(db, "Lead logger", {INQ_KEY: {"options": {"inquiry_priority": ["standard"], "inquiry_status": ["Lead"]}}}))

    r = client.post(INQUIRIES, json=inquiry_payload(client, user, org["id"], priority="urgent"), headers=auth_header(user))
    assert r.status_code == 422 and "Priority 'Urgent' isn't available to your role" in r.json()["detail"], r.text
    assert "Standard" in r.json()["detail"] and "Inquiries & Tenders" in r.json()["detail"]

    r = client.post(INQUIRIES, json=inquiry_payload(client, user, org["id"], status="Qualified Inquiry"), headers=auth_header(user))
    assert r.status_code == 422 and "Inquiry Status 'Qualified Inquiry' isn't available to your role" in r.json()["detail"], r.text

    r = client.post(INQUIRIES, json=inquiry_payload(client, user, org["id"], status="Lead", priority="standard"), headers=auth_header(user))
    assert r.status_code == 201, r.text
    inquiry = r.json()

    # Edit: an unchanged value is never refused; a change outside the list is.
    r = client.patch(f"{INQUIRIES}/{inquiry['id']}", json={"status": "Lead", "priority": "standard", "product": "RRV"}, headers=auth_header(user))
    assert r.status_code == 200, r.text
    r = client.patch(f"{INQUIRIES}/{inquiry['id']}", json={"status": "Quotation Sent"}, headers=auth_header(user))
    assert r.status_code == 422 and "Inquiry Status 'Quotation Sent' isn't available" in r.json()["detail"]
    r = client.patch(f"{INQUIRIES}/{inquiry['id']}", json={"priority": "urgent"}, headers=auth_header(user))
    assert r.status_code == 422 and "Priority 'Urgent' isn't available" in r.json()["detail"]


def test_inquiry_priority_rule_does_not_touch_tenders(client, db):
    """The inquiry form and the tender form are separate screens with their own Priority dropdown."""
    user = make_user(db, "vis.crm.split@premnathrail.com")
    org = _org(client, user, "Split Org")
    _give(db, user, _role(db, "Standard inquiries", {INQ_KEY: {"options": {"inquiry_priority": ["standard"]}}}))
    r = client.post(TENDERS, json={"org_id": org["id"], "lead_source": "Direct", "priority": "urgent"}, headers=auth_header(user))
    assert r.status_code == 201, r.text
    r = client.post(INQUIRIES, json=inquiry_payload(client, user, org["id"], priority="urgent"), headers=auth_header(user))
    assert r.status_code == 422


def test_inquiry_union_across_roles_widens_the_status_list(client, db):
    user = make_user(db, "vis.crm.union@premnathrail.com")
    org = _org(client, user, "Union Org")
    _give(db, user,
          _role(db, "Leads", {INQ_KEY: {"options": {"inquiry_status": ["Lead"]}}}),
          _role(db, "Quoters", {INQ_KEY: {"options": {"inquiry_status": ["Quotation Sent"]}}}))
    assert effective(user)[INQ_KEY]["options"]["inquiry_status"] == ["Lead", "Quotation Sent"]
    r = client.post(INQUIRIES, json=inquiry_payload(client, user, org["id"], status="Quotation Sent"), headers=auth_header(user))
    assert r.status_code == 201, r.text
    r = client.post(INQUIRIES, json=inquiry_payload(client, user, org["id"], status="Order Received"), headers=auth_header(user))
    assert r.status_code == 422


# ---------- tenders ----------

def test_tender_status_and_priority_refused_outside_the_role(client, db):
    user = make_user(db, "vis.crm.tnd@premnathrail.com")
    org = _org(client, user, "Tender Vis Org")
    _give(db, user, _role(db, "Tender watcher", {INQ_KEY: {"options": {"tender_status": ["Waiting for Future Tender", "Tender Cancelled"],
                                                                      "tender_priority": ["urgent"]}}}))
    base = {"org_id": org["id"], "lead_source": "Direct", "priority": "urgent"}
    r = client.post(TENDERS, json={**base, "status": "Tender Published", "tender_number": "T-1", "tender_name": "Grinder",
                                   "publish_date": "2026-01-01", "closing_at": "2026-02-01T10:00:00"}, headers=auth_header(user))
    assert r.status_code == 422 and "Tender Status 'Tender Published' isn't available to your role" in r.json()["detail"], r.text

    r = client.post(TENDERS, json={**base, "priority": "standard"}, headers=auth_header(user))
    assert r.status_code == 422 and "Priority 'Standard' isn't available" in r.json()["detail"], r.text

    r = client.post(TENDERS, json=base, headers=auth_header(user))  # default status 'Waiting for Future Tender' is allowed
    assert r.status_code == 201, r.text
    tender = r.json()
    r = client.patch(f"{TENDERS}/{tender['id']}", json={"status": "Tender Cancelled"}, headers=auth_header(user))
    assert r.status_code == 200, r.text
    r = client.patch(f"{TENDERS}/{tender['id']}", json={"status": "Tender Participation", "tender_number": "T-2", "tender_name": "X",
                                                        "publish_date": "2026-01-01", "closing_at": "2026-02-01T10:00:00"}, headers=auth_header(user))
    assert r.status_code == 422 and "Tender Status 'Tender Participation' isn't available" in r.json()["detail"]


# ---------- bulk import ----------

def test_bulk_import_refused_for_a_restricted_role_with_the_real_reason(client, db):
    user = make_user(db, "vis.crm.import@premnathrail.com")
    _give(db, user, _role(db, "Domestic importer", {ORG_KEY: {"options": {"org_scope": ["domestic"]}}},
                          permissions=GRANTS + [f"{ORG_KEY}:import"]))
    csv = io.BytesIO(b"org_name,org_type\nSome Org,Customer\n")
    r = client.post("/api/v1/crm/bulk-import", files={"file": ("orgs.csv", csv, "text/csv")}, headers=auth_header(user))
    assert r.status_code == 422, r.text
    assert "Your role limits Organization Scope" in r.json()["detail"] and "Visibility" in r.json()["detail"]
