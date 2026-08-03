from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User


def make_user(db, email, role="user"):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def test_user_can_submit_feedback(client, db):
    user = make_user(db, "feedback_user@premnathrail.com")
    response = client.post(
        "/api/v1/feedback",
        json={"message": "Please add dark mode."},
        headers=auth_header(user),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["message"] == "Please add dark mode."
    assert body["user_email"] == "feedback_user@premnathrail.com"
    assert body["is_read"] is False


def test_submit_feedback_rejects_empty_message(client, db):
    user = make_user(db, "feedback_empty@premnathrail.com")
    response = client.post("/api/v1/feedback", json={"message": ""}, headers=auth_header(user))
    assert response.status_code == 422


def test_submit_feedback_rejects_whitespace_only_message(client, db):
    user = make_user(db, "feedback_whitespace@premnathrail.com")
    response = client.post("/api/v1/feedback", json={"message": "   "}, headers=auth_header(user))
    assert response.status_code == 422


def test_submit_feedback_strips_surrounding_whitespace(client, db):
    user = make_user(db, "feedback_trim@premnathrail.com")
    response = client.post("/api/v1/feedback", json={"message": "  Add dark mode please  "}, headers=auth_header(user))
    assert response.status_code == 201
    assert response.json()["message"] == "Add dark mode please"


def test_non_admin_cannot_list_feedback(client, db):
    user = make_user(db, "feedback_normal@premnathrail.com")
    response = client.get("/api/v1/feedback", headers=auth_header(user))
    assert response.status_code == 403


def test_non_admin_cannot_see_unread_count(client, db):
    user = make_user(db, "feedback_normal2@premnathrail.com")
    response = client.get("/api/v1/feedback/unread-count", headers=auth_header(user))
    assert response.status_code == 403


def test_admin_can_list_feedback_and_unread_count(client, db):
    admin = make_user(db, "feedback_admin@premnathrail.com", role="admin")
    submitter = make_user(db, "feedback_submitter@premnathrail.com")

    client.post("/api/v1/feedback", json={"message": "Great portal!"}, headers=auth_header(submitter))

    count_response = client.get("/api/v1/feedback/unread-count", headers=auth_header(admin))
    assert count_response.status_code == 200
    assert count_response.json()["count"] == 1

    list_response = client.get("/api/v1/feedback", headers=auth_header(admin))
    assert list_response.status_code == 200
    entries = list_response.json()
    assert len(entries) == 1
    assert entries[0]["message"] == "Great portal!"
    assert entries[0]["user_name"] == "feedback_submitter"


def test_admin_marking_feedback_read_reduces_unread_count(client, db):
    admin = make_user(db, "feedback_admin2@premnathrail.com", role="admin")
    submitter = make_user(db, "feedback_submitter2@premnathrail.com")

    create_response = client.post("/api/v1/feedback", json={"message": "Bug report."}, headers=auth_header(submitter))
    feedback_id = create_response.json()["id"]

    mark_response = client.patch(f"/api/v1/feedback/{feedback_id}/read", headers=auth_header(admin))
    assert mark_response.status_code == 200
    assert mark_response.json()["is_read"] is True

    count_response = client.get("/api/v1/feedback/unread-count", headers=auth_header(admin))
    assert count_response.json()["count"] == 0


def test_non_admin_cannot_mark_feedback_read(client, db):
    user = make_user(db, "feedback_normal3@premnathrail.com")
    submitter = make_user(db, "feedback_submitter3@premnathrail.com")
    create_response = client.post("/api/v1/feedback", json={"message": "x"}, headers=auth_header(submitter))
    feedback_id = create_response.json()["id"]

    response = client.patch(f"/api/v1/feedback/{feedback_id}/read", headers=auth_header(user))
    assert response.status_code == 403


def test_mark_nonexistent_feedback_returns_404(client, db):
    admin = make_user(db, "feedback_admin3@premnathrail.com", role="admin")
    response = client.patch("/api/v1/feedback/99999/read", headers=auth_header(admin))
    assert response.status_code == 404


def test_list_feedback_sorts_unread_before_read(client, db):
    admin = make_user(db, "feedback_admin4@premnathrail.com", role="admin")
    submitter = make_user(db, "feedback_submitter4@premnathrail.com")

    old = client.post("/api/v1/feedback", json={"message": "old, will be read"}, headers=auth_header(submitter)).json()
    client.patch(f"/api/v1/feedback/{old['id']}/read", headers=auth_header(admin))
    client.post("/api/v1/feedback", json={"message": "newer, still unread"}, headers=auth_header(submitter))

    entries = client.get("/api/v1/feedback", headers=auth_header(admin)).json()
    assert [e["is_read"] for e in entries] == [False, True]
