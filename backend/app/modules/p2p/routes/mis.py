"""MIS (Management Information System) reporting for P2P Requests — daily/
weekly/monthly/yearly/custom-range counts of PRs raised, PR approvals, and
PO approvals, plus a downloadable multi-sheet Excel export. Read-only:
nothing here mutates a P2PRequest, so there's no audit trail to write."""
from collections import Counter
from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, selectinload
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.formatting.rule import DataBarRule

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.p2p.models.p2p_request import P2PRequest, P2P_CATEGORIES
from app.modules.p2p.schemas.mis import (
    P2PMisApproverPending, P2PMisCategoryBreakdown, P2PMisKpis, P2PMisSummaryResponse, P2PMisTrendPoint,
)

router = APIRouter(prefix="/p2p/mis", tags=["P2P"])

PERIODS = ("daily", "weekly", "monthly", "yearly", "custom")
_ROLE_LABELS = {"department_head": "Department Head", "project_head": "Project Head", "plant_head": "Plant Head"}
_PO_ROLE_LABELS = {"purchase_head": "Purchase Head", "director": "Director", "md": "MD"}
_PO_ROLE_FLAGS = {"purchase_head": "is_purchase_head", "director": "is_director", "md": "is_md"}


def _require_mis_access(user: User = Depends(get_current_user)) -> User:
    """Purchase team, or any PO approver (purchase head/director/MD — who may
    not hold the "purchase" app at all, only the boolean flag), or admin."""
    if user.role == "admin" or "purchase" in user.get_apps() or user.is_purchase_head or user.is_director or user.is_md:
        return user
    raise HTTPException(status_code=403, detail="Purchase module or PO approver access is required for MIS reports.")


def _resolve_range(period: str, ref: date, date_from: date | None, date_to: date | None) -> tuple[date, date]:
    if period not in PERIODS:
        raise HTTPException(status_code=400, detail=f"Invalid period '{period}'. Use one of: {', '.join(PERIODS)}")
    if period == "custom":
        if not date_from or not date_to:
            raise HTTPException(status_code=400, detail="date_from and date_to are required for a custom period.")
        if date_from > date_to:
            raise HTTPException(status_code=400, detail="date_from must not be after date_to.")
        return date_from, date_to
    if period == "daily":
        return ref, ref
    if period == "weekly":
        start = ref - timedelta(days=ref.weekday())  # Monday
        return start, start + timedelta(days=6)
    if period == "monthly":
        return ref.replace(day=1), ref.replace(day=monthrange(ref.year, ref.month)[1])
    return date(ref.year, 1, 1), date(ref.year, 12, 31)  # yearly


def _dt_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    return datetime.combine(start, time.min, tzinfo=timezone.utc), datetime.combine(end, time.max, tzinfo=timezone.utc)


def _in_range(value: datetime | date | None, start: date, end: date) -> bool:
    if not value:
        return False
    d = value.date() if isinstance(value, datetime) else value
    return start <= d <= end


def _po_last_approved_at(pr: P2PRequest) -> datetime | None:
    dates = [d for d in (pr.purchase_head_approved_at, pr.director_approved_at, pr.md_approved_at, pr.po_approved_at) if d]
    return max(dates) if dates else None


def _bucket_of(d: date, period: str) -> date:
    return date(d.year, d.month, 1) if period == "yearly" else d


def _trend_buckets(start: date, end: date, period: str) -> list[date]:
    if period != "yearly":
        buckets, d = [], start
        while d <= end:
            buckets.append(d)
            d += timedelta(days=1)
        return buckets
    buckets, d = [], date(start.year, start.month, 1)
    while d <= end:
        buckets.append(d)
        d = date(d.year + (1 if d.month == 12 else 0), 1 if d.month == 12 else d.month + 1, 1)
    return buckets


