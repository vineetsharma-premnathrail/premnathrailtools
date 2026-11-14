"""CRM › Knowledge Hub: folders, documents + versions, confidential access, pricing expiry, links, search,
favourites, share. SharePoint is faked in memory."""
from datetime import date, timedelta

import pytest

from app.auth.jwt_handler import create_access_token, create_upload_token
from app.core.config import settings
from app.main import app
from app.modules.crm.models.library import (  # noqa: F401  (registers the tables for create_all)
    LibraryDocument, LibraryDocumentLink, LibraryDocumentVersion, LibraryFavorite, LibraryFolder,
)
from app.modules.crm.models.organization import Organization
from app.modules.crm.routes import library as library_routes
from app.modules.crm.services import library as lib
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.modules.products.models.product import FinishedProduct
from app.modules.projects.models.project import PmProject

API = "/api/v1/crm/library"
MB = 1024 * 1024

if not any(getattr(r, "path", "") == f"{API}/summary" for r in app.routes):
    app.include_router(library_routes.router, prefix="/api/v1")  # main.py includes it too once the Manager adds the line

VIEW, CREATE, EDIT, DELETE = (f"crm:sales_library:{a}" for a in ("view", "create", "edit", "delete"))
CONF = "crm:sales_library.confidential:view"


@pytest.fixture(autouse=True)
def graph(monkeypatch):
    """In-memory SharePoint: upload sessions, verify, download links, bytes."""
    state = {"sessions": [], "downloads": []}

    async def create_upload_session(site_id, folder_path, filename):
        state["sessions"].append((folder_path, filename))
        return {"upload_url": f"https://sp.example/upload/{len(state['sessions'])}", "expires_at": "2026-12-01T00:00:00Z"}

    async def verify_direct_upload(site_id, item_id, folder_path, expected_size, content_type):
        name = next(n for f, n in reversed(state["sessions"]) if f == folder_path)
        return {"name": name, "path": f"{folder_path}/{name}", "webUrl": "https://sp.example/x", "size": expected_size, "item_id": item_id}

    async def get_download_url(site_id, file_path):
        state["downloads"].append(file_path)
        return f"https://sp.example/dl/{len(state['downloads'])}"

    async def download_file_content(site_id, file_path):
        return b"%PDF-1.7 demo", "application/pdf"

    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "site")
    monkeypatch.setattr(library_routes, "create_upload_session", create_upload_session)
    monkeypatch.setattr(library_routes, "verify_direct_upload", verify_direct_upload)
    monkeypatch.setattr(library_routes, "get_download_url", get_download_url)
    monkeypatch.setattr(library_routes, "download_file_content", download_file_content)
    return state


