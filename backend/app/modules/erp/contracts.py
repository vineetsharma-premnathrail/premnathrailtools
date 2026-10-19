"""Customer AMC / CMC service contracts (SAP VA41–VA43) — business rules.

Entitlement (SAP CS entitlement check on the service order):
  covering_contract(project, day) = the ACTIVE contract whose period holds
  the day and whose machine list holds the machine, provided its included
  visits (0 = unlimited) aren't used up by earlier SRs on it. The warranty
  check (erp/warranty.py) treats such a machine as covered ('amc'), so the
  SR is free of charge by default, and links the SR to the contract
  (service_contract_id) with the contract's SLA hours. When the machine is
  under an AMC (spares not covered) and spares are charged, the user marks
  the SR chargeable with a reason; billing then leaves out the labour /
  visit lines the contract covers (erp/billing.py).

Billing plan (SAP periodic billing plan): contract value split over the
period by the billing frequency (upfront = one line); each line is billed
with a real AR invoice through accounts.service.create_ar_transaction
(reference_type 'service_contract'); a cancelled draft invoice frees the
line again (sync_billing).

Approval: central engine 'erp.service_contract' (Organization › Approval
Workflows) — default stages: holders of Service Contracts › approve, then a
Partner (final approval). Approved = active; the machines' amc_status /
amc_end_date mirror it for older screens.

Daily job (tasks/erp_contract_scheduler.py): expiry, renewal reminders 60 /
30 / 7 days before the end (bell + Teams — reminders), and drafting the
invoices of billing lines that fell due."""
from __future__ import annotations

from fastapi import HTTPException

# Service contracts are built but not live yet ("Upcoming", 2026-10-14): new
# contracts and renewals are refused and the UI shows the tab as Upcoming.
# Flip to True (here and in frontend/src/lib/features.ts) to go live.
SERVICE_CONTRACTS_ENABLED = False


def ensure_contracts_enabled() -> None:
    if not SERVICE_CONTRACTS_ENABLED:
        raise HTTPException(status_code=409, detail="Service contracts (AMC / CMC) are an upcoming feature and not open yet — "
                            "record the AMC on the machine (AMC status / end date) until it goes live.")

import calendar
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.erp.models.project import Project
from app.modules.erp.models.service_contract import (
    FREQUENCY_MONTHS, SERVICE_CONTRACT_BILLING_FREQUENCIES, SERVICE_CONTRACT_TYPES, SERVICE_CONTRACT_TYPE_LABELS,
    ServiceContract, ServiceContractBilling, ServiceContractMachine,
)
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User

CONTRACT_KEY = "erp.service_contract"
CONTRACT_ENTITY = "erp_service_contract"
LIVE = ("pending_approval", "active")
REMINDER_DAYS = (60, 30, 7)
_LIVE_INVOICE = ("pending", "posted")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def audit(db: Session, c: ServiceContract, action: str, summary: str, user_id: int | None) -> None:
    db.add(AuditLog(entity_type="service_contract", entity_id=c.id, action=action, summary=summary, performed_by_id=user_id))


def label(c: ServiceContract) -> str:
    return f"{c.contract_number} ({SERVICE_CONTRACT_TYPE_LABELS.get(c.contract_type, c.contract_type)})"


# ── Entitlement ─────────────────────────────────────────────────────────

def visits_used(db: Session, contract_id: int, exclude_sr_id: int | None = None) -> int:
    q = db.query(func.count(ServiceRequest.id)).filter(ServiceRequest.service_contract_id == contract_id,
                                                       ServiceRequest.is_deleted == False)  # noqa: E712
    if exclude_sr_id:
        q = q.filter(ServiceRequest.id != exclude_sr_id)
    return int(q.scalar() or 0)


def contracts_on(db: Session, project_id: int, day: date):
    return (db.query(ServiceContract)
            .join(ServiceContractMachine, ServiceContractMachine.contract_id == ServiceContract.id)
            .filter(ServiceContractMachine.project_id == project_id, ServiceContract.status == "active",
                    ServiceContract.is_deleted == False,  # noqa: E712
                    ServiceContract.start_date <= day, ServiceContract.end_date >= day)
            .order_by(ServiceContract.start_date.desc()).all())


