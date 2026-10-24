"""Vendor 'Referred by' rules and creator/referrer display names — one place,
used by both the Finance (accounts/vendors) and Procurement (p2p/vendors)
routes so they behave identically.

referral_type:
  employee — referred_by_user_id is an active portal user
  external — referred_by_name (person / company) [+ referred_by_phone]
  direct   — nobody referred us (an explicit answer, so a blank is never ambiguous)
NULL = vendor added before this field existed (shown as "—", never guessed).
"""
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.accounts.models.vendor import REFERRAL_TYPES, Vendor
from app.modules.main.models.user import User

REFERRAL_FIELDS = ("referral_type", "referred_by_user_id", "referred_by_name", "referred_by_phone")
REFERRAL_LABELS = {"employee": "Employee", "external": "External", "direct": "Direct (no referral)"}


def _s(v):
    return (v.strip() or None) if isinstance(v, str) else v


def clean_referral(db: Session, data: dict, current: Vendor | None = None) -> dict:
    """Validate + normalise the referral fields inside `data` (in place).
    On update only acts when a referral field is sent; the type then decides
    which of the other fields are kept (the rest are cleared)."""
    if not any(k in data for k in REFERRAL_FIELDS):
        return data
    for k in ("referral_type", "referred_by_name", "referred_by_phone"):
        if k in data:
            data[k] = _s(data[k])
    cur = lambda k: getattr(current, k, None) if current is not None else None  # noqa: E731
    rtype = data["referral_type"] if "referral_type" in data else cur("referral_type")
    uid = data["referred_by_user_id"] if "referred_by_user_id" in data else cur("referred_by_user_id")
    name = data["referred_by_name"] if "referred_by_name" in data else cur("referred_by_name")
    phone = data["referred_by_phone"] if "referred_by_phone" in data else cur("referred_by_phone")

    if rtype is None:
        if cur("referral_type"):
            raise HTTPException(status_code=422, detail="'Referred by' can't be cleared once set — choose 'Direct (no referral)' if nobody referred this vendor.")
        if uid or name or phone:
            raise HTTPException(status_code=422, detail="Choose how the vendor was referred (Employee, External or Direct) before giving the referrer's details.")
        data.update({"referral_type": None, "referred_by_user_id": None, "referred_by_name": None, "referred_by_phone": None})
        return data
    if rtype not in REFERRAL_TYPES:
        raise HTTPException(status_code=422, detail=f"'Referred by' type must be one of: {', '.join(REFERRAL_TYPES)}.")
    if rtype == "employee":
        if not uid:
            raise HTTPException(status_code=422, detail="Pick the employee who referred this vendor, or choose 'External' / 'Direct'.")
        u = db.get(User, uid)
        if u is None or (not u.is_active and uid != cur("referred_by_user_id")):
            raise HTTPException(status_code=422, detail="The employee you picked as referrer doesn't exist or is inactive — pick them again from the list.")
        name = phone = None
    elif rtype == "external":
        if not name:
            raise HTTPException(status_code=422, detail="Enter the name (person or company) who referred this vendor, or choose 'Employee' / 'Direct'.")
        uid = None
    else:
        uid = name = phone = None
    data.update({"referral_type": rtype, "referred_by_user_id": uid, "referred_by_name": name, "referred_by_phone": phone})
    return data


def user_names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {uid: (n or e) for uid, n, e in db.query(User.id, User.name, User.email).filter(User.id.in_(ids)).all()}


def vendor_people(db: Session, vendors: list[Vendor]) -> dict[int, dict]:
    """created_by_name / referred_by_label per vendor id, in one user query."""
    names = user_names(db, [i for v in vendors for i in (v.created_by_id, v.referred_by_user_id)])
    return {v.id: people_for(v, names) for v in vendors}


def people_for(v: Vendor, names: dict[int, str]) -> dict:
    if v.referral_type == "employee":
        label = names.get(v.referred_by_user_id) or "Former employee"
    elif v.referral_type == "external":
        label = v.referred_by_name + (f" ({v.referred_by_phone})" if v.referred_by_phone else "") if v.referred_by_name else None
    elif v.referral_type == "direct":
        label = REFERRAL_LABELS["direct"]
    else:
        label = None
    return {
        "created_by_name": names.get(v.created_by_id) if v.created_by_id else None,
        "referred_by_user_name": names.get(v.referred_by_user_id) if v.referred_by_user_id else None,
        "referred_by_label": label,
    }
