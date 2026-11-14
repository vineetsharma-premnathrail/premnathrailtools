"""Procurement › Vendors › Find duplicates (owner, 2026-11-14).

One click lists groups of vendors that are probably the same company, so the
team can merge / block the extra ones:

* same_gstin  — the same GSTIN on two vendors (one GSTIN = one vendor; new
                saves are refused by the Vendor model, older data may still
                hold pairs);
* same_name   — the same company name once spelling noise is removed
                ("M/s Shree Ram Steels Pvt. Ltd." = "Shree Ram Steels Private Limited");
* similar_name — names that differ by a typo or a word ("Shree Ram Steel" /
                "Shri Ram Steels");
* same_pan    — one PAN, different GSTINs: usually one company registered in
                several states, which is allowed — shown for a look only.

Read-only: nothing is changed. Who may open it = who may read the vendor
master (same rule as the vendor list). Its own prefix, so the path never
collides with /p2p/vendors/{vendor_id}."""
from __future__ import annotations

import re
from collections import defaultdict
from difflib import SequenceMatcher

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.accounts.models.vendor import Vendor
from app.modules.main.models.user import User
from app.modules.p2p.routes.vendors import _lookup

router = APIRouter(prefix="/p2p/vendor-duplicates", tags=["P2P - Vendors"])

# Words that do not tell two companies apart.
_NOISE = {"m", "s", "ms", "messrs", "the", "pvt", "private", "ltd", "limited", "llp", "co", "company", "inc",
          "corp", "corporation", "and"}
SIMILAR_AT = 0.88  # SequenceMatcher ratio on the cleaned name


def name_key(name: str | None) -> str:
    """Company name without case, punctuation and legal-form words."""
    s = (name or "").lower().replace("&", " and ").replace("m/s", " ")
    words = [w for w in re.split(r"[^a-z0-9]+", s) if w and w not in _NOISE]
    return " ".join(words)


def _vendor(v: Vendor, po_count: int) -> dict:
    return {"id": v.id, "code": v.code, "name": v.name, "gstin": v.gstin, "pan": v.pan, "city": v.city,
            "state": v.state, "status": v.status, "po_count": po_count}


def find_duplicate_groups(db: Session) -> list[dict]:
    vendors = db.query(Vendor).order_by(Vendor.code.asc()).all()
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
    po_counts = dict(db.query(P2PPurchaseOrder.vendor_id, func.count(P2PPurchaseOrder.id))
                     .filter(P2PPurchaseOrder.vendor_id.isnot(None)).group_by(P2PPurchaseOrder.vendor_id).all())
    rows = {v.id: _vendor(v, po_counts.get(v.id, 0)) for v in vendors}
    groups: list[dict] = []

    def add(kind: str, reason: str, ids) -> None:
        ids = sorted(set(ids), key=lambda i: rows[i]["code"] or "")
        if len(ids) > 1:
            groups.append({"kind": kind, "reason": reason, "vendors": [rows[i] for i in ids]})

    by_gstin: dict[str, list[int]] = defaultdict(list)
    by_pan: dict[str, list[int]] = defaultdict(list)
    by_name: dict[str, list[int]] = defaultdict(list)
    for v in vendors:
        if v.gstin and v.gstin.strip():
            by_gstin[v.gstin.strip().upper()].append(v.id)
        if v.pan and v.pan.strip():
            by_pan[v.pan.strip().upper()].append(v.id)
        key = name_key(v.name)
        if key:
            by_name[key].append(v.id)

    for g, ids in by_gstin.items():
        add("same_gstin", f"Same GSTIN {g}", ids)
    for key, ids in by_name.items():
        add("same_name", "Same company name", ids)

    # Similar names: compare one vendor per cleaned name, only within the same
    # first letters (a cheap bucket that keeps thousands of vendors fast).
    keys = sorted(by_name)
    buckets: dict[str, list[str]] = defaultdict(list)
    for k in keys:
        buckets[k.replace(" ", "")[:2]].append(k)
    parent = {k: k for k in keys}

    def root(k: str) -> str:
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    for bucket in buckets.values():
        for i, a in enumerate(bucket):
            for b in bucket[i + 1:]:
                if SequenceMatcher(None, a, b, autojunk=False).ratio() >= SIMILAR_AT:
                    parent[root(b)] = root(a)
    clusters: dict[str, list[str]] = defaultdict(list)
    for k in keys:
        clusters[root(k)].append(k)
    for names in clusters.values():
        if len(names) > 1:
            add("similar_name", "Similar company names", [i for n in names for i in by_name[n]])

    for p, ids in by_pan.items():
        gstins = {(rows[i]["gstin"] or "").upper() for i in ids}
        if len(gstins) > 1:  # same PAN and same GSTIN is already in same_gstin
            add("same_pan", f"Same PAN {p}, different GSTINs (often one company in several states)", ids)

    order = {"same_gstin": 0, "same_name": 1, "similar_name": 2, "same_pan": 3}
    groups.sort(key=lambda g: (order[g["kind"]], g["vendors"][0]["name"].lower()))
    return groups


@router.get("")
def vendor_duplicates(db: Session = Depends(get_db), _user: User = Depends(_lookup)):
    groups = find_duplicate_groups(db)
    counts = {k: sum(1 for g in groups if g["kind"] == k) for k in ("same_gstin", "same_name", "similar_name", "same_pan")}
    return {"groups": groups, "counts": counts, "vendors_checked": db.query(func.count(Vendor.id)).scalar() or 0}