def covering_contract(db: Session | None, project: Project, day: date, exclude_sr_id: int | None = None) -> ServiceContract | None:
    if db is None or getattr(project, "id", None) is None:
        return None
    try:
        rows = contracts_on(db, project.id, day)
    except Exception:  # noqa: BLE001 — table missing on an old database must not block an SR
        return None
    for c in rows:
        if c.visits_included and visits_used(db, c.id, exclude_sr_id) >= c.visits_included:
            continue
        return c
    return None


def exhausted_contract(db: Session, project: Project, day: date, exclude_sr_id: int | None = None) -> ServiceContract | None:
    """An active contract on the machine whose included visits are used up."""
    for c in contracts_on(db, project.id, day):
        if c.visits_included and visits_used(db, c.id, exclude_sr_id) >= c.visits_included:
            return c
    return None


def apply_entitlement(db: Session, sr: ServiceRequest, project: Project, day: date, status: str) -> None:
    """Links the SR to the covering contract (or unlinks it) and copies the
    contract's SLA hours onto an SR that has none."""
    c = covering_contract(db, project, day, exclude_sr_id=sr.id) if status == "amc" else None
    sr.service_contract_id = c.id if c is not None else None
    if c is not None:
        if sr.sla_response_hours is None and c.sla_response_hours:
            sr.sla_response_hours = c.sla_response_hours
        if sr.sla_resolution_hours is None and c.sla_resolution_hours:
            sr.sla_resolution_hours = c.sla_resolution_hours


def entitlement_view(db: Session, project: Project, day: date | None = None) -> dict | None:
    day = day or date.today()
    c = covering_contract(db, project, day)
    if c is None:
        ex = exhausted_contract(db, project, day)
        if ex is None:
            return None
        return {"contract_id": ex.id, "contract_number": ex.contract_number, "covered": False,
                "reason": f"{ex.contract_number}: all {ex.visits_included} included visits are used — further visits are chargeable."}
    used = visits_used(db, c.id)
    return {"contract_id": c.id, "contract_number": c.contract_number, "contract_type": c.contract_type, "covered": True,
            "end_date": c.end_date, "visits_included": c.visits_included, "visits_used": used,
            "labour_covered": c.labour_covered, "spares_covered": c.spares_covered,
            "sla_response_hours": c.sla_response_hours, "sla_resolution_hours": c.sla_resolution_hours}


# ── Validation / billing plan ───────────────────────────────────────────

def validate(db: Session, c: ServiceContract, machine_ids: list[int]) -> None:
    from app.modules.crm.models.organization import Organization
    if c.contract_type not in SERVICE_CONTRACT_TYPES:
        raise HTTPException(status_code=422, detail="Contract type must be AMC, CMC or Extended warranty.")
    if c.billing_frequency not in SERVICE_CONTRACT_BILLING_FREQUENCIES:
        raise HTTPException(status_code=422, detail="Billing frequency must be Upfront, Monthly, Quarterly, Half-yearly or Annual.")
    org = db.get(Organization, c.customer_id) if c.customer_id else None
    if org is None or getattr(org, "is_deleted", False):
        raise HTTPException(status_code=422, detail="Pick the customer (CRM organisation) the contract is with.")
    if not c.start_date or not c.end_date or c.end_date < c.start_date:
        raise HTTPException(status_code=422, detail="Enter the contract period — the end date must be on or after the start date.")
    if c.end_date > add_months(c.start_date, 60):
        raise HTTPException(status_code=422, detail="A service contract runs at most 5 years — split a longer one into renewals.")
    if float(c.contract_value or 0) < 0:
        raise HTTPException(status_code=422, detail="Contract value can't be negative.")
    if c.visits_included is not None and c.visits_included < 0:
        raise HTTPException(status_code=422, detail="Included visits can't be negative (0 = unlimited).")
    for f, lbl in (("sla_response_hours", "SLA response"), ("sla_resolution_hours", "SLA resolution")):
        v = getattr(c, f)
        if v is not None and not 0 < v <= 2000:
            raise HTTPException(status_code=422, detail=f"{lbl} hours must be between 1 and 2000 (leave it empty for no SLA).")
    if c.sla_response_hours and c.sla_resolution_hours and c.sla_resolution_hours < c.sla_response_hours:
        raise HTTPException(status_code=422, detail="SLA resolution hours can't be less than the response hours.")
    if c.contract_type in ("cmc", "extended_warranty"):
        c.labour_covered, c.spares_covered = True, True
    ids = list(dict.fromkeys(machine_ids))
    machines = db.query(Project).filter(Project.id.in_(ids), Project.is_deleted == False).all() if ids else []  # noqa: E712
    missing = set(ids) - {m.id for m in machines}
    if missing:
        raise HTTPException(status_code=422, detail=f"Machine(s) #{', #'.join(map(str, sorted(missing)))} not found — they may be deleted; pick again.")
    wrong = [m for m in machines if m.customer_id != c.customer_id]
    if wrong:
        names = ", ".join(f"{m.serial_number} ({m.customer_name or 'no customer linked'})" for m in wrong)
        raise HTTPException(status_code=422, detail=f"These machines don't belong to {org.name}: {names}. A contract covers only the "
                                                    "customer's own installed base — link the machine to the customer first (Machines › Edit).")


