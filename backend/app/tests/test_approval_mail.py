"""Approval emails with Approve / Reject links (2026-10-27):
- an email is queued for every approver whose turn it is, sent only after commit;
- the link page never decides on GET, the POST decides through engine.decide();
- a link works only for its own pending step and person, and stops after use,
  hand-over, expiry or tampering; reject needs a reason."""
import pytest

from app.core.config import settings
from app.modules.main.models.user import User
from app.modules.organization.services import approval_engine as engine
from app.modules.organization.services import approval_mail as mail

KEY = "test.approval_mail"
APPROVE = ["quality:ncr:approve", "quality:ncr:reject"]
URL = "/api/v1/approvals/email"

engine.register_transaction(engine.TransactionType(
    key=KEY, module_key="quality", subtab_key="ncr", label="Test mail approval", entity_type="test_mail_approval",
    url="/dashboard/quality/ncr/{id}", default_stages=[engine.StageDef("Check", "partner")],
    context_fields={"vendor_name": {"label": "Vendor", "type": "text"}},
))


def _user(db, email, grants=(), **kw):
    u = User(email=email, name=email.split("@")[0], role=kw.pop("role", "user"), is_active=True, **kw)
    u.granular_permissions = list(grants)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _stage(name, user_ids):
    return {"name": name, "approver_rule": "specific_users", "rule_config": {"user_ids": user_ids}, "approval_mode": "any",
            "conditions": [], "skip_if_no_approver": False, "escalate_after_hours": None, "escalation_rule": None,
            "escalation_config": {}}


@pytest.fixture
def sent(monkeypatch):
    out: list[tuple[int, int]] = []
    monkeypatch.setattr(settings, "SENDER_EMAIL", "erp@example.com")
    monkeypatch.setattr(mail, "_submit_job", lambda step_id, user_id: out.append((step_id, user_id)))
    return out


@pytest.fixture
def team(db):
    t = {
        "admin": _user(db, "am.admin@premnathrail.com", role="admin"),
        "req": _user(db, "am.req@premnathrail.com"),
        "a1": _user(db, "am.a1@premnathrail.com", grants=APPROVE),
        "a2": _user(db, "am.a2@premnathrail.com", grants=APPROVE),
    }
    engine.save_workflow(db, KEY, {"stages": [_stage("First", [t["a1"].id]), _stage("Second", [t["a2"].id])],
                                   "is_active": True, "allow_self_approval": False}, t["admin"])
    db.commit()
    return t


def _submit(db, team, n=1):
    req = engine.submit(db, KEY, entity_id=n, requester=team["req"], title=f"Doc {n}", reference=f"D-{n}",
                        amount=125000, context={"vendor_name": "Acme Tools"})
    db.commit()
    return req


def _step(req, user):
    return next(s for s in req.steps if s.approver_id == user.id)


def test_mail_queued_only_after_commit_and_next_stage_gets_its_own(db, team, sent):
    req = engine.submit(db, KEY, entity_id=1, requester=team["req"], title="Doc 1", reference="D-1")
    assert sent == []  # not before commit
    db.commit()
    assert sent == [(_step(req, team["a1"]).id, team["a1"].id)]

    engine.decide(db, req.id, team["a1"], "approve")
    db.commit()
    assert sent[-1] == (_step(req, team["a2"]).id, team["a2"].id)


def test_rolled_back_submit_sends_nothing(db, team, sent):
    engine.submit(db, KEY, entity_id=2, requester=team["req"], title="Doc 2", reference="D-2")
    db.rollback()
    db.commit()
    assert sent == []


def test_email_shows_details_and_buttons(db, team, sent):
    req = _submit(db, team)
    step = _step(req, team["a1"])
    subject, html = mail.build_email(db, step, team["a1"])
    assert subject == "Approval needed: D-1"
    for text in ("Test mail approval", "D-1", "₹ 125,000.00", "Acme Tools", "First", "am.req", ">Approve<", ">Reject<"):
        assert text in html
    assert f"{URL}?t=" in html and "&amp;d=approve" in html


def test_get_shows_page_and_never_decides(client, db, team, sent):
    req = _submit(db, team)
    token = mail.make_token(_step(req, team["a1"]).id, team["a1"].id)
    r = client.get(URL, params={"t": token, "d": "approve"})
    assert r.status_code == 200
    assert "Acme Tools" in r.text and 'name="decision" value="approve"' in r.text
    assert "script-src" not in r.headers["content-security-policy"] and "form-action 'self'" in r.headers["content-security-policy"]
    db.refresh(req)
    assert _step(req, team["a1"]).status == "pending"


def test_post_approve_moves_on_and_link_then_stops(client, db, team, sent):
    req = _submit(db, team)
    token = mail.make_token(_step(req, team["a1"]).id, team["a1"].id)
    r = client.post(URL, data={"t": token, "decision": "approve", "comment": "Checked rates"})
    assert r.status_code == 200 and "next stage (Second)" in r.text
    db.refresh(req)
    s1 = _step(req, team["a1"])
    assert s1.status == "approved" and s1.comment == "Checked rates" and s1.decided_by_id == team["a1"].id

    again = client.post(URL, data={"t": token, "decision": "approve"})
    assert again.status_code == 410 and "already approved" in again.text


