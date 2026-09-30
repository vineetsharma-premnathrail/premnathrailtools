from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_action
from app.db.session import get_db
from app.modules.electrical.models.bom import ElectricalBomItem
from app.modules.electrical.models.panel import (
    ElectricalPanel, ELECTRICAL_PANEL_TYPES, ELECTRICAL_PANEL_STATUSES, ELECTRICAL_PANEL_ASSEMBLED,
)
from app.modules.electrical.schemas.panel import ElectricalPanelCreate, ElectricalPanelUpdate, ElectricalPanelResponse
from app.modules.electrical.service import ELECTRICAL_APP, get_job_or_404, require_working, user_names
from app.modules.main.models.user import User

router = APIRouter(
    prefix="/electrical/jobs/{job_id}/panels", tags=["Electrical"],
    dependencies=[Depends(require_app_access(ELECTRICAL_APP))],
)

_CAN_EDIT = require_tab_action(ELECTRICAL_APP, "jobs", "edit")


def _to_responses(db: Session, panels: list[ElectricalPanel]) -> list[ElectricalPanelResponse]:
    names = user_names(db, {p.assembled_by_id for p in panels})
    ids = [p.id for p in panels]
    counts = dict(db.query(ElectricalBomItem.panel_id, func.count(ElectricalBomItem.id)).filter(
        ElectricalBomItem.panel_id.in_(ids), ElectricalBomItem.is_deleted == False  # noqa: E712
    ).group_by(ElectricalBomItem.panel_id).all()) if ids else {}
    out = []
    for p in panels:
        resp = ElectricalPanelResponse.model_validate(p)
        resp.assembled_by_name = names.get(p.assembled_by_id)
        resp.component_count = counts.get(p.id, 0)
        out.append(resp)
    return out


def _get_panel(db: Session, job_id: int, panel_id: int) -> ElectricalPanel:
    panel = db.query(ElectricalPanel).filter(
        ElectricalPanel.id == panel_id, ElectricalPanel.job_id == job_id, ElectricalPanel.is_deleted == False  # noqa: E712
    ).first()
    if not panel:
        raise HTTPException(status_code=404, detail=f"Panel #{panel_id} not found on this job (it may have been deleted).")
    return panel


def _validate(db: Session, job_id: int, data: dict, current_id: int | None = None) -> None:
    if data.get("panel_type") and data["panel_type"] not in ELECTRICAL_PANEL_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid panel type '{data['panel_type']}'. Use one of: {', '.join(ELECTRICAL_PANEL_TYPES)}.")
    if data.get("status") and data["status"] not in ELECTRICAL_PANEL_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid panel status '{data['status']}'. Use one of: {', '.join(ELECTRICAL_PANEL_STATUSES)}.")
    if data.get("panel_tag"):
        data["panel_tag"] = data["panel_tag"].strip().upper()
        clash = db.query(ElectricalPanel).filter(
            ElectricalPanel.job_id == job_id, func.upper(ElectricalPanel.panel_tag) == data["panel_tag"],
            ElectricalPanel.is_deleted == False,  # noqa: E712
        )
        if current_id:
            clash = clash.filter(ElectricalPanel.id != current_id)
        if clash.first():
            raise HTTPException(status_code=409, detail=f"Panel tag '{data['panel_tag']}' is already used on this job. Pick a different tag.")


def _stamp_assembly(panel: ElectricalPanel, user: User) -> None:
    if panel.status in ELECTRICAL_PANEL_ASSEMBLED and panel.assembled_at is None:
        panel.assembled_at = datetime.now(timezone.utc)
        panel.assembled_by_id = user.id
    elif panel.status not in ELECTRICAL_PANEL_ASSEMBLED:
        panel.assembled_at = None
        panel.assembled_by_id = None


@router.get("", response_model=list[ElectricalPanelResponse])
async def list_panels(job_id: int, db: Session = Depends(get_db)):
    get_job_or_404(db, job_id)
    panels = db.query(ElectricalPanel).filter(
        ElectricalPanel.job_id == job_id, ElectricalPanel.is_deleted == False  # noqa: E712
    ).order_by(ElectricalPanel.panel_tag).all()
    return _to_responses(db, panels)


@router.post("", response_model=ElectricalPanelResponse)
async def create_panel(job_id: int, payload: ElectricalPanelCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True)
    require_working(job, "change its panels")
    data = payload.model_dump()
    _validate(db, job_id, data)
    panel = ElectricalPanel(**data, job_id=job_id)
    _stamp_assembly(panel, user)
    db.add(panel)
    db.commit()
    db.refresh(panel)
    return _to_responses(db, [panel])[0]


@router.patch("/{panel_id}", response_model=ElectricalPanelResponse)
async def update_panel(job_id: int, panel_id: int, payload: ElectricalPanelUpdate, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True)
    require_working(job, "change its panels")
    panel = _get_panel(db, job_id, panel_id)
    updates = payload.model_dump(exclude_unset=True)
    _validate(db, job_id, updates, current_id=panel.id)
    for field, val in updates.items():
        setattr(panel, field, val)
    _stamp_assembly(panel, user)
    db.commit()
    db.refresh(panel)
    return _to_responses(db, [panel])[0]


@router.delete("/{panel_id}")
async def delete_panel(job_id: int, panel_id: int, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True)
    require_working(job, "change its panels")
    panel = _get_panel(db, job_id, panel_id)
    mounted = db.query(ElectricalBomItem).filter(ElectricalBomItem.panel_id == panel.id, ElectricalBomItem.is_deleted == False).count()  # noqa: E712
    if mounted:
        raise HTTPException(status_code=409, detail=f"{mounted} BOM line(s) are mounted in panel {panel.panel_tag}. Move them to another panel (or clear their panel) on the BOM tab first.")
    panel.is_deleted = True
    panel.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Panel {panel.panel_tag} deleted"}
