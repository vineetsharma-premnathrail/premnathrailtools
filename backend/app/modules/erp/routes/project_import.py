"""Bulk import / Excel export for Machines (the Projects asset register).

Duplicate rule (2026-10-07): the serial number IS the machine. A row whose
serial matches a machine that already exists — live or in the Recycle Bin,
compared ignoring case and spaces — or an earlier row of the same file is NOT
saved; it comes back in `existing` with the machine it matched. A new serial
whose engine or chassis number already belongs to another machine is a
conflict (one physical machine can't carry two serials), so it comes back in
`errors` naming that machine. Everything else is validated with the same
ProjectCreate schema the New Machine form uses."""
from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.permissions import ensure_tab_action, require_app_access, require_tab_action
from app.core.data_scope import apply_scope
from app.db.session import get_db
from app.modules.erp.importing import (
    check_rows, csv_template, enum_label, norm_key, parse_bool, parse_choice, parse_date, read_rows,
    text, validation_reason, xlsx_response, check_date_range, in_range, ist_date, parse_export_ids,
)
from app.modules.erp.models.project import Project
from app.modules.erp.routes.projects import _natural_sort_key, _write_audit
from app.modules.erp.schemas.project import PROJECT_STATUSES, ProjectCreate
from app.modules.main.models.user import User
from app.utils.notifications import notify_user

# Registered before the projects router so /export isn't read as /{project_id}.
router = APIRouter(prefix="/erp/projects", tags=["ERP - Projects"])

# (column key, Excel title) — the title normalises back to the key, so an
# exported sheet imports as-is.
COLUMNS: list[tuple[str, str]] = [
    ("serial_number", "Serial Number"), ("machine_type", "Machine Type"), ("model_name", "Model Name"),
    ("engine_number", "Engine Number"), ("chassis_number", "Chassis Number"), ("application_type", "Application Type"),
    ("status", "Status"), ("year_of_manufacture", "Year of Manufacture"), ("software_version", "Software Version"),
    ("po_number", "PO Number"), ("po_date", "PO Date"), ("delivery_date", "Delivery Date"),
    ("commissioning_date", "Commissioning Date"), ("handover_date", "Handover Date"),
    ("client_company", "Client Company"), ("client_name", "Client Name"), ("client_designation", "Client Designation"),
    ("client_email", "Client Email"), ("client_phone", "Client Phone"), ("client_phone_alt", "Client Phone Alt"),
    ("client_address", "Client Address"), ("client_gst", "Client GST"),
    ("site_name", "Site Name"), ("site_location", "Site Location"), ("site_state", "Site State"),
    ("site_pincode", "Site Pincode"), ("site_country", "Site Country"), ("zone", "Zone"), ("is_export", "Is Export"),
    ("warranty_start_date", "Warranty Start Date"), ("warranty_end_date", "Warranty End Date"),
    ("warranty_override", "Warranty Override"), ("extended_warranty", "Extended Warranty"),
    ("extended_warranty_end", "Extended Warranty End"), ("amc_status", "AMC Status"), ("amc_end_date", "AMC End Date"),
    ("operator_name", "Operator Name"), ("operator_phone", "Operator Phone"), ("operator_email", "Operator Email"),
    ("operator_qualification", "Operator Qualification"),
    ("specifications", "Specifications"), ("installed_options", "Installed Options"),
    ("notes", "Notes"), ("tech_notes", "Tech Notes"), ("warranty_terms", "Warranty Terms"),
]
LABELS = dict(COLUMNS)
DATE_FIELDS = {"po_date", "delivery_date", "commissioning_date", "handover_date", "warranty_start_date",
               "warranty_end_date", "extended_warranty_end", "amc_end_date"}
BOOL_FIELDS = {"is_export", "extended_warranty"}
STATUS_CHOICES = {s: enum_label(s) for s in PROJECT_STATUSES}
AMC_CHOICES = {"Active": "Active AMC", "Expired": "Expired Contract"}


def _require_create(user: User) -> None:
    # Importing registers new machines, so it needs Create as well as Import.
    ensure_tab_action(user, "erp", "projects", "create")


def _machine_label(p: Project) -> str:
    bits = [p.model_name, p.client_company]
    extra = " · ".join(b for b in bits if b)
    return f"{p.serial_number}{f' ({extra})' if extra else ''}{' — in Recycle Bin' if p.is_deleted else ''}"


