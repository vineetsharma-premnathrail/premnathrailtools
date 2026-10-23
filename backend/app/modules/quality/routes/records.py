"""Quality documents of record — inspection report, test certificate
(per decided lot) and deviation approval (per NCR). Word is primary: the
documents are registered with the managed-document workflow
(/managed-documents/<entity_type>/<id>: Save & Edit in Word, history,
upload revised copy). "Download PDF" here renders the Word document of
record once one exists, otherwise a fresh PDF from the system data."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session, selectinload

from app.core.permission_registry import can_perform
from app.core.permission_words import action_word
from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
try:  # managed Word documents framework (main/services/managed_documents.py)
    from app.modules.main.services import managed_documents
except ImportError:  # pragma: no cover — deployed without it: PDF only
    managed_documents = None
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.reports import documents as qdocs
from app.modules.quality.reports.render import render_docx, render_pdf

router = APIRouter(prefix="/quality/records", tags=["Quality"], dependencies=[Depends(require_app_access("quality"))])

_KINDS = {
    qdocs.REPORT: ("Inspection report", "Inspection-Report", "inspection_lots"),
    qdocs.CERTIFICATE: ("Test certificate", "Test-Certificate", "inspection_lots"),
    qdocs.DEVIATION: ("Deviation approval", "Deviation-Approval", "ncr"),
    qdocs.EIGHT_D: ("8D report", "8D-Report", "capa"),
}
_TAB_LABELS = {"inspection_lots": "Inspection Lots", "ncr": "NCR", "capa": "CAPA"}


def _lot(db: Session, lot_id: int) -> QualityInspectionLot:
    lot = db.query(QualityInspectionLot).options(selectinload(QualityInspectionLot.results)).filter(QualityInspectionLot.id == lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail=f"Inspection lot #{lot_id} not found — it may have been removed. Refresh the page.")
    return lot


def _ncr(db: Session, ncr_id: int) -> QualityNcr:
    ncr = db.query(QualityNcr).options(selectinload(QualityNcr.approvals)).filter(QualityNcr.id == ncr_id, QualityNcr.is_deleted == False).first()  # noqa: E712
    if not ncr:
        raise HTTPException(status_code=404, detail=f"NCR #{ncr_id} not found — it may have been removed. Refresh the page.")
    return ncr


def _capa(db: Session, capa_id: int):
    from app.modules.quality.models.capa import QualityCapa
    capa = db.query(QualityCapa).filter(QualityCapa.id == capa_id, QualityCapa.is_deleted == False).first()  # noqa: E712
    if not capa:
        raise HTTPException(status_code=404, detail=f"CAPA #{capa_id} not found — it may have been removed. Refresh the page.")
    return capa


def _ensure_scope(db: Session, kind: str, entity_id: int, user: User) -> None:
    """The record behind a document must be inside the user's data scope."""
    from app.core.data_scope import ensure_in_scope
    rec = _capa(db, entity_id) if kind == qdocs.EIGHT_D else _ncr(db, entity_id) if kind == qdocs.DEVIATION else _lot(db, entity_id)
    ensure_in_scope(db, user, rec)


def _revision(db: Session, kind: str, entity_id: int) -> int:
    return _capa(db, entity_id).report_revision if kind == qdocs.EIGHT_D else 0


def _spec(db: Session, kind: str, entity_id: int) -> tuple[dict, str]:
    try:
        if kind == qdocs.EIGHT_D:
            capa = _capa(db, entity_id)
            return qdocs.capa_8d_spec(db, capa), capa.capa_number
        if kind == qdocs.REPORT:
            lot = _lot(db, entity_id)
            return qdocs.inspection_report_spec(db, lot), lot.lot_number
        if kind == qdocs.CERTIFICATE:
            lot = _lot(db, entity_id)
            return qdocs.test_certificate_spec(db, lot), lot.lot_number
        ncr = _ncr(db, entity_id)
        return qdocs.deviation_spec(db, ncr), ncr.ncr_number
    except qdocs.DocumentNotReady as e:
        raise HTTPException(status_code=409, detail=str(e))


def _target_loader(kind: str):
    label, stem, tab = _KINDS[kind]

    def load(db: Session, entity_id: int, user: User, modify: bool):
        _ensure_scope(db, kind, entity_id, user)
        spec, number = _spec(db, kind, entity_id)
        action = "edit" if modify else "view"
        if not can_perform(user, "quality", tab, action):
            raise HTTPException(status_code=403, detail=f"You don't have '{action_word(action)}' permission on Quality › "
                                f"{_TAB_LABELS[tab]}. Ask an admin to grant it in Users › Permission Matrix.")
        return managed_documents.DocumentTarget(
            entity_id=entity_id, revision=_revision(db, kind, entity_id), title=f"{label} {spec['number']}",
            folder=managed_documents.sharepoint_folder("Quality", stem, number),
            filename_stem=managed_documents.safe_filename(f"{stem}-{spec['number']}"),
            build_docx=lambda: render_docx(spec),
        )
    return load


for _kind in (_KINDS if managed_documents else ()):
    managed_documents.register(managed_documents.DocumentAdapter(entity_type=_kind, app="quality", load=_target_loader(_kind)))


async def _pdf(kind: str, entity_id: int, db: Session, user: User) -> Response:
    _ensure_scope(db, kind, entity_id, user)
    # Same rule as the Word document of record (_target_loader): 'View' on
    # the tab the record belongs to, not just access to the Quality module.
    from app.core.permissions import ensure_tab_action
    ensure_tab_action(user, "quality", _KINDS[kind][2], "view")
    spec, _ = _spec(db, kind, entity_id)

    def render() -> bytes:
        try:
            return render_pdf(spec, f"Generated {datetime.now():%d-%m-%Y %H:%M} by {user.name or user.email} from the Premnath Rail portal.")
        except Exception as e:  # noqa: BLE001 — surface the real reason
            raise HTTPException(status_code=500, detail=f"Couldn't build the {_KINDS[kind][0].lower()} PDF: {e}")

    pdf = await managed_documents.pdf_of_record(db, kind, entity_id, _revision(db, kind, entity_id), render=render) if managed_documents else render()
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{_KINDS[kind][1]}-{spec["number"]}.pdf"'})


@router.get("/lots/{lot_id}/inspection-report.pdf")
async def inspection_report_pdf(lot_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    return await _pdf(qdocs.REPORT, lot_id, db, user)


@router.get("/lots/{lot_id}/test-certificate.pdf")
async def test_certificate_pdf(lot_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    return await _pdf(qdocs.CERTIFICATE, lot_id, db, user)


@router.get("/ncr/{ncr_id}/deviation-approval.pdf")
async def deviation_pdf(ncr_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    return await _pdf(qdocs.DEVIATION, ncr_id, db, user)


@router.get("/capa/{capa_id}/8d-report.pdf")
async def eight_d_pdf(capa_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    return await _pdf(qdocs.EIGHT_D, capa_id, db, user)
