"""Shared Pydantic field validators for format-checked string fields
(email, GST number) — mirrors the frontend's app/lib/validation.ts so the
same values are rejected on both sides, not just cosmetically in the UI."""
import re

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
GST_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$")


def validate_email_format(v: str | None) -> str | None:
    if not v:
        return v
    v = v.strip()
    if not EMAIL_RE.match(v):
        raise ValueError("Enter a valid email address (e.g. name@company.com).")
    return v


def validate_gst_format(v: str | None) -> str | None:
    if not v:
        return v
    v = v.strip().upper()
    if not GST_RE.match(v):
        raise ValueError("Enter a valid 15-character GSTIN (e.g. 27ABCDE1234F1Z5).")
    return v


FY_RE = re.compile(r"^(\d{4})-(\d{2})$")


def validate_financial_year_format(v: str | None) -> str | None:
    if not v:
        return v
    v = v.strip()
    m = FY_RE.match(v)
    if not m:
        raise ValueError("Enter a valid financial year format (e.g. 2026-27).")
    y1, y2 = int(m.group(1)), int(m.group(2))
    if not (1900 <= y1 <= 2100 and y2 == (y1 + 1) % 100):
        raise ValueError("Enter a valid financial year format (e.g. 2026-27).")
    return v
