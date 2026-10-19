"""Opportunity reporting (SAP CRM pipeline / win-loss analysis), limited to the
user's CRM data scope:

* GET /crm/opportunity/meta       lost reason codes + CRM users for the owner pickers
* GET /crm/opportunity/win-loss   closed inquiries in a period: won / lost, win rate,
                                  lost by reason / competitor, per owner
* GET /crm/opportunity/forecast   open pipeline weighted by probability, by expected
                                  order month and by owner
"""
from collections import defaultdict
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope
from app.core.permissions import require_tab_access
from app.db.session import get_db
from app.modules.crm.access import require_view_any
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.services import opportunity as opp
from app.modules.main.models.user import User

router = APIRouter(prefix="/crm/opportunity", tags=["CRM - Opportunity"])


def _owner_key(inq: Inquiry) -> tuple[int | None, str]:
    name = (inq.bd_owner or "").strip()
    return inq.bd_owner_id, name or "Unassigned"


@router.get("/meta")
async def opportunity_meta(db: Session = Depends(get_db), _user: User = Depends(require_view_any())):
    users = db.query(User).filter(User.is_active == True).order_by(User.name).all()  # noqa: E712
    return {
        "lost_reasons": [{"value": k, "label": v} for k, v in opp.LOST_REASONS.items()],
        "owners": [{"value": u.id, "label": u.name or u.email} for u in users if "crm" in u.get_apps()],
    }


def _period(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    today = date.today()
    start = date_from or date(today.year if today.month >= 4 else today.year - 1, 4, 1)  # Indian FY start
    end = date_to or today
    if end < start:
        raise HTTPException(status_code=422, detail=f"'To' ({end:%d-%m-%Y}) is before 'From' ({start:%d-%m-%Y}) — swap the dates.")
    return start, end


@router.get("/win-loss")
async def win_loss(date_from: date | None = None, date_to: date | None = None, db: Session = Depends(get_db),
                   user: User = Depends(require_tab_access("crm", "dashboard"))):
    start, end = _period(date_from, date_to)
    lo = datetime.combine(start, time.min, tzinfo=timezone.utc)
    hi = datetime.combine(end, time.max, tzinfo=timezone.utc)
    q = apply_scope(db.query(Inquiry), user, Inquiry).filter(Inquiry.is_deleted == False)  # noqa: E712
    rows = [i for i in q.filter(Inquiry.closed_at.isnot(None), Inquiry.closed_at >= lo, Inquiry.closed_at <= hi).all()
            if opp.is_won(i.current_stage, i.status) or opp.is_lost(i.current_stage, i.status)]
    won = [i for i in rows if opp.is_won(i.current_stage, i.status)]
    lost = [i for i in rows if not opp.is_won(i.current_stage, i.status)]
    val = lambda items: round(sum(float(i.expected_value or 0) for i in items), 2)  # noqa: E731

    by_reason: dict[str, list] = defaultdict(list)
    by_comp: dict[str, list] = defaultdict(list)
    for i in lost:
        by_reason[i.lost_reason_code or "unspecified"].append(i)
        if i.lost_to_competitor:
            by_comp[i.lost_to_competitor.strip()].append(i)
    owners: dict[tuple, dict] = {}
    for i in rows:
        key = _owner_key(i)
        o = owners.setdefault(key, {"owner_id": key[0], "owner": key[1], "won": 0, "lost": 0, "won_value": 0.0, "lost_value": 0.0})
        side = "won" if i in won else "lost"
        o[side] += 1
        o[f"{side}_value"] = round(o[f"{side}_value"] + float(i.expected_value or 0), 2)
    for o in owners.values():
        o["win_rate"] = round(o["won"] / (o["won"] + o["lost"]) * 100, 1) if (o["won"] + o["lost"]) else None
    total = len(rows)
    return {
        "date_from": start.isoformat(), "date_to": end.isoformat(),
        "closed": total, "won": len(won), "lost": len(lost), "won_value": val(won), "lost_value": val(lost),
        "win_rate": round(len(won) / total * 100, 1) if total else None,
        "by_reason": sorted([{"code": k, "label": opp.LOST_REASONS.get(k, "Not recorded (closed before reasons were required)"),
                              "count": len(v), "value": val(v)} for k, v in by_reason.items()], key=lambda r: -r["count"]),
        "by_competitor": sorted([{"competitor": k, "count": len(v), "value": val(v)} for k, v in by_comp.items()],
                                key=lambda r: -r["count"]),
        "by_owner": sorted(owners.values(), key=lambda r: -(r["won"] + r["lost"])),
        "lost_inquiries": [{"id": i.id, "universal_id": i.universal_id, "customer": i.organization.name if i.organization else None,
                            "owner": _owner_key(i)[1], "reason": opp.LOST_REASONS.get(i.lost_reason_code or "", "—"),
                            "competitor": i.lost_to_competitor, "value": float(i.expected_value or 0),
                            "closed_on": i.closed_at.date().isoformat() if i.closed_at else None}
                           for i in sorted(lost, key=lambda x: x.closed_at, reverse=True)[:50]],
    }


@router.get("/forecast")
async def forecast(db: Session = Depends(get_db), user: User = Depends(require_tab_access("crm", "dashboard"))):
    q = apply_scope(db.query(Inquiry), user, Inquiry).filter(Inquiry.is_deleted == False)  # noqa: E712
    open_rows = [i for i in q.all() if not (opp.is_won(i.current_stage, i.status) or opp.is_lost(i.current_stage, i.status))]
    months: dict[str, dict] = {}
    owners: dict[tuple, dict] = {}
    no_date = {"count": 0, "value": 0.0, "weighted": 0.0}
    for i in open_rows:
        value = float(i.expected_value or 0)
        weighted = value * float(i.probability or 0) / 100
        if i.expected_order_date:
            k = i.expected_order_date.strftime("%Y-%m")
            m = months.setdefault(k, {"month": k, "count": 0, "value": 0.0, "weighted": 0.0})
        else:
            m = no_date
        m["count"] += 1
        m["value"] += value
        m["weighted"] += weighted
        key = _owner_key(i)
        o = owners.setdefault(key, {"owner_id": key[0], "owner": key[1], "count": 0, "value": 0.0, "weighted": 0.0})
        o["count"] += 1
        o["value"] += value
        o["weighted"] += weighted
    rnd = lambda d: {**d, "value": round(d["value"], 2), "weighted": round(d["weighted"], 2)}  # noqa: E731
    return {
        "open": len(open_rows),
        "pipeline_value": round(sum(float(i.expected_value or 0) for i in open_rows), 2),
        "weighted_value": round(sum(float(i.expected_value or 0) * float(i.probability or 0) / 100 for i in open_rows), 2),
        "by_month": [rnd(m) for _k, m in sorted(months.items())],
        "no_expected_date": rnd(no_date),
        "by_owner": sorted((rnd(o) for o in owners.values()), key=lambda r: -r["weighted"]),
    }