def _gather(
    db: Session, period: str, ref: date, date_from: date | None, date_to: date | None,
    category_code: str | None, department: str | None,
) -> dict:
    start, end = _resolve_range(period, ref, date_from, date_to)
    start_dt, end_dt = _dt_bounds(start, end)

    date_filters = [
        and_(P2PRequest.created_at >= start_dt, P2PRequest.created_at <= end_dt),
        and_(P2PRequest.approved_at.isnot(None), P2PRequest.approved_at >= start_dt, P2PRequest.approved_at <= end_dt),
        and_(P2PRequest.po_date.isnot(None), P2PRequest.po_date >= start, P2PRequest.po_date <= end),
        and_(P2PRequest.status == "rejected", P2PRequest.updated_at >= start_dt, P2PRequest.updated_at <= end_dt),
        and_(P2PRequest.purchase_head_approved_at.isnot(None), P2PRequest.purchase_head_approved_at >= start_dt, P2PRequest.purchase_head_approved_at <= end_dt),
        and_(P2PRequest.director_approved_at.isnot(None), P2PRequest.director_approved_at >= start_dt, P2PRequest.director_approved_at <= end_dt),
        and_(P2PRequest.po_approved_at.isnot(None), P2PRequest.po_approved_at >= start_dt, P2PRequest.po_approved_at <= end_dt),
        and_(P2PRequest.md_approved_at.isnot(None), P2PRequest.md_approved_at >= start_dt, P2PRequest.md_approved_at <= end_dt),
    ]
    query = db.query(P2PRequest).options(selectinload(P2PRequest.items)).filter(or_(*date_filters))
    if category_code:
        query = query.filter(P2PRequest.category_code == category_code)
    if department:
        query = query.filter(P2PRequest.department == department)
    prs = query.order_by(P2PRequest.created_at.asc()).all()

    pending_pr_q = db.query(P2PRequest).filter(P2PRequest.status == "submitted")
    pending_po_q = db.query(P2PRequest).filter(P2PRequest.status == "po_raised")
    if category_code:
        pending_pr_q = pending_pr_q.filter(P2PRequest.category_code == category_code)
        pending_po_q = pending_po_q.filter(P2PRequest.category_code == category_code)
    if department:
        pending_pr_q = pending_pr_q.filter(P2PRequest.department == department)
        pending_po_q = pending_po_q.filter(P2PRequest.department == department)
    pending_prs = pending_pr_q.all()
    pending_pos = pending_po_q.all()

    kpis = P2PMisKpis(
        prs_created=sum(1 for pr in prs if _in_range(pr.created_at, start, end)),
        prs_approved=sum(1 for pr in prs if pr.status not in ("rejected", "cancelled") and _in_range(pr.approved_at, start, end)),
        prs_rejected=sum(1 for pr in prs if pr.status == "rejected" and _in_range(pr.updated_at, start, end)),
        prs_pending_approval=len(pending_prs),
        pos_raised=sum(1 for pr in prs if _in_range(pr.po_date, start, end)),
        pos_approved=sum(1 for pr in prs if pr.status == "po_approved" and _in_range(_po_last_approved_at(pr), start, end)),
        pos_pending_approval=len(pending_pos),
    )

    buckets = {b: {"created": 0, "approved": 0, "po_raised": 0} for b in _trend_buckets(start, end, period)}
    for pr in prs:
        if pr.created_at and _in_range(pr.created_at, start, end):
            buckets.setdefault(_bucket_of(pr.created_at.date(), period), {"created": 0, "approved": 0, "po_raised": 0})["created"] += 1
        if pr.approved_at and pr.status not in ("rejected", "cancelled") and _in_range(pr.approved_at, start, end):
            buckets.setdefault(_bucket_of(pr.approved_at.date(), period), {"created": 0, "approved": 0, "po_raised": 0})["approved"] += 1
        if pr.po_date and _in_range(pr.po_date, start, end):
            buckets.setdefault(_bucket_of(pr.po_date, period), {"created": 0, "approved": 0, "po_raised": 0})["po_raised"] += 1
    trend = [
        P2PMisTrendPoint(date=b.isoformat(), created=v["created"], approved=v["approved"], po_raised=v["po_raised"])
        for b, v in sorted(buckets.items())
    ]

    created_counter = Counter(pr.category_code for pr in prs if _in_range(pr.created_at, start, end))
    category_breakdown = [
        P2PMisCategoryBreakdown(category_code=code, label=P2P_CATEGORIES.get(code, code), count=count)
        for code, count in created_counter.most_common()
    ]

    pending_counts: dict[tuple[int, str], int] = {}
    for pr in pending_prs:
        for role in pr.pending_approval_roles:
            uid = pr.approver_id if role == "department_head" else getattr(pr, f"{role}_id")
            if uid:
                key = (uid, _ROLE_LABELS[role])
                pending_counts[key] = pending_counts.get(key, 0) + 1
    role_approvers = {
        role: db.query(User).filter(User.is_active == True, getattr(User, flag) == True).all()  # noqa: E712
        for role, flag in _PO_ROLE_FLAGS.items()
    }
    for pr in pending_pos:
        for role in pr.pending_po_approval_roles:
            for approver in role_approvers[role]:
                key = (approver.id, _PO_ROLE_LABELS[role])
                pending_counts[key] = pending_counts.get(key, 0) + 1
    user_ids = {uid for uid, _ in pending_counts}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    approver_pending = [
        P2PMisApproverPending(
            approver_id=uid, approver_name=(users[uid].name or users[uid].email) if uid in users else f"User #{uid}",
            role=role, pending_count=count,
        )
        for (uid, role), count in sorted(pending_counts.items(), key=lambda kv: -kv[1])
    ]

    return {
        "start": start, "end": end, "prs": prs,
        "kpis": kpis, "trend": trend, "category_breakdown": category_breakdown, "approver_pending": approver_pending,
    }


