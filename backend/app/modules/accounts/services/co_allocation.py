"""CO assessment / distribution cycles (SAP KSU5 / KSV5) — definitions,
test run (preview) and posting run per period, and reversal.

Sender amount of a segment = the period's posted actual (debit - credit) on
the sender cost centre for the segment's ledgers (all expense ledgers when
none are named), leaving out this cycle's own earlier runs so a re-run after
a reversal sends the same amount. Earlier cycles' allocations do count, so
cycles can be run in sequence (service centre -> plant -> production).

Shares by basis:
  fixed_percent   each receiver's percent; what isn't allocated (sum < 100)
                  stays on the sender;
  headcount       active users in the receiver cost centre's department;
  activity_hours  production time-log hours of the period on workstations
                  whose cost centre is the receiver (optionally one activity
                  type).
The last receiver takes the rounding paisa, so a 100% segment empties the
sender exactly."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.accounts.models.co_activity import CO_ACTIVITY_TYPES
from app.modules.accounts.models.co_allocation import (
    CO_ALLOCATION_BASES, CO_ALLOCATION_METHODS, CoAllocationCycle, CoAllocationRun, CoAllocationSegment,
)
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.journal_entry import JE_LEDGER_STATUSES, JournalEntry, JournalEntryLine
from app.modules.accounts.services import fiscal
from app.modules.organization.models.cost_center import CostCenter

REFERENCE_TYPE = "co_allocation_run"
POSTING_TYPE = "co_allocation"


def _r(x) -> float:
    return round(float(x or 0), 2)


def _cc_label(cc: CostCenter | None, cc_id=None) -> str:
    return f"{cc.code} — {cc.name}" if cc else f"#{cc_id}"


# ── Definitions ──────────────────────────────────────────────────────────

def validate_cycle(db: Session, data: dict, *, cycle_id: int | None = None) -> dict:
    out = dict(data)
    out["code"] = (out.get("code") or "").strip().upper()
    out["name"] = (out.get("name") or "").strip()
    if not out["code"] or not out["name"]:
        raise ValueError("Give the cycle a code (e.g. ASSESS-ADMIN) and a name.")
    q = db.query(CoAllocationCycle.id).filter(func.upper(CoAllocationCycle.code) == out["code"])
    if cycle_id:
        q = q.filter(CoAllocationCycle.id != cycle_id)
    if q.first():
        raise ValueError(f"A cycle with code {out['code']} already exists — pick another code.")
    if out.get("method") not in CO_ALLOCATION_METHODS:
        raise ValueError("Method must be 'distribution' (same ledgers move) or 'assessment' (one assessment ledger).")
    if out.get("status", "active") not in ("active", "inactive"):
        raise ValueError("Status must be active or inactive.")
    if out.get("valid_from") and out.get("valid_to") and out["valid_to"] < out["valid_from"]:
        raise ValueError("'Valid to' is before 'valid from' — swap them.")
    if out["method"] == "assessment":
        gl_id = out.get("assessment_gl_account_id")
        gl = db.query(GLAccount).filter(GLAccount.id == gl_id).first() if gl_id else None
        if not gl:
            raise ValueError("An assessment cycle needs its assessment ledger (a secondary-cost expense ledger such as "
                             "'Overhead assessed') — pick it.")
        if gl.account_type != "expense" or not gl.is_posting_account or gl.status != "active":
            raise ValueError(f"Assessment ledger '{gl.code} — {gl.name}' must be an active expense posting ledger.")
    else:
        out["assessment_gl_account_id"] = None

    segments = out.get("segments") or []
    if not segments:
        raise ValueError("Add at least one segment: a sender cost centre and its receivers.")
    cc_ids = {s.get("sender_cost_center_id") for s in segments} | {
        r.get("cost_center_id") for s in segments for r in (s.get("receivers") or [])}
    cc_ids.discard(None)
    ccs = {c.id: c for c in db.query(CostCenter).filter(CostCenter.id.in_(cc_ids)).all()} if cc_ids else {}
    gl_ids = {g for s in segments for g in (s.get("sender_gl_account_ids") or [])}
    gls = {a.id: a for a in db.query(GLAccount).filter(GLAccount.id.in_(gl_ids)).all()} if gl_ids else {}
    clean = []
    for i, s in enumerate(segments, start=1):
        where = f"Segment {i}"
        name = (s.get("name") or "").strip() or f"Segment {i}"
        sender = s.get("sender_cost_center_id")
        if not sender or sender not in ccs:
            raise ValueError(f"{where}: pick the sender cost centre.")
        basis = s.get("basis")
        if basis not in CO_ALLOCATION_BASES:
            raise ValueError(f"{where}: basis must be one of {', '.join(CO_ALLOCATION_BASES)}.")
        act = (s.get("activity_type") or None)
        if act:
            act = act.upper()
            if basis != "activity_hours":
                act = None
            elif act not in CO_ACTIVITY_TYPES:
                raise ValueError(f"{where}: '{act}' isn't an activity type — use {', '.join(CO_ACTIVITY_TYPES)} or leave it blank for all.")
        for g in s.get("sender_gl_account_ids") or []:
            a = gls.get(g)
            if not a:
                raise ValueError(f"{where}: ledger #{g} doesn't exist — pick it again.")
            if a.account_type != "expense":
                raise ValueError(f"{where}: ledger '{a.code} — {a.name}' isn't an expense ledger — only costs are allocated.")
        receivers = s.get("receivers") or []
        if not receivers:
            raise ValueError(f"{where}: add at least one receiver cost centre.")
        seen, total_pct, rec_clean = set(), 0.0, []
        for r in receivers:
            rid = r.get("cost_center_id")
            if not rid or rid not in ccs:
                raise ValueError(f"{where}: a receiver row has no valid cost centre — pick it again.")
            if rid == sender:
                raise ValueError(f"{where}: {_cc_label(ccs[rid])} is the sender — it can't also receive.")
            if rid in seen:
                raise ValueError(f"{where}: receiver {_cc_label(ccs[rid])} is listed twice.")
            seen.add(rid)
            pct = float(r.get("percent") or 0)
            if basis == "fixed_percent":
                if pct <= 0:
                    raise ValueError(f"{where}: give receiver {_cc_label(ccs[rid])} a percentage above 0.")
                total_pct += pct
            rec_clean.append({"cost_center_id": rid, "percent": round(pct, 4) if basis == "fixed_percent" else None})
        if basis == "fixed_percent" and total_pct > 100.0001:
            raise ValueError(f"{where}: the receivers' percentages add up to {total_pct:g}% — they can't exceed 100%.")
        if basis == "headcount":
            for r in rec_clean:
                if not ccs[r["cost_center_id"]].department_id:
                    raise ValueError(f"{where}: receiver {_cc_label(ccs[r['cost_center_id']])} has no department, so its "
                                     f"headcount can't be counted. Set its department under Organization › Cost centres, "
                                     f"or use another basis.")
        clean.append({"sequence": i, "name": name[:150], "sender_cost_center_id": sender,
                      "sender_gl_account_ids": list(s.get("sender_gl_account_ids") or []) or None,
                      "basis": basis, "activity_type": act, "receivers": rec_clean})
    out["segments"] = clean
    return out


def save_cycle(db: Session, data: dict, *, cycle_id: int | None = None, user_id: int | None = None) -> CoAllocationCycle:
    clean = validate_cycle(db, data, cycle_id=cycle_id)
    if cycle_id:
        cycle = db.query(CoAllocationCycle).filter(CoAllocationCycle.id == cycle_id).first()
        if not cycle:
            raise ValueError("Cycle not found — it may have been deleted. Reload the list.")
        for seg in list(cycle.segments):
            db.delete(seg)
        db.flush()
    else:
        cycle = CoAllocationCycle(created_by_id=user_id)
        db.add(cycle)
    for k in ("code", "name", "method", "assessment_gl_account_id", "valid_from", "valid_to", "notes"):
        setattr(cycle, k, clean.get(k))
    cycle.status = clean.get("status") or "active"
    db.flush()
    for s in clean["segments"]:
        db.add(CoAllocationSegment(cycle_id=cycle.id, **s))
    db.flush()
    db.refresh(cycle)
    return cycle


def delete_cycle(db: Session, cycle_id: int) -> None:
    cycle = db.query(CoAllocationCycle).filter(CoAllocationCycle.id == cycle_id).first()
    if not cycle:
        raise ValueError("Cycle not found — it may have been deleted. Reload the list.")
    if db.query(CoAllocationRun.id).filter(CoAllocationRun.cycle_id == cycle.id).first():
        raise ValueError(f"Cycle {cycle.code} has been run, so it stays for the audit trail — set it Inactive instead.")
    db.delete(cycle)
    db.flush()


def cycle_row(db: Session, cycle: CoAllocationCycle) -> dict:
    cc_ids = {s.sender_cost_center_id for s in cycle.segments} | {r["cost_center_id"] for s in cycle.segments for r in s.receivers or []}
    ccs = {c.id: c for c in db.query(CostCenter).filter(CostCenter.id.in_(cc_ids)).all()} if cc_ids else {}
    gl = db.query(GLAccount).filter(GLAccount.id == cycle.assessment_gl_account_id).first() if cycle.assessment_gl_account_id else None
    last = db.query(CoAllocationRun).filter(CoAllocationRun.cycle_id == cycle.id, CoAllocationRun.status == "posted").order_by(
        CoAllocationRun.accounting_period.desc()).first()
    return {
        "id": cycle.id, "code": cycle.code, "name": cycle.name, "method": cycle.method,
        "method_label": CO_ALLOCATION_METHODS.get(cycle.method, cycle.method),
        "assessment_gl_account_id": cycle.assessment_gl_account_id,
        "assessment_gl_label": f"{gl.code} — {gl.name}" if gl else None,
        "valid_from": cycle.valid_from, "valid_to": cycle.valid_to, "status": cycle.status, "notes": cycle.notes,
        "last_posted_period": last.accounting_period if last else None,
        "segments": [{
            "id": s.id, "sequence": s.sequence, "name": s.name, "sender_cost_center_id": s.sender_cost_center_id,
            "sender_label": _cc_label(ccs.get(s.sender_cost_center_id), s.sender_cost_center_id),
            "sender_gl_account_ids": s.sender_gl_account_ids or [], "basis": s.basis,
            "basis_label": CO_ALLOCATION_BASES.get(s.basis, s.basis), "activity_type": s.activity_type,
            "receivers": [{**r, "label": _cc_label(ccs.get(r["cost_center_id"]), r["cost_center_id"])} for r in s.receivers or []],
        } for s in cycle.segments],
    }


# ── Run ──────────────────────────────────────────────────────────────────

def _cycle_journal_ids(db: Session, cycle_id: int) -> list[int]:
    run_ids = [i for (i,) in db.query(CoAllocationRun.id).filter(CoAllocationRun.cycle_id == cycle_id).all()]
    if not run_ids:
        return []
    return [i for (i,) in db.query(JournalEntry.id).filter(
        JournalEntry.reference_document_type == REFERENCE_TYPE, JournalEntry.reference_document_id.in_(run_ids)).all()]


def _sender_actuals(db: Session, seg: CoAllocationSegment, start, end, exclude_je: list[int]) -> dict[int, float]:
    q = (
        db.query(JournalEntryLine.gl_account_id,
                 func.coalesce(func.sum(JournalEntryLine.debit_amount), 0), func.coalesce(func.sum(JournalEntryLine.credit_amount), 0))
        .join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id)
        .join(GLAccount, JournalEntryLine.gl_account_id == GLAccount.id)
        .filter(JournalEntryLine.cost_center_id == seg.sender_cost_center_id, JournalEntry.status.in_(JE_LEDGER_STATUSES),
                JournalEntry.posting_type != "year_end", JournalEntry.posting_date >= start, JournalEntry.posting_date <= end,
                GLAccount.account_type == "expense")
    )
    if seg.sender_gl_account_ids:
        q = q.filter(JournalEntryLine.gl_account_id.in_(seg.sender_gl_account_ids))
    if exclude_je:
        q = q.filter(JournalEntry.id.notin_(exclude_je))
    return {gl: _r(float(d) - float(c)) for gl, d, c in q.group_by(JournalEntryLine.gl_account_id).all()}


def _weights(db: Session, seg: CoAllocationSegment, ccs: dict, start, end) -> dict[int, float]:
    rec_ids = [r["cost_center_id"] for r in seg.receivers or []]
    if seg.basis == "fixed_percent":
        return {r["cost_center_id"]: float(r.get("percent") or 0) for r in seg.receivers or []}
    if seg.basis == "headcount":
        from app.modules.main.models.user import User

        dept = {cid: ccs[cid].department_id for cid in rec_ids if cid in ccs}
        counts = dict(db.query(User.department_id, func.count(User.id)).filter(
            User.is_active == True, User.department_id.in_({d for d in dept.values() if d})).group_by(User.department_id).all())  # noqa: E712
        return {cid: float(counts.get(dept.get(cid), 0)) for cid in rec_ids}
    from app.modules.production.models.work_order import ProductionTimeLog
    from app.modules.production.models.workstation import ProductionWorkstation

    q = (db.query(ProductionWorkstation.cost_center_id, func.coalesce(func.sum(ProductionTimeLog.hours), 0))
         .join(ProductionWorkstation, ProductionTimeLog.workstation_id == ProductionWorkstation.id)
         .filter(ProductionWorkstation.cost_center_id.in_(rec_ids), ProductionTimeLog.log_date >= start, ProductionTimeLog.log_date <= end))
    if seg.activity_type:
        q = q.filter(ProductionTimeLog.activity_type == seg.activity_type)
    hours = {cc: float(h) for cc, h in q.group_by(ProductionWorkstation.cost_center_id).all()}
    return {cid: hours.get(cid, 0.0) for cid in rec_ids}


def _split(amount: float, weights: list[tuple[int, float]], fixed_percent: bool) -> list[tuple[int, float]]:
    """Shares of `amount`; last receiver takes the rounding when everything is allocated."""
    total_w = sum(w for _, w in weights)
    out, done = [], 0.0
    full = not fixed_percent or abs(total_w - 100) < 1e-6
    for i, (cid, w) in enumerate(weights):
        share = w / 100 if fixed_percent else w / total_w
        amt = _r(amount * share)
        if full and i == len(weights) - 1:
            amt = _r(amount - done)
        done = _r(done + amt)
        out.append((cid, amt))
    return out


def compute(db: Session, cycle: CoAllocationCycle, period: str) -> dict:
    """The test run: what the cycle would post for `period`, without writing."""
    start, end = fiscal.period_bounds(period)
    if cycle.status != "active":
        raise ValueError(f"Cycle {cycle.code} is inactive — set it Active before running it.")
    if (cycle.valid_from and end < cycle.valid_from) or (cycle.valid_to and start > cycle.valid_to):
        raise ValueError(f"Cycle {cycle.code} isn't valid in {period} — check its validity dates.")
    exclude = _cycle_journal_ids(db, cycle.id)
    cc_ids = {s.sender_cost_center_id for s in cycle.segments} | {r["cost_center_id"] for s in cycle.segments for r in s.receivers or []}
    ccs = {c.id: c for c in db.query(CostCenter).filter(CostCenter.id.in_(cc_ids)).all()} if cc_ids else {}
    segments, lines, messages = [], [], []
    for seg in cycle.segments:
        sender = ccs.get(seg.sender_cost_center_id)
        actuals = {g: a for g, a in _sender_actuals(db, seg, start, end, exclude).items() if a > 0.005}
        weights = _weights(db, seg, ccs, start, end)
        wlist = [(r["cost_center_id"], weights.get(r["cost_center_id"], 0.0)) for r in seg.receivers or []]
        total_w = sum(w for _, w in wlist)
        sent_total = _r(sum(actuals.values()))
        seg_out = {
            "segment_id": seg.id, "name": seg.name, "sender_cost_center_id": seg.sender_cost_center_id,
            "sender_label": _cc_label(sender, seg.sender_cost_center_id), "basis": seg.basis,
            "sender_amount": sent_total, "allocated": 0.0, "receivers": [], "ledgers": [],
        }
        if sent_total <= 0:
            messages.append(f"{seg.name}: sender {seg_out['sender_label']} has no cost to allocate in {period}.")
            segments.append(seg_out)
            continue
        if total_w <= 0:
            what = {"headcount": "active users in the receivers' departments",
                    "activity_hours": "time-log hours on the receivers' workstations (set each workstation's cost centre)"}.get(seg.basis, "percentages")
            raise ValueError(f"{seg.name}: the basis is zero for every receiver in {period} — there are no {what}. "
                             f"Fix the basis data or change the segment's basis.")
        rec_totals: dict[int, float] = {}
        gl_rows = {a.id: a for a in db.query(GLAccount).filter(GLAccount.id.in_(list(actuals))).all()}
        sources = list(actuals.items()) if cycle.method == "distribution" else [(cycle.assessment_gl_account_id, sent_total)]
        for gl_id, amount in sources:
            parts = [(cid, a) for cid, a in _split(amount, wlist, seg.basis == "fixed_percent") if abs(a) >= 0.005]
            moved = _r(sum(a for _, a in parts))
            if moved <= 0:
                continue
            remark = f"{cycle.code} {period} · {seg.name}"
            lines.append({"gl_account_id": gl_id, "cost_center_id": seg.sender_cost_center_id, "credit_amount": moved, "remarks": remark})
            for cid, a in parts:
                lines.append({"gl_account_id": gl_id, "cost_center_id": cid, "debit_amount": a, "remarks": remark})
                rec_totals[cid] = _r(rec_totals.get(cid, 0) + a)
            if cycle.method == "distribution":
                g = gl_rows.get(gl_id)
                seg_out["ledgers"].append({"gl_account_id": gl_id, "label": f"{g.code} — {g.name}" if g else str(gl_id),
                                           "sender_amount": amount, "allocated": moved})
        seg_out["allocated"] = _r(sum(rec_totals.values()))
        if cycle.method == "assessment":
            seg_out["ledgers"] = [{"gl_account_id": g, "label": f"{gl_rows[g].code} — {gl_rows[g].name}" if g in gl_rows else str(g),
                                   "sender_amount": a, "allocated": None} for g, a in actuals.items()]
        seg_out["receivers"] = [{
            "cost_center_id": cid, "label": _cc_label(ccs.get(cid), cid), "basis_value": w,
            "share_pct": round(w if seg.basis == "fixed_percent" else w / total_w * 100, 4),
            "amount": rec_totals.get(cid, 0.0),
        } for cid, w in wlist]
        segments.append(seg_out)
    return {
        "cycle_id": cycle.id, "cycle_code": cycle.code, "method": cycle.method, "period": period, "posting_date": end,
        "segments": segments, "lines": lines, "messages": messages,
        "total_amount": _r(sum(s["allocated"] for s in segments)),
    }


def _get_cycle(db: Session, cycle_id: int) -> CoAllocationCycle:
    cycle = db.query(CoAllocationCycle).filter(CoAllocationCycle.id == cycle_id).first()
    if not cycle:
        raise ValueError("Cycle not found — it may have been deleted. Reload the list.")
    return cycle


def _posted_run(db: Session, cycle_id: int, period: str) -> CoAllocationRun | None:
    return db.query(CoAllocationRun).filter(CoAllocationRun.cycle_id == cycle_id, CoAllocationRun.accounting_period == period,
                                            CoAllocationRun.status == "posted").first()


def run_cycle(db: Session, cycle_id: int, period: str, *, test_run: bool = True, user_id: int | None = None) -> dict:
    cycle = _get_cycle(db, cycle_id)
    existing = _posted_run(db, cycle.id, period)
    if existing and not test_run:
        raise ValueError(f"Cycle {cycle.code} is already posted for {period} (run #{existing.id}). Reverse that run first "
                         f"if the period's costs changed, then run it again.")
    result = compute(db, cycle, period)
    result["already_posted_run_id"] = existing.id if existing else None
    if test_run:
        result["test_run"] = True
        return result
    if not result["lines"]:
        raise ValueError(f"Nothing to post: no sender of cycle {cycle.code} has cost in {period}. "
                         + " ".join(result["messages"]))
    run = CoAllocationRun(cycle_id=cycle.id, accounting_period=period, status="posted", total_amount=result["total_amount"],
                          run_by_id=user_id)
    db.add(run)
    db.flush()
    from app.modules.accounts import service

    entry = service.post_journal_entry(
        db, posting_date=result["posting_date"], lines=result["lines"], posting_type=POSTING_TYPE, voucher_type="journal",
        description=f"CO {CO_ALLOCATION_METHODS[cycle.method].split(' ')[0].lower()} {cycle.code} — {cycle.name} ({period})",
        reference_document_type=REFERENCE_TYPE, reference_document_id=run.id, created_by_id=user_id,
    )
    run.journal_entry_id = entry.id
    run.result = {k: v for k, v in result.items() if k not in ("lines", "posting_date")}
    db.flush()
    result.update({"test_run": False, "run_id": run.id, "journal_entry_id": entry.id, "entry_number": entry.entry_number})
    return result


def reverse_run(db: Session, run_id: int, *, reason: str, user_id: int | None = None) -> CoAllocationRun:
    run = db.query(CoAllocationRun).filter(CoAllocationRun.id == run_id).first()
    if not run:
        raise ValueError("Allocation run not found — reload the list.")
    if run.status != "posted":
        raise ValueError(f"Run #{run.id} is already reversed.")
    if not reason or not reason.strip():
        raise ValueError("Give a reason for reversing the allocation — it goes on the audit trail.")
    from app.modules.accounts import service

    original = db.query(JournalEntry).filter(JournalEntry.id == run.journal_entry_id).first()
    rev = service.reverse_journal_entry(db, journal_entry_id=run.journal_entry_id, reason=reason.strip(), reversed_by_id=user_id,
                                        reversal_date=original.posting_date if original else None)
    run.status, run.reversal_journal_entry_id = "reversed", rev.id
    run.reversed_by_id, run.reversed_at, run.reversal_reason = user_id, datetime.now(timezone.utc), reason.strip()
    db.flush()
    return run


def run_rows(db: Session, *, cycle_id: int | None = None, period: str | None = None) -> list[dict]:
    q = db.query(CoAllocationRun)
    if cycle_id:
        q = q.filter(CoAllocationRun.cycle_id == cycle_id)
    if period:
        q = q.filter(CoAllocationRun.accounting_period == period)
    runs = q.order_by(CoAllocationRun.accounting_period.desc(), CoAllocationRun.id.desc()).all()
    cycles = {c.id: c for c in db.query(CoAllocationCycle).filter(CoAllocationCycle.id.in_({r.cycle_id for r in runs})).all()} if runs else {}
    je_ids = {r.journal_entry_id for r in runs} | {r.reversal_journal_entry_id for r in runs}
    je_ids.discard(None)
    numbers = dict(db.query(JournalEntry.id, JournalEntry.entry_number).filter(JournalEntry.id.in_(je_ids)).all()) if je_ids else {}
    return [{
        "id": r.id, "cycle_id": r.cycle_id, "cycle_code": cycles[r.cycle_id].code if r.cycle_id in cycles else None,
        "cycle_name": cycles[r.cycle_id].name if r.cycle_id in cycles else None, "accounting_period": r.accounting_period,
        "status": r.status, "total_amount": _r(r.total_amount), "journal_entry_id": r.journal_entry_id,
        "entry_number": numbers.get(r.journal_entry_id), "reversal_journal_entry_id": r.reversal_journal_entry_id,
        "reversal_entry_number": numbers.get(r.reversal_journal_entry_id), "run_by_id": r.run_by_id, "created_at": r.created_at,
        "reversed_at": r.reversed_at, "reversal_reason": r.reversal_reason, "result": r.result,
    } for r in runs]
