"""Turns a signed record reference from a page URL back into the record id
(core/record_ref.py). Any signed-in user may resolve a reference — it only
proves the link wasn't edited; the record's own API still checks permission
and data scope."""
from fastapi import APIRouter, Depends, HTTPException

from app.modules.main.routes.auth import get_current_user
from app.core.record_ref import decode_ref
from app.modules.main.models.user import User

router = APIRouter(prefix="/refs", tags=["Record links"])


@router.get("/{ref}")
async def resolve_ref(ref: str, _user: User = Depends(get_current_user)):
    record_id = decode_ref(ref)
    if record_id is None:
        raise HTTPException(
            status_code=404,
            detail="This link is invalid — it was changed or copied incompletely. Open the record from its list, "
                   "or ask the sender for the link again.",
        )
    return {"id": record_id}
