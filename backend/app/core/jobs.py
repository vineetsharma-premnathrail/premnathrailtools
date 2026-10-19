"""SM36 / SM37 for the APScheduler jobs started in app/main.py.

`instrument_scheduler(scheduler)` (called once, just before
scheduler.start()) adds the access-governance and log-prune jobs and wraps
EVERY job so each run is persisted as a JobRun row: start, end, status,
rows (when the job returns a count / dict of counts) and the error. Most task
entry points catch their own exceptions and only log them, so ERROR records
logged on the job's thread during the run also mark it failed.

On PostgreSQL a session-level advisory lock per job makes a second worker or
replica skip a run that is already in progress (status "skipped").

Re-run from the monitor is offered only for jobs listed as idempotent (every
reminder de-duplicates per recipient/day, sync/escalation/expiry are
naturally repeatable)."""
import logging
import threading
import time
import zlib
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

JOB_INFO: dict[str, dict] = {
    "approval_escalations": {"label": "Approval escalations", "idempotent": True},
    "activity_followup_reminders": {"label": "CRM follow-up reminders", "idempotent": True},
    "po_overdue_reminders": {"label": "PO overdue reminders", "idempotent": True},
    "hr_reminders": {"label": "HR reminders", "idempotent": True},
    "pm_reminders": {"label": "Project task reminders", "idempotent": True},
    "design_reminders": {"label": "Design reminders", "idempotent": True},
    "store_jobwork_reminders": {"label": "Job work reminders", "idempotent": True},
    "quality_reminders": {"label": "Quality reminders", "idempotent": True},
    "maintenance_pm_scheduler": {"label": "Maintenance PM work-order generator", "idempotent": False},
    "maintenance_amc_reminders": {"label": "AMC / warranty reminders", "idempotent": True},
    "sales_scheduler": {"label": "Sales delivery / LD scheduler", "idempotent": False},
    "azure_user_sync": {"label": "Microsoft Entra user sync", "idempotent": True},
    "access_governance_daily": {"label": "Access expiry + review reminders", "idempotent": True},
    "basis_log_prune": {"label": "Prune job runs, errors, denials > 90 days", "idempotent": True},
}

_FUNCS: dict[str, callable] = {}
_SCHEDULER = None
_running: set[str] = set()
_running_lock = threading.Lock()


def _session():
    from app.modules.main.services import basis_log
    return basis_log._session()


class _ThreadErrors(logging.Handler):
    """Collects ERROR+ records logged on one thread."""

    def __init__(self, thread_id: int):
        super().__init__(level=logging.ERROR)
        self.thread_id = thread_id
        self.messages: list[str] = []

    def emit(self, record):
        if record.thread == self.thread_id and not record.name.startswith(__name__):
            try:
                self.messages.append(f"{record.name}: {record.getMessage()}"[:1000])
            except Exception:  # noqa: BLE001
                pass


def _rows_of(result) -> tuple[int | None, str | None]:
    if isinstance(result, bool) or result is None:
        return None, None
    if isinstance(result, int):
        return result, None
    if isinstance(result, dict):
        nums = [v for v in result.values() if isinstance(v, int) and not isinstance(v, bool)]
        return (sum(nums) if nums else None), ", ".join(f"{k}: {v}" for k, v in result.items())[:2000]
    return None, str(result)[:2000]


def _try_lock(db, job_id: str) -> bool:
    if db.get_bind().dialect.name != "postgresql":
        return True
    from sqlalchemy import text
    return bool(db.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": zlib.crc32(job_id.encode())}).scalar())


def _unlock(db, job_id: str) -> None:
    if db.get_bind().dialect.name != "postgresql":
        return
    from sqlalchemy import text
    db.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": zlib.crc32(job_id.encode())})


def run_tracked(job_id: str, func, triggered_by_id: int | None = None):
    """Run `func()` once, recording a JobRun row. Never raises (the scheduler
    thread must survive); returns the JobRun id or None."""
    from app.modules.main.models.grc import JobRun

    db = None
    run_id = None
    try:
        db = _session()
        started = datetime.now(timezone.utc)
        with _running_lock:
            busy = job_id in _running
            if not busy:
                _running.add(job_id)
        locked = (not busy) and _try_lock(db, job_id)
        if busy or not locked:
            with _running_lock:
                if not busy:
                    _running.discard(job_id)
            run = JobRun(job_id=job_id, status="skipped", started_at=started, finished_at=started, duration_ms=0,
                         result_summary="Skipped — the previous run of this job is still in progress.",
                         triggered_by_id=triggered_by_id)
            db.add(run)
            db.commit()
            return run.id
        run = JobRun(job_id=job_id, status="running", started_at=started, triggered_by_id=triggered_by_id)
        db.add(run)
        db.commit()
        run_id = run.id
        handler = _ThreadErrors(threading.get_ident())
        logging.getLogger().addHandler(handler)
        t0 = time.monotonic()
        error = None
        result = None
        try:
            result = func()
        except Exception as exc:  # noqa: BLE001
            import traceback
            error = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-8000:]
        finally:
            logging.getLogger().removeHandler(handler)
            with _running_lock:
                _running.discard(job_id)
            try:
                _unlock(db, job_id)
            except Exception:  # noqa: BLE001
                pass
        rows, summary = _rows_of(result)
        if error is None and handler.messages:
            error = "Errors logged during the run:\n" + "\n".join(handler.messages[:20])
        run = db.get(JobRun, run_id)
        run.finished_at = datetime.now(timezone.utc)
        run.duration_ms = int((time.monotonic() - t0) * 1000)
        run.rows, run.result_summary = rows, summary
        run.status = "failed" if error else "success"
        run.error = error
        db.commit()
        if error:
            _notify_repeated_failure(db, job_id)
        return run_id
    except Exception:  # noqa: BLE001
        logger.exception("Job monitor could not record run of %s", job_id)
        return run_id
    finally:
        if db is not None:
            db.close()


