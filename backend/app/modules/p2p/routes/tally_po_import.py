"""POs uploaded from Tally in bulk (Excel) before 2026-10-27.

The separate "Upload Tally POs" option was removed (owner, 2026-10-27): every
PO is now created in the portal and its Tally PO (number + PDF) is uploaded on
the PO draft, which is mandatory before it goes for approval
(rfq.upload_po_document / submit_po_draft). POs that were already uploaded
keep source="tally"; this route only serves their attached Tally PDF."""
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.data_scope import ensure_in_scope
from app.core.permissions import ensure_feature_action, ensure_tab_action, require_app_access
from app.db.session import get_db
import app.modules.p2p.access  # noqa: F401 — registers the Procurement data scopes
from app.modules.main.models.user import User
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.utils.sharepoint import download_file_content

router = APIRouter(prefix="/p2p/tally-po-import", tags=["P2P Purchase Orders"])

SOURCE = "tally"


def _tally_po_or_404(db: Session, user: User, po_id: int) -> P2PPurchaseOrder:
    po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id == po_id).first()
    if not po or po.source != SOURCE:
        raise HTTPException(status_code=404, detail="Tally PO not found — it may have been removed, or the link is wrong.")
    ensure_in_scope(db, user, po)
    return po


@router.get("/{po_id}/document/content")
async def get_tally_po_document(
    po_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    ensure_tab_action(user, "p2p", "purchase_orders", "view")
    ensure_feature_action(user, "p2p", "purchase_orders", "po_document", "view")
    po = _tally_po_or_404(db, user, po_id)
    if not po.document_sharepoint_path:
        raise HTTPException(status_code=404, detail=f"{po.po_number} has no Tally PO document attached yet.")
    content, _content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, po.document_sharepoint_path)
    name = po.document_filename or f"{po.po_number}.pdf"
    ascii_name = name.encode("ascii", "ignore").decode().replace('"', "").replace("\\", "") or f"{po.po_number}.pdf"
    return Response(content=content, media_type="application/pdf", headers={
        "Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}",
        "X-Content-Type-Options": "nosniff",
    })
