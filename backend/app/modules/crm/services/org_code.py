from datetime import date
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.crm.models.organization import Organization


def generate_org_code(db: Session) -> str:
    """ORG-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"ORG-{year}-"
    # Postgres transaction-scoped advisory lock keyed on the prefix — serializes
    # concurrent org-code generation for the same year so two requests can never
    # read the same MAX(...) and generate the same code. Released automatically
    # at the end of the current transaction (covers this request's eventual
    # db.commit()). Matches the locking strategy used for P2P/PO/RFQ/GRN/SR
    # number generation — see app.modules.p2p.service._lock_number_series.
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
    last = db.query(func.max(Organization.org_code)).filter(
        Organization.org_code.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"
