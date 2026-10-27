"""Approval request emails with Approve / Reject links (2026-10-27).

Every time a step of the central approval engine becomes someone's turn
(first stage, next stage, hand-over, escalation, delegate), that person gets
an email with the document's details and two buttons. A button opens a small
page (routes/approval_mail.py) showing the same details and a comment box; the
decision is only taken when the approver presses Confirm there (a POST). A
link that approves on GET would be approved by Microsoft Defender's Safe Links
scanner, which opens every link in a mail before the person sees it.

The link carries a signed token naming one step and one person, valid for
TOKEN_HOURS. It needs no portal login (owner decision 2026-10-27) and no table
of its own: it stops working by itself once that step is no longer pending for
that person (decided, skipped, moved to someone else, request cancelled), and
the decision goes through engine.decide(), so four-eyes, permissions, module
rules, audit and the next stage's email are exactly what the portal does.

Mails are queued on the session and sent only after it commits, from a
background thread: a rolled-back submit sends nothing and a slow mailbox never
holds up the request.

Modules can add line items to the mail with register_email_lines(); provider
modules are listed in _PROVIDER_MODULES and imported on first use.
"""
from __future__ import annotations

import asyncio
import importlib
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Callable
from urllib.parse import quote

from jose import JWTError, jwt
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest, ApprovalRequestStep

logger = logging.getLogger(__name__)

TOKEN_HOURS = 72
_PURPOSE = "approval_mail"
_IST = timezone(timedelta(hours=5, minutes=30))
MAX_LINES = 25

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="approval-mail")


# ── Token ────────────────────────────────────────────────────────────────

def make_token(step_id: int, user_id: int, hours: int = TOKEN_HOURS) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=hours)
    return jwt.encode({"purpose": _PURPOSE, "sid": step_id, "uid": user_id, "exp": exp}, settings.SECRET_KEY, algorithm="HS256")


def read_token(token: str) -> tuple[int, int] | None:
    """(step_id, user_id), or None when the token is forged, altered or expired."""
    try:
        p = jwt.decode(token or "", settings.SECRET_KEY, algorithms=["HS256"])
    except JWTError:
        return None
    if p.get("purpose") != _PURPOSE or not isinstance(p.get("sid"), int) or not isinstance(p.get("uid"), int):
        return None
    return p["sid"], p["uid"]


def page_url(token: str, decision: str | None = None) -> str:
    # Token in the query, not the path: the app's request logs write the path
    # only (uvicorn's access log is redacted in routes/approval_mail.py).
    url = f"{settings.APP_BASE_URL.rstrip('/')}/api/v1/approvals/email?t={quote(token, safe='')}"
    return url + (f"&d={decision}" if decision else "")


def link_problem(db: Session, step: ApprovalRequestStep | None, user: User | None) -> str | None:
    """Why this link can't be used any more, in words for the approver; None = usable."""
    from app.modules.organization.services import approval_engine as engine

    if step is None or user is None:
        return "This approval no longer exists. Open My Approvals in the portal to see what is waiting for you."
    if not user.is_active:
        return "Your portal account is inactive, so this link can't be used. Ask an admin to reactivate it."
    req = step.request
    ref = req.reference or req.title
    if req.status != "pending":
        return f"{ref} is already {req.status} — nothing left to decide."
    if step.status != "pending" or step.sequence != req.current_sequence:
        if step.status in ("approved", "rejected", "returned") and step.decided_by:
            return (f"{ref} was already {step.status} at stage '{step.stage_name}' by {step.decided_by.name}"
                    f"{' on ' + _when(step.decided_at) if step.decided_at else ''}.")
        return f"Stage '{step.stage_name}' of {ref} is no longer waiting for a decision."
    if not engine._via(db, user, step, req):
        return (f"{ref} is no longer waiting for you — it was moved to someone else or your delegation ended. "
                "Open My Approvals in the portal to see what is waiting for you.")
    return None


# ── Queue on the session, send after commit ──────────────────────────────

def queue(db: Session, step: ApprovalRequestStep, user_ids) -> None:
    """Email these people about this (pending) step once the session commits."""
    if step.id is None:
        db.flush()
    items = db.info.setdefault("_approval_mails", [])
    items.extend((step.id, uid) for uid in user_ids if uid)
    if not db.info.get("_approval_mail_hooked"):
        db.info["_approval_mail_hooked"] = True
        event.listen(db, "after_commit", _dispatch)
        event.listen(db, "after_rollback", _clear)


def _clear(session: Session) -> None:
    session.info.pop("_approval_mails", None)


def _dispatch(session: Session) -> None:
    items = list(dict.fromkeys(session.info.pop("_approval_mails", None) or []))
    if not items:
        return
    if not settings.SENDER_EMAIL:
        logger.info("Approval emails not sent: SENDER_EMAIL is not configured (%d queued).", len(items))
        return
    for step_id, user_id in items:
        _submit_job(step_id, user_id)