def check_overlap(db: Session, c: ServiceContract) -> None:
    ids = [m.project_id for m in c.machines]
    if not ids:
        raise HTTPException(status_code=422, detail=f"{c.contract_number} has no machines — add the covered machines first.")
    q = (db.query(ServiceContract, Project.serial_number)
         .join(ServiceContractMachine, ServiceContractMachine.contract_id == ServiceContract.id)
         .join(Project, Project.id == ServiceContractMachine.project_id)
         .filter(ServiceContractMachine.project_id.in_(ids), ServiceContract.id != c.id, ServiceContract.status.in_(LIVE),
                 ServiceContract.is_deleted == False,  # noqa: E712
                 ServiceContract.start_date <= c.end_date, ServiceContract.end_date >= c.start_date))
    hit = q.first()
    if hit:
        other, serial = hit
        raise HTTPException(status_code=409, detail=f"Machine {serial} is already on {other.contract_number} "
                                                    f"({other.start_date:%d-%m-%Y} to {other.end_date:%d-%m-%Y}, {other.status.replace('_', ' ')}) "
                                                    "for part of this period — a machine has one contract at a time. Remove it here, "
                                                    "or start this contract after that one ends.")


def build_billing_plan(c: ServiceContract) -> list[ServiceContractBilling]:
    total = round(float(c.contract_value or 0), 2)
    if total <= 0:
        return []
    periods: list[tuple[date, date]] = []
    if c.billing_frequency == "upfront":
        periods = [(c.start_date, c.end_date)]
    else:
        step = FREQUENCY_MONTHS[c.billing_frequency]
        s = c.start_date
        while s <= c.end_date:
            e = min(add_months(s, step) - timedelta(days=1), c.end_date)
            periods.append((s, e))
            s = e + timedelta(days=1)
    n = len(periods)
    each = round(total / n, 2)
    rows = []
    for i, (s, e) in enumerate(periods, start=1):
        amt = each if i < n else round(total - each * (n - 1), 2)
        rows.append(ServiceContractBilling(sequence=i, period_start=s, period_end=e, amount=amt, status="planned",
                                           due_date=s if (c.bill_in_advance or c.billing_frequency == "upfront") else e))
    return rows


def replan(db: Session, c: ServiceContract) -> None:
    if any(b.status == "invoiced" for b in c.billing_lines):
        raise HTTPException(status_code=409, detail=f"{c.contract_number} already has invoiced periods — the billing plan can't be rebuilt.")
    c.billing_lines.clear()
    db.flush()
    for b in build_billing_plan(c):
        c.billing_lines.append(b)


# ── Status changes ──────────────────────────────────────────────────────

