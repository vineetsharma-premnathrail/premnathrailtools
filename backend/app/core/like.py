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
