"""Permission ids and internal codes in plain words, for anything a user reads
(error messages, notifications, "Approves in", access reviews) — never the
raw `module:tab:action` id or a snake_case code (2026-10-23).

    words("p2p:purchase_requisitions:approve")
        -> "Procurement › Purchase Requisitions — Approve"
    words("crm:inquiries_tenders.quotations:create")
        -> "CRM › Inquiries & Tenders › Quotations — Create"
    words("sales:*:view")  -> "Sales › any tab — View"
    action_word("approve") -> "Approve"
    humanize("customer_order") -> "Customer order"
"""
from __future__ import annotations


def humanize(code) -> str:
    """'machine_project' -> 'Machine project'; anything else unchanged."""
    s = str(code if code is not None else "")
    if not s or " " in s or not any(c == "_" or c.islower() for c in s):
        return s
    s = s.replace("_", " ").strip()
    return s[:1].upper() + s[1:]


def action_word(action: str | None) -> str:
    from app.core.permission_registry import ACTION_LABELS
    if action == "*":
        return "any action"
    return ACTION_LABELS.get(action or "", humanize(action))


# App keys that aren't Permission Matrix modules of their own.
_APP_WORDS = {"products": "Sales › Products", "purchase": "Procurement › Purchase Desk"}


def module_word(module_key: str | None) -> str:
    from app.core.permission_registry import MODULES
    return (MODULES.get(module_key or "") or {}).get("label") or _APP_WORDS.get(module_key or "") or humanize(module_key)


def tab_words(module_key: str, tab: str) -> str:
    """'Group › Tab' (or 'Tab › Feature') for a tab / 'tab.feature' key."""
    from app.core.permission_registry import MODULES
    m = MODULES.get(module_key) or {}
    if tab == "*":
        return "any tab"
    tab_key, _, feature_key = tab.partition(".")
    label = (m.get("subtabs") or {}).get(tab_key) or humanize(tab_key)
    group = (m.get("groups") or {}).get(tab_key)
    out = f"{group} › {label}" if group else label
    if feature_key:
        f = ((m.get("features") or {}).get(tab_key) or {}).get(feature_key)
        out += f" › {f['label'] if f else humanize(feature_key)}"
    return out


def words(perm: str | None) -> str:
    """A permission id in words; '' for None. Unknown parts are humanized."""
    if not perm:
        return ""
    parts = perm.split(":")
    if len(parts) != 3:
        return humanize(perm)
    mk, tab, action = parts
    return f"{module_word(mk)} › {tab_words(mk, tab)} — {action_word(action)}"


def place(perm: str | None) -> str:
    """Where a permission applies, in words: 'CRM › Inquiries & Tenders › Quotations'
    (the part of words() before the action)."""
    return words(perm).rsplit(" — ", 1)[0]
