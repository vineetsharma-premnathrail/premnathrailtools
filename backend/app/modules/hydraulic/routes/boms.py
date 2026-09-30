import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.hydraulic.models.bom import HydBom, HydBomItem
from app.modules.hydraulic.models.circuit import HydCircuit
from app.modules.hydraulic.models.component import HydComponent
from app.modules.hydraulic.schemas.bom import HydBomCreate, HydBomUpdate, HydBomItemResponse, HydBomResponse
from app.modules.hydraulic.service import (
    generate_bom_number, check_system_type, get_system_or_404, next_revision, systems_by_id, components_by_id, user_names,
)
from app.modules.main.models.user import User

router = APIRouter(
    prefix="/hydraulic/boms", tags=["Hydraulic & Pneumatic"],
    dependencies=[Depends(require_app_access("hydraulic"))],
)

_CAN_EDIT = require_tab_action("hydraulic", "bom", "edit")


def _to_responses(db: Session, boms: list[HydBom]) -> list[HydBomResponse]:
    systems = systems_by_id(db, {b.system_id for b in boms})
    circuit_ids = {b.circuit_id for b in boms if b.circuit_id}
    circuits = {c.id: c for c in db.query(HydCircuit).filter(HydCircuit.id.in_(circuit_ids)).all()} if circuit_ids else {}
    comps = components_by_id(db, {i.component_id for b in boms for i in b.items})
    names = user_names(db, {b.created_by_id for b in boms} | {b.released_by_id for b in boms})
    out = []
    for b in boms:
        resp = HydBomResponse.model_validate(b)
        system = systems.get(b.system_id)
        circuit = circuits.get(b.circuit_id)
        resp.system_number = system.system_number if system else None
        resp.system_name = system.name if system else None
        resp.circuit_number = circuit.circuit_number if circuit else None
        resp.circuit_revision = circuit.revision if circuit else None
        resp.created_by_name = names.get(b.created_by_id)
        resp.released_by_name = names.get(b.released_by_id)
        items = []
        for line in b.items:
            item = HydBomItemResponse.model_validate(line)
            comp = comps.get(line.component_id)
            if comp:
                item.component_code, item.component_name, item.component_category = comp.code, comp.name, comp.category
                item.manufacturer, item.model_number = comp.manufacturer, comp.model_number
                item.unit_cost = float(comp.unit_cost or 0.0)
            item.line_cost = round(item.unit_cost * line.quantity, 2)
            items.append(item)
        resp.items = items
        resp.line_count = len(items)
        resp.total_cost = round(sum(i.line_cost for i in items), 2)
        out.append(resp)
    return out


def _get_or_404(db: Session, bom_id: int, lock: bool = False) -> HydBom:
    q = db.query(HydBom).filter(HydBom.id == bom_id, HydBom.is_deleted == False)  # noqa: E712
    if lock:
        q = q.with_for_update()
    bom = q.first()
    if not bom:
        raise HTTPException(status_code=404, detail=f"BOM #{bom_id} not found (it may have been deleted).")
    return bom


def _require_draft(bom: HydBom, action: str) -> None:
    if bom.status != "draft":
        raise HTTPException(
            status_code=409,
            detail=f"{bom.bom_number} Rev {bom.revision} is {bom.status} — only a draft BOM can be {action}. Raise a new revision to change it.",
        )


def _build_items(db: Session, lines: list[dict]) -> list[HydBomItem]:
    ids = {line["component_id"] for line in lines}
    found = {c.id: c for c in db.query(HydComponent).filter(HydComponent.id.in_(ids), HydComponent.is_deleted == False).all()} if ids else {}  # noqa: E712
    missing = ids - set(found)
    if missing:
        raise HTTPException(status_code=404, detail=f"Component(s) #{', #'.join(str(i) for i in sorted(missing))} not found in the component master — they may have been deleted. Remove those lines and pick again.")
    tags = [line["tag_number"].strip().upper() for line in lines if (line.get("tag_number") or "").strip()]
    dupes = sorted({t for t in tags if tags.count(t) > 1})
    if dupes:
        raise HTTPException(status_code=400, detail=f"Tag number(s) {', '.join(dupes)} are used on more than one line. Each circuit tag should appear once — combine the lines or fix the tag.")
    return [
        HydBomItem(
            component_id=line["component_id"], tag_number=(line.get("tag_number") or "").strip().upper() or None,
            quantity=line["quantity"], uom=line["uom"].strip().upper(), remarks=line.get("remarks"), sort_order=idx,
        )
        for idx, line in enumerate(lines)
    ]


def _resolve_links(db: Session, data: dict) -> None:
    if data.get("system_id"):
        data["system_type"] = get_system_or_404(db, data["system_id"]).system_type
    if data.get("circuit_id"):
        circuit = db.query(HydCircuit).filter(HydCircuit.id == data["circuit_id"], HydCircuit.is_deleted == False).first()  # noqa: E712
        if not circuit:
            raise HTTPException(status_code=404, detail=f"Circuit #{data['circuit_id']} not found (it may have been deleted) — pick the circuit again.")
        if data.get("system_id") and circuit.system_id and circuit.system_id != data["system_id"]:
            raise HTTPException(status_code=400, detail=f"Circuit {circuit.circuit_number} belongs to a different system than the one chosen for this BOM.")