def _mirror_on_machines(db: Session, c: ServiceContract, active: bool) -> None:
    for m in c.machines:
        p = db.get(Project, m.project_id)
        if p is None:
            continue
        if active:
            p.amc_status, p.amc_end_date = "active", c.end_date
        elif p.amc_end_date == c.end_date:
            p.amc_status = "expired" if c.status == "expired" else c.status


def activate(db: Session, c: ServiceContract, actor: User | None, remarks: str | None = None) -> None:
    check_overlap(db, c)
    c.status = "active"
    c.approved_by_id = actor.id if actor else None
    c.approved_at = _now()
    c.approval_remarks = remarks
    if not c.billing_lines:
        for b in build_billing_plan(c):
            c.billing_lines.append(b)
    _mirror_on_machines(db, c, True)
    if c.renewed_from_id:
        old = db.get(ServiceContract, c.renewed_from_id)
        if old is not None and old.status in ("active", "expired"):
            old.status = "renewed"
            audit(db, old, "renewed", f"{old.contract_number} renewed by {c.contract_number}.", actor.id if actor else None)
    audit(db, c, "activated", f"{label(c)} approved and active ({c.start_date:%d-%m-%Y} to {c.end_date:%d-%m-%Y})"
          + (f" by {actor.name or actor.email}" if actor else "") + (f". Remarks: {remarks}" if remarks else "."), actor.id if actor else None)


def submit(db: Session, c: ServiceContract, user: User) -> None:
    from app.modules.organization.services import approval_engine as engine
    if c.status != "draft":
        raise HTTPException(status_code=409, detail=f"{c.contract_number} is {c.status.replace('_', ' ')} — only a draft is sent for approval.")
    if float(c.contract_value or 0) <= 0 and c.contract_type != "extended_warranty":
        raise HTTPException(status_code=422, detail="Enter the contract value — an AMC / CMC is billed to the customer.")
    check_overlap(db, c)
    c.status = "pending_approval"
    c.submitted_by_id, c.submitted_at = user.id, _now()
    if not c.billing_lines:
        for b in build_billing_plan(c):
            c.billing_lines.append(b)
    db.flush()
    audit(db, c, "submitted", f"{label(c)} sent for approval by {user.name or user.email}.", user.id)
    req = engine.submit(db, CONTRACT_KEY, entity_id=c.id, requester=user,
                  title=f"Service contract {c.contract_number} — {c.customer.name if c.customer else ''}".strip(" —"),
                  reference=c.contract_number, amount=float(c.contract_value or 0),
                  context={"contract_type": c.contract_type}, exclude_user_ids=[c.created_by_id] if c.created_by_id else None)
    if c.status == "pending_approval":  # not auto-approved
        from app.modules.erp.notify import approver_ids, role_event
        role_event(db, None, "contract_submitted", title=f"Contract {c.contract_number} waiting for approval",
                   message=f"{user.name or user.email} sent {label(c)}"
                           + (f" with {c.customer.name}" if c.customer else "")
                           + f" ({float(c.contract_value or 0):,.2f} + GST, {c.start_date:%d-%m-%Y} to {c.end_date:%d-%m-%Y}) for approval.",
                   entity_type=CONTRACT_ENTITY, entity_id=c.id, actor=user,
                   skip_user_ids=approver_ids(req) | ({c.created_by_id} if c.created_by_id else set()))


def _decided(db: Session, req, outcome: str, actor: User) -> None:
    from app.modules.erp.access import decision_comment
    c = db.get(ServiceContract, req.entity_id)
    if c is None or c.status != "pending_approval":
        return
    remarks = decision_comment(req, actor) or None
    if outcome == "approved":
        activate(db, c, actor, remarks)
        return
    c.status = "draft"
    c.approval_remarks = remarks
    what = "withdrawn" if outcome == "cancelled" else outcome
    audit(db, c, outcome, f"Approval of {c.contract_number} {what} by {actor.name or actor.email}" + (f": {remarks}" if remarks else "."), actor.id)


