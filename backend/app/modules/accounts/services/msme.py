"""MSME supplier payments (MSMED Act 2006 sec. 15-16; Income-tax Act sec. 43B(h)).

* A buyer must pay a micro / small / medium supplier within the agreed credit
  period, never more than 45 days from the day of acceptance of the goods or
  services; with no written agreement, within 15 days. Later than that the
  buyer owes compound interest at 3 x the RBI bank rate (sec. 16).
* Sec. 43B(h) (from AY 2024-25): an amount owed to a MICRO or SMALL
  enterprise that is still unpaid beyond that limit at the year end is not
  deductible in that year — it is allowed only in the year it is paid.
  Medium enterprises and traders (Udyam registration as wholesale / retail
  trade) are outside 43B(h).

Day count: from the bill date (the portal's acceptance proxy — goods are
accepted on the GRN before the bill is booked, so this never understates the
days outstanding by more than the GRN-to-bill gap)."""
from __future__ import annotations

import re
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.modules.accounts.models.vendor import Vendor

MSME_CATEGORIES = {"micro": "Micro", "small": "Small", "medium": "Medium"}
MSME_ACTIVITIES = {"manufacturing": "Manufacturing", "services": "Services", "trader": "Trader (wholesale / retail)"}
STATUTORY_LIMIT_DAYS = 45
NO_AGREEMENT_DAYS = 15
_UDYAM_RE = re.compile(r"^UDYAM-[A-Z]{2}-\d{2}-\d{7}$")


def clean_msme_fields(data: dict) -> dict:
    """Normalises / validates the MSME fields present in a vendor payload (in
    place); raises ValueError with what to fix."""
    if "udyam_number" in data:
        u = (data.get("udyam_number") or "").strip().upper().replace(" ", "") or None
        if u and not _UDYAM_RE.match(u):
            raise ValueError(f"Udyam registration number '{data['udyam_number']}' is not in the Udyam format "
                             "UDYAM-XX-00-0000000 (state letters, district code, 7 digits) — copy it from the Udyam certificate.")
        data["udyam_number"] = u
    if "msme_category" in data:
        c = (data.get("msme_category") or "").strip().lower() or None
        if c in ("none", "no", "not_msme"):
            c = None
        if c and c not in MSME_CATEGORIES:
            raise ValueError("MSME category must be micro, small or medium (or blank when the vendor is not an MSME).")
        data["msme_category"] = c
    if "msme_activity" in data:
        a = (data.get("msme_activity") or "").strip().lower() or None
        if a and a not in MSME_ACTIVITIES:
            raise ValueError("MSME activity must be manufacturing, services or trader.")
        data["msme_activity"] = a
    return data


def check_vendor(v: Vendor) -> None:
    """Cross-field MSME rules on the vendor as it will be saved."""
    if v.msme_category and not v.udyam_number:
        raise ValueError(f"A {MSME_CATEGORIES[v.msme_category].lower()} enterprise needs its Udyam registration number — the MSMED Act "
                         "protection applies only to a registered enterprise. Enter it from the vendor's Udyam certificate.")
    if v.msme_category and v.payment_days is not None and int(v.payment_days) > STATUTORY_LIMIT_DAYS:
        raise ValueError(f"Payment terms of {v.payment_days} days aren't allowed for an MSME supplier — the MSMED Act caps the credit "
                         f"period at {STATUTORY_LIMIT_DAYS} days from acceptance. Set payment days to {STATUTORY_LIMIT_DAYS} or less.")


def limit_days(v: Vendor) -> int:
    """Statutory payment limit: the agreed days (capped at 45), or 15 days
    when no credit period is agreed."""
    if v.payment_days is None or v.payment_days <= 0:
        return NO_AGREEMENT_DAYS
    return min(int(v.payment_days), STATUTORY_LIMIT_DAYS)


def covered_by_43bh(v: Vendor) -> bool:
    return v.msme_category in ("micro", "small") and (v.msme_activity or "") != "trader"


def _msme_vendors(db: Session) -> dict[int, Vendor]:
    return {v.id: v for v in db.query(Vendor).filter(Vendor.msme_category.isnot(None)).all()}


