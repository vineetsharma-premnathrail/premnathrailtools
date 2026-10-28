"""Idempotency keys: a save retried after a network failure is never saved twice.

The portal (frontend/src/lib/idempotency.ts) sends `Idempotency-Key` on every
POST / PUT / PATCH. When a save reached the server but the reply was lost
(network drop, timeout, closed tab), the person presses Save again with the
same data, and the browser sends the same key. This middleware then replays
the stored reply of the first save instead of running it again, so no
duplicate PR / PO / organization is created.

* Only successful (2xx) JSON / text replies are stored, for 24 hours. A
  failed save (4xx / 5xx) or a file reply (export, download) deletes its
  key, so fixing the data and saving again works. A first attempt still
  "in progress" after 5 minutes is treated as dead and a retry runs.
* A second request with a key whose first request is still running gets
  409 (code idempotency_in_progress); the frontend waits and asks again.
* Keys are per user (read from the session token), so one user can never
  replay another's reply.
* Requests without the header (scripts, tests, the auth routes) behave as
  before. If the table is missing (migration not run yet) it fails open.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from itertools import count

from anyio import CancelScope, to_thread
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

logger = logging.getLogger(__name__)

HEADER = b"idempotency-key"
METHODS = ("POST", "PUT", "PATCH")
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{8,100}$")
TTL = timedelta(hours=24)
# A first attempt still "in progress" after this long died (worker crash / redeploy) — let a retry run.
STALE_IN_PROGRESS = timedelta(minutes=5)
MAX_STORED_BODY = 2 * 1024 * 1024
SKIP_PREFIXES = ("/api/v1/auth/",)
_purge_counter = count()
# Tests point this at their own session factory (default: app.db.session.SessionLocal).
session_factory = None


def _session():
    if session_factory is not None:
        return session_factory()
    from app.db.session import SessionLocal
    return SessionLocal()


def _user_key(headers: dict[bytes, bytes]) -> str | None:
    token = None
    cookie = headers.get(b"cookie", b"").decode("latin-1")
    for part in cookie.split(";"):
        name, _, value = part.strip().partition("=")
        if name == "session_token" and value:
            token = value
    auth = headers.get(b"authorization", b"").decode("latin-1")
    if not token and auth.startswith("Bearer "):
        token = auth[7:].strip()
    if not token:
        return None
    from app.auth.jwt_handler import verify_access_token
    payload = verify_access_token(token) or {}
    if payload.get("sub"):
        return f"u{payload['sub']}"
    return "h" + hashlib.sha256(token.encode()).hexdigest()[:40]


def _send_json(status: int, body: dict, extra: list[tuple[bytes, bytes]] | None = None):
    raw = json.dumps(body).encode()
    return [
        {"type": "http.response.start", "status": status,
         "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(raw)).encode()), *(extra or [])]},
        {"type": "http.response.body", "body": raw},
    ]


# ── database steps (sync, run in a worker thread) ───────────────────────────

def _claim(user_key: str, key: str, method: str, path: str):
    """Insert the key as in progress. Returns None when claimed, else the
    existing row as a dict."""
    from app.modules.main.models.idempotency_record import IdempotencyRecord

    db = _session()
    try:
        if next(_purge_counter) % 500 == 0:
            db.query(IdempotencyRecord).filter(IdempotencyRecord.created_at < datetime.now(timezone.utc) - TTL).delete()
            db.commit()
        db.add(IdempotencyRecord(user_key=user_key, idem_key=key, method=method, path=path[:500], state="in_progress"))
        try:
            db.commit()
            return None
        except IntegrityError:
            db.rollback()
        row = db.query(IdempotencyRecord).filter_by(user_key=user_key, idem_key=key).first()
        if row is None:  # removed in between (the first save failed) — claim again
            db.add(IdempotencyRecord(user_key=user_key, idem_key=key, method=method, path=path[:500], state="in_progress"))
            db.commit()
            return None
        created = row.created_at if row.created_at.tzinfo else row.created_at.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        if created < now - TTL or (row.state != "done" and created < now - STALE_IN_PROGRESS):
            db.delete(row)
            db.commit()
            db.add(IdempotencyRecord(user_key=user_key, idem_key=key, method=method, path=path[:500], state="in_progress"))
            db.commit()
            return None
        return {"method": row.method, "path": row.path, "state": row.state, "status": row.response_status,
                "type": row.response_type, "body": row.response_body}
    finally:
        db.close()


def _finish(user_key: str, key: str, status: int, ctype: str | None, body: bytes | None, replayable: bool):
    from app.modules.main.models.idempotency_record import IdempotencyRecord

    db = _session()
    try:
        row = db.query(IdempotencyRecord).filter_by(user_key=user_key, idem_key=key).first()
        if row is None:
            return
        text = None
        if body is not None:
            try:
                text = body.decode("utf-8")
            except UnicodeDecodeError:
                replayable = False
        if 200 <= status < 300 and replayable:
            row.state = "done"
            row.response_status = status
            row.response_type = (ctype or "")[:150] or None
            row.response_body = text
        elif 200 <= status < 300 and "json" in (ctype or ""):
            # A saved JSON reply too big to keep: a retry is told it was saved (409 idempotency_replayed).
            row.state = "done"
            row.response_status = status
            row.response_type = (ctype or "")[:150] or None
            row.response_body = None
        else:
            # Failed saves, and file / download replies (exports, documents) — those
            # just run again, so the key is freed.
            db.delete(row)
        db.commit()
    finally:
        db.close()


class IdempotencyMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in METHODS:
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        headers = dict(scope.get("headers") or [])
        raw_key = headers.get(HEADER)
        if not raw_key or path.startswith(SKIP_PREFIXES):
            return await self.app(scope, receive, send)
        key = raw_key.decode("latin-1").strip()
        if not KEY_RE.match(key):
            for msg in _send_json(400, {"detail": "The Idempotency-Key header must be 8-100 letters, digits, '-' or '_'. Reload the page and save again."}):
                await send(msg)
            return
        user_key = _user_key(headers)
        if user_key is None:  # not signed in — the route answers 401 itself
            return await self.app(scope, receive, send)
        method = scope["method"]

        try:
            existing = await to_thread.run_sync(_claim, user_key, key, method, path)
        except SQLAlchemyError:
            logger.exception("idempotency: claim failed, continuing without it")
            return await self.app(scope, receive, send)

        if existing is not None:
            if existing["method"] != method or existing["path"] != path[:500]:
                msgs = _send_json(422, {"detail": "This save key was already used for a different action. Reload the page and save again."})
            elif existing["state"] != "done":
                msgs = _send_json(409, {"detail": "This save is still being processed on the server — wait a few seconds; it will not be saved twice.",
                                        "code": "idempotency_in_progress"})
            elif existing["body"] is None:
                msgs = _send_json(409, {"detail": "This was already saved. Reload the page to see it.", "code": "idempotency_replayed"},
                                  [(b"idempotent-replayed", b"true")])
            else:
                raw = existing["body"].encode("utf-8")
                msgs = [
                    {"type": "http.response.start", "status": existing["status"] or 200,
                     "headers": [(b"content-type", (existing["type"] or "application/json").encode()),
                                 (b"content-length", str(len(raw)).encode()), (b"idempotent-replayed", b"true")]},
                    {"type": "http.response.body", "body": raw},
                ]
            for msg in msgs:
                await send(msg)
            return

        captured: dict = {"status": 500, "type": None, "chunks": [], "size": 0, "too_big": False}

        async def capture(message):
            if message["type"] == "http.response.start":
                captured["status"] = message["status"]
                for name, value in message.get("headers") or []:
                    if name.lower() == b"content-type":
                        captured["type"] = value.decode("latin-1")
            elif message["type"] == "http.response.body":
                chunk = message.get("body") or b""
                captured["size"] += len(chunk)
                if captured["size"] > MAX_STORED_BODY:
                    captured["too_big"] = True
                    captured["chunks"] = []
                elif not captured["too_big"]:
                    captured["chunks"].append(chunk)
            try:
                await send(message)
            except OSError:  # the browser went away — still record the result below
                pass

        try:
            await self.app(scope, receive, capture)
        finally:
            ctype = captured["type"] or ""
            replayable = not captured["too_big"] and ("json" in ctype or "text" in ctype)
            body = b"".join(captured["chunks"]) if replayable else None
            # Shielded: a cancelled request (browser gone) must still finish its row,
            # or the key would stay "in progress".
            with CancelScope(shield=True):
                try:
                    await to_thread.run_sync(_finish, user_key, key, captured["status"], ctype, body, replayable)
                except SQLAlchemyError:
                    logger.exception("idempotency: could not record the result")
