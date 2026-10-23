"""Basis logs: SU53 denied-request trace and SM21/ST22 system error log.

Both write through their OWN session (never the failing request's session,
which may be mid-rollback) and never raise — logging must not turn a 403 or
500 into a different error. `SESSION_FACTORY` is looked up at call time so the
test-suite can point it at its in-memory database."""
import logging
import re
import threading
import time
import traceback as tb
import uuid

logger = logging.getLogger(__name__)

SESSION_FACTORY = None  # tests override; None -> app.db.session.SessionLocal

# --- rate limiter: identical denials (user + permission + path) inside the
# window are folded into one row (repeat_count += 1); at most MAX_NEW_PER_MIN
# new rows a minute process-wide so a script hammering a forbidden URL can't
# flood the table.
DEDUP_WINDOW_S = 600
MAX_NEW_PER_MIN = 120
_lock = threading.Lock()
_recent: dict[tuple, tuple[int, float]] = {}
_minute: list[float] = [0.0, 0.0]  # [window start, count]

_KEY_RE = re.compile(r"\(([a-z_]+:[a-z_*]+(?::[a-z_*]+)?)\)")
_APP_RE = re.compile(r"Access to '([a-z_]+)' module required")


def _session():
    if SESSION_FACTORY is not None:
        return SESSION_FACTORY()
    from app.db.session import SessionLocal
    return SessionLocal()


def permission_key_from_detail(detail) -> str | None:
    text = detail if isinstance(detail, str) else str(detail or "")
    m = _KEY_RE.search(text)
    if m:
        key = m.group(1)
        return key if key.count(":") == 2 else f"{key}:view"
    m = _APP_RE.search(text)
    if m:
        return f"{m.group(1)}:*:view"
    return None


def reset_rate_limiter() -> None:
    with _lock:
        _recent.clear()
        _minute[0], _minute[1] = 0.0, 0


def record_denial(method: str, path: str, detail, user_id: int | None, permission_key: str | None = None) -> None:
    from app.modules.main.models.grc import PermissionDenial

    # The core checks pass the id (PermissionDenied); older messages still name it in brackets.
    key = permission_key or permission_key_from_detail(detail)
    now = time.monotonic()
    dedup = (user_id, key, path)
    with _lock:
        prev = _recent.get(dedup)
        if prev and now - prev[1] < DEDUP_WINDOW_S:
            row_id = prev[0]
            _recent[dedup] = (row_id, prev[1])
        else:
            row_id = None
            if now - _minute[0] >= 60:
                _minute[0], _minute[1] = now, 0
            if _minute[1] >= MAX_NEW_PER_MIN:
                return
            _minute[1] += 1
    db = None
    try:
        db = _session()
        if row_id is not None:
            row = db.get(PermissionDenial, row_id)
            if row is not None:
                row.repeat_count = (row.repeat_count or 1) + 1
                db.commit()
                return
        row = PermissionDenial(user_id=user_id, permission_key=key, method=method[:10], path=path[:400],
                               detail=(detail if isinstance(detail, str) else str(detail))[:2000], repeat_count=1)
        db.add(row)
        db.commit()
        with _lock:
            _recent[dedup] = (row.id, now)
            if len(_recent) > 5000:
                for k in [k for k, v in _recent.items() if now - v[1] >= DEDUP_WINDOW_S]:
                    _recent.pop(k, None)
    except Exception:  # noqa: BLE001 — never break the 403 response
        logger.warning("Could not record permission denial", exc_info=True)
    finally:
        if db is not None:
            db.close()


_REDACT_RE = re.compile(r"(?i)(token|code|password|secret|key|sig)=[^&]*")


def new_error_ref() -> str:
    return str(uuid.uuid4())


def record_error(error_ref: str, request, exc: Exception, user_id: int | None) -> None:
    from app.modules.main.models.grc import SystemErrorLog

    db = None
    try:
        db = _session()
        qs = request.url.query or ""
        ip = request.client.host if request.client else None
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            ip = fwd.split(",")[0].strip()
        db.add(SystemErrorLog(
            error_ref=error_ref, method=request.method, path=request.url.path[:400],
            query_string=_REDACT_RE.sub(r"\1=***", qs)[:2000] or None, status_code=500,
            exception_type=f"{type(exc).__module__}.{type(exc).__name__}"[:160], message=str(exc)[:4000],
            traceback="".join(tb.format_exception(type(exc), exc, exc.__traceback__))[-20000:],
            user_id=user_id, ip_address=(ip or "")[:64] or None,
            user_agent=(request.headers.get("user-agent") or "")[:400] or None,
        ))
        db.commit()
    except Exception:  # noqa: BLE001 — never break the 500 response
        logger.warning("Could not persist system error %s", error_ref, exc_info=True)
    finally:
        if db is not None:
            db.close()


def prune(days: int = 90) -> int:
    """Delete denials and system errors older than `days`; returns rows removed."""
    from datetime import datetime, timedelta, timezone
    from app.modules.main.models.grc import JobRun, PermissionDenial, SystemErrorLog

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    db = _session()
    try:
        n = db.query(PermissionDenial).filter(PermissionDenial.occurred_at < cutoff).delete(synchronize_session=False)
        n += db.query(SystemErrorLog).filter(SystemErrorLog.occurred_at < cutoff).delete(synchronize_session=False)
        n += db.query(JobRun).filter(JobRun.started_at < cutoff).delete(synchronize_session=False)
        db.commit()
        return n
    finally:
        db.close()
