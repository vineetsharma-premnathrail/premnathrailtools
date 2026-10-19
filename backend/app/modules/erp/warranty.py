"""Warranty check for service requests (SAP CS warranty check / BGM1).

The machine's cover on the day the SR is reported decides whether the job
is chargeable by default:

  warranty start = machine.warranty_start_date, else its commissioning
                   date, else its handover date
  warranty end   = machine.warranty_end_date, else start + the product's
                   warranty months (Product master), else start + the
                   Service setting "Default warranty (months)"

Cover, in order: in_warranty (start ≤ day ≤ end), extended_warranty (the
machine has an extension running to day or later), amc (an AMC running to
day or later), out_of_warranty, or unknown when the machine has no start
date at all (never commissioned / handed over in the records).

Default chargeability by service type:
  installation_commissioning → free (part of the supply)
  paid_service               → chargeable
  every other type           → free while covered, chargeable otherwise
A user may choose differently only with a reason (audited); a 'warranty'
type SR can never be chargeable."""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.erp.models.project import Project
from app.modules.erp.models.service_request import ServiceRequest

COVERED = ("in_warranty", "extended_warranty", "amc")
WARRANTY_LABELS = {
    "in_warranty": "In warranty", "extended_warranty": "Extended warranty", "amc": "Under AMC",
    "out_of_warranty": "Out of warranty", "unknown": "Warranty unknown (no commissioning / handover date)",
}
_ACTIVE_AMC = (None, "", "active", "yes", "running", "amc")


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def _default_months(db: Session) -> int:
    from app.modules.erp.settings import get_setting
    try:
        return int(get_setting(db, "default_warranty_months") or 0)
    except Exception:  # noqa: BLE001 — a settings problem must not block raising an SR
        return 12


def warranty_months(db: Session, project: Project) -> int:
    product = project.product if project.product_id else None
    if product is not None and product.warranty_months:
        return int(product.warranty_months)
    return _default_months(db)


def warranty_window(db: Session, project: Project) -> tuple[date | None, date | None]:
    start = project.warranty_start_date or project.commissioning_date or project.handover_date
    end = project.warranty_end_date
    if start and not end:
        months = warranty_months(db, project)
        end = add_months(start, months) - timedelta(days=1) if months > 0 else None
    return start, end


def warranty_status_on(db: Session, project: Project, day: date, exclude_sr_id: int | None = None) -> str:
    start, end = warranty_window(db, project)
    if start and end and start <= day <= end:
        return "in_warranty"
    if project.extended_warranty and project.extended_warranty_end and day <= project.extended_warranty_end and (not start or day >= start):
        return "extended_warranty"
    # Service contracts (VA41 entitlement, erp/contracts.py): an active AMC / CMC with
    # visits left covers the machine; one whose visits are used up does not, even
    # though the machine's amc_status mirror still says active.
    from app.modules.erp import contracts as _contracts
    if _contracts.covering_contract(db, project, day, exclude_sr_id) is not None:
        return "amc"
    on_contract = False
    if db is not None and getattr(project, "id", None) is not None:
        try:
            on_contract = bool(_contracts.contracts_on(db, project.id, day))
        except Exception:  # noqa: BLE001
            on_contract = False
    if not on_contract and project.amc_end_date and day <= project.amc_end_date and (project.amc_status or "").strip().lower() in _ACTIVE_AMC:
        return "amc"
    if not start:
        return "unknown"
    return "out_of_warranty"


def default_chargeable(service_type: str | None, warranty_status: str) -> bool:
    if service_type == "installation_commissioning":
        return False
    if service_type == "paid_service":
        return True
    return warranty_status not in COVERED


def reported_day(sr: ServiceRequest | None) -> date:
    opened = sr.opened_at if sr is not None else None
    return opened.date() if isinstance(opened, datetime) else date.today()


