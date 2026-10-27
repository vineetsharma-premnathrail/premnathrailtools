"""PEW-<N>: ONE number series for every project of the company. It continues the
old machine-register series (PEW-77 was the last past project, so the next is PEW-78).
The next number is highest-used + 1 across machine serials (erp_projects), PM projects
(pm_projects.project_code; projects created from a Sales Order are PM projects too) so a
number is never used twice (owner decision 2026-10-26; it replaced
PEW-<YYYY>-<NNNN> of 2026-10-19). A PM project may also be given a typed number
(e.g. PEW-64A for a repeat of PEW-64).
"""
from __future__ import annotations

import re
from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session

PREFIX = "PEW"
_BASE_RE = re.compile(r"^PEW-(\d+)")
_OLD_FORMAT_RE = re.compile(r"^PEW-\d{4}-\d{4}(/.*)?$")  # PEW-YYYY-NNNN, replaced by the migration


def pew_base(number: str | None) -> int:
    """The digits right after 'PEW-' (PEW-17A -> 17, PEW-34-A1 -> 34); 0 when none
    or when it is an old PEW-YYYY-NNNN number (the year is not a series number)."""
    n = (number or "").strip().upper()
    if _OLD_FORMAT_RE.match(n):
        return 0
    m = _BASE_RE.match(n)
    return int(m.group(1)) if m else 0


def normalise_serial(serial: str | None) -> str | None:
    """A serial that starts with PEW- (any case, surrounding spaces) is stored as PEW-... in
    upper case and trimmed, so 'pew-90' and ' PEW-90 ' are one number everywhere. Any other
    serial is returned untouched (None stays None)."""
    if serial is None:
        return None
    s = serial.strip()
    return s.upper() if s.upper().startswith(f"{PREFIX}-") else serial


def _norm_col(column):
    from sqlalchemy import func
    return func.upper(func.trim(column))


def next_pew_number(db: Session, on: date | None = None) -> str:
    """PEW-<highest used + 1> across machines, PM projects (incl. those created from Sales Orders) and vehicle builds.
    An advisory lock (Postgres) keeps two simultaneous creations from sharing one.
    `on` is accepted for old callers; the series no longer restarts each year."""
    from app.modules.erp.models.project import Project as MachineProject
    from app.modules.projects.models.project import PmProject

    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:p))"), {"p": PREFIX})
    like = f"{PREFIX}-%"
    used = [n for (n,) in db.query(MachineProject.serial_number).filter(_norm_col(MachineProject.serial_number).like(like)).all()]
    used += [n for (n,) in db.query(PmProject.project_code).filter(_norm_col(PmProject.project_code).like(like)).all()]
    # Vehicle builds made by hand take a series number too (2026-10-27).
    from app.modules.production.models.rrv_build import ProductionRrvBuild
    used += [n for (n,) in db.query(ProductionRrvBuild.build_number).filter(_norm_col(ProductionRrvBuild.build_number).like(like)).all()]
    return f"{PREFIX}-{max((pew_base(n) for n in used), default=0) + 1}"


def pm_project_for_serial(db: Session, serial: str | None):
    """The PM project a machine belongs to by number: its code equals the serial or the
    serial continues it with '-' (PEW-34-A1 -> PEW-34; PEW-34A is NOT PEW-34). Case
    insensitive; the longest matching code wins. None when there is none."""
    from sqlalchemy import func
    from app.modules.projects.models.project import PmProject

    s = (serial or "").strip().upper()
    if not s:
        return None
    prefixes = [s] + [s[:i] for i, ch in enumerate(s) if ch == "-" and i > 0]
    rows = db.query(PmProject).filter(func.upper(func.trim(PmProject.project_code)).in_(prefixes)).all()
    if not rows:
        return None
    return max(rows, key=lambda p: len((p.project_code or "").strip()))


def link_machine_to_project(db: Session, machine) -> bool:
    """Sets machine.pm_project_id from its serial when it has no link yet (an explicit
    link is never overridden). No commit. True when a link was set."""
    if getattr(machine, "pm_project_id", None):
        return False
    pm = pm_project_for_serial(db, machine.serial_number)
    if pm is None:
        return False
    machine.pm_project_id = pm.id
    return True


def pew_number_taken(db: Session, number: str, *, exclude_pm_id: int | None = None) -> str | None:
    """Who already holds `number`, for a clear refusal; None = free. A machine holds it when
    its serial equals the number or starts with it + '-' (PEW-40 is used by PEW-40-01)."""
    from app.modules.erp.models.project import Project as MachineProject
    from app.modules.projects.models.project import PmProject

    number = (number or "").strip().upper()
    q = db.query(PmProject).filter(_norm_col(PmProject.project_code) == number)
    if exclude_pm_id:
        q = q.filter(PmProject.id != exclude_pm_id)
    pm = q.first()
    if pm:
        return f"project '{pm.name}'"
    from app.modules.production.models.rrv_build import ProductionRrvBuild
    build = db.query(ProductionRrvBuild).filter(_norm_col(ProductionRrvBuild.build_number) == number).first()
    if build:
        return f"vehicle build {build.build_number} ({build.rrv_model})"
    like = number.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "-%"
    norm = _norm_col(MachineProject.serial_number)  # 'pew-40' and ' PEW-40 ' hold PEW-40 too
    mq = db.query(MachineProject.serial_number).filter((norm == number) | norm.like(like, escape="\\"))
    if exclude_pm_id:
        # The project's OWN machine (registered with it) doesn't make its number "taken".
        mq = mq.filter((MachineProject.pm_project_id.is_(None)) | (MachineProject.pm_project_id != exclude_pm_id))
    machines = [s for (s,) in mq.order_by(MachineProject.serial_number).limit(3).all()]
    if machines:
        return f"past project machine{'s' if len(machines) > 1 else ''} {', '.join(machines)}" + (" ..." if len(machines) == 3 else "")
    return None