@router.get("", response_model=list[HydBomResponse])
async def list_boms(
    system_id: int | None = None,
    system_type: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("hydraulic", "bom")),
):
    query = db.query(HydBom).filter(HydBom.is_deleted == False)  # noqa: E712
    if system_id:
        query = query.filter(HydBom.system_id == system_id)
    if system_type:
        query = query.filter(HydBom.system_type == system_type)
    if status_filter:
        query = query.filter(HydBom.status == status_filter)
    if search:
        like = f"%{search}%"
        query = query.filter(HydBom.bom_number.ilike(like) | HydBom.title.ilike(like))
    return _to_responses(db, query.order_by(HydBom.id.desc()).all())


@router.post("", response_model=HydBomResponse)
async def create_bom(
    payload: HydBomCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("hydraulic", "bom", "create")),
):
    data = payload.model_dump()
    check_system_type(data["system_type"])
    _resolve_links(db, data)
    lines = data.pop("items")
    bom = HydBom(**data, bom_number=generate_bom_number(db), revision="A", status="draft", created_by_id=user.id)
    bom.items = _build_items(db, lines)
    db.add(bom)
    db.commit()
    db.refresh(bom)
    return _to_responses(db, [bom])[0]


@router.get("/{bom_id}", response_model=HydBomResponse)
async def get_bom(bom_id: int, db: Session = Depends(get_db)):
    return _to_responses(db, [_get_or_404(db, bom_id)])[0]


@router.get("/{bom_id}/export")
async def export_bom_csv(bom_id: int, db: Session = Depends(get_db)):
    bom = _to_responses(db, [_get_or_404(db, bom_id)])[0]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([f"{bom.bom_number} Rev {bom.revision}", bom.title, bom.system_number or "", bom.status])
    writer.writerow(["#", "Tag", "Code", "Component", "Category", "Manufacturer", "Model", "Qty", "UOM", "Unit cost", "Line cost", "Remarks"])
    for idx, i in enumerate(bom.items, 1):
        writer.writerow([idx, i.tag_number or "", i.component_code, i.component_name, i.component_category, i.manufacturer or "",
                         i.model_number or "", i.quantity, i.uom, i.unit_cost, i.line_cost, i.remarks or ""])
    writer.writerow(["", "", "", "", "", "", "", "", "", "Total", bom.total_cost, ""])
    return Response(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{bom.bom_number}-Rev{bom.revision}.csv"'},
    )


@router.patch("/{bom_id}", response_model=HydBomResponse)
async def update_bom(
    bom_id: int,
    payload: HydBomUpdate,
    db: Session = Depends(get_db),
    _perm: User = Depends(_CAN_EDIT),
):
    bom = _get_or_404(db, bom_id, lock=True)
    _require_draft(bom, "edited")
    updates = payload.model_dump(exclude_unset=True)
    lines = updates.pop("items", None)
    merged = {"system_id": bom.system_id, "circuit_id": bom.circuit_id, **updates}
    _resolve_links(db, merged)
    for field, val in updates.items():
        setattr(bom, field, val)
    if merged.get("system_type"):
        bom.system_type = merged["system_type"]
    if lines is not None:
        bom.items = _build_items(db, lines)
    db.commit()
    db.refresh(bom)
    return _to_responses(db, [bom])[0]


@router.post("/{bom_id}/release", response_model=HydBomResponse)
async def release_bom(
    bom_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("hydraulic", "bom", "approve")),
):
    bom = _get_or_404(db, bom_id, lock=True)
    _require_draft(bom, "released")
    if not bom.items:
        raise HTTPException(status_code=400, detail="Add at least one component line before releasing the BOM.")
    # Releasing a revision makes the previously released one obsolete.
    db.query(HydBom).filter(
        HydBom.bom_number == bom.bom_number, HydBom.id != bom.id, HydBom.status == "released",
    ).update({"status": "obsolete"}, synchronize_session=False)
    bom.status = "released"
    bom.released_by_id = user.id
    bom.released_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(bom)
    return _to_responses(db, [bom])[0]


@router.post("/{bom_id}/revise", response_model=HydBomResponse)
async def revise_bom(
    bom_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_EDIT),
):
    """Copies a released BOM into its next revision as a new draft."""
    bom = _get_or_404(db, bom_id, lock=True)
    if bom.status != "released":
        raise HTTPException(status_code=409, detail=f"{bom.bom_number} Rev {bom.revision} is {bom.status} — only a released BOM can be revised. Edit the draft directly instead.")
    open_draft = db.query(HydBom).filter(HydBom.bom_number == bom.bom_number, HydBom.status == "draft", HydBom.is_deleted == False).first()  # noqa: E712
    if open_draft:
        raise HTTPException(status_code=409, detail=f"Rev {open_draft.revision} of {bom.bom_number} is already an open draft — edit or delete it instead of raising another revision.")
    latest = db.query(HydBom.revision).filter(HydBom.bom_number == bom.bom_number).order_by(HydBom.id.desc()).first()
    new = HydBom(
        bom_number=bom.bom_number, revision=next_revision(latest[0] if latest else bom.revision), title=bom.title,
        system_type=bom.system_type, system_id=bom.system_id, circuit_id=bom.circuit_id, status="draft",
        remarks=bom.remarks, created_by_id=user.id,
    )
    new.items = [
        HydBomItem(component_id=i.component_id, tag_number=i.tag_number, quantity=i.quantity, uom=i.uom, remarks=i.remarks, sort_order=i.sort_order)
        for i in bom.items
    ]
    db.add(new)
    db.commit()
    db.refresh(new)
    return _to_responses(db, [new])[0]


@router.delete("/{bom_id}")
async def delete_bom(
    bom_id: int,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("hydraulic", "bom", "delete")),
):
    bom = _get_or_404(db, bom_id)
    _require_draft(bom, "deleted")
    bom.is_deleted = True
    bom.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"{bom.bom_number} Rev {bom.revision} deleted"}
