"""Typing assist: the word list the browser completes / spell-checks from, and
fuzzy "similar records" look-ups. Read-only — nothing is written, no table.

Both features reuse the permission gate AND the data scope of the module's own
list route, so a user can never read a name through typing assist that the list
page would hide from them:

* items          Store > Items view (the item list itself is a cross-module
                 lookup, but item words are only shared with Store viewers);
* vendors        p2p.routes.vendors._lookup (Procurement > Vendors / RFQ /
                 Purchase Orders view, Purchase desk, Accounts);
* organizations  CRM or Finance access + the CRM data scope (apply_scope);
* machines       erp.routes.projects._machines_tab_or_pm_project + the machine
                 list filter;
* products       Sales (CRM) > Products view.

Text only: names, descriptions, make, specification. Never ids in the word list,
prices, emails, phones, PAN or GSTIN.
"""
import re
import threading
import time
from collections import Counter
from difflib import SequenceMatcher
from functools import lru_cache

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope, scope_filter, user_scope
from app.core.permission_registry import can_view_tab
from app.core.permissions import require_any_app_access
from app.modules.accounts.models.vendor import Vendor
from app.modules.crm.models.organization import Organization
from app.modules.erp.models.project import Project
from app.modules.erp.routes.projects import _has_sr_access, _machine_list_filter, _machines_tab_or_pm_project
from app.modules.main.models.user import User
from app.modules.p2p.routes.vendor_duplicates import name_key
from app.modules.p2p.routes.vendors import _lookup as _vendor_lookup
from app.modules.products.models.product import FinishedProduct
from app.modules.store.models.item import StoreItem

TOP_WORDS = 20_000
TOP_BIGRAMS = 20_000
MIN_TOKEN = 2
MAX_TOKEN = 30
MAX_TEXT = 1_000          # characters of one text field that are read
CACHE_SECONDS = 600       # 10 minutes
MAX_CACHE_ENTRIES = 50
CANDIDATE_SECONDS = 60    # similar(): the id/code/name rows of one kind

MIN_QUERY = 3
MAX_QUERY = 80
MAX_LIMIT = 10
THRESHOLD = 0.6
MIN_BONUS = 4             # shortest text that gets the prefix / word-start bonus

KINDS = ("item", "vendor", "organization", "machine")

_TOKEN = re.compile(r"[^\W_]+")
_SEP = re.compile(r"[^a-z0-9]+")


# ── Tokenising ──────────────────────────────────────────────────────────────

def tokenize(text: str | None) -> list[str]:
    """Lower-case words of 2 to 30 letters / digits. Numbers on their own
    (quantities, years, codes) are dropped — they are not words to complete."""
    out = []
    for tok in _TOKEN.findall((text or "")[:MAX_TEXT].lower()):
        if MIN_TOKEN <= len(tok) <= MAX_TOKEN and not tok.isdigit():
            out.append(tok)
    return out


def count_text(words: Counter, bigrams: Counter, texts) -> None:
    """Add every text's words and consecutive word pairs (never across two
    separate fields) to the counters."""
    for text in texts:
        toks = tokenize(text)
        words.update(toks)
        bigrams.update(zip(toks, toks[1:]))


def _top(counter: Counter, n: int) -> list:
    return sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:n]


# ── Permission gates (the module's own list-route rules) ───────────────────

def _items_allowed(user: User) -> bool:
    return can_view_tab(user, "store", "items")


def _ensure_items(user: User) -> None:
    if not _items_allowed(user):
        raise HTTPException(
            status_code=403,
            detail="You don't have permission to view Store items. Ask your admin for Store › Items view access.",
        )


def _vendors_allowed(user: User) -> bool:
    try:
        _vendor_lookup(user)
        return True
    except HTTPException:
        return False


def _orgs_allowed(user: User) -> bool:
    try:
        require_any_app_access("crm", "accounts")(user)
        return True
    except HTTPException:
        return False


def _ensure_machines(db: Session, user: User) -> None:
    """The Machines list route's two gates: access to the ERP or Project
    Management module, then the Machines / Service Requests tab."""
    require_any_app_access("erp", "projects")(user)
    _machines_tab_or_pm_project(None, db, user)


def _machines_allowed(db: Session, user: User) -> bool:
    try:
        _ensure_machines(db, user)
        return True
    except HTTPException:
        return False


def _products_allowed(user: User) -> bool:
    return can_view_tab(user, "crm", "products")


# ── Data scope ─────────────────────────────────────────────────────────────

def _org_query(db: Session, user: User, *cols):
    """Organizations the Organizations list page shows this user (its data scope)."""
    q = db.query(*cols).filter(Organization.is_deleted == False)  # noqa: E712
    return apply_scope(q, user, Organization, db)


def _machine_query(db: Session, user: User, *cols):
    """Machines the Machines list shows this user (project / service-request scope)."""
    q = db.query(*cols).filter(Project.is_deleted == False)  # noqa: E712
    scope_expr = _machine_list_filter(db, user)
    return q if scope_expr is None else q.filter(scope_expr)


