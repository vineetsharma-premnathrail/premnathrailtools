"""Upload purchase orders already made and approved in Tally (2026-10-27).

Purchase > Purchase Orders > Create PO > "Upload Tally POs". One Excel/CSV row
per PO line; rows with the same Tally PO number form one PO. Each PO gets a new
portal number (PO-YYYY-NNNN); the Tally number is kept as external_ref and can
be uploaded only once. The PO comes in as issued and released (no requisition,
no portal approval — it was approved in Tally), so the store can receive it and
it shows in Tracking at once (po_split.EXTERNAL_PO_SOURCES).

Matching is by code only, never by name: the vendor by its vendor-master code
or GSTIN, each line's item by its Item Master code or its Tally / legacy code.
/preview checks the file and returns the POs it would make with every problem;
/commit re-checks and saves all POs or none."""
import csv
import io
import math
import zipfile
from urllib.parse import quote
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.data_scope import ensure_in_scope
from app.core.permissions import ensure_feature_action, ensure_tab_action, require_app_access
from app.db.session import get_db
import app.modules.p2p.access  # noqa: F401 — registers the Procurement data scopes
from app.modules.accounts.models.vendor import Vendor
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.p2p.item_link import item_category_for
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.service import compute_line_total, generate_po_number
from app.modules.store.models.item import StoreItem
from app.utils.sharepoint import build_sharepoint_folder_path, download_file_content, upload_file_to_sharepoint

router = APIRouter(prefix="/p2p/tally-po-import", tags=["P2P Purchase Orders"])

SOURCE = "tally"
MAX_ROWS = 2000
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_UNZIPPED_BYTES = 50 * 1024 * 1024  # an .xlsx is a zip — cap what it inflates to
MAX_PDF_BYTES = 15 * 1024 * 1024

COLUMNS = ["tally_po_no", "po_date", "vendor", "expected_delivery", "item_code", "quantity", "unit", "unit_price", "gst_rate"]
# Header spellings accepted for each column (after lower-casing and turning
# spaces / dots / dashes into "_") — the template's, and Tally export titles.
_ALIASES = {
    "tally_po_no": ("tally_po_no", "po_no", "po_number", "voucher_no", "order_no", "tally_po_number"),
    "po_date": ("po_date", "date", "voucher_date", "order_date"),
    "vendor": ("vendor", "vendor_code", "party_code", "gstin", "vendor_gstin", "party_gstin", "gstin_uin"),
    "expected_delivery": ("expected_delivery", "due_date", "due_on", "delivery_date"),
    "item_code": ("item_code", "stock_item_code", "tally_item_code", "legacy_code"),
    "quantity": ("quantity", "qty", "billed_qty", "ordered_qty"),
    "unit": ("unit", "uom", "units"),
    "unit_price": ("unit_price", "rate", "price"),
    "gst_rate": ("gst_rate", "gst", "gst_%", "gst_percent", "tax_rate", "igst_rate"),
}
_DATE_FORMATS = ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%b-%Y", "%d-%b-%y", "%d.%m.%Y", "%d-%m-%y", "%d/%m/%y")


def _import_user(action: str = "create"):
    """Purchase team + Purchase Orders tab + the 'Upload Tally POs' feature."""
    purchase_dep = require_app_access("purchase")

    def _dependency(user: User = Depends(purchase_dep)) -> User:
        ensure_tab_action(user, "p2p", "purchase_orders", "view")
        ensure_feature_action(user, "p2p", "purchase_orders", "tally_import", action)
        return user

    return _dependency


def _key(header) -> str:
    k = str(header or "").strip().lower()
    for ch in " .-/#()":
        k = k.replace(ch, "_")
    while "__" in k:
        k = k.replace("__", "_")
    return k.strip("_")


