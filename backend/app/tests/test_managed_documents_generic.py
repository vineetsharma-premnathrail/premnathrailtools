"""Generic managed-document routes, exercised through the ERP project letter
adapter (the quotation adapter is covered in test_crm_quotation_documents.py)."""

from app.tests.test_crm_quotation_documents import sp  # noqa: F401  (fixture: fake SharePoint)
from app.tests.test_erp_projects import auth_header, make_user


def _cover(invoice_no):
    # General letters can no longer be created; the fixed delivery documents are.
    return {"letter_type": "delivery_cover", "letter_date": "2026-10-06",
            "data": {"client": "DMRC", "loa_ref": "DMRC/LOA/12", "invoice_no": invoice_no, "documents": ["Packing List"]}}


def _letter(client, admin, serial):
    project = client.post("/api/v1/erp/projects", json={"serial_number": serial}, headers=auth_header(admin)).json()
    letter = client.post(f"/api/v1/erp/projects/{project['id']}/letters", json=_cover("INV/P1/26-27/005"), headers=auth_header(admin)).json()
    return project, letter


def test_letter_word_document_follows_letter_revisions(client, db, sp):
    admin = make_user(db, "md_admin@premnathrail.com", role="admin")
    project, letter = _letter(client, admin, "PEW-MD-1")
    dbase = f"/api/v1/managed-documents/erp_project_letter/{letter['id']}"
    lbase = f"/api/v1/erp/projects/{project['id']}/letters/{letter['id']}"

    assert client.post(dbase, headers=auth_header(admin)).status_code == 200
    # PDF/Word downloads of the letter now come from the Word document of record.
    assert client.get(f"{lbase}/file", headers=auth_header(admin)).content == b"%PDF-from-word"
    assert client.get(f"{lbase}/file?format=docx", headers=auth_header(admin)).content == sp.files["item-1"][-1]

    # Editing the letter's content makes the Word draft stale; the PDF falls back to a fresh render.
    edited = client.patch(lbase, json=_cover("INV/P1/26-27/006"), headers=auth_header(admin)).json()
    assert edited["revision"] == 1
    state = client.get(dbase, headers=auth_header(admin)).json()["document"]
    assert state["is_stale"] is True
    assert client.post(f"{dbase}/edit", headers=auth_header(admin)).status_code == 409
    assert client.get(f"{lbase}/file", headers=auth_header(admin)).content != b"%PDF-from-word"

    # Saving the same content again is not a revision.
    same = client.patch(lbase, json=_cover("INV/P1/26-27/006"), headers=auth_header(admin)).json()
    assert same["revision"] == 1


def test_generic_routes_check_type_module_and_permission(client, db, sp):
    admin = make_user(db, "md_admin2@premnathrail.com", role="admin")
    viewer = make_user(db, "md_viewer@premnathrail.com", assigned_apps=["erp"])
    outsider = make_user(db, "md_outsider@premnathrail.com", assigned_apps=["crm"])
    _, letter = _letter(client, admin, "PEW-MD-2")
    dbase = f"/api/v1/managed-documents/erp_project_letter/{letter['id']}"

    assert client.get("/api/v1/managed-documents/no_such_type/1", headers=auth_header(admin)).status_code == 404
    assert client.get(dbase, headers=auth_header(outsider)).status_code == 403
    assert client.get(dbase, headers=auth_header(viewer)).status_code == 200
    assert client.post(dbase, headers=auth_header(viewer)).status_code == 403
    assert client.get("/api/v1/managed-documents/erp_project_letter/999999", headers=auth_header(admin)).status_code == 404


def test_follow_up_mom_word_document(client, db, sp):
    user = make_user(db, "md_sales@premnathrail.com", assigned_apps=["crm"])
    created = client.post("/api/v1/crm/activities", json={
        "activity_type": "Meeting", "subject": "Site visit", "remarks": "<p>Discussed RRV demo</p>", "assigned_to": "Rahul",
    }, headers=auth_header(user))
    assert created.status_code in (200, 201), created.text
    activity = created.json()
    dbase = f"/api/v1/managed-documents/crm_activity_mom/{activity['id']}"
    export = f"/api/v1/crm/activities/{activity['id']}/mom-docx"

    rendered = client.post(export, headers=auth_header(user)).content
    assert rendered[:2] == b"PK"
    assert client.post(dbase, headers=auth_header(user)).status_code == 200
    # Export now returns the Word MoM of record (here: the generated file in fake SharePoint).
    assert client.post(export, headers=auth_header(user)).content == sp.files["item-1"][-1]

    # A status change is not a MoM change; editing the remarks is.
    client.patch(f"/api/v1/crm/activities/{activity['id']}", json={"status": "Closed"}, headers=auth_header(user))
    assert client.get(dbase, headers=auth_header(user)).json()["document"]["is_stale"] is False
    client.patch(f"/api/v1/crm/activities/{activity['id']}", json={"remarks": "<p>Demo fixed for 12 Oct</p>"}, headers=auth_header(user))
    assert client.get(dbase, headers=auth_header(user)).json()["document"]["is_stale"] is True
