"""Plain-function helpers for the standalone P2P module —
PR number generation, kept separate from routes so it's easy to unit test."""
from datetime import date
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.p2p.models.p2p_request import P2PRequest


def generate_p2p_number(db: Session, category_code: str) -> str:
    """P2P-[CATEGORY]-[YEAR]-[NUMBER], sequence scoped per category+year."""
    year = date.today().year
    prefix = f"P2P-{category_code}-{year}-"
    last = db.query(func.max(P2PRequest.p2p_number)).filter(
        P2PRequest.p2p_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"