def _bill_rows(db: Session, as_of: date | None) -> tuple[list[dict], dict[int, Vendor]]:
    from app.modules.accounts.services.outstanding import open_documents
    vendors = _msme_vendors(db)
    if not vendors:
        return [], vendors
    rows = [r for r in open_documents(db, party_type="vendor", as_of=as_of) if r["party_id"] in vendors]
    return rows, vendors


def open_bill_alerts(db: Session, *, as_of: date | None = None, warn_days: int = 7) -> dict:
    """Open bills of MSME suppliers with the statutory pay-by date:
    'breached' past it, 'due_soon' within `warn_days`, else 'ok'."""
    today = as_of or date.today()
    rows, vendors = _bill_rows(db, as_of)
    out = []
    for r in rows:
        v = vendors[r["party_id"]]
        lim = limit_days(v)
        pay_by = r["doc_date"] + timedelta(days=lim)
        left = (pay_by - today).days
        status = "breached" if left < 0 else "due_soon" if left <= warn_days else "ok"
        out.append({"vendor_id": v.id, "vendor_code": v.code, "vendor_name": v.name, "msme_category": v.msme_category,
                    "udyam_number": v.udyam_number, "invoice_id": r["id"], "invoice_number": r["doc_number"],
                    "invoice_date": r["doc_date"].isoformat(), "amount_due": round(float(r["amount_due"]), 2),
                    "limit_days": lim, "pay_by": pay_by.isoformat(), "days_outstanding": (today - r["doc_date"]).days,
                    "days_left": left, "status": status})
    out.sort(key=lambda x: (x["days_left"], x["vendor_name"]))
    return {"as_of": today.isoformat(), "rows": out,
            "breached_count": sum(1 for x in out if x["status"] == "breached"),
            "breached_amount": round(sum(x["amount_due"] for x in out if x["status"] == "breached"), 2),
            "due_soon_count": sum(1 for x in out if x["status"] == "due_soon")}


def fy_end_for(fy_start_year: int) -> date:
    return date(fy_start_year + 1, 3, 31)


def report_43bh(db: Session, *, fy_start_year: int) -> dict:
    """Sec. 43B(h) statement for the financial year starting 1 April
    `fy_start_year`: bills of micro / small (non-trader) suppliers still
    unpaid at 31 March whose statutory pay-by date fell on or before
    31 March — disallowed this year, allowed in the year actually paid."""
    fy_end = fy_end_for(fy_start_year)
    rows, vendors = _bill_rows(db, fy_end if fy_end < date.today() else None)
    out, excluded = [], []
    for r in rows:
        v = vendors[r["party_id"]]
        lim = limit_days(v)
        pay_by = r["doc_date"] + timedelta(days=lim)
        if r["doc_date"] > fy_end:
            continue
        row = {"vendor_id": v.id, "vendor_code": v.code, "vendor_name": v.name, "msme_category": v.msme_category,
               "msme_activity": v.msme_activity, "udyam_number": v.udyam_number, "invoice_number": r["doc_number"],
               "invoice_date": r["doc_date"].isoformat(), "limit_days": lim, "pay_by": pay_by.isoformat(),
               "unpaid_at_year_end": round(float(r["amount_due"]), 2), "days_beyond_limit": (fy_end - pay_by).days}
        if not covered_by_43bh(v):
            row["reason"] = "Medium enterprise — outside 43B(h)" if v.msme_category == "medium" else "Trader — outside 43B(h)"
            excluded.append(row)
        elif pay_by <= fy_end:
            out.append(row)
    out.sort(key=lambda x: (x["vendor_name"], x["invoice_date"]))
    return {"financial_year": f"{fy_start_year}-{(fy_start_year + 1) % 100:02d}", "year_end": fy_end.isoformat(),
            "rows": out, "total_disallowed": round(sum(x["unpaid_at_year_end"] for x in out), 2),
            "excluded": excluded,
            "note": ("Disallowed under sec. 43B(h) for this year; deductible in the year of actual payment. Bills whose "
                     "pay-by date falls after 31 March are not listed — they are allowed if paid within the limit.")}