def cancel(db: Session, c: ServiceContract, user: User, reason: str) -> None:
    from app.modules.organization.services import approval_engine as engine
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Enter why the contract is cancelled — it is kept in the audit trail.")
    if c.status not in ("draft", "pending_approval", "active"):
        raise HTTPException(status_code=409, detail=f"{c.contract_number} is {c.status} — it can't be cancelled.")
    if c.status == "pending_approval":
        try:
            engine.cancel_for_entity(db, CONTRACT_ENTITY, c.id, user, reason)
        except HTTPException:
            pass
    live = [b for b in c.billing_lines if b.status == "invoiced" and b.ar_transaction_id]
    c.status, c.cancel_reason = "cancelled", reason
    for b in c.billing_lines:
        if b.status == "planned":
            b.status = "cancelled"
    _mirror_on_machines(db, c, False)
    extra = f" {len(live)} period(s) already invoiced stay with Finance (raise a credit note there if they must be reversed)." if live else ""
    audit(db, c, "cancelled", f"{c.contract_number} cancelled by {user.name or user.email}: {reason}.{extra}", user.id)


def renew(db: Session, c: ServiceContract, user: User) -> ServiceContract:
    from app.modules.accounts.services.fiscal import next_number
    if c.status not in ("active", "expired"):
        raise HTTPException(status_code=409, detail=f"Only an active or expired contract is renewed — {c.contract_number} is {c.status}.")
    nxt = db.query(ServiceContract).filter(ServiceContract.renewed_from_id == c.id, ServiceContract.is_deleted == False,  # noqa: E712
                                           ServiceContract.status.in_(("draft", "pending_approval", "active"))).first()
    if nxt:
        raise HTTPException(status_code=409, detail=f"{c.contract_number} already has renewal {nxt.contract_number} ({nxt.status.replace('_', ' ')}).")
    start = c.end_date + timedelta(days=1)
    months = max(1, round(((c.end_date - c.start_date).days + 1) / 30.4375))  # same length as the old contract
    end = add_months(start, months) - timedelta(days=1)
    new = ServiceContract(
        contract_number=next_number(db, "SC", start), contract_type=c.contract_type, title=c.title, customer_id=c.customer_id,
        status="draft", start_date=start, end_date=end, contract_value=c.contract_value, gst_rate=c.gst_rate, sac_code=c.sac_code,
        billing_frequency=c.billing_frequency, bill_in_advance=c.bill_in_advance, visits_included=c.visits_included,
        labour_covered=c.labour_covered, spares_covered=c.spares_covered, sla_response_hours=c.sla_response_hours,
        sla_resolution_hours=c.sla_resolution_hours, terms=c.terms, renewed_from_id=c.id, created_by_id=user.id,
    )
    new.machines = [ServiceContractMachine(project_id=m.project_id) for m in c.machines]
    db.add(new)
    db.flush()
    audit(db, new, "created", f"Renewal of {c.contract_number} drafted by {user.name or user.email} ({start:%d-%m-%Y} to {end:%d-%m-%Y}).", user.id)
    return new


def expire_due(db: Session, today: date) -> int:
    n = 0
    for c in db.query(ServiceContract).filter(ServiceContract.status == "active", ServiceContract.end_date < today,
                                             ServiceContract.is_deleted == False).all():  # noqa: E712
        c.status = "expired"
        _mirror_on_machines(db, c, False)
        audit(db, c, "expired", f"{c.contract_number} expired on {c.end_date:%d-%m-%Y}.", None)
        n += 1
    return n


# ── Billing ─────────────────────────────────────────────────────────────

def sync_billing(db: Session, c: ServiceContract) -> None:
    from app.modules.accounts.models.ar_transaction import ARTransaction
    for b in c.billing_lines:
        if b.ar_transaction_id:
            txn = db.get(ARTransaction, b.ar_transaction_id)
            if txn is None or txn.status == "cancelled":
                b.ar_transaction_id, b.invoiced_at = None, None
                b.status = "planned" if c.status != "cancelled" else "cancelled"