def test_reject_needs_a_reason(client, db, team, sent):
    req = _submit(db, team)
    token = mail.make_token(_step(req, team["a1"]).id, team["a1"].id)
    r = client.post(URL, data={"t": token, "decision": "reject", "comment": "  "})
    assert r.status_code == 200 and "Write a comment saying why" in r.text
    db.refresh(req)
    assert req.status == "pending"

    r = client.post(URL, data={"t": token, "decision": "reject", "comment": "Wrong vendor"})
    assert r.status_code == 200
    db.refresh(req)
    assert req.status == "rejected"


def test_return_is_not_offered_by_mail(client, db, team, sent):
    req = _submit(db, team)
    token = mail.make_token(_step(req, team["a1"]).id, team["a1"].id)
    r = client.post(URL, data={"t": token, "decision": "return", "comment": "x"})
    assert "Press Approve or Reject" in r.text
    db.refresh(req)
    assert req.status == "pending"


def test_link_of_one_person_or_stage_cannot_be_used_by_another(client, db, team, sent):
    req = _submit(db, team)
    # Token naming the second-stage approver while stage one is still open.
    early = mail.make_token(_step(req, team["a2"]).id, team["a2"].id)
    assert client.post(URL, data={"t": early, "decision": "approve"}).status_code == 410
    # Token naming the requester on the approver's step.
    wrong = mail.make_token(_step(req, team["a1"]).id, team["req"].id)
    assert client.post(URL, data={"t": wrong, "decision": "approve"}).status_code == 410
    db.refresh(req)
    assert all(s.status in ("pending", "waiting") for s in req.steps)


def test_tampered_expired_and_handed_over_links_stop(client, db, team, sent):
    req = _submit(db, team)
    step = _step(req, team["a1"])
    token = mail.make_token(step.id, team["a1"].id)
    assert client.get(URL, params={"t": token[:-3] + "abc"}).status_code == 410
    assert client.get(URL, params={"t": mail.make_token(step.id, team["a1"].id, hours=-1)}).status_code == 410
    assert client.get(URL, params={"t": ""}).status_code == 410

    other = _user(db, "am.other@premnathrail.com", grants=APPROVE)
    engine.reassign_pending(db, team["a1"].id, other.id, team["admin"], "handover")
    db.commit()
    assert sent[-1] == (step.id, other.id)
    r = client.get(URL, params={"t": token})
    assert r.status_code == 410 and "no longer waiting for you" in r.text


def test_engine_rules_still_apply_through_mail(client, db, team, sent):
    # Approve permission taken away after the mail went out: decide() refuses, the page says why.
    req = _submit(db, team)
    token = mail.make_token(_step(req, team["a1"]).id, team["a1"].id)
    team["a1"].granular_permissions = []
    db.commit()
    r = client.post(URL, data={"t": token, "decision": "approve"})
    assert r.status_code == 200 and "permission" in r.text
    db.refresh(req)
    assert req.status == "pending" and _step(req, team["a1"]).status == "pending"


def test_pr_and_po_lines_provider_registered():
    mail._load_providers()
    assert {"p2p.purchase_requisition", "p2p.purchase_order"} <= set(mail._LINE_PROVIDERS)


def test_no_mail_when_caller_decides_at_once(db, team, sent):
    engine.submit(db, KEY, entity_id=3, requester=team["req"], title="Doc 3", reference="D-3", notify=False)
    db.commit()
    assert sent == []


def test_page_needs_no_portal_session(client, db, team, sent):
    req = _submit(db, team)
    client.cookies.clear()
    r = client.get(URL, params={"t": mail.make_token(_step(req, team["a1"]).id, team["a1"].id)})
    assert r.status_code == 200 and "Deciding as am.a1" in r.text


def test_second_click_never_decides_the_next_stage(client, db, team, sent):
    # a1 approves both stages' approvers list: a double click must not approve stage two too.
    engine.save_workflow(db, KEY, {"stages": [_stage("First", [team["a1"].id]), _stage("Second", [team["a1"].id, team["a2"].id])],
                                   "is_active": True, "allow_self_approval": False}, team["admin"])
    db.commit()
    req = _submit(db, team, 5)
    first = next(s for s in req.steps if s.approver_id == team["a1"].id and s.stage_name == "First")
    engine.decide(db, req.id, team["a1"], "approve", only_step_id=first.id)
    db.commit()
    with pytest.raises(engine.HTTPException) as exc:
        engine.decide(db, req.id, team["a1"], "approve", only_step_id=first.id)
    assert exc.value.status_code == 409
    db.rollback()
    db.refresh(req)
    assert all(s.status == "pending" for s in req.steps if s.stage_name == "Second")


def test_admin_cannot_stand_in_through_a_link(db, team, sent):
    req = _submit(db, team, 6)
    step = _step(req, team["a1"])
    with pytest.raises(engine.HTTPException) as exc:
        engine.decide(db, req.id, team["admin"], "approve", "standing in", only_step_id=step.id)
    assert exc.value.status_code == 403


def test_access_log_token_is_redacted():
    import logging
    from app.modules.organization.routes.approval_mail import _RedactToken
    rec = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                            ("1.2.3.4", "GET", "/api/v1/approvals/email?t=abc.def.ghi&d=approve", "1.1", 200), None)
    _RedactToken().filter(rec)
    assert rec.args[2] == "/api/v1/approvals/email?t=REDACTED&d=approve"