def _read_rows(filename: str, raw: bytes) -> list[dict]:
    """Rows as {column: raw value}, columns mapped through _ALIASES. Excel
    cells keep their type (dates stay dates)."""
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        try:
            inflated = sum(i.file_size for i in zipfile.ZipFile(io.BytesIO(raw)).infolist())
        except zipfile.BadZipFile:
            raise HTTPException(status_code=422, detail="Could not open the Excel file — save it as .xlsx (or CSV) and upload again.")
        if inflated > MAX_UNZIPPED_BYTES:
            raise HTTPException(status_code=413, detail=f"The Excel file is too large once opened — upload at most {MAX_ROWS} lines at a time by splitting it.")
        try:
            ws = load_workbook(io.BytesIO(raw), read_only=True, data_only=True).active
            table = []
            for r in ws.iter_rows(values_only=True):
                table.append(list(r))
                if len(table) > MAX_ROWS + 1:
                    break
        except Exception:
            raise HTTPException(status_code=422, detail="Could not open the Excel file — save it as .xlsx (or CSV) and upload again.")
    elif name.endswith(".csv"):
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(status_code=422, detail="Could not read the CSV as UTF-8 text — in Excel use Save As › CSV UTF-8 and upload again.")
        table = []
        for r in csv.reader(io.StringIO(text)):
            table.append(r)
            if len(table) > MAX_ROWS + 1:
                break
    else:
        raise HTTPException(status_code=422, detail="Upload a .xlsx or .csv file — download the template to start from the right columns.")
    if not table:
        return []
    lookup = {alias: col for col, names in _ALIASES.items() for alias in names}
    headers = [lookup.get(_key(h)) for h in table[0]]
    missing = [c for c in ("tally_po_no", "po_date", "vendor", "item_code", "quantity", "unit_price") if c not in headers]
    if missing:
        raise HTTPException(status_code=422, detail=(
            f"The file is missing the column(s) {', '.join(missing)}. Keep the template's header row "
            f"(columns: {', '.join(COLUMNS)}) — download the template if unsure."))
    rows = []
    for values in table[1:]:
        row = {}
        for i, col in enumerate(headers):
            if col and i < len(values) and col not in row:
                v = values[i]
                row[col] = v.strip() if isinstance(v, str) else v
        if any(v not in (None, "") for v in row.values()):
            rows.append(row)
    return rows


def _text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def _number(v, label: str) -> float | None:
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        n = float(v)
    else:
        try:
            n = float(str(v).replace(",", "").replace("%", "").replace("₹", "").strip())
        except ValueError:
            raise ValueError(f"{label} '{v}' isn't a number — enter digits only, e.g. 1250.50.") from None
    if not math.isfinite(n):
        raise ValueError(f"{label} '{v}' isn't a number — enter digits only, e.g. 1250.50.")
    if n < 0:
        raise ValueError(f"{label} can't be negative (got {n:g}).")
    return n


def _date(v, label: str) -> date | None:
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, (int, float)) and 20000 < v < 80000:  # an Excel date serial
        return date(1899, 12, 30) + timedelta(days=int(v))
    s = str(v).strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"{label} '{s}' isn't a date — use DD-MM-YYYY (e.g. 15-10-2026).")


def _find_vendor(db: Session, ref: str) -> tuple[Vendor | None, str | None]:
    """Vendor by code, else by GSTIN — never by name."""
    v = db.query(Vendor).filter(func.lower(Vendor.code) == ref.lower()).first()
    if v:
        return v, None
    by_gstin = db.query(Vendor).filter(func.upper(Vendor.gstin) == ref.upper()).all()
    if len(by_gstin) == 1:
        return by_gstin[0], None
    if len(by_gstin) > 1:
        return None, (f"GSTIN '{ref}' belongs to {len(by_gstin)} vendors ({', '.join(x.code for x in by_gstin[:5])}) — "
                      "put the vendor code instead.")
    return None, (f"Vendor '{ref}' isn't in the vendor master (checked vendor code and GSTIN). Add the vendor in "
                  "Procurement › Vendors, or put its vendor code / GSTIN in the vendor column.")


