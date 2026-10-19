"""Organization › System Monitor: background jobs (SM37) and system errors
(SM21 / ST22). The denied-access trace (SU53) lives in routes/grc.py."""
from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core import jobs
from app.core.permissions import require_tab_action
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.grc import JobRun, SystemErrorLog
from app.modules.main.models.user import User

router = APIRouter(prefix="/organization/monitor", tags=["Organization - System Monitor"])

_view = require_tab_action("organization", "monitor", "view")
_edit = require_tab_action("organization", "monitor", "edit")


def _names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    return {u.id: u.name for u in db.query(User.id, User.name).filter(User.id.in_(ids))} if ids else {}


def _run_out(r: JobRun, names: dict[int, str]) -> dict:
    return {
        "id": r.id, "job_id": r.job_id, "status": r.status, "started_at": r.started_at, "finished_at": r.finished_at,
        "duration_ms": r.duration_ms, "rows": r.rows, "result_summary": r.result_summary, "error": r.error,
        "triggered_by": names.get(r.triggered_by_id) if r.triggered_by_id else "Scheduler",
    }


@router.get("/jobs")
async def list_jobs(db: Session = Depends(get_db), _user: User = Depends(_view)):
    out = []
    for j in jobs.job_list():
        last = db.query(JobRun).filter(JobRun.job_id == j["job_id"]).order_by(JobRun.id.desc()).first()
        since = datetime.now(timezone.utc) - timedelta(days=7)
        fails = db.query(JobRun).filter(JobRun.job_id == j["job_id"], JobRun.status == "failed",
                                        JobRun.started_at >= since).count()
        names = _names(db, [last.triggered_by_id] if last else [])
        out.append({**j, "last_run": _run_out(last, names) if last else None, "failures_7d": fails})
    return out


@router.get("/jobs/{job_id}/runs")
async def job_runs(job_id: str, limit: int = 50, db: Session = Depends(get_db), _user: User = Depends(_view)):
    rows = db.query(JobRun).filter(JobRun.job_id == job_id).order_by(JobRun.id.desc()).limit(min(max(limit, 1), 500)).all()
    names = _names(db, {r.triggered_by_id for r in rows})
    return [_run_out(r, names) for r in rows]


@router.post("/jobs/{job_id}/run", status_code=202)
async def run_job(job_id: str, db: Session = Depends(get_db), actor: User = Depends(_edit)):
    info = jobs.JOB_INFO.get(job_id)
    if job_id not in {j["job_id"] for j in jobs.job_list()}:
        raise HTTPException(status_code=404, detail=f"No background job '{job_id}' is registered on this server.")
    if not (info and info.get("idempotent")):
        raise HTTPException(
            status_code=409,
            detail=f"'{(info or {}).get('label', job_id)}' is not safe to re-run by hand (a second run could create "
                   "duplicate records). It runs again at its next scheduled time.",
        )
    if job_id in jobs._running:
        raise HTTPException(status_code=409, detail="This job is running right now — wait for it to finish, then re-run if needed.")
    db.add(AuditLog(entity_type="job_run", entity_id=None, action="run_now", module_key="organization",
                    subtab_key="monitor", performed_by_id=actor.id,
                    summary=f"{actor.name} started background job '{info['label']}' by hand"))
    db.commit()
    jobs.run_now(job_id, actor.id)
    return {"started": True, "job_id": job_id}


def _error_out(e: SystemErrorLog, names: dict[int, str], full: bool = False) -> dict:
    out = {
        "id": e.id, "error_ref": e.error_ref, "occurred_at": e.occurred_at, "method": e.method, "path": e.path,
        "status_code": e.status_code, "exception_type": e.exception_type, "message": (e.message or "")[:500],
        "user_id": e.user_id, "user_name": names.get(e.user_id), "ip_address": e.ip_address,
    }
    if full:
        out.update({"message": e.message, "traceback": e.traceback, "query_string": e.query_string,
                    "user_agent": e.user_agent})
    return out


@router.get("/errors")
async def list_errors(days: int = 7, path: str | None = None, user_id: int | None = None, q: str | None = None,
                      limit: int = 200, db: Session = Depends(get_db), _user: User = Depends(_view)):
    since = datetime.now(timezone.utc) - timedelta(days=min(max(days, 1), 90))
    query = db.query(SystemErrorLog).filter(SystemErrorLog.occurred_at >= since)
    if path:
        query = query.filter(SystemErrorLog.path == path)
    if user_id:
        query = query.filter(SystemErrorLog.user_id == user_id)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter((SystemErrorLog.error_ref.ilike(like)) | (SystemErrorLog.message.ilike(like))
                             | (SystemErrorLog.exception_type.ilike(like)))
    rows = query.order_by(SystemErrorLog.id.desc()).limit(min(max(limit, 1), 1000)).all()
    names = _names(db, {r.user_id for r in rows})
    return [_error_out(r, names) for r in rows]


@router.get("/errors/summary")
async def error_summary(days: int = 7, db: Session = Depends(get_db), _user: User = Depends(_view)):
    since = datetime.now(timezone.utc) - timedelta(days=min(max(days, 1), 90))
    rows = db.query(SystemErrorLog.method, SystemErrorLog.path, SystemErrorLog.exception_type) \
        .filter(SystemErrorLog.occurred_at >= since).all()
    c = Counter((m, p, t) for m, p, t in rows)
    return [{"method": m, "path": p, "exception_type": t, "count": n} for (m, p, t), n in c.most_common(50)]


@router.get("/errors/{error_ref}")
async def error_detail(error_ref: str, db: Session = Depends(get_db), _user: User = Depends(_view)):
    e = db.query(SystemErrorLog).filter(SystemErrorLog.error_ref == error_ref.strip()).first()
    if not e:
        raise HTTPException(status_code=404, detail=f"No error with reference '{error_ref}' — check the reference the user sent (it looks like 1b2c3d4e-…), or it may be older than 90 days and pruned.")
    return _error_out(e, _names(db, [e.user_id]), full=True)
