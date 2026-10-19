"""Customer master tax data (SAP BP / VD01 control data) and partner addresses.

* PAN — 10 characters AAAAA9999A. When the GSTIN is known, the PAN is GSTIN
  characters 3-12; a typed PAN that disagrees with the GSTIN is refused, and a
  blank PAN is filled from the GSTIN.
* GST state code — the GSTIN's first two digits (authoritative), else the state
  name. It is the default place of supply on the customer's sales orders and
  invoices (sales/service.py snapshot_customer).
* Addresses — ship-to / consignee / bill-to / payer, each with its own GSTIN and
  state (a Railway zone buys centrally and ships to many sheds / depots).
"""
from __future__ import annotations

import re

from fastapi import HTTPException

from app.modules.accounts.services.gst import GST_STATE_CODES, state_code_for_name, state_code_from_gstin
from app.modules.crm.models.organization import ORG_ADDRESS_TYPES

PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
ADDRESS_TYPE_LABEL = {"ship_to": "Ship-to", "consignee": "Consignee", "bill_to": "Bill-to", "payer": "Payer / paying authority"}


def _clean(v: str | None) -> str | None:
    v = (v or "").strip().upper()
    return v or None


def check_state_code(code: str | None, what: str = "GST state code") -> str | None:
    code = (code or "").strip()
    if not code:
        return None
    if code.isdigit():
        code = code.zfill(2)
    if code not in GST_STATE_CODES:
        raise HTTPException(status_code=422, detail=(
            f"'{code}' isn't a valid {what}. Use the 2-digit GST state code (e.g. 07 Delhi, 27 Maharashtra) — "
            f"it is the first two digits of a GSTIN."))
    return code


def derive_tax_ids(gstin: str | None, pan: str | None, state: str | None, state_code: str | None) -> tuple[str | None, str | None]:
    """(pan, gst_state_code) for an organisation, validated against the GSTIN."""
    gstin, pan = _clean(gstin), _clean(pan)
    if pan and not PAN_RE.match(pan):
        raise HTTPException(status_code=422, detail=(
            f"PAN '{pan}' isn't valid. A PAN has 10 characters: 5 letters, 4 digits, 1 letter (e.g. AAACP1234C)."))
    if gstin and len(gstin) == 15:
        from_gstin = gstin[2:12]
        if pan and pan != from_gstin:
            raise HTTPException(status_code=422, detail=(
                f"PAN {pan} doesn't match GSTIN {gstin} (its characters 3-12 are {from_gstin}). "
                f"Correct the PAN, or clear it and it will be taken from the GSTIN."))
        pan = pan or (from_gstin if PAN_RE.match(from_gstin) else None)
    code = state_code_from_gstin(gstin)
    typed = check_state_code(state_code)
    if code and typed and typed != code:
        raise HTTPException(status_code=422, detail=(
            f"GST state code {typed} doesn't match GSTIN {gstin} (state {code} — {GST_STATE_CODES.get(code, '')}). "
            f"The GSTIN decides the state; clear the state code or correct the GSTIN."))
    return pan, code or typed or state_code_for_name(state)


def apply_to_org(org) -> None:
    """Fill / validate org.pan and org.gst_state_code from its GSTIN and state."""
    org.pan, org.gst_state_code = derive_tax_ids(org.gst_number, org.pan, org.state, org.gst_state_code)


def check_address_type(value: str | None) -> str:
    if value not in ORG_ADDRESS_TYPES:
        raise HTTPException(status_code=422, detail=(
            f"'{value}' isn't an address type. Pick one of: {', '.join(ADDRESS_TYPE_LABEL[t] for t in ORG_ADDRESS_TYPES)}."))
    return value


def apply_to_address(addr) -> None:
    gstin = _clean(addr.gstin)
    addr.gstin = gstin
    code = state_code_from_gstin(gstin)
    typed = check_state_code(addr.state_code)
    if code and typed and code != typed:
        raise HTTPException(status_code=422, detail=(
            f"State code {typed} doesn't match the address GSTIN {gstin} (state {code}). Clear the state code or correct the GSTIN."))
    addr.state_code = code or typed or state_code_for_name(addr.state)
    if not addr.state and addr.state_code:
        addr.state = GST_STATE_CODES.get(addr.state_code)


def address_text(addr) -> str:
    return ", ".join(p for p in (addr.address, addr.city, addr.state, addr.pin_code) if p)


def check_contact_address(db, org_id: int, address_id: int | None) -> None:
    """A contact person's address must be one of the same organisation's addresses."""
    if not address_id:
        return
    from app.modules.crm.models.organization import OrgAddress
    addr = db.get(OrgAddress, address_id)
    if not addr or addr.org_id != org_id:
        raise HTTPException(status_code=422, detail=(
            f"Address #{address_id} isn't an address of this customer organization — pick one from its Addresses list, "
            f"or leave it empty for the head office."))
