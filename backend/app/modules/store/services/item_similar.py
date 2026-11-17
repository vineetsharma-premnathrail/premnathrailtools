"""'Is it already in the Item Master?' (owner, 2026-11-14).

Before an item is added in a hurry from the Before-PO receipt form, the form
asks for items that look like the one being typed, so "Bolt M12", "M12 BOLT"
and "Bolt M-12" do not become three items. Matches, best first:

* bill_name   — this vendor's earlier bill used the same name for an item
                (store_item_vendor_names, learnt from receipts);
* same_name   — the same words once case, punctuation and word order are ignored;
* similar     — a typo-level difference, or every word of one name inside the other;

and the technical specification, when given, lifts an item whose spec matches.
Read-only; only active items are offered."""
from __future__ import annotations

import re
from difflib import SequenceMatcher

from sqlalchemy.orm import Session

from app.modules.store.models.item import StoreItem

SIMILAR_AT = 0.78
LIMIT = 8


def words(text: str | None) -> list[str]:
    """Lower-case words and numbers; 'M-12' and 'M12' both give 'm12'."""
    s = (text or "").lower().replace("&", " and ")
    s = re.sub(r"(?<=[a-z])[-/.](?=\d)|(?<=\d)[-/.](?=[a-z])", "", s)
    return [w for w in re.split(r"[^a-z0-9.]+", s) if w and w != "."]


def name_key(text: str | None) -> str:
    """Same words in any order -> same key."""
    return " ".join(sorted(words(text)))


def _ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    m = SequenceMatcher(None, a, b, autojunk=False)
    if m.real_quick_ratio() < SIMILAR_AT or m.quick_ratio() < SIMILAR_AT:
        return 0.0
    return m.ratio()


def similar_items(db: Session, name: str, spec: str | None = None, vendor_id: int | None = None) -> list[dict]:
    key = name_key(name)
    if not key:
        return []
    want = set(key.split())
    spec_key = name_key(spec)
    hits: dict[int, dict] = {}

    def add(item: StoreItem, kind: str, reason: str, score: float) -> None:
        cur = hits.get(item.id)
        if cur is None or score > cur["score"]:
            hits[item.id] = {"id": item.id, "item_code": item.item_code, "item_name": item.item_name,
                             "item_type": item.item_type, "category": item.category, "uom": item.uom,
                             "specification": item.specification or item.description,
                             "match": kind, "reason": reason, "score": round(score, 3)}

    items = db.query(StoreItem).filter(StoreItem.status == "active").all()
    by_id = {i.id: i for i in items}

    if vendor_id:
        from app.modules.store.models.pre_po_receipt import StoreItemVendorName, bill_name_key
        rows = (db.query(StoreItemVendorName)
                .filter(StoreItemVendorName.vendor_id == vendor_id).all())
        typed = bill_name_key(name)
        for r in rows:
            it = by_id.get(r.store_item_id)
            if it is None:
                continue
            if r.name_key == typed:
                add(it, "bill_name", f"This vendor's earlier bill called it \"{r.invoice_name}\"", 1.0)
            elif _ratio(name_key(r.invoice_name), key) >= SIMILAR_AT:
                add(it, "bill_name", f"Close to \"{r.invoice_name}\" on this vendor's earlier bill", 0.9)

    for it in items:
        k = name_key(it.item_name)
        if not k:
            continue
        if k == key:
            score, kind, reason = 0.95, "same_name", "Same name"
        else:
            have = set(k.split())
            contained = (want <= have or have <= want) and min(len(want), len(have)) >= 2
            r = _ratio(k, key)
            if r < SIMILAR_AT and not contained:
                continue
            score, kind = max(r, 0.8 if contained else 0.0) * 0.9, "similar"
            reason = "Similar name" if r >= SIMILAR_AT else "Every word of the shorter name is in the other"
        if spec_key and name_key(it.specification or it.description) == spec_key:
            score, reason = score + 0.04, f"{reason}, same technical details"
        add(it, kind, reason, score)

    return sorted(hits.values(), key=lambda h: (-h["score"], h["item_code"]))[:LIMIT]
