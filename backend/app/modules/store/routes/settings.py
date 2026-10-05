from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.setting import STORE_SETTING_CHALLAN_RULES, STORE_SETTING_VENDOR_ISSUE_TYPES, STORE_SETTING_RETURN_DATE_ISSUE_TYPES, StoreSetting

router = APIRouter(prefix="/store/settings", tags=["Store"])


class IssueRulesIn(BaseModel):
    challan_issue_types: list[str] = []
    challan_location_ids: list[int] = []
    vendor_issue_types: list[str] = []
    return_date_issue_types: list[str] = []


def get_setting(db: Session, key: str, default=None):
    row = db.query(StoreSetting).filter(StoreSetting.key == key).first()
    return row.value if row and row.value is not None else default


def challan_rules(db: Session) -> dict:
    raw = get_setting(db, STORE_SETTING_CHALLAN_RULES, {}) or {}
    return {"issue_types": list(raw.get("issue_types") or []), "location_ids": list(raw.get("location_ids") or [])}


def vendor_issue_types(db: Session) -> list[str]:
    return list(get_setting(db, STORE_SETTING_VENDOR_ISSUE_TYPES, []) or [])


def return_date_issue_types(db: Session) -> list[str]:
    return list(get_setting(db, STORE_SETTING_RETURN_DATE_ISSUE_TYPES, []) or [])


def _issue_rules_payload(db: Session) -> dict:
    challan = challan_rules(db)
    return {
        "challan_issue_types": challan["issue_types"],
        "challan_location_ids": challan["location_ids"],
        "vendor_issue_types": vendor_issue_types(db),
        "return_date_issue_types": return_date_issue_types(db),
    }


def _put_setting(db: Session, key: str, value) -> None:
    row = db.query(StoreSetting).filter(StoreSetting.key == key).first()
    if not row:
        row = StoreSetting(key=key)
        db.add(row)
    row.value = value


@router.get("/issue-rules")
async def get_issue_rules(db: Session = Depends(get_db), _user: User = Depends(require_app_access("store"))):
    return _issue_rules_payload(db)


@router.put("/issue-rules")
async def set_issue_rules(
    payload: IssueRulesIn,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    from app.modules.store.routes.doc_types import doc_types

    known = {t.value for t in doc_types(db, "issue")}
    challan_types = list(dict.fromkeys(payload.challan_issue_types))
    vendor_types = list(dict.fromkeys(payload.vendor_issue_types))
    return_date_types = list(dict.fromkeys(payload.return_date_issue_types))
    if missing := [t for t in dict.fromkeys(challan_types + vendor_types + return_date_types) if t not in known]:
        raise HTTPException(status_code=400, detail=f"Issue type(s) {', '.join(missing)} no longer exist — reload the page and tick them again.")
    loc_ids = list(dict.fromkeys(payload.challan_location_ids))
    found = {l.id for l in db.query(StoreLocation).filter(StoreLocation.id.in_(loc_ids)).all()} if loc_ids else set()
    if missing_locs := [i for i in loc_ids if i not in found]:
        raise HTTPException(status_code=400, detail=f"Store #{', #'.join(map(str, missing_locs))} wasn't found — it may have been deleted. Reload the page and save again.")
    _put_setting(db, STORE_SETTING_CHALLAN_RULES, {"issue_types": challan_types, "location_ids": loc_ids})
    _put_setting(db, STORE_SETTING_VENDOR_ISSUE_TYPES, vendor_types)
    _put_setting(db, STORE_SETTING_RETURN_DATE_ISSUE_TYPES, return_date_types)
    db.commit()
    return _issue_rules_payload(db)