def _submit_job(step_id: int, user_id: int) -> None:
    _executor.submit(send_now, step_id, user_id)


def send_now(step_id: int, user_id: int) -> bool:
    """Build and send one approval email in its own session. Never raises."""
    from app.db.session import SessionLocal
    from app.utils.email import _send_graph_mail

    db = SessionLocal()
    try:
        step = db.get(ApprovalRequestStep, step_id)
        user = db.get(User, user_id)
        if link_problem(db, step, user) or not user.email or not user.notifications_enabled:
            return False
        subject, html = build_email(db, step, user)
        ok, err = asyncio.run(_send_graph_mail(
            settings.SENDER_EMAIL, subject, html, user.email, user.name or user.email, sender_name="Premnathrail ERP",
        ))
        if not ok:
            logger.warning("Approval email for step %s to user %s failed: %s", step_id, user_id, err)
        return ok
    except Exception:
        logger.exception("Approval email for step %s to user %s failed", step_id, user_id)
        return False
    finally:
        db.close()


# ── Details shown in the mail and on the page ────────────────────────────

_LINE_PROVIDERS: dict[str, Callable[[Session, ApprovalRequest, User], dict | None]] = {}
_PROVIDER_MODULES = ("app.modules.p2p.approval_mail_lines",)
_providers_loaded = False


def register_email_lines(workflow_key: str, fn: Callable[[Session, ApprovalRequest, User], dict | None]) -> None:
    """fn(db, request, reader) — reader is the approver the mail is for (hide what they may not see) -> {"columns": [...], "rows": [[...], ...], "align": ["l"|"r", ...]} or None."""
    _LINE_PROVIDERS[workflow_key] = fn


def _load_providers() -> None:
    global _providers_loaded
    if _providers_loaded:
        return
    _providers_loaded = True
    for name in _PROVIDER_MODULES:
        try:
            importlib.import_module(name)
        except Exception:
            logger.exception("Approval email line provider %s failed to load", name)


def _when(dt: datetime | None) -> str:
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_IST).strftime("%d %b %Y, %I:%M %p")


def money(v) -> str:
    try:
        return f"₹ {float(v):,.2f}"
    except (TypeError, ValueError):
        return ""


def _context_value(db: Session, meta: dict, value) -> str:
    kind = meta.get("type")
    if kind == "bool":
        return "Yes" if value else "No"
    if kind == "user":
        u = db.get(User, value) if isinstance(value, int) else None
        return u.name if u else ""
    if kind == "number" and isinstance(value, (int, float)):
        return f"{value:,.2f}".rstrip("0").rstrip(".")
    return str(value)


def summary(db: Session, req: ApprovalRequest, step: ApprovalRequestStep, reader: User) -> dict:
    from app.modules.organization.services import approval_engine as engine

    tt = engine.transaction_types().get(req.workflow_key)
    fields: list[tuple[str, str]] = [
        ("Document", tt.label if tt else req.workflow_key),
        ("Reference", req.reference or ""),
        ("Title", req.title),
    ]
    if req.amount is not None:
        fields.append(("Amount", money(req.amount)))
    fields += [
        ("Requested by", req.requester.name if req.requester else ""),
        ("Submitted", _when(req.submitted_at)),
        ("Your stage", step.stage_name),
    ]
    if step.due_at:
        fields.append(("Decide by", _when(step.due_at)))
    ctx = req.context or {}
    for name, meta in (tt.context_fields if tt else {}).items():
        value = ctx.get(name)
        if name == "amount" or value is None or value == "" or value == []:
            continue
        shown = _context_value(db, meta, value)
        if shown:
            fields.append((meta.get("label") or name, shown))
    fields = [(k, v) for k, v in fields if v]

    history = [
        (s.stage_name, s.decided_by.name if s.decided_by else "", s.status, s.comment or "")
        for s in sorted(req.steps, key=lambda s: (s.sequence, s.id or 0))
        if s.status in ("approved", "rejected", "returned")
    ]

    _load_providers()
    lines = None
    fn = _LINE_PROVIDERS.get(req.workflow_key)
    if fn:
        try:
            lines = fn(db, req, reader)
        except Exception:
            logger.exception("Approval email lines for %s #%s failed", req.workflow_key, req.entity_id)
    return {
        "fields": fields, "history": history, "lines": lines,
        "type_label": tt.label if tt else "document",
        "portal_url": _portal_url(req, tt),
        "comment_on_approve": bool(tt and tt.comment_required_on_approve),
    }


