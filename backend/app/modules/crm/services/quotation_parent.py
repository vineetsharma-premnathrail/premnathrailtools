"""The record a quotation hangs off: a CRM inquiry or a CRM tender (the tender's price bid).

A quotation has exactly one parent (`Quotation.inquiry_id` XOR `Quotation.tender_id`, enforced by a
CHECK constraint). Everything quotation-related — routes, status flow, approval, documents, reports —
asks this module instead of reading `quot.inquiry_id`, so inquiry and tender quotations behave the same.
Both parents share `universal_id`, `org_id`, `organization` and `bd_owner`, which is all the quotation
code reads from them.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import ColumnElement
from sqlalchemy.orm import Session

from app.core.data_scope import SCOPE_LABELS, apply_scope, ensure_in_scope, user_edit_scope
import app.modules.crm.access  # noqa: F401 — registers the CRM data-scope models (Inquiry, Tender)
from app.modules.crm.access import MODULE, can_change_quotation
from app.modules.crm.models.inquiry import Inquiry, Quotation
from app.modules.crm.models.tender import Tender
from app.modules.main.models.user import User

INQUIRY = "inquiry"
TENDER = "tender"
KINDS = (INQUIRY, TENDER)
LABEL = {INQUIRY: "Inquiry", TENDER: "Tender"}
MODELS = {INQUIRY: Inquiry, TENDER: Tender}


def label(kind: str) -> str:
    """"Inquiry" / "Tender" — for screens, notification details and messages."""
    return LABEL[kind]


def kind_of(quot: Quotation) -> str:
    """Which parent a quotation belongs to."""
    return TENDER if quot.tender_id is not None else INQUIRY


def parent_id_of(quot: Quotation) -> int | None:
    return quot.tender_id if quot.tender_id is not None else quot.inquiry_id


def parent_filter(kind: str, record_id: int) -> ColumnElement[bool]:
    """Quotation query filter: the quotations of this inquiry / tender."""
    return (Quotation.tender_id if kind == TENDER else Quotation.inquiry_id) == record_id


def parent_of(db: Session, quot: Quotation) -> tuple[str, Inquiry | Tender | None]:
    """(kind, record) of a quotation's parent — record is None only if the row is gone."""
    kind = kind_of(quot)
    return kind, db.get(MODELS[kind], parent_id_of(quot))


def reference(parent: Inquiry | Tender | None) -> str:
    """The parent's number as printed in notification details (INQ-… / TND-…)."""
    return (parent.universal_id or "") if parent is not None else ""


def load_live(db: Session, kind: str, record_id: int, user: User, lock: bool = False) -> Inquiry | Tender:
    """The inquiry / tender a quotation belongs to, only while it is not soft-deleted — quotations of a
    deleted record must not be listed, revised, downloaded or deleted — and only when it is in the user's
    CRM data scope. `lock` takes a row lock so two saves on one record serialise (quote numbering)."""
    model = MODELS[kind]
    q = db.query(model).filter(model.id == record_id, model.is_deleted == False)  # noqa: E712
    if lock:
        q = q.with_for_update()
    record = q.first()
    if not record:
        raise HTTPException(status_code=404, detail=(
            f"{label(kind)} not found or deleted — restore it before working on its quotations."))
    ensure_in_scope(db, user, record)
    return record


def find_quotation(db: Session, kind: str, record_id: int, quot_id: int, lock: bool = False) -> Quotation:
    """The quotation with this id on this inquiry / tender (a quotation of another record is a 404, never
    served through the wrong parent's URL)."""
    q = db.query(Quotation).filter(Quotation.id == quot_id, parent_filter(kind, record_id))
    if lock:
        q = q.with_for_update()
    quot = q.first()
    if not quot:
        raise HTTPException(status_code=404, detail=(
            f"Quotation not found — it may have been deleted, or it is not on this {kind}. Refresh the {kind}."))
    return quot


def ensure_live(kind: str, record: Inquiry | Tender | None) -> Inquiry | Tender:
    """For a record loaded by quotation (not by the URL): 404 when it is missing or deleted."""
    if record is None or record.is_deleted:
        raise HTTPException(status_code=404, detail=(
            f"{label(kind)} not found or deleted — restore it before working on its quotations."))
    return record


def ensure_can_change(db: Session, user: User, quot: Quotation | None, parent: Inquiry | Tender | None, verb: str) -> None:
    """403 with the reason unless the quotation's creator, or someone whose CRM Edit scope covers the
    inquiry / tender (Role › Data access › Edit — default: its creator and BD owner), is acting.
    Same rule as access.can_change_quotation; the message names the right kind of record."""
    if can_change_quotation(db, user, quot, parent):
        return
    kind = TENDER if isinstance(parent, Tender) else INQUIRY
    level = SCOPE_LABELS[user_edit_scope(user, MODULE)]
    number = getattr(quot, "quot_number", None) if quot is not None else None
    what = f"quotation {number}" if number else f"a quotation on this {kind}"
    uid = getattr(parent, "universal_id", None)
    where = f"{kind} {uid}" if uid else f"this {kind}"
    made = "it was made by someone else and " if quot is not None else ""
    raise HTTPException(status_code=403, detail=(
        f"You can't {verb} {what} — {made}{where} is outside your CRM Edit scope ('{level}'). Ask its creator, the "
        f"{kind}'s BD owner, or an admin to widen the Edit scope of your role in Organization › Role & Permissions "
        "(Data access › Edit)."))


def number_prefix(kind: str, parent: Inquiry | Tender) -> str:
    """Quote number prefix. Inquiry: QT-<part after "INQ-">-; tender: QT-TND-<part after "TND-">- — the
    TND marker keeps a tender's numbers apart from an inquiry's, whatever the two ids look like."""
    if kind == TENDER:
        suffix = parent.universal_id.split("TND-")[-1] if parent.universal_id else str(parent.id)
        return f"QT-TND-{suffix}-"
    suffix = parent.universal_id.split("INQ-")[-1] if parent.universal_id else str(parent.id)
    return f"QT-{suffix}-"


def other_accepted(db: Session, quot: Quotation) -> Quotation | None:
    """Another accepted quotation on the same inquiry / tender (one accepted offer per record)."""
    kind = kind_of(quot)
    return db.query(Quotation).filter(
        parent_filter(kind, parent_id_of(quot)), Quotation.id != quot.id, Quotation.status == "accepted",
    ).first()


def in_scope_parent_ids(db: Session, user: User, kind: str):
    """Sub-select of the ids of live inquiries / tenders inside the user's CRM data scope."""
    model = MODELS[kind]
    return apply_scope(db.query(model.id).filter(model.is_deleted == False), user, model, db)  # noqa: E712
