"""Supporting documents (voucher proof) on Finance documents.

Every entry in the books needs proof an auditor can ask for: the vendor's
bill behind a purchase invoice (also the basis of the GST input credit), the
working behind a manual journal, the bank advice behind a receipt. Files are
FinanceAttachment rows (bytes in SharePoint); this module answers "does the
document have proof?" and enforces the Finance › Settings › Supporting
documents rules at the point the document would reach the books."""
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.accounts.models.attachment import FinanceAttachment
from app.modules.accounts.settings import get_setting

# Voucher types a payment proof rule applies to (a contra is an internal
# transfer between our own accounts — the bank statement is its proof).
PROOF_PAYMENT_TYPES = ("vendor", "customer", "expense", "other_receipt")


def proof_count(db: Session, entity_type: str, entity_id: int) -> int:
    return db.query(func.count(FinanceAttachment.id)).filter(
        FinanceAttachment.entity_type == entity_type, FinanceAttachment.entity_id == entity_id,
        FinanceAttachment.is_deleted == False,  # noqa: E712
    ).scalar() or 0


def proof_counts(db: Session, entity_type: str, ids: list[int]) -> dict[int, int]:
    if not ids:
        return {}
    rows = db.query(FinanceAttachment.entity_id, func.count(FinanceAttachment.id)).filter(
        FinanceAttachment.entity_type == entity_type, FinanceAttachment.entity_id.in_(ids),
        FinanceAttachment.is_deleted == False,  # noqa: E712
    ).group_by(FinanceAttachment.entity_id).all()
    return {eid: n for eid, n in rows}


def ensure_vendor_invoice_proof(db: Session, inv) -> None:
    """A purchase invoice can't be submitted or posted without the vendor's
    bill attached (opening-balance bills are migrated history and exempt)."""
    if inv.invoice_type == "opening" or not get_setting(db, "proof_required_purchase_invoice"):
        return
    if proof_count(db, "vendor_invoice", inv.id) == 0:
        raise HTTPException(status_code=400, detail=(
            f"Attach the vendor's bill to purchase invoice '{inv.invoice_number}' first — open it in Finance › Purchase, "
            "Supporting documents › Upload. Without the bill copy the GST input credit can't be defended. "
            "(Finance › Settings › Supporting documents makes this compulsory.)"))


def ensure_journal_proof(db: Session, entry) -> None:
    """A manual journal can't be submitted or posted without its working /
    approval attached — manual journals are where errors and fraud enter."""
    if not get_setting(db, "proof_required_journal"):
        return
    if proof_count(db, "journal", entry.id) == 0:
        raise HTTPException(status_code=400, detail=(
            "Attach the working or approval behind this journal first — open the draft in Finance › Journals, "
            "Supporting documents › Upload. (Finance › Settings › Supporting documents makes this compulsory.)"))


def payment_proof_required(db: Session, payment_type: str, amount: float) -> bool:
    if payment_type not in PROOF_PAYMENT_TYPES or not get_setting(db, "proof_required_payment"):
        return False
    above = float(get_setting(db, "proof_required_payment_above") or 0)
    return amount > above + 1e-9


def staged_payment_files(db: Session, ids: list[int], user_id: int) -> list[FinanceAttachment]:
    """The files this user staged for a payment voucher they are about to
    save; 400 when any of them is gone or not theirs."""
    ids = sorted(set(ids))
    if not ids:
        return []
    rows = db.query(FinanceAttachment).filter(
        FinanceAttachment.id.in_(ids), FinanceAttachment.entity_type == "payment",
        FinanceAttachment.entity_id.is_(None), FinanceAttachment.created_by_id == user_id,
        FinanceAttachment.is_deleted == False,  # noqa: E712
    ).all()
    if len(rows) != len(ids):
        raise HTTPException(status_code=400, detail=(
            "One of the files attached to this voucher is no longer waiting to be saved (removed, or already used "
            "on another voucher). Remove it from the Supporting documents list, upload it again and save."))
    return rows