def _row_payload(r: dict) -> dict:
    """File row → ProjectCreate kwargs. Raises ValueError with the column's reason."""
    data: dict = {}
    for key, label in COLUMNS:
        if key in DATE_FIELDS:
            data[key] = parse_date(r, key, label)
        elif key in BOOL_FIELDS:
            data[key] = parse_bool(r, key, label)
        elif key == "status":
            data[key] = parse_choice(r, key, label, STATUS_CHOICES, default="active")
        elif key == "amc_status":
            data[key] = parse_choice(r, key, label, AMC_CHOICES)
        else:
            data[key] = text(r, key)
    data["site_country"] = data["site_country"] or "India"
    return data


@router.get("/import/template")
async def import_template(
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_tab_action("erp", "projects", "import")),
):
    keys = [k for k, _ in COLUMNS]
    sample = {"serial_number": "PRT-RRV-0101", "machine_type": "Rail Road Vehicle", "model_name": "RRV 4x4",
              "engine_number": "ENG-55821", "chassis_number": "CH-99012", "application_type": "Track Maintenance",
              "status": "Active", "year_of_manufacture": "2025-26", "po_number": "PO/NR/2025/118", "po_date": "12-05-2025",
              "delivery_date": "20-09-2025", "client_company": "Northern Railway", "client_name": "R. K. Verma",
              "client_email": "rk.verma@example.com", "client_phone": "9876543210", "site_name": "Ghaziabad Depot",
              "site_state": "Uttar Pradesh", "site_country": "India", "is_export": "No",
              "warranty_start_date": "20-09-2025", "warranty_end_date": "19-09-2026", "extended_warranty": "No"}
    return csv_template(COLUMNS, [[sample.get(k, "") for k in keys]], "machines_import_template.csv")


@router.post("/import")
async def import_projects(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_tab_action("erp", "projects", "import")),
):
    _require_create(user)
    rows = read_rows(file.filename, await file.read())
    check_rows(rows, ["serial_number"])

    # Identity lookups over every machine, Recycle Bin included — a serial
    # parked there still belongs to that machine (restore it, don't re-add).
    machines = db.query(Project).all()
    by_serial = {norm_key(p.serial_number): p for p in machines}
    by_engine = {norm_key(p.engine_number): p for p in machines if p.engine_number}
    by_chassis = {norm_key(p.chassis_number): p for p in machines if p.chassis_number}

    created, existing, errors = [], [], []
    seen_serial: dict[str, int] = {}
    seen_engine: dict[str, tuple[int, str]] = {}
    seen_chassis: dict[str, tuple[int, str]] = {}

    for idx, r in enumerate(rows, start=2):  # row 1 is the header
        if not any(str(v).strip() for v in r.values()):
            continue
        serial = text(r, "serial_number") or ""
        if not serial:
            errors.append({"row": idx, "key": "", "reason": "Serial Number is empty — every machine needs its serial number."})
            continue
        skey = norm_key(serial)

        # Duplicate → not saved, reported next to the machine it matched.
        match = by_serial.get(skey)
        if match:
            existing.append({"row": idx, "key": serial, "existing_ref": match.serial_number, "existing_label": _machine_label(match),
                             "reason": "Serial number already registered" + (" — restore it from the Recycle Bin instead of importing" if match.is_deleted else "")})
            continue
        if skey in seen_serial:
            existing.append({"row": idx, "key": serial, "existing_ref": None, "existing_label": serial,
                             "reason": f"Repeats row {seen_serial[skey]} of this file"})
            continue

        try:
            data = _row_payload(r)
        except ValueError as exc:
            errors.append({"row": idx, "key": serial, "reason": str(exc)})
            continue

        # Same engine / chassis under a different serial = identity conflict.
        conflict = None
        for field, label, db_map, file_map in (("engine_number", "Engine number", by_engine, seen_engine),
                                               ("chassis_number", "Chassis number", by_chassis, seen_chassis)):
            val = data.get(field)
            if not val:
                continue
            k = norm_key(val)
            if k in db_map:
                conflict = (f"{label} {val} already belongs to machine {_machine_label(db_map[k])} — one machine can't have two serial numbers. "
                            f"Correct the {label.lower()} or the serial in the file.")
                break
            if k in file_map:
                conflict = f"{label} {val} is also on row {file_map[k][0]} (serial {file_map[k][1]}) of this file — each machine's {label.lower()} must be unique."
                break
        if conflict:
            errors.append({"row": idx, "key": serial, "reason": conflict})
            continue

        try:
            payload = ProjectCreate(**data)
        except ValidationError as exc:
            errors.append({"row": idx, "key": serial, "reason": validation_reason(exc, LABELS)})
            continue

        project = Project(**payload.model_dump())
        db.add(project)
        db.flush()
        _write_audit(db, project.id, "created", user, summary=f"Machine {project.serial_number} imported from {file.filename} by {user.name or user.email}.")
        seen_serial[skey] = idx
        if project.engine_number:
            seen_engine[norm_key(project.engine_number)] = (idx, serial)
        if project.chassis_number:
            seen_chassis[norm_key(project.chassis_number)] = (idx, serial)
        created.append({"row": idx, "id": project.id, "ref": project.serial_number,
                        "name": project.model_name or project.machine_type or "", "detail": project.client_company or ""})

    if created:
        notify_user(
            db, user_id=user.id, title="Machine Import Finished",
            message=f"{len(created)} machine(s) imported from {file.filename}; {len(existing)} already existed and {len(errors)} had problems (not saved).",
            notification_type="erp_import_result", entity_type="project",
        )
    db.commit()
    return {"created": created, "existing": existing, "errors": errors}


