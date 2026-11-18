"""Safe "contains" search for SQL LIKE / ILIKE.

In LIKE, `%` means "anything" and `_` means "any one character", so a user who
types `_` or `%` into a search box would otherwise match (almost) every row.
Escape what the user typed and pass `escape="\\"` to `.like()` / `.ilike()`:

    q = f"%{like_escape(search)}%"
    query.filter(Model.name.ilike(q, escape="\\"))

The value is still sent as a bound parameter; this only fixes which rows match.
"""

LIKE_ESCAPE = "\\"


def like_escape(value: object) -> str:
    """Make `%`, `_` and `\\` in user text match literally inside a LIKE pattern."""
    text = "" if value is None else str(value)
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# Characters a word starts after inside a field ("MAHA METRO", "DIESEL SHUNTER - 600T",
# "OHE/RRV", "(UTTARAKHAND)") — so a typed word matches the start of any word in it.
_WORD_STARTS = (" ", "-", "/", "(", ",", ".")


def word_prefix_filter(columns, search: str, contains_columns=(), per_word=None):
    """Search-box filter (CRM lists, owner 2026-11-18): every typed word must match
    the START of a word in one of `columns` ("t" finds THDC / Tamper, not SHUNTER);
    `contains_columns` (record numbers like INQ-20260929-0012) still match anywhere,
    so "0012" finds its record. `per_word(word)` adds one more clause a word may
    match instead (e.g. the linked organization's name). None when nothing was typed."""
    from sqlalchemy import or_, and_

    words = [w for w in (search or "").split() if w]
    if not words:
        return None
    clauses = []
    for w in words:
        e = like_escape(w)
        ors = []
        for col in columns:
            ors.append(col.ilike(f"{e}%", escape=LIKE_ESCAPE))
            ors.extend(col.ilike(f"%{sep}{e}%", escape=LIKE_ESCAPE) for sep in _WORD_STARTS)
        ors.extend(col.ilike(f"%{e}%", escape=LIKE_ESCAPE) for col in contains_columns)
        if per_word is not None:
            ors.append(per_word(w))
        clauses.append(or_(*ors))
    return and_(*clauses)
