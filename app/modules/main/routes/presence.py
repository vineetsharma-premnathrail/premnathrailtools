import time
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user

router = APIRouter(prefix="/presence", tags=["Presence"])

# In-memory "who's viewing this" store: { "sr:42": { user_id: {name, email, last_seen} }, ... }
# Client heartbeats every 30s; entries older than _TTL are lazily purged on
# the next heartbeat/read for that key (no background sweep, no cross-worker sync).
_presence: dict[str, dict[int, dict]] = {}
_TTL = 45  # seconds


def _purge(key: str) -> None:
    cutoff = time.time() - _TTL
    _presence[key] = {
        uid: info
        for uid, info in _presence.get(key, {}).items()
        if info["last_seen"] > cutoff
    }


class HeartbeatPayload(BaseModel):
    resource_type: str   # "sr" | "project"
    resource_id: int


@router.post("/heartbeat", status_code=204)
async def heartbeat(payload: HeartbeatPayload, user: User = Depends(get_current_user)):
    key = f"{payload.resource_type}:{payload.resource_id}"
    _presence.setdefault(key, {})[user.id] = {
        "name": user.name,
        "email": user.email,
        "last_seen": time.time(),
    }
    _purge(key)


@router.get("/{resource_type}/{resource_id}")
async def get_viewers(resource_type: str, resource_id: int, user: User = Depends(get_current_user)):
    key = f"{resource_type}:{resource_id}"
    _purge(key)
    return [
        {"name": info["name"], "email": info["email"]}
        for uid, info in _presence.get(key, {}).items()
        if uid != user.id
    ]
