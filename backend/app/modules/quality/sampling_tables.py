"""ISO 2859-1 / IS 2500 Part 1 single-sampling tables, as plain data.

Pure Python (no ORM) so both the Alembic seed migration and the lazy seeder
in services/sampling.py build the exact same rows.

Table I  — lot size → sample size code letter, general inspection levels
           I / II / III (special levels S-1..S-4 are not used here).
Table II — code letter × AQL → sample size n, accept number Ac, reject
           number Re, for normal (II-A), tightened (II-B) and reduced (II-C)
           inspection. The arrows of the printed table ("use the first plan
           below / above the arrow") are already followed here, so every
           (letter, severity, AQL) row is a concrete plan — which is why its
           sample size can differ from the code letter's own sample size.

The arrow layout is generated from the standard's diagonal structure:
along a code-letter row, normal inspection reads
    ... ↓ | 0/1 | ↑ | ↓ | 1/2 | 2/3 | 3/4 | 5/6 | 7/8 | 10/11 | 14/15 | 21/22 | ↑ ...
with the 0/1 cell where letter index + AQL index = 14 (A×6.5, B×4.0, ...,
K×0.10, ..., Q×0.010). Tightened uses Ac 0,1,2,3,5,8,12,18 shifted one AQL
step to the right; reduced (1999 edition, Re = Ac + 1) uses the reduced
sample sizes with Ac 0,1,2,3,5,6,8,10. Verify against the printed standard
before relying on edge cells — see the Quality → Masters → Sampling page.
"""

CODE_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R"]
SAMPLE_SIZES = [2, 3, 5, 8, 13, 20, 32, 50, 80, 125, 200, 315, 500, 800, 1250, 2000]
REDUCED_SAMPLE_SIZES = [2, 2, 2, 3, 5, 8, 13, 20, 32, 50, 80, 125, 200, 315, 500, 800]

AQL_VALUES = [0.010, 0.015, 0.025, 0.040, 0.065, 0.10, 0.15, 0.25, 0.40, 0.65, 1.0, 1.5, 2.5, 4.0, 6.5, 10.0]

# (lot_min, lot_max, {level: code letter}) — Table I. lot_max None = and above.
LOT_SIZE_RANGES = [
    (2, 8, {"I": "A", "II": "A", "III": "B"}),
    (9, 15, {"I": "A", "II": "B", "III": "C"}),
    (16, 25, {"I": "B", "II": "C", "III": "D"}),
    (26, 50, {"I": "C", "II": "D", "III": "E"}),
    (51, 90, {"I": "C", "II": "E", "III": "F"}),
    (91, 150, {"I": "D", "II": "F", "III": "G"}),
    (151, 280, {"I": "E", "II": "G", "III": "H"}),
    (281, 500, {"I": "F", "II": "H", "III": "J"}),
    (501, 1200, {"I": "G", "II": "J", "III": "K"}),
    (1201, 3200, {"I": "H", "II": "K", "III": "L"}),
    (3201, 10000, {"I": "J", "II": "L", "III": "M"}),
    (10001, 35000, {"I": "K", "II": "M", "III": "N"}),
    (35001, 150000, {"I": "L", "II": "N", "III": "P"}),
    (150001, 500000, {"I": "M", "II": "P", "III": "Q"}),
    (500001, None, {"I": "N", "II": "Q", "III": "R"}),
]

# Cell layouts by diagonal offset d = letter index + AQL index - 14.
# An int pair is a plan; "down"/"up" are the printed table's arrows.
_NORMAL = {0: (0, 1), 1: "up", 2: "down", 3: (1, 2), 4: (2, 3), 5: (3, 4), 6: (5, 6), 7: (7, 8),
           8: (10, 11), 9: (14, 15), 10: (21, 22)}
_TIGHTENED = {2: (0, 1), 3: "down", 4: (1, 2), 5: (2, 3), 6: (3, 4), 7: (5, 6), 8: (8, 9),
              9: (12, 13), 10: (18, 19)}
_REDUCED = {0: (0, 1), 1: "up", 2: "down", 3: (1, 2), 4: (2, 3), 5: (3, 4), 6: (5, 6), 7: (6, 7),
            8: (8, 9), 9: (10, 11)}


def _cell(layout: dict, d: int, max_d: int):
    if d in layout:
        return layout[d]
    return "down" if d < min(layout) else "up" if d > max_d else "down"


def _resolve(layout: dict, sizes: list[int], letter_idx: int, aql_idx: int):
    """Follow arrows from (letter, AQL) to a concrete (n, Ac, Re)."""
    max_d = max(layout)
    li = letter_idx
    for _ in range(40):
        cell = _cell(layout, li + aql_idx - 14, max_d)
        if isinstance(cell, tuple):
            return sizes[li], cell[0], cell[1]
        if cell == "down":
            if li == len(sizes) - 1:
                break
            li += 1
        else:
            if li == 0:
                break
            li -= 1
    # Fell off the table: fall back to the last letter's 0/1 plan.
    return sizes[li], 0, 1


def build_aql_rows() -> list[dict]:
    rows = []
    for severity, layout, sizes in (
        ("normal", _NORMAL, SAMPLE_SIZES),
        ("tightened", _TIGHTENED, SAMPLE_SIZES),
        ("reduced", _REDUCED, REDUCED_SAMPLE_SIZES),
    ):
        for li, letter in enumerate(CODE_LETTERS):
            for ai, aql in enumerate(AQL_VALUES):
                n, ac, re = _resolve(layout, sizes, li, ai)
                rows.append({"code_letter": letter, "severity": severity, "aql": aql,
                             "sample_size": n, "accept_number": ac, "reject_number": re})
    return rows


def build_code_letter_rows() -> list[dict]:
    rows = []
    for lo, hi, levels in LOT_SIZE_RANGES:
        for level, letter in levels.items():
            rows.append({"inspection_level": level, "lot_size_min": lo, "lot_size_max": hi, "code_letter": letter})
    return rows