def make_user(db, email, grants=(), role="user"):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, granular_permissions=list(grants))
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def auth(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


@pytest.fixture
def team(db):
    return {
        "admin": make_user(db, "lib.admin@premnathrail.com", role="admin"),
        # view + create + delete, no edit: no Confidential feature either (it inherits from Edit)
        "author": make_user(db, "lib.author@premnathrail.com", [VIEW, CREATE, DELETE]),
        "editor": make_user(db, "lib.editor@premnathrail.com", [VIEW, CREATE, EDIT, DELETE, CONF]),
        "viewer": make_user(db, "lib.viewer@premnathrail.com", [VIEW]),
        "edit_only": make_user(db, "lib.editonly@premnathrail.com", [VIEW, EDIT]),  # edit, but no Confidential feature
        "nobody": make_user(db, "lib.nobody@premnathrail.com", ["crm:products:view"]),
    }


def folder(client, u, name, **body):
    r = client.post(f"{API}/folders", json={"name": name, **body}, headers=auth(u))
    assert r.status_code == 200, r.text
    return r.json()


def upload(client, u, folder_id, name="RRV Product Demo.mp4", size=200 * MB, mime="video/mp4", document_id=None, **meta):
    body = {"folder_id": folder_id, "file_name": name, "file_size": size, "mime_type": mime}
    if document_id:
        body["document_id"] = document_id
    s = client.post(f"{API}/documents/upload-session", json=body, headers=auth(u))
    assert s.status_code == 200, s.text
    done = client.post(f"{API}/documents/complete-upload", headers=auth(u),
                       json={"upload_token": s.json()["upload_token"], "drive_item_id": "ITEM", **meta})
    return done


def make_product(db, code="RRV", name="RRV Sanding Vehicle"):
    p = FinishedProduct(code=code, name=name, product_type="finished")
    db.add(p)
    db.commit()
    return p


# ── permissions ──────────────────────────────────────────────────────────
def test_every_route_is_denied_without_the_tab_permission(client, db, team):
    h = auth(team["nobody"])
    assert client.get(f"{API}/summary", headers=h).status_code == 403
    assert client.get(f"{API}/folders", headers=h).status_code == 403
    assert client.get(f"{API}/documents", headers=h).status_code == 403
    r = client.post(f"{API}/folders", json={"name": "X"}, headers=h)
    assert r.status_code == 403 and "Knowledge Hub" in r.json()["detail"]
    assert client.get(f"{API}/products/1/resources", headers=h).status_code == 403
    assert client.post(f"{API}/documents/1/favorite", headers=h).status_code == 403


def test_view_only_user_cannot_create_edit_or_delete(client, db, team):
    f = folder(client, team["editor"], "Catalogues")
    h = auth(team["viewer"])
    assert client.get(f"{API}/folders", headers=h).status_code == 200
    r = client.post(f"{API}/folders", json={"name": "New"}, headers=h)
    assert r.status_code == 403 and "'create' permission" in r.json()["detail"].lower()
    r = client.patch(f"{API}/folders/{f['id']}", json={"name": "Renamed"}, headers=h)
    assert r.status_code == 403 and "'edit' permission" in r.json()["detail"].lower()
    r = client.delete(f"{API}/folders/{f['id']}", headers=h)
    assert r.status_code == 403 and "'delete' permission" in r.json()["detail"].lower()
    r = client.post(f"{API}/documents/upload-session", headers=h,
                    json={"folder_id": f["id"], "file_name": "a.pdf", "file_size": 10, "mime_type": "application/pdf"})
    assert r.status_code == 403


# ── folders ──────────────────────────────────────────────────────────────
def test_folder_tree_sorted_duplicates_and_loop_guard(client, db, team):
    ed = team["editor"]
    b = folder(client, ed, "B Folder")
    a = folder(client, ed, "a folder")
    child = folder(client, ed, "RRV", parent_id=b["id"])
    grand = folder(client, ed, "Videos", parent_id=child["id"])
    names = [f["name"] for f in client.get(f"{API}/folders", headers=auth(ed)).json() if f["parent_id"] is None]
    assert names == ["a folder", "B Folder"]  # same sort_order -> name A-Z, case-insensitive

    dup = client.post(f"{API}/folders", json={"name": "A FOLDER"}, headers=auth(ed))
    assert dup.status_code == 409 and "already exists" in dup.json()["detail"]
    # same name under another parent is fine
    folder(client, ed, "a folder", parent_id=b["id"])

    loop = client.patch(f"{API}/folders/{b['id']}", json={"parent_id": grand["id"]}, headers=auth(ed))
    assert loop.status_code == 422 and "loop" in loop.json()["detail"]
    self_move = client.patch(f"{API}/folders/{b['id']}", json={"parent_id": b["id"]}, headers=auth(ed))
    assert self_move.status_code == 422 and "loop" in self_move.json()["detail"]
    ok = client.patch(f"{API}/folders/{grand['id']}", json={"parent_id": a["id"], "name": "Demo videos"}, headers=auth(ed))
    assert ok.status_code == 200 and ok.json()["parent_id"] == a["id"] and ok.json()["name"] == "Demo videos"


def test_delete_folder_only_when_empty_and_own_only(client, db, team):
    ed, author, admin = team["editor"], team["author"], team["admin"]
    parent = folder(client, ed, "Products")
    child = folder(client, ed, "RRV", parent_id=parent["id"])
    r = client.delete(f"{API}/folders/{parent['id']}", headers=auth(ed))
    assert r.status_code == 409 and "1 sub-folder(s)" in r.json()["detail"] and "Move or delete" in r.json()["detail"]

    assert upload(client, ed, child["id"]).status_code == 200
    r = client.delete(f"{API}/folders/{child['id']}", headers=auth(ed))
    assert r.status_code == 409 and "1 document(s)" in r.json()["detail"]

    # not the creator -> refused even with Delete; admin may delete
    empty = folder(client, ed, "Empty one")
    r = client.delete(f"{API}/folders/{empty['id']}", headers=auth(author))
    assert r.status_code == 403 and "you created yourself" in r.json()["detail"]
    assert client.delete(f"{API}/folders/{empty['id']}", headers=auth(admin)).status_code == 200
    assert all(f["id"] != empty["id"] for f in client.get(f"{API}/folders", headers=auth(ed)).json())
    # (re-using a deleted folder's name relies on the Postgres partial unique index; SQLite ignores its WHERE)


def test_child_of_confidential_folder_is_forced_confidential(client, db, team):
    ed = team["editor"]
    top = folder(client, ed, "Pricing", is_confidential=True)
    sub = folder(client, ed, "2026", parent_id=top["id"])
    assert sub["is_confidential"] is True
    # a user without the feature cannot mark a folder confidential
    r = client.post(f"{API}/folders", json={"name": "Secret", "is_confidential": True}, headers=auth(team["author"]))
    assert r.status_code == 403 and "Confidential folders" in r.json()["detail"]


def test_folder_product_must_exist_and_pricing_flag_needs_dated_files(client, db, team):
    ed = team["editor"]
    r = client.post(f"{API}/folders", json={"name": "Bad", "product_id": 999}, headers=auth(ed))
    assert r.status_code == 422 and "Product #999" in r.json()["detail"]
    f = folder(client, ed, "Datasheets")
    assert upload(client, ed, f["id"], name="sheet.pdf", mime="application/pdf").status_code == 200
    r = client.patch(f"{API}/folders/{f['id']}", json={"is_pricing": True}, headers=auth(ed))
    assert r.status_code == 422 and "no expiry date" in r.json()["detail"]


# ── confidential ─────────────────────────────────────────────────────────
def test_confidential_hidden_from_everything_without_the_feature(client, db, team):
    ed, author = team["editor"], team["author"]
    product = make_product(db)
    pub = folder(client, ed, "Products")
    secret = folder(client, ed, "Pricing & Quotations", is_confidential=True, is_pricing=True)
    sub = folder(client, ed, "2026", parent_id=secret["id"])
    public_doc = upload(client, ed, pub["id"], name="RRV Brochure.pdf", mime="application/pdf",
                        links=[{"link_type": "product", "link_id": product.id}]).json()
    secret_doc = upload(client, ed, sub["id"], name="RRV Price List.xlsx", mime="application/vnd.ms-excel",
                        expiry_date=str(date.today() + timedelta(days=90)),
                        links=[{"link_type": "product", "link_id": product.id}]).json()

    h = auth(author)
    assert [f["name"] for f in client.get(f"{API}/folders", headers=h).json()] == ["Products"]
    assert [d["id"] for d in client.get(f"{API}/documents", headers=h).json()] == [public_doc["id"]]
    assert client.get(f"{API}/documents", params={"q": "price"}, headers=h).json() == []
    assert client.get(f"{API}/documents", params={"product_id": product.id}, headers=h).json()[0]["id"] == public_doc["id"]
    summary = client.get(f"{API}/summary", headers=h).json()
    assert summary["folders"] == 1 and summary["documents"] == 1 and [d["id"] for d in summary["recent"]] == [public_doc["id"]]
    res = client.get(f"{API}/products/{product.id}/resources", headers=h).json()
    assert [d["id"] for g in res for d in g["documents"]] == [public_doc["id"]]

    # direct access: 404 with one neutral message that never names the file or folder
    def neutral(r, label):
        d = r.json()["detail"]
        assert r.status_code == 404 and d == lib.NOT_FOUND_OR_HIDDEN, (label, r.status_code, d)
        assert "Price List" not in d and "Pricing" not in d

    for url in (f"{API}/documents/{secret_doc['id']}", f"{API}/documents/{secret_doc['id']}/download-url",
                f"{API}/documents/{secret_doc['id']}/content"):
        neutral(client.get(url, headers=h), url)
    neutral(client.get(f"{API}/documents", params={"folder_id": secret["id"]}, headers=h), "list by folder")
    neutral(client.post(f"{API}/documents/{secret_doc['id']}/favorite", headers=h), "favorite")
    neutral(client.delete(f"{API}/documents/{secret_doc['id']}", headers=h), "delete")
    neutral(client.patch(f"{API}/folders/{secret['id']}", json={"description": "x"}, headers=auth(team["edit_only"])), "edit")
    neutral(client.post(f"{API}/documents/upload-session", headers=h,
                        json={"folder_id": sub["id"], "file_name": "x.pdf", "file_size": 5, "mime_type": "application/pdf"}), "upload")
    # a missing document answers with the very same message, so hidden and missing can't be told apart
    neutral(client.get(f"{API}/documents/987654", headers=h), "missing")
    # a name clashing with a hidden folder gets a neutral 409 too
    clash = client.post(f"{API}/folders", json={"name": "pricing & quotations"}, headers=h)
    assert clash.status_code == 409 and clash.json()["detail"] == lib.NAME_TAKEN_NEUTRAL

    # the Confidential feature (and admin) see all of it
    for who in (ed, team["admin"]):
        hh = auth(who)
        assert len(client.get(f"{API}/folders", headers=hh).json()) == 3
        assert client.get(f"{API}/documents/{secret_doc['id']}", headers=hh).status_code == 200
        assert client.get(f"{API}/summary", headers=hh).json()["documents"] == 2
        assert len([d for g in client.get(f"{API}/products/{product.id}/resources", headers=hh).json() for d in g["documents"]]) == 2


# ── pricing expiry, versions ─────────────────────────────────────────────
def test_pricing_folder_needs_expiry_and_a_past_date_shows_expired(client, db, team):
    ed = team["editor"]
    pricing = folder(client, ed, "Pricing", is_pricing=True)
    nested = folder(client, ed, "Standard quotes", parent_id=pricing["id"])  # inherits the rule
    r = upload(client, ed, nested["id"], name="quote.docx", mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    assert r.status_code == 422
    assert r.json()["detail"] == ("Pricing documents need an expiry date so outdated prices are flagged — "
                                  "pick the date the price list stops being valid.")
    assert db.query(LibraryDocument).count() == 0

    past = str(date.today() - timedelta(days=3))
    ok = upload(client, ed, nested["id"], name="quote.docx", mime="application/msword", expiry_date=past)
    assert ok.status_code == 200 and ok.json()["is_expired"] is True
    assert client.get(f"{API}/documents", params={"expiry": "expired"}, headers=auth(ed)).json()[0]["id"] == ok.json()["id"]
    assert client.get(f"{API}/documents", params={"expiry": "expiring"}, headers=auth(ed)).json() == []
    assert client.get(f"{API}/summary", headers=auth(ed)).json()["expired"] == 1
    bad = client.get(f"{API}/documents", params={"expiry": "soon"}, headers=auth(ed))
    assert bad.status_code == 422

    # moving a dateless document into a pricing folder is refused too
    plain = folder(client, ed, "Datasheets")
    d = upload(client, ed, plain["id"], name="spec.pdf", mime="application/pdf").json()
    r = client.patch(f"{API}/documents/{d['id']}", json={"folder_id": pricing["id"]}, headers=auth(ed))
    assert r.status_code == 422 and "expiry date" in r.json()["detail"]
    r = client.patch(f"{API}/documents/{d['id']}", json={"folder_id": pricing["id"], "expiry_date": str(date.today() + timedelta(days=10))},
                     headers=auth(ed))
    assert r.status_code == 200 and r.json()["folder_path"] == "Pricing"
    soon = client.get(f"{API}/documents", params={"expiry": "expiring"}, headers=auth(ed)).json()
    assert [x["id"] for x in soon] == [d["id"]]


def test_new_version_bumps_current_and_old_version_stays_downloadable(client, db, team, graph):
    ed = team["editor"]
    f = folder(client, ed, "Technical")
    doc = upload(client, ed, f["id"], name="RRV datasheet.pdf", mime="application/pdf", size=2 * MB, change_note="first").json()
    assert doc["current_version_no"] == 1 and doc["file_kind"] == "pdf" and doc["file_name"] == "RRV datasheet.pdf"
    v1_folder, v1_name = graph["sessions"][-1]
    assert v1_folder.startswith("Sales Library/new-") and v1_name == "v1-RRV datasheet.pdf"

    v2 = upload(client, ed, f["id"], name="RRV datasheet rev B.pdf", mime="application/pdf", size=2 * MB, document_id=doc["id"], change_note="rev B")
    assert v2.status_code == 200, v2.text
    body = v2.json()
    assert body["current_version_no"] == 2 and body["file_name"] == "RRV datasheet rev B.pdf" and body["title"] == "RRV datasheet.pdf"
    assert [v["version_no"] for v in body["versions"]] == [2, 1] and body["versions"][0]["change_note"] == "rev B"
    assert graph["sessions"][-1] == (f"Sales Library/{doc['id']}", "v2-RRV datasheet rev B.pdf")  # stable path per document id

    h = auth(ed)
    cur = client.get(f"{API}/documents/{doc['id']}/download-url", headers=h).json()
    old = client.get(f"{API}/documents/{doc['id']}/download-url", params={"version_no": 1}, headers=h).json()
    assert cur["version_no"] == 2 and old["version_no"] == 1 and old["file_name"] == "RRV datasheet.pdf"
    assert graph["downloads"] == [f"Sales Library/{doc['id']}/v2-RRV datasheet rev B.pdf", v1_folder + "/" + v1_name]
    missing = client.get(f"{API}/documents/{doc['id']}/download-url", params={"version_no": 9}, headers=h)
    assert missing.status_code == 404 and "no version 9" in missing.json()["detail"]
    content = client.get(f"{API}/documents/{doc['id']}/content", headers=h)
    assert content.status_code == 200 and content.content.startswith(b"%PDF") and content.headers["content-disposition"].startswith("inline")

    # a file too big to stream through the portal tells the user to download it instead
    big = upload(client, ed, f["id"], name="RRV demo.mp4", size=300 * MB).json()
    r = client.get(f"{API}/documents/{big['id']}/content", headers=h)
    assert r.status_code == 413 and "Use Download" in r.json()["detail"]

    # a version needs Edit, a new document needs Create
    r = client.post(f"{API}/documents/upload-session", headers=auth(team["author"]),
                    json={"file_name": "x.pdf", "file_size": 5, "mime_type": "application/pdf", "document_id": doc["id"]})
    assert r.status_code == 403 and "'edit' permission" in r.json()["detail"].lower()


def test_upload_token_checks(client, db, team):
    ed = team["editor"]
    f = folder(client, ed, "Docs")
    s = client.post(f"{API}/documents/upload-session", headers=auth(ed),
                    json={"folder_id": f["id"], "file_name": "a.pdf", "file_size": 10, "mime_type": "application/pdf"}).json()
    other = client.post(f"{API}/documents/complete-upload", headers=auth(team["admin"]),
                        json={"upload_token": s["upload_token"], "drive_item_id": "I"})
    assert other.status_code == 403 and "different user" in other.json()["detail"]
    # a token from CRM Documents (no library kind) is not accepted
    crm_token = create_upload_token({"user_id": ed.id, "folder": "CRM-media/x", "file_name": "a.pdf", "file_size": 10})
    r = client.post(f"{API}/documents/complete-upload", headers=auth(ed), json={"upload_token": crm_token, "drive_item_id": "I"})
    assert r.status_code == 400 and "Knowledge Hub" in r.json()["detail"]
    ok = client.post(f"{API}/documents/complete-upload", headers=auth(ed), json={"upload_token": s["upload_token"], "drive_item_id": "I"})
    assert ok.status_code == 200
    replay = client.post(f"{API}/documents/complete-upload", headers=auth(ed), json={"upload_token": s["upload_token"], "drive_item_id": "I"})
    assert replay.status_code == 409 and db.query(LibraryDocument).count() == 1
    bad_type = client.post(f"{API}/documents/upload-session", headers=auth(ed),
                           json={"folder_id": f["id"], "file_name": "page.html", "file_size": 10, "mime_type": "text/html"})
    assert bad_type.status_code == 400


# ── links, search, favourites ────────────────────────────────────────────
def test_links_are_checked_listed_filtered_and_folder_product_auto_links(client, db, team):
    ed = team["editor"]
    rrv = make_product(db)
    other = make_product(db, "SL", "Scissor Lift")
    org = Organization(name="Northern Railway", org_type="Customer")
    project = PmProject(project_code="PEW-40", name="RRV for NR")
    db.add_all([org, project])
    db.commit()
    pf = folder(client, ed, "RRV", product_id=rrv.id)
    sub = folder(client, ed, "Videos", parent_id=pf["id"])

    bad = upload(client, ed, sub["id"], name="a.mp4", links=[{"link_type": "product", "link_id": 12345}])
    assert bad.status_code == 422 and "Product #12345" in bad.json()["detail"]
    assert db.query(LibraryDocument).count() == 0

    r = upload(client, ed, sub["id"], name="RRV site visit.mp4", links=[
        {"link_type": "organization", "link_id": org.id}, {"link_type": "project", "link_id": project.id}])
    assert r.status_code == 200, r.text
    links = {(l["link_type"], l["name"]) for l in r.json()["links"]}
    assert links == {("organization", "Northern Railway"), ("project", "PEW-40"), ("product", "RRV Sanding Vehicle")}  # product from the folder tree

    h = auth(ed)
    assert len(client.get(f"{API}/documents", params={"product_id": rrv.id}, headers=h).json()) == 1
    assert client.get(f"{API}/documents", params={"product_id": other.id}, headers=h).json() == []
    assert len(client.get(f"{API}/documents", params={"project_id": project.id}, headers=h).json()) == 1
    assert len(client.get(f"{API}/documents", params={"organization_id": org.id}, headers=h).json()) == 1
    groups = client.get(f"{API}/products/{rrv.id}/resources", headers=h).json()
    assert groups[0]["folder_path"] == "RRV › Videos" and groups[0]["documents"][0]["title"] == "RRV site visit.mp4"
    assert client.get(f"{API}/products/999/resources", headers=h).status_code == 404

    # replace the link set
    doc_id = r.json()["id"]
    p = client.patch(f"{API}/documents/{doc_id}", headers=h, json={"links": [{"link_type": "product", "link_id": other.id}]})
    assert p.status_code == 200 and [(l["link_type"], l["link_id"]) for l in p.json()["links"]] == [("product", other.id)]
    assert client.patch(f"{API}/documents/{doc_id}", headers=h, json={"links": [{"link_type": "project", "link_id": 777}]}).status_code == 422
    # Edit is needed
    assert client.patch(f"{API}/documents/{doc_id}", headers=auth(team["author"]), json={"title": "x"}).status_code == 403


def test_search_is_word_by_word_in_any_order_over_title_tags_file_and_product(client, db, team):
    ed = team["editor"]
    rrv = make_product(db)
    f = folder(client, ed, "Videos")
    demo = upload(client, ed, f["id"], name="RRV Product Demo.mp4", links=[{"link_type": "product", "link_id": rrv.id}]).json()
    sheet = upload(client, ed, f["id"], name="data sheet.pdf", mime="application/pdf", title="Hydraulic details",
                   tags=["sanding", "Brake"], description="Torque curve").json()
    h = auth(ed)

    def ids(q):
        return [d["id"] for d in client.get(f"{API}/documents", params={"q": q}, headers=h).json()]

    assert ids("rrv demo") == [demo["id"]] and ids("demo rrv") == [demo["id"]]
    assert ids("DEMO mp4") == [demo["id"]]            # file name
    assert ids("sanding vehicle") == [demo["id"]]     # both words found on one file (linked product name), not split across files
    assert ids("sanding brake") == [sheet["id"]]      # tags
    assert ids("torque hydraulic") == [sheet["id"]]   # description + title
    assert ids("vehicle product") == [demo["id"]]     # linked product name + title
    assert ids("rrv nothing") == []
    assert ids("100%") == []                          # LIKE wildcard typed by a user matches nothing
    assert sorted(ids("")) == sorted([demo["id"], sheet["id"]])
    titles = [d["title"] for d in client.get(f"{API}/documents", headers=h).json()]
    assert titles == sorted(titles, key=str.lower)    # default sort title A-Z
    kinds = client.get(f"{API}/documents", params={"file_kind": "video"}, headers=h).json()
    assert [d["id"] for d in kinds] == [demo["id"]]


def test_favourites_are_per_user(client, db, team):
    ed, viewer = team["editor"], team["viewer"]
    f = folder(client, ed, "Docs")
    a = upload(client, ed, f["id"], name="a.pdf", mime="application/pdf").json()
    b = upload(client, ed, f["id"], name="b.pdf", mime="application/pdf").json()
    assert client.post(f"{API}/documents/{a['id']}/favorite", headers=auth(ed)).json() == {"is_favorite": True}
    assert client.post(f"{API}/documents/{a['id']}/favorite", headers=auth(ed)).status_code == 200  # idempotent
    mine = client.get(f"{API}/documents", params={"favorites": "true"}, headers=auth(ed)).json()
    assert [d["id"] for d in mine] == [a["id"]] and mine[0]["is_favorite"] is True
    assert client.get(f"{API}/documents", params={"favorites": "true"}, headers=auth(viewer)).json() == []
    assert {d["id"]: d["is_favorite"] for d in client.get(f"{API}/documents", headers=auth(viewer)).json()} == {a["id"]: False, b["id"]: False}
    assert client.delete(f"{API}/documents/{a['id']}/favorite", headers=auth(ed)).json() == {"is_favorite": False}
    assert client.get(f"{API}/documents", params={"favorites": "true"}, headers=auth(ed)).json() == []


# ── delete, share ────────────────────────────────────────────────────────
def test_document_delete_is_own_only_and_admin_any(client, db, team):
    ed, author, viewer, admin = team["editor"], team["author"], team["viewer"], team["admin"]
    f = folder(client, ed, "Docs")
    mine = upload(client, author, f["id"], name="mine.pdf", mime="application/pdf").json()
    theirs = upload(client, ed, f["id"], name="theirs.pdf", mime="application/pdf").json()
    r = client.delete(f"{API}/documents/{theirs['id']}", headers=auth(author))
    assert r.status_code == 403 and "you created yourself" in r.json()["detail"]
    assert client.delete(f"{API}/documents/{mine['id']}", headers=auth(viewer)).status_code == 403  # no Delete grant
    assert client.delete(f"{API}/documents/{mine['id']}", headers=auth(author)).status_code == 200
    assert client.delete(f"{API}/documents/{theirs['id']}", headers=auth(admin)).status_code == 200
    assert client.get(f"{API}/documents", headers=auth(ed)).json() == []
    gone = client.get(f"{API}/documents/{mine['id']}", headers=auth(ed))
    assert gone.status_code == 404 and "was not found" in gone.json()["detail"]
    # the folder is empty again
    assert client.delete(f"{API}/folders/{f['id']}", headers=auth(admin)).status_code == 200


def test_share_notifies_people_who_can_open_the_file(client, db, team):
    ed = team["editor"]
    f = folder(client, ed, "Docs")
    secret = folder(client, ed, "Confidential", is_confidential=True)
    d = upload(client, ed, f["id"], name="catalogue.pdf", mime="application/pdf").json()
    s = upload(client, ed, secret["id"], name="margins.pdf", mime="application/pdf").json()

    r = client.post(f"{API}/documents/{d['id']}/share", headers=auth(ed),
                    json={"user_ids": [team["viewer"].id, team["nobody"].id, ed.id], "message": "for the Pune visit"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sent"] == 1 and body["user_ids"] == [team["viewer"].id]
    assert body["skipped"] == [{"reason": "can't receive this file"}] * 2  # generic: no names, no cause
    n = db.query(Notification).filter(Notification.user_id == team["viewer"].id).one()
    assert n.notification_type == "crm_library_share" and n.entity_type == "crm_library_document" and n.entity_id == d["id"]
    assert "catalogue.pdf" in n.message and "for the Pune visit" in n.message
    assert db.query(Notification).filter(Notification.user_id == team["nobody"].id).count() == 0

    # a confidential file only goes to people who may open it
    r = client.post(f"{API}/documents/{s['id']}/share", headers=auth(ed), json={"user_ids": [team["viewer"].id]})
    assert r.status_code == 422 and "can't receive this file" in r.json()["detail"]
    ghost = client.post(f"{API}/documents/{d['id']}/share", headers=auth(ed), json={"user_ids": [424242]})
    assert ghost.status_code == 422 and "424242" not in ghost.json()["detail"]
    assert client.post(f"{API}/documents/{d['id']}/share", headers=auth(ed), json={"user_ids": []}).status_code == 422
    assert client.post(f"{API}/documents/{d['id']}/share", headers=auth(team["nobody"]), json={"user_ids": [ed.id]}).status_code == 403


def test_pickers_need_only_view_and_filter_word_by_word(client, db, team):
    make_product(db)
    make_product(db, "SL", "Scissor Lift")
    db.add_all([Organization(name="Zeta Rail", org_type="Customer"), Organization(name="Gone Rail", org_type="Customer", is_deleted=True),
                PmProject(project_code="PEW-1", name="One"), PmProject(project_code="PEW-2", name="Two RRV", status="cancelled")])
    db.commit()
    assert client.get(f"{API}/pickers/products", headers=auth(team["nobody"])).status_code == 403
    v = auth(team["viewer"])  # view-only is enough
    assert [x["code"] for x in client.get(f"{API}/pickers/products", headers=v).json()] == ["RRV", "SL"]
    assert [x["code"] for x in client.get(f"{API}/pickers/products", params={"q": "vehicle rrv"}, headers=v).json()] == ["RRV"]
    assert len(client.get(f"{API}/pickers/products", params={"limit": 1}, headers=v).json()) == 1
    assert client.get(f"{API}/pickers/products", params={"limit": 500}, headers=v).status_code == 422  # max 50
    assert [x["code"] for x in client.get(f"{API}/pickers/projects", headers=v).json()] == ["PEW-1"]  # cancelled left out
    assert [x["name"] for x in client.get(f"{API}/pickers/organizations", headers=v).json()] == ["Zeta Rail"]


def test_organization_links_and_picker_follow_the_crm_data_scope(client, db, team, monkeypatch):
    ed = team["editor"]
    mine = Organization(name="Mine Rail", org_type="Customer")
    theirs = Organization(name="Theirs Rail", org_type="Customer")
    db.add_all([mine, theirs])
    db.commit()
    f = folder(client, ed, "References")
    monkeypatch.setattr(lib, "in_scope", lambda db_, user, rec: rec.id == mine.id)
    monkeypatch.setattr(lib, "apply_scope", lambda q, user, model: q.filter(model.id == mine.id))
    assert [o["name"] for o in client.get(f"{API}/pickers/organizations", headers=auth(ed)).json()] == ["Mine Rail"]
    refused = upload(client, ed, f["id"], name="a.pdf", mime="application/pdf", links=[{"link_type": "organization", "link_id": theirs.id}])
    assert refused.status_code == 422 and "outside your access" in refused.json()["detail"]
    ok = upload(client, ed, f["id"], name="a.pdf", mime="application/pdf", links=[{"link_type": "organization", "link_id": mine.id}])
    assert ok.status_code == 200


def test_summary_counts(client, db, team):
    ed = team["editor"]
    f = folder(client, ed, "Videos")
    upload(client, ed, f["id"], name="a.mp4")
    upload(client, ed, f["id"], name="b.pdf", mime="application/pdf", expiry_date=str(date.today() + timedelta(days=5)))
    s = client.get(f"{API}/summary", headers=auth(ed)).json()
    assert (s["folders"], s["documents"], s["videos"], s["expired"], s["expiring_30d"]) == (1, 2, 1, 0, 1)
    assert len(s["recent"]) == 2


# ── security: MIME, upload checks, tags, built-in folders ────────────────
def test_mime_comes_from_the_extension_and_content_is_served_sandboxed(client, db, team, graph):
    ed = team["editor"]
    f = folder(client, ed, "Docs")
    # the browser claims an odd type with parameters: the stored type is the extension's
    pdf = upload(client, ed, f["id"], name="brochure.pdf", mime="application/x-evil; charset=utf-8", size=MB).json()
    assert pdf["mime_type"] == "application/pdf" and db.query(LibraryDocumentVersion).one().mime_type == "application/pdf"
    r = client.get(f"{API}/documents/{pdf['id']}/content", headers=auth(ed))
    assert r.headers["content-type"].startswith("application/pdf")
    # the route sends `sandbox`; the global API middleware (owasp.py) replaces it with the stricter default-src 'none'
    assert r.headers["content-security-policy"] in ("sandbox", "default-src 'none'") and r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-disposition"].startswith("inline")
    # documents are downloaded, not shown in the browser
    docx = upload(client, ed, f["id"], name="quote.docx", mime="text/plain", size=MB).json()
    assert docx["mime_type"].endswith("wordprocessingml.document")
    r = client.get(f"{API}/documents/{docx['id']}/content", headers=auth(ed))
    assert r.headers["content-disposition"].startswith("attachment") and "content-security-policy" in r.headers
    # server-side mapping, pure
    assert lib.server_mime("a.svg") == "application/octet-stream" and lib.server_mime("x.HTML") == "application/octet-stream"
    assert lib.server_mime("v.mp4") == "video/mp4" and lib.server_mime("p.JPG") == "image/jpeg" and lib.server_mime("noext") == "application/octet-stream"
    assert not lib.inline_allowed("image/svg+xml") and not lib.inline_allowed("text/plain") and lib.inline_allowed("video/webm")


@pytest.mark.parametrize("mime", ["text/html", "TEXT/HTML; charset=utf-8", "application/xhtml+xml", "application/xml", "text/xml",
                                  "application/javascript", "text/javascript", "image/svg+xml", "application/rss+xml"])
def test_script_capable_types_are_refused_at_upload_session(client, db, team, mime):
    f = folder(client, team["editor"], "Docs")
    r = client.post(f"{API}/documents/upload-session", headers=auth(team["editor"]),
                    json={"folder_id": f["id"], "file_name": "picture.png", "file_size": 10, "mime_type": mime})
    assert r.status_code == 400 and "can't be uploaded" in r.json()["detail"] and "PDF, Word or image" in r.json()["detail"]


def test_complete_upload_refuses_a_file_that_is_not_the_one_the_session_opened(client, db, team, monkeypatch, graph):
    ed = team["editor"]
    f = folder(client, ed, "Docs")
    s = client.post(f"{API}/documents/upload-session", headers=auth(ed),
                    json={"folder_id": f["id"], "file_name": "a.pdf", "file_size": 10, "mime_type": "application/pdf"}).json()
    deleted = []

    async def other(site_id, item_id, folder_, size, ctype):
        return {"name": "other.pdf", "path": f"{folder_}/other.pdf", "webUrl": None, "size": size, "item_id": item_id}

    async def delete_item(site_id, item_id):
        deleted.append(item_id)

    monkeypatch.setattr(library_routes, "verify_direct_upload", other)
    monkeypatch.setattr(library_routes, "delete_drive_item", delete_item)
    r = client.post(f"{API}/documents/complete-upload", headers=auth(ed), json={"upload_token": s["upload_token"], "drive_item_id": "I1"})
    assert r.status_code == 400 and "not the one this upload was opened for" in r.json()["detail"]
    assert deleted == ["I1"] and db.query(LibraryDocument).count() == 0

    # Graph's own rename suffix is fine; a different stem or extension is not
    assert lib.sharepoint_name_matches("v1-a.pdf", "v1-a.pdf") and lib.sharepoint_name_matches("v1-a.pdf", "V1-A 2.PDF")
    assert not lib.sharepoint_name_matches("v1-a.pdf", "v2-a.pdf") and not lib.sharepoint_name_matches("v1-a.pdf", "v1-a.exe")
    assert not lib.sharepoint_name_matches("v1-a.pdf", "v1-a 2b.pdf")


def test_new_version_of_an_expired_pricing_document_needs_a_fresh_expiry(client, db, team):
    ed = team["editor"]
    pricing = folder(client, ed, "Pricing", is_pricing=True)
    doc = upload(client, ed, pricing["id"], name="prices.xlsx", expiry_date=str(date.today() - timedelta(days=1)), size=MB).json()
    assert doc["is_expired"] is True
    refused = upload(client, ed, pricing["id"], name="prices rev2.xlsx", document_id=doc["id"], size=MB)
    assert refused.status_code == 422 and refused.json()["detail"] == lib.PRICING_EXPIRY_MESSAGE
    assert db.query(LibraryDocumentVersion).count() == 1
    future = str(date.today() + timedelta(days=60))
    ok = upload(client, ed, pricing["id"], name="prices rev2.xlsx", document_id=doc["id"], size=MB, expiry_date=future)
    assert ok.status_code == 200 and ok.json()["current_version_no"] == 2 and ok.json()["is_expired"] is False
    # a still-valid price list may get a new version without re-entering the date
    again = upload(client, ed, pricing["id"], name="prices rev3.xlsx", document_id=doc["id"], size=MB)
    assert again.status_code == 200 and again.json()["current_version_no"] == 3 and again.json()["expiry_date"] == future


def test_two_versions_at_once_give_a_409_not_a_500(client, db, team, monkeypatch):
    from sqlalchemy.exc import IntegrityError
    ed = team["editor"]
    f = folder(client, ed, "Docs")
    doc = upload(client, ed, f["id"], name="a.pdf", mime="application/pdf", size=MB).json()
    s = client.post(f"{API}/documents/upload-session", headers=auth(ed),
                    json={"file_name": "a2.pdf", "file_size": 10, "document_id": doc["id"]}).json()
    real_commit = db.commit

    def boom():
        raise IntegrityError("insert", {}, Exception("uq_crm_library_versions_doc_no"))

    monkeypatch.setattr(db, "commit", boom)
    r = client.post(f"{API}/documents/complete-upload", headers=auth(ed), json={"upload_token": s["upload_token"], "drive_item_id": "I"})
    monkeypatch.setattr(db, "commit", real_commit)
    assert r.status_code == 409 and r.json()["detail"] == (
        "Someone uploaded another version of this file at the same moment — open it again and retry.")
    assert db.query(LibraryDocumentVersion).count() == 1


def test_tag_search_finds_non_ascii_tags(client, db, team):
    ed = team["editor"]
    f = folder(client, ed, "Docs")
    hindi = upload(client, ed, f["id"], name="notes.pdf", mime="application/pdf", size=MB, tags=["ब्रेक", "रेल"]).json()
    upload(client, ed, f["id"], name="other.pdf", mime="application/pdf", size=MB, tags=["brake"])
    h = auth(ed)
    for q in ("ब्रेक", "रेल", "ब्रे"):
        assert [d["id"] for d in client.get(f"{API}/documents", params={"q": q}, headers=h).json()] == [hindi["id"]], q
    assert client.get(f"{API}/documents", params={"q": "ब्रेक brake"}, headers=h).json() == []  # AND across words
    assert client.get(f"{API}/documents/{hindi['id']}", headers=h).json()["tags"] == ["ब्रेक", "रेल"]


def test_built_in_folders_without_a_creator_are_admin_only_to_rename_move_delete(client, db, team):
    ed, admin = team["editor"], team["admin"]
    seeded = LibraryFolder(name="Templates", sort_order=7, created_by_id=None)
    db.add(seeded)
    db.commit()
    other = folder(client, ed, "Mine")
    h = auth(ed)
    for r in (client.patch(f"{API}/folders/{seeded.id}", json={"name": "Forms"}, headers=h),
              client.patch(f"{API}/folders/{seeded.id}", json={"parent_id": other["id"]}, headers=h),
              client.delete(f"{API}/folders/{seeded.id}", headers=h)):
        assert r.status_code == 403 and "built-in Knowledge Hub folder" in r.json()["detail"]
    # other edits (description) stay open to editors
    assert client.patch(f"{API}/folders/{seeded.id}", json={"description": "Standard forms"}, headers=h).status_code == 200
    assert client.patch(f"{API}/folders/{seeded.id}", json={"name": "Forms"}, headers=auth(admin)).status_code == 200
    assert client.delete(f"{API}/folders/{seeded.id}", headers=auth(admin)).status_code == 200