@router.get("/summary", response_model=P2PMisSummaryResponse)
async def get_mis_summary(
    period: str = Query("weekly"),
    date_param: date | None = Query(None, alias="date", description="Reference date within the period; defaults to today"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    category_code: str | None = Query(None),
    department: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(_require_mis_access),
):
    data = _gather(db, period, date_param or date.today(), date_from, date_to, category_code, department)
    return P2PMisSummaryResponse(
        period=period, date_from=data["start"].isoformat(), date_to=data["end"].isoformat(),
        kpis=data["kpis"], trend=data["trend"], category_breakdown=data["category_breakdown"],
        approver_pending=data["approver_pending"],
    )


def _argb(hex6: str) -> str:
    """openpyxl.styles colors (Font/PatternFill/Side) take 8-digit ARGB —
    handing them a bare 6-digit RGB string silently gets '00' (fully
    transparent) alpha prepended instead of erroring, so every fill/font-
    color/border ends up invisible in Excel despite being "set" correctly
    at the Python level. Always go through this helper for those three;
    chart series `graphicalProperties.solidFill` and drawing srgbClr are a
    different (alpha-less) color type and take the bare 6-digit hex as-is."""
    return f"FF{hex6}"


# Premnathrail brand orange (matches the email templates in utils/email.py)
# and the dark title bar used across the app's internal-notification emails —
# reused here so the workbook reads as the same product, not a bare data dump.
_BRAND = "FF7A45"
_INK = "0F172A"
_MUTED = "64748B"
_ZEBRA = "F8FAFC"
_GRID = "E2E8F0"

_TITLE_FILL = PatternFill(start_color=_argb(_INK), end_color=_argb(_INK), fill_type="solid")
_TITLE_FONT = Font(color=_argb("FFFFFF"), bold=True, size=16)
_SUBTITLE_FONT = Font(color=_argb("CBD5E1"), size=10.5)
_HEADER_FILL = PatternFill(start_color=_argb(_BRAND), end_color=_argb(_BRAND), fill_type="solid")
_HEADER_FONT = Font(color=_argb("FFFFFF"), bold=True, size=11)
_BODY_FONT = Font(size=10.5, color=_argb("1E293B"))
_ZEBRA_FILL = PatternFill(start_color=_argb(_ZEBRA), end_color=_argb(_ZEBRA), fill_type="solid")
_THIN = Side(style="thin", color=_argb(_GRID))
_CELL_BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)

_STATUS_COLORS = {
    "submitted": "2563EB", "approved": "16A34A", "po_raised": "F59E0B", "po_approved": "16A34A",
    "partially_received": "F59E0B", "received": "16A34A", "closed": "64748B",
    "rejected": "DC2626", "cancelled": "64748B",
}
_PRIORITY_COLORS = {"High": "DC2626", "Medium": "F59E0B", "Low": "16A34A"}
# Same categorical palette used by the frontend's Chart.js reports pages —
# kept in lockstep so a chart looks the same whether viewed in-app or in Excel.
# Bare 6-digit hex is correct here — chart series fills are a different color
# type (srgbClr) that has no alpha channel, unlike the cell styles above.
_CHART_PALETTE = ["2A78D6", "EB6834", "1BAF7A", "EDA100", "E87BA4", "008300", "4A3AA7", "E34948"]


def _badge_fill(value: str, color_map: dict[str, str]) -> PatternFill:
    hex_color = _argb(color_map.get(value, _MUTED))
    return PatternFill(start_color=hex_color, end_color=hex_color, fill_type="solid")


