"""Approve / Reject from the approval email (2026-10-27).

GET shows the document's details and a comment box — it never changes
anything (mail scanners open every link). POST takes the decision through
engine.decide(), exactly like My Approvals. No portal login: the signed token
in the link names the one step and the one person (services/approval_mail.py)
and stops working once that step is no longer pending for them.

The token travels in the query string on GET and in a hidden form field on
POST (the form posts to the bare path), never in the path. The app's own
request logs write the path only; uvicorn's access log writes the query too,
so _RedactToken below blanks the token there.
"""
import logging
import re
from html import escape

from fastapi import APIRouter, Depends, Form, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.core.audit_context import set_api_source, set_current_user_id
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequestStep
from app.modules.organization.services import approval_engine as engine
from app.modules.organization.services import approval_mail as mail

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/approvals/email", tags=["Approvals"])

_TOKEN_RE = re.compile(r"([?&]t=)[^&\s\"']+")


class _RedactToken(logging.Filter):
    """uvicorn.access logs 'GET /api/v1/approvals/email?t=<token>' — anyone
    reading the container logs could use a live link. Blank the token."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and record.args:
            record.args = tuple(_TOKEN_RE.sub(r"\1REDACTED", a) if isinstance(a, str) and "approvals/email" in a else a
                                for a in record.args)
        return True


logging.getLogger("uvicorn.access").addFilter(_RedactToken())

# Inline styles only, no scripts, forms post back here only. Set on the
# response and kept by the OWASP middleware for this one path.
PAGE_CSP = ("default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; "
            "form-action 'self'; frame-ancestors 'none'; base-uri 'none'")


def _page(title: str, body: str, status: int = 200) -> HTMLResponse:
    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow">
<title>{escape(title)} · Premnathrail ERP</title></head>
<body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:640px;margin:24px auto;padding:0 16px">
<div style="background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);overflow:hidden">
<div style="padding:16px 24px;border-bottom:3px solid #f97316;font-weight:700;font-size:16px">Premnathrail ERP · Approval</div>
<div style="padding:24px">{body}</div></div></div></body></html>"""
    return HTMLResponse(html, status_code=status, headers={"Content-Security-Policy": PAGE_CSP})


def _notice(title: str, message: str, portal_url: str | None = None, status: int = 200, ok: bool = False) -> HTMLResponse:
    color = "#16a34a" if ok else "#b45309"
    link = (f'<p style="margin:20px 0 0"><a href="{escape(portal_url)}" style="color:#ea580c;font-weight:600">'
            "Open the portal</a></p>") if portal_url else ""
    return _page(title, f'<h2 style="margin:0 0 12px;font-size:20px;color:{color}">{escape(title)}</h2>'
                        f'<p style="font-size:15px;line-height:1.5;margin:0">{escape(message)}</p>{link}', status)


def _inbox_url() -> str:
    from app.core.config import settings
    return settings.FRONTEND_URL.rstrip("/") + "/dashboard/organization/approvals"


def _resolve(db: Session, token: str) -> tuple[ApprovalRequestStep | None, User | None, HTMLResponse | None]:
    ids = mail.read_token(token)
    if ids is None:
        return None, None, _notice("Link expired", f"This approval link is not valid or is older than {mail.TOKEN_HOURS} hours. "
                                   "Open My Approvals in the portal to decide it there.", _inbox_url(), status=410)
    step, user = db.get(ApprovalRequestStep, ids[0]), db.get(User, ids[1])
    problem = mail.link_problem(db, step, user)
    if problem:
        return step, user, _notice("Nothing to decide", problem, _inbox_url(), status=410)
    return step, user, None


