"""Design reports: register summary and the Master Document List (MDL) —
the ISO 9001 §7.5 list of every controlled document and its current
revision, exported as CSV."""
import csv
import io
from collections import Counter
from datetime import date
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.design.models.document import DesignDocument, DesignDocumentRevision
from app.modules.design.routes.documents import document_responses, list_documents_query
from app.modules.design.schemas.dashboard import DesignCountRow, DesignMonthRow, DesignReportSummary
from app.modules.design.service import as_aware, released_revision, user_name, users_by_id
from app.modules.main.models.user import User

router = APIRouter(
    prefix="/design/reports", tags=["Design"],
    dependencies=[Depends(require_app_access("design")), Depends(require_tab_access("design", "reports"))],
)

_TYPE_LABELS = {
    "ga_drawing": "GA Drawing", "part_drawing": "Part Drawing", "assembly_drawing": "Assembly Drawing",
    "schematic": "Schematic", "specification": "Specification", "calculation": "Calculation", "datasheet": "Datasheet",
    "procedure": "Procedure", "manual": "Manual", "bom": "BOM", "other": "Other",
}
_STATUS_LABELS = {
    "draft": "Draft", "in_review": "In Review", "in_approval": "In Approval", "released": "Released",
    "revising": "Released (revision in progress)", "obsolete": "Obsolete",
}


@router.get("/summary", response_model=DesignReportSummary)
async def report_summary(db: Session = Depends(get_db)):
    docs = document_responses(db, list_documents_query(db, limit=100000))
    out = DesignReportSummary()
    out.by_type = [DesignCountRow(key=k, count=v) for k, v in Counter(d.document_type for d in docs).most_common()]
    out.by_discipline = [DesignCountRow(key=k, count=v) for k, v in Counter(d.discipline for d in docs).most_common()]
    out.by_status = [DesignCountRow(key=k, count=v) for k, v in Counter(d.display_status for d in docs).most_common()]

    released = db.query(DesignDocumentRevision).join(DesignDocument, DesignDocument.id == DesignDocumentRevision.document_id).filter(
        DesignDocumentRevision.is_deleted == False,  # noqa: E712
        DesignDocument.is_deleted == False,  # noqa: E712
        DesignDocumentRevision.released_at.isnot(None),
    ).all()
    out.total_revisions_released = len(released)

    today = date.today()
    months = []
    for back in range(11, -1, -1):
        y, m = today.year, today.month - back
        while m <= 0:
            y, m = y - 1, m + 12
        months.append(f"{y:04d}-{m:02d}")
    per_month = Counter(as_aware(r.released_at).strftime("%Y-%m") for r in released)
    out.releases_by_month = [DesignMonthRow(month=m, released=per_month.get(m, 0)) for m in months]

    # Cycle time: first entry into the workflow (created) → release. The
    # revision's created_at is when the author opened it.
    cycles = [
        (as_aware(r.released_at) - as_aware(r.created_at)).total_seconds() / 86400
        for r in released if r.created_at and r.released_at
    ]
    out.avg_cycle_days = round(sum(cycles) / len(cycles), 1) if cycles else None
    out.avg_returns_per_release = round(sum(r.returned_count for r in released) / len(released), 2) if released else None
    return out


@router.get("/master-document-list")
async def master_document_list(
    status_filter: str | None = Query(None, alias="status"),
    document_type: str | None = None,
    discipline: str | None = None,
    pm_project_id: int | None = None,
    erp_project_id: int | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("design")),
):
    docs = list_documents_query(
        db, status=status_filter, document_type=document_type, discipline=discipline,
        pm_project_id=pm_project_id, erp_project_id=erp_project_id, search=search, limit=100000,
    )
    rows = document_responses(db, docs)
    by_id = {d.id: d for d in docs}
    signers = users_by_id(db, {
        uid for d in docs for r in [released_revision(d)] if r for uid in (r.reviewed_by_id, r.approved_by_id)
    })

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "Doc Number", "Title", "Type", "Discipline", "Status", "Controlled Rev", "Released On", "Checked By",
        "Approved By", "Open Rev", "Open Rev Status", "Pending With", "Owner", "Project", "Machine", "Store Item",
        "Department", "Created On",
    ])
    for row in sorted(rows, key=lambda r: r.doc_number):
        rel = released_revision(by_id[row.id])
        writer.writerow([
            row.doc_number, row.title, _TYPE_LABELS.get(row.document_type, row.document_type), row.discipline.title(),
            _STATUS_LABELS.get(row.display_status, row.display_status), row.released_revision_label or "",
            row.released_at.strftime("%d-%m-%Y") if row.released_at else "",
            user_name(signers.get(rel.reviewed_by_id)) if rel else "", user_name(signers.get(rel.approved_by_id)) if rel else "",
            row.open_revision_label or "", (row.open_revision_status or "").replace("_", " ").title(), row.pending_with_name or "",
            row.owner_name or "", row.pm_project_label or "", row.erp_project_label or "", row.store_item_label or "",
            row.department_name or "", row.created_at.strftime("%d-%m-%Y") if row.created_at else "",
        ])
    # BOM so Excel opens the UTF-8 file with the right encoding.
    content = "﻿" + buffer.getvalue()
    filename = f"master-document-list-{date.today().isoformat()}.csv"
    return Response(
        content=content.encode("utf-8"), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
