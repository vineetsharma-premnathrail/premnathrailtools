"""GST: state codes, GSTIN validation, place of supply and tax split.

Rule (IGST Act s.7/8): supplier state == place-of-supply state -> intra-state
-> CGST + SGST, each half the rate. Different states -> inter-state -> IGST at
the full rate. The supplier state is ours on a sale and the vendor's on a
purchase; the place of supply is the delivery state (customer's/shipping
state on a sale, our state on a purchase delivered to us)."""
import re
from sqlalchemy.orm import Session

# Statutory GST state codes (first two digits of every GSTIN) — fixed by
# law, so code, not a master table.
GST_STATE_CODES: dict[str, str] = {
    "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
    "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
    "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
    "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
    "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
    "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
    "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
    "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
    "96": "Other Country", "97": "Other Territory",
}
_ALIASES = {
    "orissa": "21", "pondicherry": "34", "nct of delhi": "07", "new delhi": "07", "j&k": "01",
    "jammu & kashmir": "01", "andaman & nicobar islands": "35", "daman and diu": "26",
    "dadra and nagar haveli": "26", "daman & diu": "26", "dadra & nagar haveli": "26", "uttaranchal": "05",
}
_GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def gstin_checksum_ok(gstin: str) -> bool:
    total = 0
    for i, ch in enumerate(gstin[:14]):
        product = _CHARSET.index(ch) * (1 if i % 2 == 0 else 2)
        total += product // 36 + product % 36
    return _CHARSET[(36 - total % 36) % 36] == gstin[14]


def validate_gstin(gstin: str | None) -> str | None:
    """Normalises and validates a GSTIN; returns None for blank. Raises
    ValueError explaining what's wrong."""
    if not gstin or not gstin.strip():
        return None
    g = gstin.strip().upper()
    if not _GSTIN_RE.match(g):
        raise ValueError(
            f"GSTIN '{gstin}' is not in the GST format — 15 characters: 2-digit state code, 10-character PAN, "
            f"entity number, 'Z', check character (e.g. 27AAACP1234C1Z5)."
        )
    if g[:2] not in GST_STATE_CODES:
        raise ValueError(f"GSTIN '{g}' starts with '{g[:2]}', which is not a GST state code.")
    if not gstin_checksum_ok(g):
        raise ValueError(f"GSTIN '{g}' fails the GST check-digit test — it has a typo. Copy it again from the party's GST certificate.")
    return g


def state_code_from_gstin(gstin: str | None) -> str | None:
    if gstin and len(gstin.strip()) >= 2 and gstin.strip()[:2] in GST_STATE_CODES:
        return gstin.strip()[:2]
    return None


def state_code_for_name(state: str | None) -> str | None:
    if not state or not state.strip():
        return None
    s = state.strip()
    if s.isdigit() and s.zfill(2) in GST_STATE_CODES:
        return s.zfill(2)
    lowered = s.lower()
    if lowered in _ALIASES:
        return _ALIASES[lowered]
    for code, name in GST_STATE_CODES.items():
        if name.lower() == lowered.replace("&", "and"):
            return code
    return None


def party_state_code(gstin: str | None, state: str | None) -> str | None:
    """A party's state: from its GSTIN (authoritative), else its state name."""
    return state_code_from_gstin(gstin) or state_code_for_name(state)


def company_gst_profile(db: Session) -> tuple[str | None, str | None]:
    """(our GSTIN, our state code). The state code comes from the GSTIN, or
    the Company Info state/region when unregistered."""
    from app.modules.organization.models.company import Company

    company = db.query(Company).order_by(Company.id.asc()).first()
    if not company:
        return None, None
    gstin = (company.gstin or "").strip().upper() or None
    code = state_code_from_gstin(gstin) or state_code_for_name(getattr(company, "default_tax_region", None))
    return gstin, code


def require_company_state(db: Session) -> str:
    _, code = company_gst_profile(db)
    if not code:
        raise ValueError(
            "The company's GST state isn't known, so CGST/SGST vs IGST can't be decided. "
            "Enter the company GSTIN under Company Info > Legal & Tax."
        )
    return code


def split_tax(taxable: float, rate: float, interstate: bool) -> tuple[float, float, float]:
    """(cgst, sgst, igst) for one line, each rounded to the paisa."""
    if not rate or not taxable:
        return 0.0, 0.0, 0.0
    if interstate:
        return 0.0, 0.0, round(taxable * rate / 100, 2)
    half = round(taxable * rate / 200, 2)
    return half, half, 0.0


def compute_lines(lines: list[dict], *, interstate: bool, allowed_rates: set[float] | None = None) -> dict:
    """Fills taxable_amount and the tax split on each line dict (in place) and
    returns header totals. Each line needs quantity, rate, discount_amount,
    gst_rate. Raises ValueError on a bad line."""
    totals = {"taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "igst": 0.0}
    if not lines:
        raise ValueError("Add at least one line.")
    for i, line in enumerate(lines, start=1):
        qty = float(line.get("quantity") or 0)
        rate = float(line.get("rate") or 0)
        discount = float(line.get("discount_amount") or 0)
        gst_rate = float(line.get("gst_rate") or 0)
        if qty <= 0:
            raise ValueError(f"Line {i}: quantity must be greater than zero.")
        if rate < 0 or discount < 0:
            raise ValueError(f"Line {i}: rate and discount can't be negative.")
        gross = round(qty * rate, 2)
        if discount > gross:
            raise ValueError(f"Line {i}: discount {discount:,.2f} is more than the line value {gross:,.2f}.")
        if allowed_rates is not None and gst_rate not in allowed_rates:
            raise ValueError(
                f"Line {i}: GST rate {gst_rate:g}% isn't an active rate. Active rates: "
                f"{', '.join(f'{r:g}%' for r in sorted(allowed_rates))} (Finance > Masters > GST Rates)."
            )
        taxable = round(gross - discount, 2)
        cgst, sgst, igst = split_tax(taxable, gst_rate, interstate)
        line.update(taxable_amount=taxable, cgst_amount=cgst, sgst_amount=sgst, igst_amount=igst)
        totals["taxable"] += taxable
        totals["cgst"] += cgst
        totals["sgst"] += sgst
        totals["igst"] += igst
    totals = {k: round(v, 2) for k, v in totals.items()}
    totals["tax"] = round(totals["cgst"] + totals["sgst"] + totals["igst"], 2)
    return totals


def active_rates(db: Session) -> set[float]:
    from app.modules.accounts.models.settings import GSTRate
    rates = {float(r.rate) for r in db.query(GSTRate).filter(GSTRate.is_active == True).all()}  # noqa: E712
    return rates or {0.0, 5.0, 18.0, 40.0}


def check_round_off(round_off: float) -> float:
    r = round(float(round_off or 0), 2)
    if abs(r) >= 1:
        raise ValueError(f"Round-off of {r:+.2f} is too large — round-off only absorbs paise (less than ₹1 either way).")
    return r
