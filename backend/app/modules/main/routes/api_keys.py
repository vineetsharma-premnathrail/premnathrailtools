from datetime import datetime
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User, AVAILABLE_APPS
from app.modules.main.models.api_key import APIKey
from app.modules.main.routes.auth import get_current_user
from app.middleware.api_key import generate_api_key

router = APIRouter(prefix="/api-keys", tags=["API Keys"])


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


class APIKeyCreate(BaseModel):
    name: str
    allowed_apps: list[str] = []


class APIKeyResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    prefix: str
    allowed_apps: list[str]
    is_active: bool
    last_used_at: datetime | None = None
    created_at: datetime | None = None


class APIKeyCreatedResponse(APIKeyResponse):
    api_key: str  # shown once — never retrievable again


@router.get("", response_model=list[APIKeyResponse])
async def list_api_keys(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    """List all API keys (admin only). Never returns the raw key or its hash."""
    return db.query(APIKey).order_by(APIKey.created_at.desc()).all()


@router.post("", response_model=APIKeyCreatedResponse, status_code=201)
async def create_api_key(
    payload: APIKeyCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Issue a new API key for an external system (admin only). The raw key is
    shown exactly once in this response — store it now, it can't be recovered."""
    invalid = set(payload.allowed_apps) - AVAILABLE_APPS
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid app(s): {', '.join(sorted(invalid))}")

    raw_key, key_hash = generate_api_key()
    record = APIKey(
        name=payload.name,
        key_hash=key_hash,
        prefix=raw_key[:12],
        allowed_apps=payload.allowed_apps,
        created_by_id=admin.id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    response = APIKeyResponse.model_validate(record).model_dump()
    return APIKeyCreatedResponse(**response, api_key=raw_key)


@router.patch("/{key_id}/revoke", response_model=APIKeyResponse)
async def revoke_api_key(key_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    """Deactivate an API key (admin only). Irreversible in the sense that the
    raw key was never stored — the caller would need a brand new key anyway."""
    record = db.query(APIKey).filter(APIKey.id == key_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="API key not found")
    record.is_active = False
    db.commit()
    db.refresh(record)
    return record