def _title_block(ws, title: str, subtitle: str, n_cols: int) -> None:
    """A branded title band (dark bar + orange accent underline) across the
    top of every sheet, matching the dark-header/orange-accent look of the
    PR/PO approval emails — so the workbook reads as the same product
    rather than a bare data dump."""
    last_col = get_column_letter(max(n_cols, 1))
    ws.merge_cells(f"A1:{last_col}1")
    cell = ws["A1"]
    cell.value = title
    cell.font = _TITLE_FONT
    cell.fill = _TITLE_FILL
    cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[1].height = 28

    ws.merge_cells(f"A2:{last_col}2")
    sub = ws["A2"]
    sub.value = subtitle
    sub.font = _SUBTITLE_FONT
    sub.fill = _TITLE_FILL
    sub.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[2].height = 18

    for col in range(1, n_cols + 1):
        c = ws.cell(row=3, column=col)
        c.fill = PatternFill(start_color=_argb(_BRAND), end_color=_argb(_BRAND), fill_type="solid")
    ws.row_dimensions[3].height = 4


def _write_sheet(
    wb: Workbook, sheet_title: str, subtitle: str, headers: list[str], rows: list[list],
    first: bool = False, badge_cols: dict[str, dict[str, str]] | None = None,
):
    """Writes a branded, filterable table. Returns (ws, header_row, n_cols,
    n_rows) so callers can attach a native chart referencing this same data
    without re-deriving cell coordinates."""
    ws = wb.active if first else wb.create_sheet(sheet_title)
    if first:
        ws.title = sheet_title
    ws.sheet_view.showGridLines = False
    n_cols = len(headers)
    _title_block(ws, "Premnathrail — P2P MIS Report", subtitle, n_cols)

    header_row = 4
    for i, h in enumerate(headers, start=1):
        cell = ws.cell(row=header_row, column=i, value=h)
        cell.fill = _HEADER_FILL
        cell.font = _HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = _CELL_BORDER
    ws.row_dimensions[header_row].height = 20

    badge_idx = {headers.index(h): cmap for h, cmap in (badge_cols or {}).items() if h in headers}
    for r_offset, row in enumerate(rows):
        r_idx = header_row + 1 + r_offset
        for c_idx, val in enumerate(row, start=1):
            cell = ws.cell(row=r_idx, column=c_idx, value=val)
            cell.font = _BODY_FONT
            cell.border = _CELL_BORDER
            cell.alignment = Alignment(horizontal="right" if isinstance(val, (int, float)) else "left", vertical="center")
            if r_offset % 2 == 1:
                cell.fill = _ZEBRA_FILL
        for idx, cmap in badge_idx.items():
            badge_cell = ws.cell(row=r_idx, column=idx + 1)
            badge_cell.font = Font(color=_argb("FFFFFF"), bold=True, size=10)
            badge_cell.fill = _badge_fill(str(row[idx]), cmap)
            badge_cell.alignment = Alignment(horizontal="center", vertical="center")

    for i, header in enumerate(headers, start=1):
        col = get_column_letter(i)
        max_len = max([len(str(header))] + [len(str(r[i - 1])) if r[i - 1] is not None else 0 for r in rows])
        ws.column_dimensions[col].width = min(max(max_len + 3, 12), 40)

    ws.freeze_panes = f"A{header_row + 1}"
    if rows:
        ws.auto_filter.ref = f"A{header_row}:{get_column_letter(n_cols)}{header_row + len(rows)}"

    return ws, header_row, n_cols, len(rows)


def _style_chart(chart, title: str, colors: list[str] | None = None) -> None:
    chart.title = title
    chart.style = 10
    chart.height = 9
    chart.width = 18
    if colors:
        for i, series in enumerate(chart.series):
            series.graphicalProperties.solidFill = colors[i % len(colors)]


def _add_data_bars(ws, col_letter: str, first_row: int, last_row: int) -> None:
    if last_row < first_row:
        return
    ws.conditional_formatting.add(
        f"{col_letter}{first_row}:{col_letter}{last_row}",
        DataBarRule(start_type="min", end_type="max", color=_argb(_BRAND)),
    )


