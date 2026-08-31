from datetime import date
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.crm.models.organization import Organization


def generate_org_code(db: Session) -> str:
    """ORG-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"ORG-{year}-"
    last = db.query(func.max(Organization.org_code)).filter(
        Organization.org_code.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"