def _scope_restricts_orgs(db: Session, user: User) -> bool:
    return scope_filter(db, user, Organization) is not None


def _scope_restricts_machines(db: Session, user: User) -> bool:
    return _machine_list_filter(db, user) is not None


# ── Vocabulary ──────────────────────────────────────────────────────────────

_cache: dict = {}            # vocabulary payloads
_candidate_cache: dict = {}  # similar(): candidate rows
_cache_lock = threading.Lock()
_key_locks: dict = {}        # one lock per vocabulary key: concurrent cold calls compute once


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()
        _candidate_cache.clear()
        _key_locks.clear()


def _cache_get(store: dict, key: tuple, seconds: int):
    with _cache_lock:
        hit = store.get(key)
        if hit and time.monotonic() - hit[0] < seconds:
            return hit[1]
    return None


def _cache_put(store: dict, key: tuple, value, seconds: int) -> None:
    now = time.monotonic()
    with _cache_lock:
        if len(store) >= MAX_CACHE_ENTRIES and key not in store:
            for k in [k for k, (ts, _v) in store.items() if now - ts >= seconds] or [next(iter(store))]:
                store.pop(k, None)
        store[key] = (now, value)


def allowed_sources(db: Session, user: User) -> list[str]:
    """Source keys this user may read words from (same checks as the list routes)."""
    out = []
    if _items_allowed(user):
        out.append("store_items")
    if _vendors_allowed(user):
        out.append("vendors")
    if _orgs_allowed(user):
        out.append("organizations")
    if _machines_allowed(db, user):
        out.append("machines")
    if _products_allowed(user):
        out.append("products")
    return out


def _source_texts(db: Session, user: User, source: str):
    """Yield the text fields of one source (only the needed columns are loaded)."""
    if source == "store_items":
        for row in db.query(StoreItem.item_name, StoreItem.description, StoreItem.make, StoreItem.specification).all():
            yield from row
    elif source == "vendors":
        for (name,) in db.query(Vendor.name).all():
            yield name
    elif source == "organizations":
        for (name,) in _org_query(db, user, Organization.name).all():
            yield name
    elif source == "machines":
        for row in _machine_query(db, user, Project.model_name, Project.client_company).all():
            yield from row
    elif source == "products":
        for (name,) in db.query(FinishedProduct.name).all():
            yield name


def _scope_marker(db: Session, user: User, source: str) -> tuple:
    """Part of a cache key for a data-scoped source. Empty when the scope does
    not narrow it (everyone with access sees the same rows). Otherwise it holds
    the user and every scope input of the list route, so a narrowed user's rows
    are never served to a wider (or different) scope, even after a role change
    inside the cache time."""
    if source == "organizations":
        if _scope_restricts_orgs(db, user):
            return ("organizations", user.id, user_scope(user, "crm"))
    elif source == "machines":
        if _scope_restricts_machines(db, user):
            return ("machines", user.id, user_scope(user, "projects"), user_scope(user, "erp"),
                    can_view_tab(user, "projects", "all_projects"), _has_sr_access(user))
    return ()


def _cache_key(db: Session, user: User, sources: list[str]) -> tuple:
    marker = tuple(m for m in (_scope_marker(db, user, src) for src in ("organizations", "machines") if src in sources) if m)
    return (frozenset(sources), marker)


def get_vocabulary(db: Session, user: User) -> dict:
    sources = allowed_sources(db, user)
    if not sources:
        return {"words": [], "bigrams": [], "sources": []}
    key = _cache_key(db, user, sources)
    hit = _cache_get(_cache, key, CACHE_SECONDS)
    if hit is not None:
        return hit
    with _cache_lock:
        flight = _key_locks.setdefault(key, threading.Lock())
    with flight:
        hit = _cache_get(_cache, key, CACHE_SECONDS)   # another caller may have built it while we waited
        if hit is not None:
            return hit
        words: Counter = Counter()
        bigrams: Counter = Counter()
        for src in sources:
            count_text(words, bigrams, _source_texts(db, user, src))
        payload = {
            "words": [[w, n] for w, n in _top(words, TOP_WORDS)],
            "bigrams": [[a, b, n] for (a, b), n in _top(bigrams, TOP_BIGRAMS)],
            "sources": sources,
        }
        _cache_put(_cache, key, payload, CACHE_SECONDS)
    with _cache_lock:
        _key_locks.pop(key, None)
    return payload


# ── Similar records ─────────────────────────────────────────────────────────

@lru_cache(maxsize=50_000)
def _keys(text: str, noise: bool) -> tuple[str, str]:
    """(normalised key, token-sorted key). Vendors / organizations also lose
    legal-form words (pvt, ltd, limited, llp, co, the, m/s)."""
    key = name_key(text) if noise else ""
    if not key:
        key = " ".join(w for w in _SEP.split((text or "").lower()) if w)
    return key, " ".join(sorted(key.split()))


