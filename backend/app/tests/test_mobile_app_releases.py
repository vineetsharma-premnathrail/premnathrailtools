"""Mobile app (Android APK) releases - owner decision 2026-11-12
(docs/agent-runs/2026-11-12-mobile-app-updates/requirement.md).

Portal admins publish versions; every signed-in user reads the latest active
one and downloads it. SharePoint is mocked. The router is mounted on a small
test app here (it is registered in main.py by the Manager).
"""
import hashlib

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.auth.jwt_handler import create_access_token
from app.core.config import settings
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.organization.models.mobile_app_release import MobileAppRelease
from app.modules.organization.routes import mobile_app as mobile_app_routes
from app.modules.organization.services import mobile_app as svc

APK = b"PK\x03\x04" + b"fake-apk-body" * 100


@pytest.fixture
def sp(monkeypatch):
    """Fake SharePoint: records calls, stores nothing."""
    calls = {"uploads": [], "deleted": [], "link_fails": False}
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "fake-site")

    async def fake_upload(site_id, folder_path, upload_file):
        upload_file.file.seek(0)
        data = upload_file.file.read()
        calls["uploads"].append({"folder": folder_path, "name": upload_file.filename,
                                 "type": upload_file.content_type, "data": data})
        return {"name": upload_file.filename, "path": f"{folder_path}/{upload_file.filename}",
                "webUrl": "https://sp.example/x", "size": len(data), "item_id": "item-1"}

    async def fake_delete(site_id, path):
        calls["deleted"].append(path)

    async def fake_link(site_id, path):
        if calls["link_fails"]:
            raise HTTPException(status_code=502, detail="no link")
        return f"https://sp.example/download?p={path}"

    async def fake_stream(site_id, path):
        if calls.get("stream_fails"):
            raise HTTPException(status_code=503, detail=svc.DOWNLOAD_BUSY_MESSAGE)

        async def chunks():
            for i in range(0, len(APK), 100):
                yield APK[i:i + 100]

        async def close():
            calls["closed"] = True

        return chunks(), close

    monkeypatch.setattr(svc, "upload_file_to_sharepoint", fake_upload)
    monkeypatch.setattr(svc, "delete_file_from_sharepoint", fake_delete)
    monkeypatch.setattr(svc, "get_download_url", fake_link)
    monkeypatch.setattr(svc, "_open_sharepoint_stream", fake_stream)
    svc.reset_download_rate()
    yield calls
    svc.reset_download_rate()


@pytest.fixture
def api(db):
    test_app = FastAPI()
    test_app.include_router(mobile_app_routes.router, prefix="/api/v1")
    test_app.dependency_overrides[get_db] = lambda: db
    return TestClient(test_app, follow_redirects=False)