def _write_kpi_sheet(wb: Workbook, subtitle: str, kpi_rows: list[tuple[str, int]]) -> None:
    """The landing sheet — a two-column KPI scorecard (label + big orange
    number) plus a native bar chart of the same numbers, so opening the
    workbook reads like a dashboard, not a spreadsheet dump."""
    ws = wb.active
    ws.title = "Summary"
    ws.sheet_view.showGridLines = False
    _title_block(ws, "Premnathrail — P2P MIS Report", subtitle, 4)

    row = 5
    for i, (label, value) in enumerate(kpi_rows):
        r = row + (i // 2) * 3
        c = 1 if i % 2 == 0 else 3
        label_cell = ws.cell(row=r, column=c, value=label)
        label_cell.font = Font(size=10, color=_argb(_MUTED), bold=True)
        label_cell.alignment = Alignment(horizontal="left", vertical="center")
        ws.merge_cells(start_row=r, start_column=c, end_row=r, end_column=c + 1)

        value_cell = ws.cell(row=r + 1, column=c, value=value)
        value_cell.font = Font(size=22, color=_argb(_BRAND), bold=True)
        value_cell.alignment = Alignment(horizontal="left", vertical="center")
        ws.merge_cells(start_row=r + 1, start_column=c, end_row=r + 1, end_column=c + 1)

        for cc in (c, c + 1):
            for rr in (r, r + 1):
                ws.cell(row=rr, column=cc).fill = PatternFill(start_color=_argb(_ZEBRA), end_color=_argb(_ZEBRA), fill_type="solid")
                ws.cell(row=rr, column=cc).border = _CELL_BORDER

    for col in ("A", "B", "C", "D"):
        ws.column_dimensions[col].width = 26

    # A small data table backs the chart below — kept on-sheet (not a hidden
    # helper range) so the underlying numbers are visible/auditable too.
    chart_data_row = row + ((len(kpi_rows) + 1) // 2) * 3 + 2
    ws.cell(row=chart_data_row, column=1, value="Metric").font = _HEADER_FONT
    ws.cell(row=chart_data_row, column=1).fill = _HEADER_FILL
    ws.cell(row=chart_data_row, column=2, value="Count").font = _HEADER_FONT
    ws.cell(row=chart_data_row, column=2).fill = _HEADER_FILL
    for i, (label, value) in enumerate(kpi_rows):
        ws.cell(row=chart_data_row + 1 + i, column=1, value=label)
        ws.cell(row=chart_data_row + 1 + i, column=2, value=value)

    chart = BarChart()
    chart.type = "col"
    data_ref = Reference(ws, min_col=2, min_row=chart_data_row, max_row=chart_data_row + len(kpi_rows))
    cat_ref = Reference(ws, min_col=1, min_row=chart_data_row + 1, max_row=chart_data_row + len(kpi_rows))
    chart.add_data(data_ref, titles_from_data=True)
    chart.set_categories(cat_ref)
    chart.legend = None
    _style_chart(chart, "This Period at a Glance", colors=[_BRAND])
    ws.add_chart(chart, f"F{row}")


@router.get("/export")
async def export_mis_report(
    period: str = Query("weekly"),
    date_param: date | None = Query(None, alias="date", description="Reference date within the period; defaults to today"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    category_code: str | None = Query(None),
    department: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(_require_mis_access),
):
    data = _gather(db, period, date_param or date.today(), date_from, date_to, category_code, department)
    start, end, prs = data["start"], data["end"], data["prs"]

    requester_ids = {pr.requested_by_id for pr in prs} - {None}
    requesters = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(requester_ids)).all()} if requester_ids else {}

    subtitle = f"{period.title()} report — {start.strftime('%d %b %Y')} to {end.strftime('%d %b %Y')} — generated {datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}"

    wb = Workbook()
    k = data["kpis"]
    _write_kpi_sheet(wb, subtitle, [
        ("PRs Created", k.prs_created), ("PRs Approved", k.prs_approved),
        ("PRs Rejected", k.prs_rejected), ("PRs Pending Approval", k.prs_pending_approval),
        ("POs Raised", k.pos_raised), ("POs Approved", k.pos_approved),
        ("PO Pending Approval", k.pos_pending_approval),
    ])

    def _fmt(d) -> str:
        if not d:
            return ""
        return d.strftime("%d-%m-%Y") if isinstance(d, date) else d.strftime("%d-%m-%Y %H:%M")

    pr_rows = [
        [
            pr.p2p_number, _fmt(pr.request_date), pr.department or "—", P2P_CATEGORIES.get(pr.category_code, pr.category_code),
            requesters.get(pr.requested_by_id, "—"), (pr.priority or "medium").title(), pr.status,
            _fmt(pr.department_head_approved_at), _fmt(pr.project_head_approved_at), _fmt(pr.plant_head_approved_at),
        ]
        for pr in prs if _in_range(pr.created_at, start, end)
    ]
    _write_sheet(wb, "PR Details", subtitle, [
        "PR Number", "Request Date", "Department", "Category", "Requested By", "Priority", "Status",
        "Dept Head Approved", "Project Head Approved", "Plant Head Approved",
    ], pr_rows, badge_cols={"Status": _STATUS_COLORS, "Priority": _PRIORITY_COLORS})

    po_rows = [
        [
            pr.po_number, pr.p2p_number, pr.selected_vendor or "—", _fmt(pr.po_date), _fmt(pr.expected_delivery),
            _fmt(pr.purchase_head_approved_at), _fmt(pr.director_approved_at), _fmt(pr.md_approved_at), pr.status,
        ]
        for pr in prs if pr.po_number and _in_range(pr.po_date, start, end)
    ]
    _write_sheet(wb, "PO Approval Details", subtitle, [
        "PO Number", "Against PR", "Vendor", "PO Date", "Expected Delivery",
        "Purchase Head Approved", "Director Approved", "MD Approved", "Status",
    ], po_rows, badge_cols={"Status": _STATUS_COLORS})

    # Trend — a table + native line chart of Created/Approved/PO Raised across
    # every bucket in the period (daily buckets, or monthly for a yearly report).
    trend_rows = [[t.date, t.created, t.approved, t.po_raised] for t in data["trend"]]
    trend_ws, trend_header_row, _, trend_n_rows = _write_sheet(
        wb, "Trend", subtitle, ["Date", "Created", "Approved", "PO Raised"], trend_rows,
    )
    if trend_n_rows:
        chart = LineChart()
        chart.smooth = False
        data_ref = Reference(trend_ws, min_col=2, max_col=4, min_row=trend_header_row, max_row=trend_header_row + trend_n_rows)
        cat_ref = Reference(trend_ws, min_col=1, min_row=trend_header_row + 1, max_row=trend_header_row + trend_n_rows)
        chart.add_data(data_ref, titles_from_data=True)
        chart.set_categories(cat_ref)
        _style_chart(chart, "Created vs Approved vs PO Raised", colors=_CHART_PALETTE)
        for series in chart.series:
            series.marker.symbol = "circle"
            series.smooth = False
        trend_ws.add_chart(chart, f"A{trend_header_row + trend_n_rows + 3}")

    # Category Breakdown — table + bar chart of PRs created per category.
    cat_ws, cat_header_row, _, cat_n_rows = _write_sheet(
        wb, "Category Breakdown", subtitle, ["Category", "PRs Created"],
        [[c.label, c.count] for c in data["category_breakdown"]],
    )
    if cat_n_rows:
        _add_data_bars(cat_ws, "B", cat_header_row + 1, cat_header_row + cat_n_rows)
        chart = BarChart()
        chart.type = "bar"  # horizontal — reads better with longer category labels
        data_ref = Reference(cat_ws, min_col=2, min_row=cat_header_row, max_row=cat_header_row + cat_n_rows)
        cat_ref = Reference(cat_ws, min_col=1, min_row=cat_header_row + 1, max_row=cat_header_row + cat_n_rows)
        chart.add_data(data_ref, titles_from_data=True)
        chart.set_categories(cat_ref)
        chart.legend = None
        _style_chart(chart, "PRs Created by Category", colors=_CHART_PALETTE)
        cat_ws.add_chart(chart, f"D{cat_header_row}")

    # Approver Pending — table + bar chart of who's sitting on the most approvals.
    app_ws, app_header_row, _, app_n_rows = _write_sheet(
        wb, "Approver Pending", subtitle, ["Approver", "Role", "Pending Count"],
        [[a.approver_name, a.role, a.pending_count] for a in data["approver_pending"]],
    )
    if app_n_rows:
        _add_data_bars(app_ws, "C", app_header_row + 1, app_header_row + app_n_rows)
        chart = BarChart()
        chart.type = "bar"
        data_ref = Reference(app_ws, min_col=3, min_row=app_header_row, max_row=app_header_row + app_n_rows)
        cat_ref = Reference(app_ws, min_col=1, min_row=app_header_row + 1, max_row=app_header_row + app_n_rows)
        chart.add_data(data_ref, titles_from_data=True)
        chart.set_categories(cat_ref)
        chart.legend = None
        _style_chart(chart, "Pending Approvals by Approver", colors=[_STATUS_COLORS["po_raised"]])
        app_ws.add_chart(chart, f"E{app_header_row}")

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"P2P_MIS_{period}_{start.isoformat()}_to_{end.isoformat()}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