def _portal_url(req: ApprovalRequest, tt) -> str:
    from app.core.record_ref import encode_ref

    base = settings.FRONTEND_URL.rstrip("/")
    if tt and tt.url:
        return base + tt.url.format(id=encode_ref(req.entity_id))
    return base + "/dashboard/organization/approvals"


# ── HTML ─────────────────────────────────────────────────────────────────

def _fields_html(fields) -> str:
    rows = "".join(
        f'<tr style="{"background:#f8fafc;" if i % 2 else ""}">'
        f'<td style="padding:8px 12px;color:#64748b;width:150px;vertical-align:top">{escape(k)}</td>'
        f'<td style="padding:8px 12px;font-weight:600;color:#0f172a">{escape(v)}</td></tr>'
        for i, (k, v) in enumerate(fields)
    )
    return f'<table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e2e8f0">{rows}</table>'


def _lines_html(lines: dict | None) -> str:
    if not lines or not lines.get("rows"):
        return ""
    cols = lines["columns"]
    align = lines.get("align") or ["l"] * len(cols)
    rows = lines["rows"]
    th = "".join(
        f'<th style="padding:6px 8px;text-align:{"right" if a == "r" else "left"};background:#f1f5f9;color:#475569;'
        f'font-size:12px;border-bottom:1px solid #e2e8f0">{escape(c)}</th>' for c, a in zip(cols, align)
    )
    body = "".join(
        "<tr>" + "".join(
            f'<td style="padding:6px 8px;text-align:{"right" if a == "r" else "left"};border-bottom:1px solid #f1f5f9">'
            f'{escape(str(v if v is not None else ""))}</td>' for v, a in zip(r, align)
        ) + "</tr>" for r in rows[:MAX_LINES]
    )
    more = (f'<p style="font-size:12px;color:#64748b;margin:6px 0 0">+ {len(rows) - MAX_LINES} more line(s) — '
            "open the document in the portal to see all.</p>") if len(rows) > MAX_LINES else ""
    title = escape(lines.get("title") or "Lines")
    return (f'<h3 style="font-size:14px;margin:20px 0 8px;color:#0f172a">{title}</h3>'
            f'<table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e2e8f0">'
            f"<tr>{th}</tr>{body}</table>{more}")


def _history_html(history) -> str:
    if not history:
        return ""
    items = "".join(
        f'<li style="margin:0 0 4px">{escape(stage)}: <b>{escape(status)}</b> by {escape(who)}'
        f'{" — “" + escape(comment) + "”" if comment else ""}</li>'
        for stage, who, status, comment in history
    )
    return (f'<h3 style="font-size:14px;margin:20px 0 8px;color:#0f172a">Earlier decisions</h3>'
            f'<ul style="margin:0;padding-left:18px;font-size:13px;color:#334155">{items}</ul>')


def details_html(s: dict) -> str:
    return _fields_html(s["fields"]) + _lines_html(s["lines"]) + _history_html(s["history"])


def _button(href: str, label: str, color: str) -> str:
    return (f'<a href="{escape(href)}" style="display:inline-block;background:{color};color:#fff;text-decoration:none;'
            f'font-weight:700;font-size:15px;padding:12px 28px;border-radius:8px;margin:0 8px 8px 0">{label}</a>')


def build_email(db: Session, step: ApprovalRequestStep, user: User) -> tuple[str, str]:
    from app.utils.email import _wrap_email_html

    req = step.request
    s = summary(db, req, step, user)
    token = make_token(step.id, user.id)
    acting = "" if step.approver_id == user.id else (
        f'<p style="font-size:13px;color:#b45309;margin:0 0 12px">You are deciding on behalf of '
        f'{escape(step.approver.name if step.approver else "the approver")} (delegation / escalation).</p>')
    body = (
        f'<p style="font-size:15px;margin:0 0 6px;color:#0f172a">Hello {escape(user.name or "")},</p>'
        f'<p style="font-size:15px;margin:0 0 16px;color:#0f172a">{escape(s["type_label"])} '
        f'<b>{escape(req.reference or req.title)}</b> is waiting for your approval.</p>'
        f"{acting}{details_html(s)}"
        f'<div style="margin:24px 0 8px">{_button(page_url(token, "approve"), "Approve", "#16a34a")}'
        f'{_button(page_url(token, "reject"), "Reject", "#dc2626")}</div>'
        f'<p style="font-size:12px;color:#64748b;margin:0 0 4px">The button opens a short page where you can add a comment '
        f"and confirm. A reason is needed to reject. The link works for {TOKEN_HOURS} hours and only for you — "
        "please don't forward this email.</p>"
        f'<p style="font-size:13px;margin:12px 0 0"><a href="{escape(s["portal_url"])}" style="color:#ea580c">'
        "Open the document in the portal</a></p>"
    )
    subject = f"Approval needed: {req.reference or req.title}"[:250]
    return subject, _wrap_email_html(body)