# Which machine date a From–To export filters on.
EXPORT_DATE_FIELDS = {"registered": "Registered on", "dispatch": "Dispatch date", "commissioning": "Commissioning date"}


@router.get("/export")
async def export_projects(
    search: str | None = Query(None),
    status: str | None = Query(None),
    application_type: str | None = Query(None),
    client_company: str | None = Query(None),
    customer_id: int | None = Query(None),
    ids: str | None = Query(None, description="Comma-separated machine ids — export only these (other filters ignored)."),
    date_field: str = Query("dispatch"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_tab_action("erp", "projects", "export")),
):
    """Excel of the asset register with the same filters as the list page.
    Columns match the import template, so the sheet can be edited and
    re-imported (existing serials are skipped, never overwritten).

    `ids` exports exactly the ticked machines. Otherwise the list filters
    apply, plus an optional From–To range on `date_field` (both ends
    inclusive, days in IST)."""
    selected = parse_export_ids(ids, "machines")
    if date_field not in EXPORT_DATE_FIELDS:
        raise HTTPException(status_code=422, detail=f"Unknown date '{date_field}' — choose one of: {', '.join(EXPORT_DATE_FIELDS.values())}.")
    check_date_range(date_from, date_to)
    query = apply_scope(db.query(Project).filter(Project.is_deleted == False), _user, Project)  # noqa: E712
    if selected is not None:
        projects = sorted(query.filter(Project.id.in_(selected)).all(), key=lambda p: _natural_sort_key(p.serial_number))
        if not projects:
            raise HTTPException(status_code=404, detail="None of the selected machines exist any more — they may have been deleted. Refresh the list.")
        return _machines_xlsx(projects)
    if status:
        query = query.filter(Project.status == status)
    if application_type:
        query = query.filter(Project.application_type == application_type)
    if client_company:
        query = query.filter(Project.client_company == client_company)
    if customer_id:
        query = query.filter(Project.customer_id == customer_id)
    if search:
        like = f"%{search}%"
        query = query.filter(Project.serial_number.ilike(like) | Project.model_name.ilike(like) | Project.client_company.ilike(like))
    projects = sorted(query.all(), key=lambda p: _natural_sort_key(p.serial_number))
    if date_from or date_to:
        pick = {
            "registered": lambda p: ist_date(p.created_at),
            "dispatch": lambda p: p.delivery_date,
            "commissioning": lambda p: p.commissioning_date,
        }[date_field]
        projects = [p for p in projects if in_range(pick(p), date_from, date_to)]
    return _machines_xlsx(projects)


def _machines_xlsx(projects: list[Project]):
    def cell(p: Project, key: str):
        v = getattr(p, key)
        if key in BOOL_FIELDS:
            return "Yes" if v else "No"
        if key == "status":
            return STATUS_CHOICES.get(v or "", v or "")
        return "" if v is None else v

    rows = [[cell(p, k) for k, _ in COLUMNS] for p in projects]
    return xlsx_response("Machines", [t for _, t in COLUMNS], rows, "machines.xlsx")