def _find_item(db: Session, code: str) -> StoreItem | None:
    """Item by Item Master code, else by its Tally / legacy code — never by name."""
    c = code.lower()
    return (db.query(StoreItem)
            .filter(or_(func.lower(StoreItem.item_code) == c, func.lower(StoreItem.legacy_code) == c))
            .order_by((func.lower(StoreItem.item_code) == c).desc())
            .first())


def _check(db: Session, rows: list[dict]) -> list[dict]:
    """The POs the rows would make, in file order, each with its problems.
    Row numbers are the spreadsheet's (header = row 1)."""
    groups: dict[str, dict] = {}
    loose_errors: list[str] = []
    vendor_cache: dict[str, tuple[Vendor | None, str | None]] = {}
    item_cache: dict[str, StoreItem | None] = {}
    for idx, r in enumerate(rows, start=2):
        ref = _text(r.get("tally_po_no"))
        if not ref:
            loose_errors.append(f"Row {idx}: Tally PO no. is empty — every line needs the PO number it belongs to.")
            continue
        if len(ref) > 100:
            loose_errors.append(f"Row {idx}: Tally PO no. is longer than 100 characters — check the column.")
            continue
        g = groups.setdefault(ref.upper(), {"tally_po_no": ref, "rows": [], "lines": [], "errors": [],
                                    "po_date": None, "vendor_ref": None, "expected_delivery": None})
        g["rows"].append(idx)
        try:
            po_date = _date(r.get("po_date"), "PO date")
            due = _date(r.get("expected_delivery"), "Expected delivery")
        except ValueError as e:
            g["errors"].append(f"Row {idx}: {e}")
            continue
        vendor_ref = _text(r.get("vendor"))
        for field, val, label in (("po_date", po_date, "PO date"), ("vendor_ref", vendor_ref, "vendor"),
                                  ("expected_delivery", due, "expected delivery")):
            if val in (None, ""):
                continue
            if g[field] in (None, ""):
                g[field] = val
            elif (g[field].lower() if isinstance(val, str) else g[field]) != (val.lower() if isinstance(val, str) else val):
                g["errors"].append(f"Row {idx}: {label} '{val}' differs from '{g[field]}' on an earlier line of the same PO — one PO has one {label}.")
        code = _text(r.get("item_code"))
        if not code:
            g["errors"].append(f"Row {idx}: item code is empty — put the Item Master code or the item's Tally code.")
            continue
        if code.lower() not in item_cache:
            item_cache[code.lower()] = _find_item(db, code)
        item = item_cache[code.lower()]
        if item is None:
            g["errors"].append(f"Row {idx}: item code '{code}' isn't in the Item Master (checked item code and Tally/legacy code). "
                               "Create the item in Store › Item Master, or set its Tally code as the item's legacy code, then upload again.")
            continue
        if item.status != "active":
            g["errors"].append(f"Row {idx}: item {item.item_code} ({item.item_name}) is {item.status} in the Item Master — activate it or use another item.")
            continue
        try:
            qty = _number(r.get("quantity"), "Quantity")
            price = _number(r.get("unit_price"), "Rate")
            gst = _number(r.get("gst_rate"), "GST %")
        except ValueError as e:
            g["errors"].append(f"Row {idx}: {e}")
            continue
        if not qty:
            g["errors"].append(f"Row {idx}: quantity is empty or 0 for {item.item_code} — enter the ordered quantity.")
            continue
        if not price:
            g["errors"].append(f"Row {idx}: rate is empty or 0 for {item.item_code} — every line needs its PO rate (stock is valued at it).")
            continue
        if gst is not None and 0 < gst < 1:
            g["errors"].append(f"Row {idx}: GST % {gst:g} looks like a fraction (Excel percentage format) — enter 18 for 18%, "
                               "or format the column as a plain number.")
            continue
        if gst is not None and gst > 100:
            g["errors"].append(f"Row {idx}: GST % {gst:g} is above 100 — enter the rate as a percentage, e.g. 18.")
            continue
        unit = _text(r.get("unit"))
        if unit and item.uom and unit.lower() != item.uom.lower():
            g["errors"].append(f"Row {idx}: unit '{unit}' doesn't match {item.item_code}'s Item Master unit '{item.uom}'. "
                               f"Convert the quantity to {item.uom} (stock is kept in it), or leave the unit column blank.")
            continue
        g["lines"].append({
            "row": idx, "store_item_id": item.id, "item_code": item.item_code, "item_name": item.item_name,
            "unit": item.uom, "quantity": qty, "unit_price": price, "gst_rate": gst,
            "line_total": compute_line_total(qty, price, gst),
        })

    existing = {}
    if groups:
        for po_number, ref in db.query(P2PPurchaseOrder.po_number, P2PPurchaseOrder.external_ref).filter(
                P2PPurchaseOrder.source == SOURCE, func.upper(P2PPurchaseOrder.external_ref).in_(list(groups))).all():
            existing[ref.upper()] = po_number

    out = []
    for g in groups.values():
        rows_txt = f"Rows {g['rows'][0]}–{g['rows'][-1]}" if len(g["rows"]) > 1 else f"Row {g['rows'][0]}"
        if g["tally_po_no"].upper() in existing:
            g["errors"].insert(0, f"Tally PO {g['tally_po_no']} was already uploaded as {existing[g['tally_po_no'].upper()]} — remove its rows from the file.")
        if not g["po_date"]:
            g["errors"].append(f"{rows_txt}: PO date is empty — enter the date of the Tally PO.")
        elif g["po_date"] > date.today():
            g["errors"].append(f"{rows_txt}: PO date {g['po_date']:%d-%m-%Y} is in the future — a Tally PO already exists, so its date can't be later than today.")
        vendor = None
        if not g["vendor_ref"]:
            g["errors"].append(f"{rows_txt}: vendor is empty — put the vendor code or GSTIN from Procurement › Vendors.")
        else:
            if g["vendor_ref"].lower() not in vendor_cache:
                vendor_cache[g["vendor_ref"].lower()] = _find_vendor(db, g["vendor_ref"])
            vendor, err = vendor_cache[g["vendor_ref"].lower()]
            if err:
                g["errors"].append(f"{rows_txt}: {err}")
            elif vendor.status != "active":
                g["errors"].append(f"{rows_txt}: vendor {vendor.name} is {vendor.status} in the vendor master — set it Active in Procurement › Vendors first.")
                vendor = None
        if vendor is not None and g["lines"]:
            from app.modules.quality.services.supplier_quality import SupplierError, ensure_po_allowed
            try:
                ensure_po_allowed(db, vendor.name, [ln["store_item_id"] for ln in g["lines"]])
            except SupplierError as e:
                g["errors"].append(f"{rows_txt}: {e}")
        if not g["lines"] and not g["errors"]:
            g["errors"].append(f"{rows_txt}: no valid lines.")
        totals = [ln["line_total"] or 0 for ln in g["lines"]]
        out.append({
            "tally_po_no": g["tally_po_no"],
            "po_date": g["po_date"],
            "expected_delivery": g["expected_delivery"],
            "vendor_id": vendor.id if vendor else None,
            "vendor_code": vendor.code if vendor else None,
            "vendor_name": vendor.name if vendor else None,
            "lines": g["lines"],
            "total_value": round(sum(totals), 2),
            "errors": g["errors"],
        })
    if loose_errors:
        out.append({"tally_po_no": None, "po_date": None, "expected_delivery": None, "vendor_id": None, "vendor_code": None,
                    "vendor_name": None, "lines": [], "total_value": 0, "errors": loose_errors})
    return out