def _bonus(qkey: str, nkey: str) -> float:
    """Typing the start (or a whole word onward) of a name, or a name plus extra
    words. Only for 4+ characters and a match that starts at a word boundary, so
    "mil" does not match every "...milling..." and "ump" does not match "pump"."""
    if len(qkey) >= MIN_BONUS and (nkey.startswith(qkey) or f" {qkey}" in nkey):
        base = 0.7 + 0.25 * len(qkey) / len(nkey)
        return min(0.95, base + (0.05 if nkey.startswith(qkey) else 0.0))
    if len(nkey) >= MIN_BONUS and (qkey.startswith(nkey) or f" {nkey}" in qkey):
        return min(0.95, 0.7 + 0.25 * len(nkey) / len(qkey))
    return 0.0


def score_pairs(query: str, candidates, noise: bool) -> list[tuple[float, tuple]]:
    """candidates: iterable of (id, code, name, alt_name | None). Returns
    (score, row) for every candidate at or above the threshold."""
    qkey, qsorted = _keys(query, noise)
    if not qkey:
        return []
    key_m = SequenceMatcher(None, autojunk=False)
    key_m.set_seq2(qkey)
    sort_m = SequenceMatcher(None, autojunk=False)
    sort_m.set_seq2(qsorted)

    def one(text: str) -> float:
        nkey, nsorted = _keys(text, noise)
        if not nkey:
            return 0.0
        if nkey == qkey or nsorted == qsorted:
            return 1.0
        best = _bonus(qkey, nkey)
        for matcher, a, b in ((key_m, nkey, qkey), (sort_m, nsorted, qsorted)):
            if matcher is sort_m and a == nkey and b == qkey:
                break                      # already in word order: same strings as above
            matcher.set_seq1(a)
            # quick_ratio is an upper bound of ratio: skip the slow one when it can't reach the threshold.
            if matcher.real_quick_ratio() >= THRESHOLD and matcher.quick_ratio() >= THRESHOLD:
                best = max(best, matcher.ratio())
        return best

    out = []
    for row in candidates:
        _id, _code, name, alt = row
        s = one(name or "")
        if alt:
            s = max(s, one(alt))
        if s >= THRESHOLD:
            out.append((s, row))
    return out


def ensure_kind_allowed(db: Session, user: User, kind: str) -> None:
    """403 with the real reason when the user can't read this kind of record."""
    if kind == "item":
        _ensure_items(user)
    elif kind == "vendor":
        _vendor_lookup(user)
    elif kind == "organization":
        require_any_app_access("crm", "accounts")(user)
    elif kind == "machine":
        _ensure_machines(db, user)


def _candidates(db: Session, user: User, kind: str) -> list[tuple]:
    """Cached for CANDIDATE_SECONDS per (kind, scope marker): a new record shows
    up in "similar" within a minute. Scoped kinds are cached per user."""
    marker = _scope_marker(db, user, {"organization": "organizations", "machine": "machines"}.get(kind, kind))
    key = (kind, marker)
    rows = _cache_get(_candidate_cache, key, CANDIDATE_SECONDS)
    if rows is None:
        rows = _load_candidates(db, user, kind)
        _cache_put(_candidate_cache, key, rows, CANDIDATE_SECONDS)
    return rows


def _load_candidates(db: Session, user: User, kind: str) -> list[tuple]:
    """(id, code, name, alt_name) rows the user's list route would show —
    only those columns are loaded."""
    if kind == "item":
        return [(i, c, n, None) for i, c, n in db.query(StoreItem.id, StoreItem.item_code, StoreItem.item_name).all()]
    if kind == "vendor":
        return [(i, c, n, None) for i, c, n in db.query(Vendor.id, Vendor.code, Vendor.name).all()]
    if kind == "organization":
        return [(i, c, n, None) for i, c, n in _org_query(db, user, Organization.id, Organization.org_code, Organization.name).all()]
    rows = _machine_query(db, user, Project.id, Project.serial_number, Project.model_name).all()
    return [(i, serial, f"{model or ''} {serial or ''}".strip(), model) for i, serial, model in rows]


def similar_records(db: Session, user: User, kind: str, q: str | None, limit: int = 5) -> dict:
    query = " ".join((q or "").split())[:MAX_QUERY]
    result = {"kind": kind, "query": query, "matches": []}
    ensure_kind_allowed(db, user, kind)
    if len(query) < MIN_QUERY:
        return result
    limit = max(1, min(int(limit or 5), MAX_LIMIT))
    scored = score_pairs(query, _candidates(db, user, kind), noise=kind in ("vendor", "organization"))
    # Only a true match shows 100%: 0.996 must not round up to "exact".
    rounded = [(1.0 if s >= 1.0 else min(0.99, round(s, 2)), row) for s, row in scored]
    rounded.sort(key=lambda sr: (-sr[0], sr[1][1] or "", sr[1][0]))
    result["matches"] = [
        {"id": row[0], "code": row[1], "name": row[2], "score": s} for s, row in rounded[:limit]
    ]
    return result