def _notify_repeated_failure(db, job_id: str) -> None:
    """Bell to admins when a job failed twice in a row."""
    from app.modules.main.models.grc import JobRun
    from app.modules.main.models.user import User
    from app.utils.notifications import notify_user

    last = db.query(JobRun).filter(JobRun.job_id == job_id, JobRun.status.in_(("success", "failed"))) \
        .order_by(JobRun.id.desc()).limit(2).all()
    if len(last) == 2 and all(r.status == "failed" for r in last):
        label = JOB_INFO.get(job_id, {}).get("label", job_id)
        for u in db.query(User).filter(User.is_active.is_(True), User.role == "admin").all():
            notify_user(db, u.id, "Background job failing",
                        f"'{label}' failed twice in a row. Open Organization › System Monitor › Background jobs for the error.",
                        "job_failed", "job_run", last[0].id)
        db.commit()


def _wrap(job_id: str, func):
    def _tracked():
        return run_tracked(job_id, func)
    _tracked.__name__ = f"tracked_{job_id}"
    _tracked.__wrapped__ = func
    return _tracked


def access_governance_daily() -> dict:
    from app.modules.main.services import grc

    db = _session()
    try:
        expired = grc.expire_access(db)
        reminded = grc.remind_reviewers(db)
        return {"expired": expired, "reminders": reminded}
    finally:
        db.close()


def basis_log_prune() -> int:
    from app.modules.main.services.basis_log import prune
    return prune(90)


def instrument_scheduler(scheduler) -> None:
    """Add the governance jobs and wrap every job with run tracking."""
    global _SCHEDULER
    from apscheduler.triggers.cron import CronTrigger

    scheduler.add_job(access_governance_daily, CronTrigger(hour=0, minute=30), id="access_governance_daily",
                      replace_existing=True)
    scheduler.add_job(basis_log_prune, CronTrigger(hour=1, minute=15), id="basis_log_prune", replace_existing=True)
    for job in scheduler.get_jobs():
        func = getattr(job.func, "__wrapped__", None) or job.func
        _FUNCS[job.id] = func
        job.modify(func=_wrap(job.id, func))
    _SCHEDULER = scheduler


def register_func(job_id: str, func) -> None:
    """Make a job runnable from the monitor without a scheduler (tests)."""
    _FUNCS[job_id] = func


def job_list() -> list[dict]:
    jobs = {}
    if _SCHEDULER is not None:
        for j in _SCHEDULER.get_jobs():
            jobs[j.id] = {"next_run_at": getattr(j, "next_run_time", None), "schedule": str(j.trigger), "paused": getattr(j, "next_run_time", 1) is None}
    out = []
    for job_id in sorted(set(_FUNCS) | set(jobs)):
        info = JOB_INFO.get(job_id, {})
        out.append({"job_id": job_id, "label": info.get("label", job_id), "idempotent": bool(info.get("idempotent")),
                    "running": job_id in _running, **jobs.get(job_id, {"next_run_at": None, "schedule": None, "paused": False})})
    return out


def run_now(job_id: str, user_id: int) -> None:
    """Start a manual run on a background thread (the request returns at once)."""
    func = _FUNCS.get(job_id)
    if func is None:
        raise KeyError(job_id)
    threading.Thread(target=run_tracked, args=(job_id, func, user_id), daemon=True, name=f"job-{job_id}").start()