async def _load(file: UploadFile) -> list[dict]:
    raw = await file.read()
    if len(raw) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"The file is {len(raw) // 1024} KB — upload at most {MAX_FILE_BYTES // (1024 * 1024)} MB at a time by splitting it.")
    rows = await run_in_threadpool(_read_rows, file.filename or "", raw)
    if not rows:
        raise HTTPException(status_code=422, detail="The file has no data rows — fill in at least one PO line under the header row.")
    if len(rows) > MAX_ROWS:
        raise HTTPException(status_code=422, detail=f"The file has more than {MAX_ROWS} lines — upload at most {MAX_ROWS} at a time by splitting it.")
    return rows


@router.get("/template")
async def tally_po_template(_user: User = Depends(_import_user())):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    wb = Workbook()
    ws = wb.active
    ws.title = "Tally POs"
    ws.append(COLUMNS)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="FF7A45")
    ws.append(["PO/0001/26-27", "15-10-2026", "V-0001", "30-10-2026", "RM-HYD-0001", 10, "NOS", 1250.5, 18])
    ws.append(["PO/0001/26-27", "15-10-2026", "V-0001", "30-10-2026", "HWF-BLT-0012", 200, "NOS", 12.5, 18])
    for col, width in zip("ABCDEFGHI", (18, 13, 22, 17, 18, 10, 8, 11, 9)):
        ws.column_dimensions[col].width = width
    help_ws = wb.create_sheet("How to fill")
    for line in (
        ["One row per PO line. Rows with the same tally_po_no become one PO."],
        ["tally_po_no — the PO number in Tally (required). The portal gives each PO its own number and keeps this one as the Tally reference."],
        ["po_date — date of the Tally PO, DD-MM-YYYY (required, same on every line of a PO)."],
        ["vendor — vendor code or GSTIN from Procurement › Vendors (required). Names are not matched."],
        ["expected_delivery — optional, DD-MM-YYYY."],
        ["item_code — Item Master code, or the item's Tally code saved as its legacy code (required). Names are not matched."],
        ["quantity — ordered quantity in the item's Item Master unit (required)."],
        ["unit — optional; if filled it must be the item's Item Master unit."],
        ["unit_price — rate per unit before GST (required)."],
        ["gst_rate — GST % (optional), e.g. 18."],
        ["Uploaded POs count as approved (they were approved in Tally): the store can receive them at once."],
        ["Delete the two sample rows before uploading."],
    ):
        help_ws.append(line)
    help_ws.column_dimensions["A"].width = 120
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": 'attachment; filename="tally_po_upload_template.xlsx"'})