def _form(db: Session, step: ApprovalRequestStep, user: User, token: str, decision: str | None,
          comment: str = "", error: str | None = None) -> HTMLResponse:
    req = step.request
    s = mail.summary(db, req, step, user)
    err = (f'<div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:10px 12px;border-radius:8px;'
           f'font-size:14px;margin:0 0 16px">{escape(error)}</div>') if error else ""
    acting = "" if step.approver_id == user.id else (
        f'<p style="font-size:13px;color:#b45309;margin:0 0 12px">You are deciding on behalf of '
        f'{escape(step.approver.name if step.approver else "the approver")}.</p>')
    hint = "A reason is required to reject." + (" A comment is required to approve this document type." if s["comment_on_approve"] else "")
    focus = {"approve": "Approve", "reject": "Reject"}.get(decision or "", "")
    heading = f"{focus} {req.reference or req.title}" if focus else f"Decide {req.reference or req.title}"

    def btn(value: str, label: str, color: str) -> str:
        ring = "box-shadow:0 0 0 3px rgba(15,23,42,.25);" if value == decision else ""
        return (f'<button type="submit" name="decision" value="{value}" style="background:{color};color:#fff;border:0;'
                f'border-radius:8px;padding:12px 28px;font-size:15px;font-weight:700;cursor:pointer;margin:0 8px 8px 0;{ring}">'
                f"{label}</button>")

    body = (
        f'<h2 style="margin:0 0 6px;font-size:20px">{escape(heading)}</h2>'
        f'<p style="margin:0 0 16px;color:#475569;font-size:14px">Deciding as {escape(user.name or user.email)} '
        f'(from your approval email).</p>{acting}{err}{mail.details_html(s)}'
        f'<form method="post" action="/api/v1/approvals/email" style="margin:20px 0 0">'
        f'<input type="hidden" name="t" value="{escape(token)}">'
        f'<label for="c" style="display:block;font-size:14px;font-weight:600;margin:0 0 6px">Comment</label>'
        f'<textarea id="c" name="comment" rows="4" maxlength="2000" style="width:100%;box-sizing:border-box;border:1px solid #cbd5e1;'
        f'border-radius:8px;padding:10px;font-size:14px;font-family:inherit">{escape(comment)}</textarea>'
        f'<p style="font-size:12px;color:#64748b;margin:6px 0 16px">{hint}</p>'
        f'{btn("approve", "Approve", "#16a34a")}{btn("reject", "Reject", "#dc2626")}</form>'
        f'<p style="font-size:13px;margin:16px 0 0"><a href="{escape(s["portal_url"])}" style="color:#ea580c">'
        "Open the document in the portal</a> to see everything, or return it for changes.</p>"
    )
    return _page(heading, body)


@router.get("", response_class=HTMLResponse)
def approval_email_page(t: str = Query(""), d: str | None = Query(None), db: Session = Depends(get_db)):
    step, user, stop = _resolve(db, t)
    if stop:
        return stop
    return _form(db, step, user, t, d if d in ("approve", "reject") else None)


@router.post("", response_class=HTMLResponse)
def approval_email_decide(t: str = Form(""), decision: str = Form(""), comment: str = Form(""),
                          db: Session = Depends(get_db)):
    step, user, stop = _resolve(db, t)
    if stop:
        return stop
    if decision not in ("approve", "reject"):
        return _form(db, step, user, t, None, comment, "Press Approve or Reject.")
    comment = comment.strip()[:2000]
    req = step.request
    ref = req.reference or req.title
    # The ORM audit trail attributes changes to the request's user; this one came through the email link.
    set_current_user_id(user.id)
    set_api_source("email_link")
    try:
        engine.decide(db, req.id, user, decision, comment or None, only_step_id=step.id)
        from app.utils.notifications import notify_user
        # Not you? A forwarded mail can be used by whoever holds it — the approver hears of every email decision.
        done = "approved" if decision == "approve" else "rejected"
        notify_user(db, user.id, f"You {done} {ref} from your email",
                    f"You {done} {ref} using the link in your approval email. If this wasn't you, tell an ERP admin now.",
                    "approval", entity_type=req.entity_type, entity_id=req.entity_id, teams=True)
        db.commit()
    except HTTPException as exc:
        db.rollback()
        db.expire_all()
        step, user = db.get(ApprovalRequestStep, step.id), db.get(User, user.id)
        problem = mail.link_problem(db, step, user)
        if problem:
            return _notice("Nothing to decide", problem, _inbox_url(), status=410)
        return _form(db, step, user, t, decision, comment, str(exc.detail))
    except Exception:
        db.rollback()
        logger.exception("Email-link decision on approval step %s failed", step.id)
        return _notice("Could not save your decision", "Something failed on our side and nothing was changed. "
                       "Open My Approvals in the portal and decide it there; if that fails too, tell the ERP admin.",
                       _inbox_url(), status=500)
    verb = "approved" if decision == "approve" else "rejected"
    db.refresh(req)
    if decision == "approve" and req.status == "pending":
        nxt = next((s.stage_name for s in req.steps if s.sequence == req.current_sequence), "")
        after = f" It now goes to the next stage ({nxt})." if nxt else " It now waits for the other approvers of this stage."
    elif decision == "approve":
        after = " That was the last stage — the document is fully approved."
    else:
        after = " The requester has been told, with your reason."
    return _notice(f"{ref} {verb}", f"You {verb} {ref}.{after}", mail._portal_url(req, engine.transaction_types().get(req.workflow_key)), ok=True)