def _user(db, email, role="user"):
    u = User(email=email, name=email.split("@")[0].title(), role=role, is_active=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _publish(api, admin, code, name=None, data=APK, filename="app-release.apk", **form):
    body = {"version_name": name or f"1.0.{code}", "version_code": str(code), **{k: str(v) for k, v in form.items()}}
    return api.post("/api/v1/mobile-app/releases", data=body,
                    files={"file": (filename, data, "application/octet-stream")}, headers=_h(admin))


def test_latest_404_when_nothing_published(api, db, sp):
    user = _user(db, "staff@premnathrail.com")
    r = api.get("/api/v1/mobile-app/latest", headers=_h(user))
    assert r.status_code == 404
    assert r.json()["detail"] == "No app version has been published yet."


def test_admin_publishes_and_everyone_sees_latest(api, db, sp):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    user = _user(db, "staff@premnathrail.com")

    r = _publish(api, admin, 3, notes="First build", required="true", min_supported_version_code=2)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["version_code"] == 3 and body["required"] is True and body["min_supported_version_code"] == 2
    assert body["sha256"] == hashlib.sha256(APK).hexdigest()
    assert body["file_size"] == len(APK)
    assert body["uploaded_by_name"] == "Admin" and body["is_active"] is True
    assert body["file_name"] == "PremnathERP-1.0.3.apk"
    up = sp["uploads"][0]
    assert up["folder"].endswith("/Mobile App/Android/3") and up["type"] == svc.APK_MEDIA_TYPE and up["data"] == APK

    _publish(api, admin, 5, notes="Second")
    latest = api.get("/api/v1/mobile-app/latest", headers=_h(user)).json()
    assert latest["version_code"] == 5
    assert latest["download_path"] == f"/mobile-app/releases/{latest['id']}/download"
    assert "is_active" not in latest

    audit = db.query(AuditLog).filter(AuditLog.entity_type == "mobile_app_release", AuditLog.action == "create").count()
    assert audit == 2


def test_non_admin_is_refused(api, db, sp):
    user = _user(db, "staff@premnathrail.com")
    r = _publish(api, user, 1)
    assert r.status_code == 403
    assert "Only a portal admin" in r.json()["detail"]
    assert api.get("/api/v1/mobile-app/releases", headers=_h(user)).status_code == 403
    assert api.patch("/api/v1/mobile-app/releases/1", json={"required": True}, headers=_h(user)).status_code == 403
    assert api.delete("/api/v1/mobile-app/releases/1", headers=_h(user)).status_code == 403
    assert not sp["uploads"]


def test_not_logged_in_is_refused(api, db, sp):
    assert api.get("/api/v1/mobile-app/latest").status_code == 401


def test_version_code_must_be_higher(api, db, sp):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    assert _publish(api, admin, 4).status_code == 201
    r = _publish(api, admin, 3)
    assert r.status_code == 409
    assert r.json()["detail"] == (
        "Version code 3 is not higher than the latest published version (4). Use 5 or higher."
    )
    assert _publish(api, admin, 4).status_code == 409
    assert len(sp["uploads"]) == 1


@pytest.mark.parametrize("filename,data,status,needle", [
    ("app.zip", APK, 422, "not an Android app file"),
    ("app.apk", b"%PDF-1.4 renamed", 422, "not a real Android app file"),
    ("app.apk", b"", 422, "is empty"),
])
def test_bad_file_rejected(api, db, sp, filename, data, status, needle):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    r = _publish(api, admin, 1, data=data, filename=filename)
    assert r.status_code == status
    assert needle in r.json()["detail"]
    assert not sp["uploads"]


def test_size_cap(api, db, sp, monkeypatch):
    monkeypatch.setattr(svc, "MAX_APK_BYTES", 100)
    admin = _user(db, "admin@premnathrail.com", role="admin")
    r = _publish(api, admin, 1)
    assert r.status_code == 413
    assert "limit for an app file is 250 MB" in r.json()["detail"]


def test_bad_version_name_and_min_supported(api, db, sp):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    r = _publish(api, admin, 2, name="1.0 beta")
    assert r.status_code == 422 and "Version name" in r.json()["detail"]
    r = _publish(api, admin, 2, min_supported_version_code=3)
    assert r.status_code == 422 and "between 1 and this version's code (2)" in r.json()["detail"]


def test_download_redirects_and_falls_back_to_streaming(api, db, sp):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    user = _user(db, "staff@premnathrail.com")
    rid = _publish(api, admin, 1).json()["id"]

    r = api.get(f"/api/v1/mobile-app/releases/{rid}/download", headers=_h(user))
    assert r.status_code == 307
    assert r.headers["location"].startswith("https://sp.example/download")

    sp["link_fails"] = True
    r = api.get(f"/api/v1/mobile-app/releases/{rid}/download", headers=_h(user))
    assert r.status_code == 200
    assert r.content == APK
    assert r.headers["content-type"] == svc.APK_MEDIA_TYPE
    assert 'filename="PremnathERP-1.0.1.apk"' in r.headers["content-disposition"]
    assert sp.get("closed") is True

    sp["stream_fails"] = True
    r = api.get(f"/api/v1/mobile-app/releases/{rid}/download", headers=_h(user))
    assert r.status_code == 503 and r.json()["detail"] == svc.DOWNLOAD_BUSY_MESSAGE

    assert api.get("/api/v1/mobile-app/releases/999/download", headers=_h(user)).status_code == 404


def test_withdrawn_version_hidden_from_users(api, db, sp):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    user = _user(db, "staff@premnathrail.com")
    first = _publish(api, admin, 1).json()["id"]
    second = _publish(api, admin, 2).json()["id"]

    r = api.patch(f"/api/v1/mobile-app/releases/{second}", json={"is_active": False}, headers=_h(admin))
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert api.get("/api/v1/mobile-app/latest", headers=_h(user)).json()["id"] == first
    assert api.get(f"/api/v1/mobile-app/releases/{second}/download", headers=_h(user)).status_code == 404
    assert api.get(f"/api/v1/mobile-app/releases/{second}/download", headers=_h(admin)).status_code == 307


def test_patch_fields_and_validation(api, db, sp):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    rid = _publish(api, admin, 5, min_supported_version_code=2).json()["id"]
    r = api.patch(f"/api/v1/mobile-app/releases/{rid}",
                  json={"notes": "Fixes", "required": True, "min_supported_version_code": None}, headers=_h(admin))
    assert r.status_code == 200
    body = r.json()
    assert body["notes"] == "Fixes" and body["required"] is True and body["min_supported_version_code"] is None
    r = api.patch(f"/api/v1/mobile-app/releases/{rid}", json={"min_supported_version_code": 6}, headers=_h(admin))
    assert r.status_code == 422 and "between 1 and this version's code (5)" in r.json()["detail"]
    assert db.query(AuditLog).filter(AuditLog.action == "update").count() == 1


def test_list_sorted_ascending(api, db, sp):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    for code in (2, 7, 9):
        _publish(api, admin, code)
    rows = api.get("/api/v1/mobile-app/releases", headers=_h(admin)).json()
    assert [r["version_code"] for r in rows] == [2, 7, 9]
    assert all(r["uploaded_by_name"] == "Admin" and r["created_at"] for r in rows)


def test_delete_removes_record_and_file(api, db, sp):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    rid = _publish(api, admin, 1).json()["id"]
    r = api.delete(f"/api/v1/mobile-app/releases/{rid}", headers=_h(admin))
    assert r.status_code == 200
    assert len(sp["deleted"]) == 1 and sp["deleted"][0].endswith("/Mobile App/Android/1/PremnathERP-1.0.1.apk")
    assert db.get(MobileAppRelease, rid) is None
    assert db.query(AuditLog).filter(AuditLog.action == "delete", AuditLog.entity_id == rid).count() == 1


def test_delete_keeps_record_when_sharepoint_fails(api, db, sp, monkeypatch):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    rid = _publish(api, admin, 1).json()["id"]

    async def broken(site_id, path):
        raise HTTPException(status_code=502, detail="SharePoint delete failed: busy")

    monkeypatch.setattr(svc, "delete_file_from_sharepoint", broken)
    r = api.delete(f"/api/v1/mobile-app/releases/{rid}", headers=_h(admin))
    assert r.status_code == 502 and "was not deleted" in r.json()["detail"]
    assert db.get(MobileAppRelease, rid) is not None


def test_download_rate_limit(api, db, sp):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    user = _user(db, "staff@premnathrail.com")
    rid = _publish(api, admin, 1).json()["id"]
    for _ in range(svc.DOWNLOAD_LIMIT):
        assert api.get(f"/api/v1/mobile-app/releases/{rid}/download", headers=_h(user)).status_code == 307
    r = api.get(f"/api/v1/mobile-app/releases/{rid}/download", headers=_h(user))
    assert r.status_code == 429
    assert "Wait about" in r.json()["detail"]
    # Another user is not affected.
    assert api.get(f"/api/v1/mobile-app/releases/{rid}/download", headers=_h(admin)).status_code == 307


def test_upload_failure_gives_plain_message(api, db, sp, monkeypatch):
    async def broken(site_id, folder_path, upload_file):
        raise HTTPException(status_code=502, detail="SharePoint upload failed: {raw graph json}")

    monkeypatch.setattr(svc, "upload_file_to_sharepoint", broken)
    admin = _user(db, "admin@premnathrail.com", role="admin")
    r = _publish(api, admin, 1)
    assert r.status_code == 502
    assert r.json()["detail"].startswith("SharePoint did not accept the file.")
    assert "graph" not in r.json()["detail"]
    assert db.query(MobileAppRelease).count() == 0


def test_oversized_request_refused_before_reading(api, db, sp):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    headers = {**_h(admin), "Content-Length": str(svc.MAX_UPLOAD_REQUEST_BYTES + 1),
               "Content-Type": "multipart/form-data; boundary=x"}
    r = api.post("/api/v1/mobile-app/releases", content=b"", headers=headers)
    assert r.status_code == 413
    assert "limit for an app file is 250 MB" in r.json()["detail"]
    assert not sp["uploads"]