def apply_warranty_check(
    db: Session, sr: ServiceRequest, project: Project, *,
    chargeable: bool | None, reason: str | None, keep_override: bool = False,
) -> str | None:
    """Sets sr.warranty_status / is_chargeable / chargeable_reason. Returns an
    audit note when the user overrode the default, else None. Raises 422
    with the real reason when an override has no reason or contradicts the
    service type."""
    status = warranty_status_on(db, project, reported_day(sr), exclude_sr_id=sr.id)
    sr.warranty_status = status
    from app.modules.erp.contracts import apply_entitlement
    apply_entitlement(db, sr, project, reported_day(sr), status)
    default = default_chargeable(sr.service_type, status)
    reason = (reason or "").strip() or None
    if chargeable is None:
        if keep_override and sr.is_chargeable is not None and sr.is_chargeable != default and sr.chargeable_reason:
            chargeable, reason = sr.is_chargeable, sr.chargeable_reason
        elif sr.service_type == "warranty":
            chargeable = False  # a warranty job is free; on an uncovered machine that is an override (reason below)
        else:
            chargeable = default
    if sr.service_type == "warranty" and chargeable:
        raise HTTPException(
            status_code=422,
            detail="A Warranty service request can't be chargeable. If the customer pays for this job, change the "
                   "service type to Repair / Breakdown or Paid Service.",
        )
    note = None
    if status == "unknown":
        # No commissioning / handover / warranty date on the machine: the
        # system can't judge the cover, so the user's choice stands as is.
        reason = reason if chargeable != default else None
    elif chargeable != default:
        if not reason:
            what = "chargeable" if chargeable else "free of charge"
            raise HTTPException(
                status_code=422,
                detail=f"Machine {project.serial_number} is {WARRANTY_LABELS[status].lower()} on {reported_day(sr):%d-%m-%Y}, so a "
                       f"{(sr.service_type or 'service').replace('_', ' ')} job is {'chargeable' if default else 'free of charge'} by default. "
                       f"Enter a reason to make it {what} — it is kept in the audit trail.",
            )
        note = f"Chargeability overridden to {'chargeable' if chargeable else 'free of charge'} " \
               f"(machine {WARRANTY_LABELS[status].lower()}): {reason}"
    else:
        reason = None
    sr.is_chargeable = bool(chargeable)
    sr.chargeable_reason = reason
    if not sr.ar_transaction_id:
        sr.billing_status = "to_bill" if sr.is_chargeable else "not_billable"
    return note


def on_sr_closed(db: Session, sr: ServiceRequest, actor_id: int | None = None) -> str | None:
    """Closing an Installation & Commissioning SR is the commissioning event:
    the machine gets its commissioning date (the SR's actual completion
    date, else today) and — where still blank — its warranty start and end.
    Dates already on the machine are never overwritten. Returns an audit
    note for the machine, or None."""
    if sr.service_type != "installation_commissioning":
        return None
    project = db.get(Project, sr.project_id)
    if project is None:
        return None
    day = sr.actual_completion_date or (sr.closed_at.date() if sr.closed_at else datetime.now(timezone.utc).date())
    changed = []
    if not project.commissioning_date:
        project.commissioning_date = day
        changed.append(f"commissioning date {day:%d-%m-%Y}")
    if not project.warranty_start_date:
        project.warranty_start_date = project.commissioning_date
        changed.append(f"warranty start {project.warranty_start_date:%d-%m-%Y}")
        if not project.warranty_end_date:
            months = warranty_months(db, project)
            if months > 0:
                project.warranty_end_date = add_months(project.warranty_start_date, months) - timedelta(days=1)
                changed.append(f"warranty end {project.warranty_end_date:%d-%m-%Y} ({months} months)")
    if not changed:
        return None
    from app.modules.main.models.audit_log import AuditLog
    note = f"Set from commissioning SR {sr.request_number}: " + ", ".join(changed) + "."
    db.add(AuditLog(entity_type="project", entity_id=project.id, action="commissioned", summary=note, performed_by_id=actor_id))
    return note