@router.post("/preview")
async def preview_tally_pos(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user: User = Depends(_import_user()),
):
    """Checks the file without saving anything."""
    pos = _check(db, await _load(file))
    bad = sum(1 for p in pos if p["errors"])
    return {"pos": pos, "ready": len(pos) - bad, "with_errors": bad, "lines": sum(len(p["lines"]) for p in pos)}


@router.post("/commit")
async def commit_tally_pos(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(_import_user()),
):
    """Re-checks the file and creates every PO, or none if any has a problem."""
    pos = _check(db, await _load(file))
    problems = [e for p in pos for e in p["errors"]]
    if problems:
        more = f" (+{len(problems) - 5} more)" if len(problems) > 5 else ""
        raise HTTPException(status_code=422, detail=(
            f"Nothing was uploaded — fix these in the file and upload again: {' | '.join(problems[:5])}{more}"))
    created = []
    try:
        for p in pos:
            po = P2PPurchaseOrder(
                po_number=generate_po_number(db),
                p2p_request_id=None,
                vendor_id=p["vendor_id"],
                vendor_name=p["vendor_name"],
                status="issued",
                po_date=p["po_date"],
                expected_delivery=p["expected_delivery"],
                created_by_id=user.id,
                total_value=p["total_value"],
                source=SOURCE,
                external_ref=p["tally_po_no"],
            )
            db.add(po)
            db.flush()
            for ln in p["lines"]:
                db.add(P2PPurchaseOrderItem(
                    purchase_order_id=po.id,
                    store_item_id=ln["store_item_id"],
                    item_name=ln["item_name"],
                    unit=ln["unit"],
                    quantity=ln["quantity"],
                    unit_price=ln["unit_price"],
                    tax_rate=ln["gst_rate"],
                    line_total=ln["line_total"],
                    item_category=item_category_for(db, ln["store_item_id"]),
                    delivery_date=p["expected_delivery"],
                ))
            db.add(AuditLog(
                entity_type="p2p_purchase_order", entity_id=po.id, action="po_uploaded_from_tally", performed_by_id=user.id,
                summary=(f"{user.name or user.email} uploaded Tally PO {p['tally_po_no']} as {po.po_number} "
                         f"({p['vendor_name']}, {len(p['lines'])} line(s), ₹{p['total_value']:,.2f}) — approved in Tally, no portal approval."),
            ))
            db.flush()
            created.append({"id": po.id, "po_number": po.po_number, "tally_po_no": p["tally_po_no"],
                            "vendor_name": p["vendor_name"], "total_value": p["total_value"], "lines": len(p["lines"])})
        _tell_partners(db, user, created)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Someone uploaded one of these Tally POs at the same moment — nothing was saved. Upload the file again; already-uploaded POs will be listed.")
    return {"created": created}


