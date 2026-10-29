"""Item codes are always <TYPE 2>-<CATEGORY 3>-<NNNN> (owner, 2026-10-28).

Re-codes any item type prefix that isn't exactly 2 letters/digits and any item
category code that isn't exactly 3 (e.g. ELECTR → ELE), so new item codes come
out as CN-ELE-0001. Existing item codes are NOT changed (they are printed on
POs / GRNs and matched in Tally). Same rule as store.service.fixed_length_code,
copied here so the migration doesn't depend on app code.

Revision ID: b8d0f2a4c6e9
Revises: a7c9e1f3b5d8
"""
import re
from itertools import combinations, product

import sqlalchemy as sa
from alembic import op

revision = "b8d0f2a4c6e9"
down_revision = "a7c9e1f3b5d8"
branch_labels = None
depends_on = None


def _code(name, length, taken):
    words = re.findall(r"[A-Z0-9]+", (name or "").upper()) or ["X"]
    joined, initials = "".join(words), "".join(w[0] for w in words)
    cands = []
    if len(words) > 1:
        cands.append((initials + joined[1:])[:length] if len(initials) < length else initials[:length])
    cands.append(joined[:length])
    cands += [joined[0] + "".join(r) for r in combinations(joined[1:], length - 1)]
    cands += [joined[0] + "".join(d) for d in product("0123456789", repeat=length - 1)]
    cands += ["".join(c) for c in product("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", repeat=length)]
    for c in cands:
        c = c.ljust(length, "X")
        if c not in taken:
            return c
    raise RuntimeError(f"No free {length}-character code for {name!r}")


def _fix(conn, table, col, length, name_col):
    rows = conn.execute(sa.text(f"SELECT id, {name_col}, {col} FROM {table} ORDER BY id")).all()
    ok = re.compile(rf"^[A-Z0-9]{{{length}}}$")
    taken = {r[2] for r in rows if r[2] and ok.match(r[2])}
    for rid, name, code in rows:
        if code and ok.match(code):
            continue
        # Prefer the old code's own letters (ELECTR → ELE), then the name.
        new = _code(code or name, length, taken) if code else _code(name, length, taken)
        taken.add(new)
        conn.execute(sa.text(f"UPDATE {table} SET {col} = :c WHERE id = :i"), {"c": new, "i": rid})


def upgrade():
    conn = op.get_bind()
    _fix(conn, "store_item_types", "prefix", 2, "label")
    _fix(conn, "store_item_categories", "code", 3, "name")


def downgrade():
    # Old codes aren't kept; item codes never changed, so nothing to undo.
    pass
