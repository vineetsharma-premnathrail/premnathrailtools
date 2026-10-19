"""QR asset tags (Maintenance Phase 3).

Every asset gets a printed label whose QR encodes
`{FRONTEND_URL}/dashboard/maintenance/scan/{asset_code}`. Scanning it on a
phone opens the scan resolver page, which looks the asset up by code and
offers "Report Breakdown" (request form pre-filled with the asset).

The QR encodes the asset *code*, not the database id, so a label survives a
DB restore and a human can still read/type the code if the QR is damaged.
"""
import io
from urllib.parse import quote

import segno
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import require_any_app_access, require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.request import MaintenanceRequest
from app.modules.maintenance.models.work_order import MaintenanceWorkOrder, MAINTENANCE_WO_OPEN_STATUSES

router = APIRouter(prefix="/maintenance", tags=["Maintenance"])

MAX_LABELS = 200
OPEN_REQUEST_STATUSES = ("open", "acknowledged")


def scan_url(asset_code: str) -> str:
    """The URL the QR encodes — the frontend scan resolver for this code."""
    return f"{settings.FRONTEND_URL.rstrip('/')}/dashboard/maintenance/scan/{quote(asset_code, safe='')}"


def _qr(asset_code: str) -> segno.QRCode:
    # Error level M (~15% recovery) survives the scuffs/oil a shop-floor label
    # picks up while keeping the symbol small enough for a 50 mm label.
    return segno.make_qr(scan_url(asset_code), error="m")


def qr_svg(asset_code: str, *, xmldecl: bool = False) -> str:
    """SVG markup (no fixed width/height — sized by CSS via the viewBox)."""
    buf = io.BytesIO()
    _qr(asset_code).save(
        buf, kind="svg", scale=4, border=2, xmldecl=xmldecl, svgns=True,
        omitsize=True, title=f"Maintenance asset {asset_code}",
    )
    return buf.getvalue().decode("utf-8")


def _active_asset(db: Session, asset_id: int) -> MaintenanceAsset:
    asset = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == asset_id, MaintenanceAsset.is_deleted == False).first()  # noqa: E712
    if not asset:
        raise HTTPException(status_code=404, detail=f"Maintenance asset #{asset_id} not found — it may have been deleted.")
    return asset


@router.get("/assets/{asset_id}/qr.svg")
async def asset_qr_svg(
    asset_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_app_access("maintenance", "production")),
):
    asset = _active_asset(db, asset_id)
    return Response(
        content=qr_svg(asset.asset_code, xmldecl=True), media_type="image/svg+xml",
        headers={"Cache-Control": "private, max-age=3600"},
    )


# Lives under /asset-lookup (not /assets) so a code like "HISTORY" or
# "X/spares" can never be swallowed by the assets router's
# /assets/{asset_id}/... routes, which main.py registers first.
@router.get("/asset-lookup/by-code/{code:path}")
async def asset_by_code(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_any_app_access("maintenance", "production")),
):
    """Scan resolver lookup. Case-insensitive on the code so a hand-typed
    code from a damaged label still resolves."""
    clean = code.strip()
    asset = db.query(MaintenanceAsset).filter(
        func.lower(MaintenanceAsset.asset_code) == clean.lower(), MaintenanceAsset.is_deleted == False,  # noqa: E712
    ).first()
    if not asset:
        raise HTTPException(
            status_code=404,
            detail=f"No asset with code '{clean}' — check the tag or ask Maintenance to re-print it.",
        )
    branch = db.query(Branch.name).filter(Branch.id == asset.branch_id).first()
    open_requests = db.query(func.count(MaintenanceRequest.id)).filter(
        MaintenanceRequest.asset_id == asset.id, MaintenanceRequest.status.in_(OPEN_REQUEST_STATUSES),
    ).scalar() or 0
    open_wos = db.query(func.count(MaintenanceWorkOrder.id)).filter(
        MaintenanceWorkOrder.asset_id == asset.id, MaintenanceWorkOrder.status.in_(MAINTENANCE_WO_OPEN_STATUSES),
    ).scalar() or 0
    return {
        "id": asset.id,
        "asset_code": asset.asset_code,
        "name": asset.name,
        "branch_id": asset.branch_id,
        "branch_name": branch[0] if branch else None,
        "location_text": asset.location_text,
        "status": asset.status,
        "criticality": asset.criticality,
        "open_requests": int(open_requests),
        "open_work_orders": int(open_wos),
        # Decommissioned machines can't take new requests (requests.py
        # rejects them) — let the scan page say so up front.
        "can_raise_request": asset.status != "decommissioned",
        "can_view_asset": "maintenance" in user.get_apps(),
    }


@router.get(
    "/asset-tags/sheet",
    dependencies=[Depends(require_app_access("maintenance")), Depends(require_tab_access("maintenance", "assets"))],
)
async def asset_tag_sheet(
    ids: str | None = Query(None, description="Comma-separated asset ids"),
    branch_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Printable label data for many assets — either explicit ids or a whole
    plant. Each label carries its QR as inline SVG so the print page needs one
    request, not one per label."""
    if not ids and not branch_id:
        raise HTTPException(status_code=400, detail="Pick a plant or select assets to print labels for.")
    q = db.query(MaintenanceAsset).filter(MaintenanceAsset.is_deleted == False)  # noqa: E712
    if ids:
        try:
            id_list = sorted({int(x) for x in ids.split(",") if x.strip()})
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Asset ids must be numbers separated by commas — got '{ids}'.")
        if not id_list:
            raise HTTPException(status_code=400, detail="No asset ids given — select at least one asset.")
        if len(id_list) > MAX_LABELS:
            raise HTTPException(
                status_code=400,
                detail=f"{len(id_list)} assets selected — print at most {MAX_LABELS} labels at a time. Select fewer assets and print in batches.",
            )
        q = q.filter(MaintenanceAsset.id.in_(id_list))
    else:
        if not db.query(Branch.id).filter(Branch.id == branch_id).first():
            raise HTTPException(status_code=404, detail=f"Plant #{branch_id} not found.")
        # A whole plant's sheet skips scrapped machines.
        q = q.filter(MaintenanceAsset.branch_id == branch_id, MaintenanceAsset.status != "decommissioned")
    total = q.count()
    if total > MAX_LABELS:
        raise HTTPException(
            status_code=400,
            detail=f"This plant has {total} assets — print at most {MAX_LABELS} labels at a time. "
                   "Select the assets you need on the Assets list and print them in batches.",
        )
    assets = q.order_by(MaintenanceAsset.asset_code).all()
    branch_ids = {a.branch_id for a in assets}
    dept_ids = {a.department_id for a in assets if a.department_id}
    branches = dict(db.query(Branch.id, Branch.name).filter(Branch.id.in_(branch_ids)).all()) if branch_ids else {}
    depts = dict(db.query(Department.id, Department.name).filter(Department.id.in_(dept_ids)).all()) if dept_ids else {}
    return [
        {
            "id": a.id,
            "asset_code": a.asset_code,
            "name": a.name,
            "branch_name": branches.get(a.branch_id),
            "department_name": depts.get(a.department_id),
            "location_text": a.location_text,
            "criticality": a.criticality,
            "qr_path": f"/maintenance/assets/{a.id}/qr.svg",
            "scan_url": scan_url(a.asset_code),
            "qr_svg": qr_svg(a.asset_code),
        }
        for a in assets
    ]