def _tell_partners(db: Session, user: User, created: list[dict]) -> None:
    """Uploaded POs skip portal approval, so every Partner hears of each batch
    (bell only) and can open the POs in Tracking."""
    if not created:
        return
    from app.utils.notifications import notify_user
    total = sum(c["total_value"] for c in created)
    nums = ", ".join(c["po_number"] for c in created[:10]) + (f" +{len(created) - 10} more" if len(created) > 10 else "")
    partner_ids = [u.id for u in db.query(User.id).filter(User.is_partner.is_(True), User.is_active.is_(True)).all()]
    for pid in partner_ids:
        if pid == user.id:
            continue
        notify_user(
            db, user_id=pid, title="Tally POs uploaded",
            message=(f"{user.name or user.email} uploaded {len(created)} PO(s) approved in Tally, worth ₹{total:,.2f} in all: {nums}. "
                     "They skipped portal approval and can be received now — check them in Purchase Orders › Tracking."),
            notification_type="p2p_tally_po_uploaded", entity_type="p2p_purchase_order", entity_id=created[0]["id"],
        )


def _tally_po_or_404(db: Session, user: User, po_id: int) -> P2PPurchaseOrder:
    po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id == po_id).first()
    if not po or po.source != SOURCE:
        raise HTTPException(status_code=404, detail="Tally PO not found — it may have been removed, or the link is wrong.")
    ensure_in_scope(db, user, po)
    return po


@router.post("/{po_id}/document")
async def upload_tally_po_document(
    po_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(_import_user()),
):
    """Attach the Tally PO print (PDF) once; it can't be replaced afterwards."""
    po = _tally_po_or_404(db, user, po_id)
    if po.document_filename:
        raise HTTPException(status_code=409, detail=f"{po.po_number} already has its Tally PO document ({po.document_filename}); it can't be replaced.")
    if (file.content_type or "").lower() != "application/pdf" or not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Attach the Tally PO as a PDF file (print it from Tally to PDF).")
    head = await file.read(MAX_PDF_BYTES + 1)
    if len(head) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail=f"The PDF is larger than {MAX_PDF_BYTES // (1024 * 1024)} MB — print it again at a lower quality.")
    if not head.startswith(b"%PDF"):
        raise HTTPException(status_code=415, detail="That file isn't a real PDF — print the Tally PO to PDF and attach that file.")
    await file.seek(0)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="Document storage (SharePoint) isn't set up on this server — ask the admin to configure it, then attach again.")
    folder_path = build_sharepoint_folder_path(user.name or user.email or "", "po", po.po_number)
    result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, file)
    po.document_filename = result["name"]
    po.document_content_type = "application/pdf"
    po.document_size = result["size"]
    po.document_sharepoint_path = result["path"]
    po.document_sharepoint_url = result.get("webUrl")
    po.document_uploaded_by_id = user.id
    po.document_uploaded_at = datetime.now(timezone.utc)
    db.add(AuditLog(entity_type="p2p_purchase_order", entity_id=po.id, action="po_document_uploaded", performed_by_id=user.id,
                    summary=f"{user.name or user.email} attached the Tally PO document to {po.po_number}."))
    db.commit()
    return {"id": po.id, "po_number": po.po_number, "document_filename": po.document_filename}


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