def invoice_line(db: Session, c: ServiceContract, b: ServiceContractBilling, user_id: int | None, *, invoice_date: date | None = None):
    from app.modules.accounts.models.ar_transaction import ARTransaction
    from app.modules.accounts.service import create_ar_transaction
    sync_billing(db, c)
    if c.status not in ("active", "expired", "renewed"):
        raise HTTPException(status_code=409, detail=f"{c.contract_number} is {c.status.replace('_', ' ')} — only an approved contract is billed.")
    if b.status == "cancelled":
        raise HTTPException(status_code=409, detail=f"Period {b.sequence} of {c.contract_number} was cancelled with the contract.")
    if b.ar_transaction_id:
        txn = db.get(ARTransaction, b.ar_transaction_id)
        raise HTTPException(status_code=409, detail=f"Period {b.sequence} is already on invoice {txn.invoice_number if txn else ''} "
                                                    "— cancel that draft in Finance › Sales first if it must be raised again.")
    sac = (c.sac_code or "").strip()
    if not sac:
        from app.modules.erp.billing import _setting
        sac = str(_setting(db, "service_sac_code", "998717")).strip()
    serials = ", ".join(sorted(m.project.serial_number for m in c.machines if m.project is not None))
    line = {"description": f"{SERVICE_CONTRACT_TYPE_LABELS.get(c.contract_type, c.contract_type)} charges {c.contract_number}, period "
                           f"{b.period_start:%d-%m-%Y} to {b.period_end:%d-%m-%Y}" + (f" — machines {serials}" if serials else ""),
            "hsn_sac_code": sac, "quantity": 1, "uom": "Job", "rate": round(float(b.amount), 2), "gst_rate": float(c.gst_rate or 0)}
    try:
        txn = create_ar_transaction(
            db, customer_id=c.customer_id, invoice_date=invoice_date or date.today(), created_by_id=user_id, lines=[line],
            customer_po_number=c.customer_po_number, customer_po_date=c.customer_po_date,
            narration=f"Service contract {c.contract_number} — billing period {b.sequence}",
            reference_type="service_contract", reference_id=c.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Finance couldn't draft the invoice: {e}")
    b.ar_transaction_id, b.status, b.invoiced_at = txn.id, "invoiced", _now()
    audit(db, c, "invoiced", f"Period {b.sequence} ({b.period_start:%d-%m-%Y} to {b.period_end:%d-%m-%Y}) billed on draft invoice "
                             f"{txn.invoice_number} for ₹{float(b.amount):,.2f} + GST.", user_id)
    return txn


def billing_view(db: Session, b: ServiceContractBilling) -> dict:
    from app.modules.accounts.models.ar_transaction import ARTransaction
    txn = db.get(ARTransaction, b.ar_transaction_id) if b.ar_transaction_id else None
    return {"id": b.id, "sequence": b.sequence, "period_start": b.period_start, "period_end": b.period_end, "due_date": b.due_date,
            "amount": float(b.amount or 0), "status": b.status, "ar_transaction_id": b.ar_transaction_id,
            "invoice_number": txn.invoice_number if txn else None, "invoice_status": txn.status if txn else None,
            "invoice_total": float(txn.total_amount or 0) if txn else None, "collection_status": txn.collection_status if txn else None}


register_done = False


def register() -> None:
    """Registers the approval type once (imported by the routes module)."""
    global register_done
    if register_done:
        return
    from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction
    register_transaction(TransactionType(
        key=CONTRACT_KEY, module_key="erp", subtab_key="service_contracts", label="Service contract (AMC / CMC)",
        entity_type=CONTRACT_ENTITY, url="/dashboard/erp/service-contracts/{id}",
        description="A customer AMC / CMC / extended-warranty contract. Approved = active: SRs on its machines are covered "
                    "and its billing plan can be invoiced.",
        context_fields={"contract_type": {"label": "Contract type", "type": "choice", "choices": list(SERVICE_CONTRACT_TYPES)}},
        default_stages=[StageDef("Service contract approvers", "permission", {"permission": "erp:service_contracts:approve"}),
                        StageDef("Partner (final approval)", "partner")],
        distinct_approvers=True,
        on_decided=_decided,
    ))
    register_done = True
