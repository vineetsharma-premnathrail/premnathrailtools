"""Shared helpers for the test_cov_design_* coverage suites (no tests here).

Kept separate from test_design.py so these suites don't break when that
file is edited. SharePoint is replaced by an in-memory store."""
from datetime import date

import pytest

from app.auth.jwt_handler import create_access_token
from app.core.config import settings
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem

API = "/api/v1/design"
PDF = b"%PDF-1.7 test drawing"
YEAR = date.today().year


@pytest.fixture
def fake_sharepoint(monkeypatch):
    store: dict[str, bytes] = {}

    async def up(site_id, folder_path, upload_file):
        data = upload_file.file.read()
        path = f"{folder_path}/{upload_file.filename}"
        store[path] = data
        return {"name": upload_file.filename, "path": path, "webUrl": f"https://sp.example/{path}", "size": len(data)}

    async def down(site_id, file_path):
        return store[file_path], "application/octet-stream"

    async def delete(site_id, file_path):
        store.pop(file_path, None)

    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "test-site")
    for mod in ("app.modules.design.routes.revisions", "app.modules.design.files"):
        monkeypatch.setattr(f"{mod}.upload_file_to_sharepoint", up)
        monkeypatch.setattr(f"{mod}.download_file_content", down)
        monkeypatch.setattr(f"{mod}.delete_file_from_sharepoint", delete)
    monkeypatch.setattr("app.modules.design.routes.documents.delete_file_from_sharepoint", delete)
    return store


def make_user(db, email, apps=("design",), role="user", grants=None, active=True):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=active, assigned_apps=list(apps))
    if grants is not None:
        user.granular_permissions = list(grants)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def make_team(db):
    return {
        "author": make_user(db, "cov.author@premnathrail.com"),
        "checker": make_user(db, "cov.checker@premnathrail.com"),
        "approver": make_user(db, "cov.approver@premnathrail.com"),
        "other": make_user(db, "cov.other@premnathrail.com"),
        "admin": make_user(db, "cov.admin@premnathrail.com", role="admin"),
    }


def item(db, code, name=None, status="active", uom="NOS"):
    it = StoreItem(item_code=code, item_name=name or code, uom=uom, status=status)
    db.add(it)
    db.commit()
    db.refresh(it)
    return it


def set_team(client, team, roles, by="admin"):
    """roles: {team key: designer|reviewer|head}."""
    body = {"team": [{"user_id": team[k].id, "role": r} for k, r in roles.items()]}
    r = client.put(f"{API}/settings", json=body, headers=auth(team[by]))
    assert r.status_code == 200, r.text
    return r.json()


def create_doc(client, team, author="author", **extra):
    body = {
        "title": "Bogie frame GA", "document_type": "ga_drawing", "discipline": "mechanical",
        "reviewer_id": team["checker"].id, "approver_id": team["approver"].id, **extra,
    }
    r = client.post(f"{API}/documents", json=body, headers=auth(team[author]))
    assert r.status_code == 201, r.text
    return r.json()


def upload(client, user, revision_id, name="frame.pdf", data=PDF, role="primary"):
    return client.post(
        f"{API}/revisions/{revision_id}/files", headers=auth(user),
        files=[("files", (name, data, "application/pdf"))], data={"file_role": role},
    )


def rev(detail, label):
    return next(r for r in detail["revisions"] if r["revision_label"] == label)


def to_approval(client, team, revision_id, author="author"):
    """Upload → submit → checker passes. Leaves the revision in_approval."""
    assert upload(client, team[author], revision_id).status_code == 200
    r = client.post(f"{API}/revisions/{revision_id}/submit", json={}, headers=auth(team[author]))
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/revisions/{revision_id}/review", json={"decision": "pass"}, headers=auth(team["checker"]))
    assert r.status_code == 200, r.text
    return r.json()


def release(client, team, revision_id, author="author"):
    to_approval(client, team, revision_id, author)
    r = client.post(f"{API}/revisions/{revision_id}/approve", json={"decision": "pass"}, headers=auth(team["approver"]))
    assert r.status_code == 200, r.text
    return r.json()


def released_doc(client, team, **extra):
    doc = create_doc(client, team, **extra)
    return release(client, team, rev(doc, "R0")["id"])


def create_bom(client, team, product, lines, author="author", **extra):
    body = {"product_item_id": product.id, "title": extra.pop("title", f"BOM for {product.item_code}"), "lines": lines, **extra}
    return client.post(f"{API}/boms", json=body, headers=auth(team[author]))


def release_bom(client, team, revision_id, author="author", expect=200):
    h = auth(team[author])
    r = client.post(f"{API}/boms/revisions/{revision_id}/submit",
                    json={"reviewer_id": team["checker"].id, "approver_id": team["approver"].id}, headers=h)
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/boms/revisions/{revision_id}/review", json={"decision": "pass"}, headers=auth(team["checker"]))
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/boms/revisions/{revision_id}/approve", json={"decision": "pass"}, headers=auth(team["approver"]))
    assert r.status_code == expect, r.text
    return r.json()


def bom_with_released(client, team, product, lines, **extra):
    r = create_bom(client, team, product, lines, **extra)
    assert r.status_code == 201, r.text
    bom = r.json()
    return release_bom(client, team, bom["revisions"][0]["id"])
