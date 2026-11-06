"""Procurement > Settings > Buyer responsibility: which buyer owns which Item
Master category (one category = one buyer; one buyer may own many).

Reading needs View on Procurement > Settings; saving needs the same explicit
Settings > Edit grant as every other settings save (like the Purpose rules).
Every change is audited. Rules and storage: app/modules/p2p/buyer_responsibility.py."""
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.permissions import ensure_tab_action
from app.core.settings_framework import can_edit_settings
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.p2p import buyer_responsibility as br

router = APIRouter(prefix="/p2p/buyer-responsibility", tags=["P2P"])

_EDITORS_NOTE = ("Only admins or users granted Settings → Edit in the Procurement permission matrix can change "
                 "buyer responsibility — ask an admin.")
_CONCURRENT = "Someone else just changed buyer responsibility — reload and make your change again."


def _viewer(user: User = Depends(get_current_user)) -> User:
    ensure_tab_action(user, "p2p", "settings", "view")
    return user


def _editor(user: User = Depends(_viewer)) -> User:
    if not can_edit_settings(user, "p2p"):
        raise HTTPException(status_code=403, detail=_EDITORS_NOTE)
    return user


@router.get("")
def read_buyer_responsibility(db: Session = Depends(get_db), user: User = Depends(_viewer)):
    return br.build_payload(db, can_edit_settings(user, "p2p"))


@router.put("")
def save_buyer_responsibility(body: dict = Body(...), db: Session = Depends(get_db), user: User = Depends(_editor)):
    try:
        clean = br.validate(db, body)
    except br.BuyerResponsibilityError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    try:
        br.save(db, user, clean, expected_version=body.get("version"))
        db.commit()
    except br.BuyerResponsibilityConflict as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=_CONCURRENT) from None
    return br.build_payload(db, True)
