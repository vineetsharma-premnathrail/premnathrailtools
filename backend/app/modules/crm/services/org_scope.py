"""Customer Organization scope (Domestic / International) and its tax fields.

* Domestic      -> GSTIN, PAN, GST State Code (PAN / state code derive from the GSTIN,
                   see customer_master.derive_tax_ids).
* International -> Tax / VAT ID, Company Registration Number (format only, no
                   country-specific checks).
* The Country field is independent: nothing here reads it to decide the scope.

Pure functions: no database, no FastAPI, so the schemas and the routes share the
same rules and the same wording.
"""
from __future__ import annotations

import re
from typing import Literal

OrgScope = Literal["domestic", "international"]
ORG_SCOPES = ("domestic", "international")

DOMESTIC_ONLY_FIELDS = (("gst_number", "GSTIN"), ("pan", "PAN"), ("gst_state_code", "GST State Code"))
INTERNATIONAL_ONLY_FIELDS = (("tax_vat_id", "Tax / VAT ID"), ("company_registration_no", "Company Registration Number"))

_FOREIGN_ID_RE = re.compile(r"^[A-Za-z0-9 \-./]{2,50}$")


def blank_to_none(v):
    """'' / whitespace -> None so a blank box never counts as a value."""
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def check_foreign_id(v: str | None, label: str) -> str | None:
    v = blank_to_none(v)
    if v is None:
        return None
    if not _FOREIGN_ID_RE.match(v):
        raise ValueError(
            f"{label} must be 2-50 characters using only letters, digits, spaces, '-', '.' or '/' "
            f"(e.g. GB 123 4567 89). Remove any other symbols and check the length."
        )
    return v


def wrong_scope_message(scope: str, **fields) -> str | None:
    """Reason + fix when a field that belongs to the other scope carries a value, else None."""
    if scope == "domestic":
        for key, label in INTERNATIONAL_ONLY_FIELDS:
            if blank_to_none(fields.get(key)) is not None:
                return (f"{label} ({key}) is only for International organizations. "
                        f"Switch Organization Scope to International, or clear {label}.")
    elif scope == "international":
        for key, label in DOMESTIC_ONLY_FIELDS:
            if blank_to_none(fields.get(key)) is not None:
                return (f"{label} ({key}) is only for Domestic organizations. "
                        f"Switch Organization Scope to Domestic, or clear {label}.")
    return None


DOMESTIC_COUNTRY_MESSAGE = (
    "A Domestic organization is in India. Choose International for a customer outside India, "
    "or set the country to India."
)


def domestic_country_message(country: str | None) -> str | None:
    """Domestic organizations are always in India (blank counts as India)."""
    c = blank_to_none(country)
    if c is not None and c.lower() != "india":
        return DOMESTIC_COUNTRY_MESSAGE
    return None


def clear_other_scope(org, scope: str) -> None:
    """Switching scope on save: drop the tax fields of the scope that no longer applies."""
    if scope == "domestic":
        org.tax_vat_id = None
        org.company_registration_no = None
    else:
        org.gst_number = None
        org.pan = None
        org.gst_state_code = None
