import re
import httpx
from app.core.config import settings

GSTIN_PATTERN = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")

# Official CBIC GST state/UT codes (first 2 digits of every GSTIN).
GST_STATE_CODES = {
    "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
    "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
    "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
    "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
    "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
    "25": "Daman and Diu", "26": "Dadra and Nagar Haveli", "27": "Maharashtra", "28": "Andhra Pradesh (Old)",
    "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
    "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh",
    "38": "Ladakh",
}


def _build_address_line(address_details: dict, fallback: str | None) -> str | None:
    """gstinapi.in's own pre-joined `address` string can repeat the same
    text multiple times when the source GST record has identical values
    across building_number/building_name/floor/street/locality (seen on
    real data, e.g. 37AAACI1681G2ZN) — build it ourselves from the granular
    fields instead, keeping each distinct piece once, in order."""
    parts = [
        address_details.get(key)
        for key in ("building_number", "building_name", "floor", "street", "locality", "landmark")
    ]
    seen: set[str] = set()
    deduped = []
    for part in parts:
        part = (part or "").strip()
        if part and part not in seen:
            seen.add(part)
            deduped.append(part)
    return ", ".join(deduped) if deduped else fallback


def _normalize(raw: dict) -> dict:
    """Map gstinapi.in's `data` object (confirmed field names via a live test
    call) into the flat shape our Vendor/Organization forms expect."""
    address_details = raw.get("address_details") or {}
    state_code = raw.get("state_code")
    return {
        "legal_name": raw.get("legal_name"),
        "trade_name": raw.get("trade_name"),
        "status": raw.get("status"),
        "address_line1": _build_address_line(address_details, raw.get("address")),
        "city": raw.get("city") or address_details.get("city"),
        "pincode": raw.get("pincode") or address_details.get("pincode"),
        "state": GST_STATE_CODES.get(state_code, None),
        "country": "India",
    }


async def lookup_gstin(gstin: str) -> dict:
    """Look up a GSTIN via gstinapi.in. Never raises — any failure (bad
    format, timeout, non-200, quota exhausted) comes back as
    {"success": False, "reason": ...} so callers can fall back to manual
    entry without special-casing exceptions."""
    gstin = (gstin or "").strip().upper()
    if not GSTIN_PATTERN.match(gstin):
        return {"success": False, "reason": "Invalid GSTIN format."}
    if not settings.GSTINAPI_KEY:
        return {"success": False, "reason": "GSTIN lookup is not configured."}

    # A GSTIN's characters 3-12 are always the taxpayer's PAN — derivable
    # locally without spending an API credit.
    pan = gstin[2:12]

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(
                f"{settings.GSTINAPI_BASE_URL}/v1/gstin/{gstin}",
                headers={"x-api-key": settings.GSTINAPI_KEY},
            )
    except httpx.HTTPError:
        return {"success": False, "reason": "GSTIN lookup service is unavailable right now."}

    if response.status_code == 429:
        return {"success": False, "reason": "GSTIN lookup quota exhausted for this period."}
    if response.status_code != 200:
        return {"success": False, "reason": "GSTIN lookup failed."}

    try:
        body = response.json()
    except ValueError:
        return {"success": False, "reason": "GSTIN lookup returned an unexpected response."}

    if not body.get("success") or not body.get("data"):
        return {"success": False, "reason": "GSTIN not found."}

    data = _normalize(body["data"])
    data["pan"] = pan
    return {"success": True, "data": data}
