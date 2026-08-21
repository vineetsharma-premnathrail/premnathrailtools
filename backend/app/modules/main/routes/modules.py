from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.module import Module
from app.modules.main.schemas.module import ModuleCreate, ModuleUpdate, ModuleResponse
from app.modules.main.routes.auth import get_current_user
from app.modules.main.routes.users import require_admin

router = APIRouter(prefix="/modules", tags=["Modules"])


@router.get("", response_model=list[ModuleResponse])
async def list_modules(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Any authenticated user can read the registry (used to render the
    assignable-apps checklist and module labels/icons) — admins see inactive
    modules too, everyone else only sees active ones."""
    query = db.query(Module)
    if user.role != "admin":
        query = query.filter(Module.is_active.is_(True))
    return query.order_by(Module.sort_order.asc(), Module.label.asc()).all()


@router.post("", response_model=ModuleResponse)
async def create_module(
    payload: ModuleCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    if db.query(Module).filter(Module.key == payload.key).first():
        raise HTTPException(status_code=409, detail=f"Module key '{payload.key}' already exists")
    module = Module(**payload.model_dump())
    db.add(module)
    db.commit()
    db.refresh(module)
    return module


@router.patch("/{module_id}", response_model=ModuleResponse)
async def update_module(
    module_id: int,
    payload: ModuleUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    module = db.query(Module).filter(Module.id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(module, field, val)
    db.commit()
    db.refresh(module)
    return module
