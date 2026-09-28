"""One-CSV bulk import for CRM data — lets an admin add large volumes of
Organizations, Contacts, Inquiries, Products and Follow-ups in a SINGLE
upload. Handles the real shape this data comes in: one organization has
several contacts, each contact can raise several inquiries, each inquiry can
be for several products, and each inquiry gets followed up on more than
once over time. A flat CSV expresses that hierarchy through three reference
columns that rows repeat to mean "same one as before":

  - org_name — found-or-created, matched against every existing org in the
    DATABASE (not just this file), case-insensitively. The first row for a
    given name — in THIS file — that supplies org details updates it in
    place (so re-uploading the same file, or uploading a corrected one,
    refreshes the org instead of erroring or leaving it stale); every later
    row just reuses it untouched. This is how one organization ends up with
    many contacts/inquiries: every one of their rows repeats the same
    org_name.
  - contact_mobile (+ contact_name) — found-or-created WITHIN that org,
    matched against the database the same way. First-in-file-with-details
    updates it in place; later rows reuse it. Repeat the same contact_mobile
    across rows to attach several inquiries to the same contact; use a
    different contact_mobile to add another contact under the same org.
  - inquiry_ref — a free-text reference YOU make up per inquiry (e.g. an old
    ticket number, or just "1", "2", "3"), scoped to its organization and
    persisted on the inquiry (Inquiry.bulk_import_ref) specifically so a
    LATER upload — even a re-upload of the exact same file — can find this
    same inquiry again instead of creating a duplicate. The first row with
    a given ref, in THIS file, either creates the inquiry (if no inquiry
    with that (org, ref) exists yet anywhere) or UPDATES it in place (if
    one already exists from a previous upload) using whatever fields this
    row supplies. Every LATER row in this file reusing the same ref means
    "more about this same inquiry", and does one of two things depending on
    what it fills in:
      * if it fills in `product`, that product is added as an ADDITIONAL
        product line on the existing inquiry (for when one inquiry covers
        several products);
      * if it fills in any `followup_*` column, that's recorded as another
        follow-up on the existing inquiry.
    A row can do either, both, or neither. Leave inquiry_ref blank to make a
    row's inquiry always-standalone (never matched or reused by any other
    row, in this file or a future one).

Every row is processed inside its own SAVEPOINT (db.begin_nested()) so one
bad row can't abort the whole batch — valid rows commit, invalid ones are
rolled back individually (including any org/contact/inquiry field change or
product line it made earlier in the same row) and reported back with their
row number and reason."""
import csv
import io
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.core.validators import validate_email_format, validate_gst_format
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.crm.models.organization import Organization, OrgContact
from app.modules.crm.models.inquiry import Inquiry, InquiryLineItem
from app.modules.crm.models.activity import Activity
from app.modules.crm.services.org_code import generate_org_code

router = APIRouter(prefix="/crm/bulk-import", tags=["CRM"])

MAX_ERRORS_RETURNED = 300


def _require_admin(user: User) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Bulk import is restricted to admins.")


def _read_csv_rows(raw: bytes) -> list[dict]:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=422, detail="Could not read the file as UTF-8 text — save it as CSV (UTF-8) from Excel and try again.")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=422, detail="The CSV file has no header row.")
    reader.fieldnames = [(h or "").strip() for h in reader.fieldnames]
    rows = []
    for raw_row in reader:
        rows.append({(k or "").strip(): (v or "").strip() for k, v in raw_row.items() if k})
    return rows


def _get(row: dict, key: str) -> str:
    return (row.get(key) or "").strip()


def _parse_float(row: dict, key: str) -> float | None:
    v = _get(row, key)
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        raise ValueError(f"'{key}' value '{v}' is not a valid number")


def _parse_date(row: dict, key: str) -> date | None:
    v = _get(row, key)
    if not v:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"'{key}' value '{v}' is not a valid date — use YYYY-MM-DD")


# ---------------------------------------------------------------------------
# The one template
# ---------------------------------------------------------------------------

_HEADER = [
    # Organization — supplied on the first row that uses this org_name; ignored on later rows for the same org_name.
    "org_name", "org_type", "parent_org", "railway_zone", "division_workshop", "address",
    "country", "state", "city", "pin_code", "gst_number", "official_phone", "official_email", "website",
    # Contact — supplied on the first row that uses this contact_mobile (within this org); ignored after that.
    "contact_name", "contact_designation", "contact_mobile", "contact_email", "contact_department",
    # Inquiry — supplied on the first row that uses this inquiry_ref; ignored on later rows sharing the same ref.
    # Leave inquiry_ref blank to make this row's inquiry standalone (not shared with any other row).
    "inquiry_ref", "lead_source", "product", "product_category", "product_spec", "quantity",
    "required_delivery_date", "delivery_location", "requirement_desc", "priority", "budget",
    "expected_value", "expected_order_date", "bd_owner", "sales_engineer", "inquiry_division",
    # Follow-up — one is created for every single row.
    "followup_activity_type", "followup_subject", "followup_activity_date", "followup_next_followup",
    "followup_assigned_to", "followup_status", "followup_remarks", "followup_action_plan",
]

_ORG_BLANK = [""] * 14  # org_name..website — blank once the org already exists

_EXAMPLE_ROWS = [
    # Row 1: NEW org, NEW contact 1, NEW inquiry REF-1 (product #1), + follow-up #1.
    [
        "Northern Railway Headquarters", "Government", "", "Northern", "Baroda House Workshop",
        "Baroda House, New Delhi", "India", "Delhi", "New Delhi", "110001", "07AAAGN1234A1Z5",
        "011-23387100", "info@nr.railnet.gov.in", "",
        "Ramesh Kumar", "Senior Section Engineer", "9876543210", "ramesh.kumar@nr.railnet.gov.in", "Procurement",
        "OLD-CRM-1001", "Tender", "Brake Shoe Assembly", "Braking Systems", "As per RDSO spec", "500",
        "2026-12-31", "Delhi Depot", "Annual rate contract requirement", "Medium", "500000", "480000",
        "2026-11-15", "Suraj Panwar", "", "Delhi Division",
        "Call", "First discussion", "2026-09-01", "2026-09-15", "Suraj Panwar", "Open", "Introduced our product range", "",
    ],
    # Row 2: same org + same contact 1 (reused by mobile) + SAME inquiry REF-1 (reused by ref) —
    # this row's `product` becomes a SECOND product on that same inquiry. No follow-up columns
    # filled in, so no follow-up is created by this row.
    [
        *_ORG_BLANK,
        "", "", "9876543210", "", "",
        "OLD-CRM-1001", "", "Brake Shoe Bolts", "Braking Systems", "Grade 10.9", "2000",
        "", "", "", "", "", "", "", "", "", "",
        "", "", "", "", "", "", "", "",
    ],
    # Row 3: same org + same contact 1 + same inquiry REF-1 — no `product` this time, only
    # follow-up columns filled in, so this just adds a SECOND follow-up to that inquiry.
    [
        *_ORG_BLANK,
        "", "", "9876543210", "", "",
        "OLD-CRM-1001", "", "", "", "", "",
        "", "", "", "", "", "", "", "", "", "",
        "Meet at Client/Site Office", "Site visit", "2026-09-20", "2026-09-30", "Suraj Panwar", "Open", "Customer asked for a revised quote", "",
    ],
    # Row 4: same org, but a DIFFERENT contact (contact 2, new mobile) + a NEW inquiry REF-2 +
    # its first follow-up — this is how a second contact under the same organization is added.
    [
        *_ORG_BLANK,
        "Priya Sharma", "Deputy Chief Engineer", "9123456780", "priya.sharma@nr.railnet.gov.in", "Engineering",
        "OLD-CRM-1002", "Referral", "Hydraulic Buffer", "Hydraulic Systems", "As per drawing XYZ", "20",
        "2026-10-31", "Delhi Depot", "Replacement stock requirement", "High", "200000", "190000",
        "2026-10-01", "Gaurav Katiyar", "", "Delhi Division",
        "Email", "Sent catalogue", "2026-09-05", "2026-09-12", "Gaurav Katiyar", "Open", "Awaiting technical feedback", "",
    ],
    # Row 5: same org + same contact 2 + same inquiry REF-2 — a second follow-up on it.
    [
        *_ORG_BLANK,
        "", "", "9123456780", "", "",
        "OLD-CRM-1002", "", "", "", "", "",
        "", "", "", "", "", "", "", "", "", "",
        "Call", "Follow-up call", "2026-09-15", "2026-09-22", "Gaurav Katiyar", "Open", "Customer confirmed budget approval pending", "",
    ],
]


@router.get("/template")
async def download_template(_user: User = Depends(require_app_access("crm"))):
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_HEADER)
    for row in _EXAMPLE_ROWS:
        writer.writerow(row)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="crm_bulk_import_template.csv"'},
    )


# ---------------------------------------------------------------------------
# The one import
# ---------------------------------------------------------------------------

@router.post("")
async def bulk_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    _require_admin(user)
    rows = _read_csv_rows(await file.read())
    if not rows:
        raise HTTPException(status_code=422, detail="The CSV file has no data rows.")

    # In-memory lookups, built once and grown as new rows create records —
    # avoids a query per row and lets rows within THIS file reuse each
    # other's org/contact/inquiry (not just pre-existing DB rows).
    org_by_name = {o.name.strip().lower(): o for o in db.query(Organization).filter(Organization.is_deleted == False).all()}  # noqa: E712
    existing_gsts = {o.gst_number for o in org_by_name.values() if o.gst_number}
    existing_org_emails = {o.official_email.lower() for o in org_by_name.values() if o.official_email}

    contacts_by_org: dict[int, list[OrgContact]] = {}
    for c in db.query(OrgContact).all():
        contacts_by_org.setdefault(c.org_id, []).append(c)

    # Keyed by (org_id, bulk_import_ref) — pre-seeded from every inquiry any
    # PREVIOUS upload has already tagged with a ref, so this run can find and
    # update them instead of creating duplicates. Grows as this run creates
    # its own new (org, ref) pairs too.
    inquiry_by_ref: dict[tuple[int, str], Inquiry] = {
        (i.org_id, i.bulk_import_ref): i
        for i in db.query(Inquiry).filter(Inquiry.bulk_import_ref.isnot(None)).all()
    }
    # Tracks which (org_id, ref) keys THIS run has already "touched" once —
    # the first touch updates the existing inquiry's primary fields (or
    # creates it new), every touch after that is a continuation row (add a
    # product line / follow-up instead). Without this, a ref pre-seeded from
    # the DB would be indistinguishable from a ref this run already visited.
    refs_touched_this_run: set[tuple[int, str]] = set()
    inquiry_seq = db.query(Inquiry).count()
    today_str = date.today().strftime("%Y%m%d")

    # How many extra product lines an inquiry already has, so a repeated
    # inquiry_ref row that adds another product gets the right sort_order —
    # seeded from the DB for pre-existing inquiries, grown as new lines are
    # added within this same batch.
    line_item_count: dict[int, int] = {}

    orgs_created = 0
    orgs_updated = 0
    contacts_created = 0
    contacts_updated = 0
    inquiries_created = 0
    inquiries_updated = 0
    product_lines_added = 0
    followups_created = 0
    errors: list[dict] = []

    for i, row in enumerate(rows, start=2):  # row 1 is the header
        savepoint = db.begin_nested()
        # Undo hooks for cache mutations made while processing this row — if
        # any later step in the SAME row fails, the savepoint rolls back the
        # DB writes (e.g. a newly created org), but plain Python dicts/lists
        # aren't part of that transaction and would otherwise keep pointing
        # at a row that no longer exists, corrupting every later row that
        # reuses it. Each successful cache mutation below pushes its own
        # inverse here, run only if this row ends up failing.
        undo: list = []
        row_created_org = row_created_contact = row_created_inquiry = row_added_product_line = False
        row_updated_org = row_updated_contact = row_updated_inquiry = False
        try:
            # --- Organization: find or create -----------------------------
            org_name = _get(row, "org_name")
            if not org_name:
                raise ValueError("org_name is required on every row")
            org = org_by_name.get(org_name.strip().lower())
            if not org:
                org_type = _get(row, "org_type")
                if not org_type:
                    raise ValueError(f"org_type is required the first time '{org_name}' appears")
                gst = validate_gst_format(_get(row, "gst_number") or None)
                if gst and gst in existing_gsts:
                    raise ValueError(f"GST number '{gst}' is already used by another organization")
                official_email = validate_email_format(_get(row, "official_email") or None)
                if official_email and official_email.lower() in existing_org_emails:
                    raise ValueError(f"official email '{official_email}' is already used by another organization")
                org = Organization(
                    name=org_name, org_type=org_type,
                    parent_org=_get(row, "parent_org") or None,
                    railway_zone=_get(row, "railway_zone") or None,
                    division_workshop=_get(row, "division_workshop") or None,
                    address=_get(row, "address") or None,
                    country=_get(row, "country") or "India",
                    state=_get(row, "state") or None,
                    city=_get(row, "city") or None,
                    pin_code=_get(row, "pin_code") or None,
                    gst_number=gst,
                    official_phone=_get(row, "official_phone") or None,
                    official_email=official_email,
                    website=_get(row, "website") or None,
                    org_code=generate_org_code(db),
                    created_by_id=user.id,
                )
                db.add(org)
                db.flush()
                org_key = org_name.strip().lower()
                org_by_name[org_key] = org
                undo.append(lambda k=org_key: org_by_name.pop(k, None))
                if gst:
                    existing_gsts.add(gst)
                    undo.append(lambda g=gst: existing_gsts.discard(g))
                if official_email:
                    existing_org_emails.add(official_email.lower())
                    undo.append(lambda e=official_email.lower(): existing_org_emails.discard(e))
                orgs_created += 1
                row_created_org = True
            else:
                # Already exists — refresh it with whatever non-blank
                # details this row supplies (a re-upload of the same file,
                # or a corrected one, should update stale data rather than
                # silently ignore it). Skip fields that are blank on this
                # row so continuation rows — which never repeat org
                # details — leave it untouched.
                gst = validate_gst_format(_get(row, "gst_number") or None)
                if gst and gst != org.gst_number and gst in existing_gsts:
                    raise ValueError(f"GST number '{gst}' is already used by another organization")
                official_email = validate_email_format(_get(row, "official_email") or None)
                if official_email and official_email.lower() != (org.official_email or "").lower() and official_email.lower() in existing_org_emails:
                    raise ValueError(f"official email '{official_email}' is already used by another organization")

                simple_fields = [
                    "org_type", "parent_org", "railway_zone", "division_workshop", "address",
                    "country", "state", "city", "pin_code", "official_phone", "website",
                ]
                field_undo = []
                for field in simple_fields:
                    val = _get(row, field)
                    if val and getattr(org, field) != val:
                        field_undo.append((field, getattr(org, field)))
                        setattr(org, field, val)
                if gst and gst != org.gst_number:
                    field_undo.append(("gst_number", org.gst_number))
                    if org.gst_number:
                        existing_gsts.discard(org.gst_number)
                    org.gst_number = gst
                    existing_gsts.add(gst)
                if official_email and official_email.lower() != (org.official_email or "").lower():
                    field_undo.append(("official_email", org.official_email))
                    if org.official_email:
                        existing_org_emails.discard(org.official_email.lower())
                    org.official_email = official_email
                    existing_org_emails.add(official_email.lower())
                if field_undo:
                    db.flush()
                    undo.append(lambda o=org, fu=field_undo: [setattr(o, f, v) for f, v in fu])
                    orgs_updated += 1
                    row_updated_org = True

            # --- Contact: find or create (optional) ------------------------
            contact = None
            contact_mobile = _get(row, "contact_mobile")
            contact_name = _get(row, "contact_name")
            if contact_mobile or contact_name:
                org_contacts = contacts_by_org.setdefault(org.id, [])
                if contact_mobile:
                    contact = next((c for c in org_contacts if (c.mobile or "").strip() == contact_mobile), None)
                elif contact_name:
                    contact = next((c for c in org_contacts if c.name.strip().lower() == contact_name.strip().lower()), None)
                if not contact:
                    if not contact_name:
                        raise ValueError("contact_name is required the first time a new contact_mobile appears")
                    contact_email = validate_email_format(_get(row, "contact_email") or None)
                    if contact_email and any((c.email or "").strip().lower() == contact_email.lower() for c in org_contacts):
                        raise ValueError(f"contact email '{contact_email}' is already used by another contact on '{org.name}'")
                    contact = OrgContact(
                        org_id=org.id, name=contact_name,
                        designation=_get(row, "contact_designation") or None,
                        mobile=contact_mobile or None, email=contact_email,
                        department=_get(row, "contact_department") or None,
                        created_by_id=user.id, created_at=datetime.now(timezone.utc),
                    )
                    db.add(contact)
                    db.flush()
                    org_contacts.append(contact)
                    undo.append(lambda oc=org_contacts, c=contact: oc.remove(c))
                    contacts_created += 1
                    row_created_contact = True
                else:
                    # Already exists — refresh non-blank details the same
                    # way an existing org does above.
                    contact_email = validate_email_format(_get(row, "contact_email") or None)
                    if contact_email and contact_email.lower() != (contact.email or "").lower() and any(
                        (c.email or "").strip().lower() == contact_email.lower() for c in org_contacts if c is not contact
                    ):
                        raise ValueError(f"contact email '{contact_email}' is already used by another contact on '{org.name}'")
                    contact_field_undo = []
                    for field, val in (
                        ("designation", _get(row, "contact_designation")),
                        ("department", _get(row, "contact_department")),
                    ):
                        if val and getattr(contact, field) != val:
                            contact_field_undo.append((field, getattr(contact, field)))
                            setattr(contact, field, val)
                    if contact_email and contact_email.lower() != (contact.email or "").lower():
                        contact_field_undo.append(("email", contact.email))
                        contact.email = contact_email
                    if contact_field_undo:
                        db.flush()
                        undo.append(lambda c=contact, fu=contact_field_undo: [setattr(c, f, v) for f, v in fu])
                        contacts_updated += 1
                        row_updated_contact = True

            # --- Inquiry: find or create or update ---------------------------
            inquiry_ref = _get(row, "inquiry_ref")
            ref_key = (org.id, inquiry_ref) if inquiry_ref else None
            inquiry = inquiry_by_ref.get(ref_key) if ref_key else None
            already_touched = ref_key is not None and ref_key in refs_touched_this_run

            inquiry_fields = dict(
                division=_get(row, "inquiry_division") or None,
                lead_source=_get(row, "lead_source") or None,
                bd_owner=_get(row, "bd_owner") or None,
                sales_engineer=_get(row, "sales_engineer") or None,
                product=_get(row, "product") or None,
                product_category=_get(row, "product_category") or None,
                product_spec=_get(row, "product_spec") or None,
                quantity=_parse_float(row, "quantity"),
                required_delivery_date=_parse_date(row, "required_delivery_date"),
                delivery_location=_get(row, "delivery_location") or None,
                requirement_desc=_get(row, "requirement_desc") or None,
                priority=_get(row, "priority") or None,
                budget=_parse_float(row, "budget"),
                expected_value=_parse_float(row, "expected_value"),
                expected_order_date=_parse_date(row, "expected_order_date"),
            )

            if inquiry is None:
                # Brand new (org, ref) pair — never imported before, and not
                # created earlier in this same file either.
                # inquiry_seq is only a starting point, not a reservation — a
                # concurrent inquiry created outside this import (or a gap
                # left by an earlier deleted inquiry) can make a candidate
                # universal_id collide, so this retries with the next
                # number instead of failing the whole row, mirroring the
                # same retry the single-inquiry create route already does.
                for attempt in range(5):
                    inquiry_seq += 1
                    candidate = Inquiry(
                        universal_id=f"INQ-{today_str}-{inquiry_seq:04d}",
                        org_id=org.id, org_contact_id=contact.id if contact else None,
                        bulk_import_ref=inquiry_ref or None,
                        lead_source=inquiry_fields["lead_source"] or "Bulk Import",
                        priority=inquiry_fields["priority"] or "Medium",
                        **{k: v for k, v in inquiry_fields.items() if k not in ("lead_source", "priority")},
                        created_by_id=user.id,
                    )
                    id_savepoint = db.begin_nested()
                    try:
                        db.add(candidate)
                        db.flush()
                        id_savepoint.commit()
                        inquiry = candidate
                        break
                    except IntegrityError:
                        id_savepoint.rollback()
                        if attempt == 4:
                            raise ValueError("Could not allocate an inquiry ID after 5 attempts — please retry the import")
                line_item_count[inquiry.id] = 0
                if ref_key:
                    inquiry_by_ref[ref_key] = inquiry
                    refs_touched_this_run.add(ref_key)
                    undo.append(lambda k=ref_key: (inquiry_by_ref.pop(k, None), refs_touched_this_run.discard(k)))
                inquiries_created += 1
                row_created_inquiry = True
            elif not already_touched:
                # Matches an inquiry already tagged with this (org, ref) from
                # a PREVIOUS upload — first time this run has seen it, so
                # refresh it with whatever non-blank fields this row
                # supplies instead of creating a duplicate.
                field_undo = []
                for field, val in inquiry_fields.items():
                    if val is not None and val != "" and getattr(inquiry, field) != val:
                        field_undo.append((field, getattr(inquiry, field)))
                        setattr(inquiry, field, val)
                if contact and inquiry.org_contact_id != contact.id:
                    field_undo.append(("org_contact_id", inquiry.org_contact_id))
                    inquiry.org_contact_id = contact.id
                if field_undo:
                    db.flush()
                    undo.append(lambda i=inquiry, fu=field_undo: [setattr(i, f, v) for f, v in fu])
                    inquiries_updated += 1
                    row_updated_inquiry = True
                refs_touched_this_run.add(ref_key)
                undo.append(lambda k=ref_key: refs_touched_this_run.discard(k))
                line_item_count.setdefault(inquiry.id, len(inquiry.additional_items))
            else:
                # A row in THIS file already resolved this ref — a repeat
                # means "more about this same inquiry": product here is an
                # ADDITIONAL line on top of its primary product, not a
                # replacement, so a row can add product #2, #3, etc.
                product_name = _get(row, "product")
                # Re-uploading the same file would otherwise add this exact
                # product line again every time — skip if it's already the
                # inquiry's primary product or already an additional line.
                already_present = product_name and (
                    inquiry.product == product_name
                    or db.query(InquiryLineItem).filter(
                        InquiryLineItem.inquiry_id == inquiry.id, InquiryLineItem.product == product_name,
                    ).first() is not None
                )
                if product_name and not already_present:
                    sort_order = line_item_count.get(inquiry.id, 0)
                    db.add(InquiryLineItem(
                        inquiry_id=inquiry.id, sort_order=sort_order,
                        product=product_name,
                        product_category=_get(row, "product_category") or None,
                        product_spec=_get(row, "product_spec") or None,
                        quantity=_parse_float(row, "quantity"),
                    ))
                    db.flush()
                    line_item_count[inquiry.id] = sort_order + 1
                    undo.append(lambda iid=inquiry.id, prev=sort_order: line_item_count.__setitem__(iid, prev))
                    product_lines_added += 1
                    row_added_product_line = True

            # --- Follow-up: created only if this row actually supplies one ---
            # (a row can exist purely to add another product line, above, with
            # no follow-up of its own — this isn't required just because the
            # row exists).
            followup_fields = (
                "followup_activity_type", "followup_subject", "followup_activity_date", "followup_next_followup",
                "followup_assigned_to", "followup_status", "followup_remarks", "followup_action_plan",
            )
            if any(_get(row, f) for f in followup_fields):
                followup_date = _parse_date(row, "followup_activity_date") or date.today()
                followup_remarks = _get(row, "followup_remarks") or None
                # Re-uploading the same file would otherwise log this exact
                # follow-up again every time — skip if an identical one
                # (same inquiry, date and remarks) already exists.
                duplicate = db.query(Activity).filter(
                    Activity.related_module == "inquiry", Activity.related_id == inquiry.id,
                    Activity.activity_date == followup_date, Activity.remarks == followup_remarks,
                ).first()
                if not duplicate:
                    db.add(Activity(
                        activity_type=_get(row, "followup_activity_type") or "Follow-up",
                        subject=_get(row, "followup_subject") or None,
                        org_id=org.id, org_contact_id=contact.id if contact else None,
                        related_module="inquiry", related_id=inquiry.id, universal_id=inquiry.universal_id,
                        activity_date=followup_date,
                        next_followup=_parse_date(row, "followup_next_followup"),
                        assigned_to=_get(row, "followup_assigned_to") or None,
                        status=_get(row, "followup_status") or "Open",
                        remarks=followup_remarks,
                        action_plan=_get(row, "followup_action_plan") or None,
                        created_by_id=user.id,
                    ))
                    db.flush()
                    followups_created += 1

                # The inquiry's `current_status_note` is a running "where
                # things stand right now" note (see Inquiry model) — it
                # should mirror the most RECENT follow-up's remarks, not sit
                # blank while the same text lives buried in the activity
                # log. Only applied when this row's follow-up is the latest
                # one on record for the inquiry, so out-of-order rows (or a
                # re-import that lands an older date) don't overwrite a
                # newer status with a stale one.
                if followup_remarks:
                    latest_date = db.query(func.max(Activity.activity_date)).filter(
                        Activity.related_module == "inquiry", Activity.related_id == inquiry.id,
                    ).scalar()
                    if latest_date is None or followup_date >= latest_date:
                        if inquiry.current_status_note != followup_remarks:
                            old_note = inquiry.current_status_note
                            inquiry.current_status_note = followup_remarks
                            db.flush()
                            undo.append(lambda i=inquiry, o=old_note: setattr(i, "current_status_note", o))
            savepoint.commit()
        except Exception as e:
            savepoint.rollback()
            for undo_one in reversed(undo):
                undo_one()
            if row_created_org:
                orgs_created -= 1
            if row_updated_org:
                orgs_updated -= 1
            if row_created_contact:
                contacts_created -= 1
            if row_updated_contact:
                contacts_updated -= 1
            if row_created_inquiry:
                inquiries_created -= 1
            if row_updated_inquiry:
                inquiries_updated -= 1
            if row_added_product_line:
                product_lines_added -= 1
            errors.append({"row": i, "message": str(e)})

    if orgs_created or orgs_updated or contacts_created or contacts_updated or inquiries_created or inquiries_updated or product_lines_added or followups_created:
        db.add(AuditLog(
            entity_type="organization", entity_id=None, action="bulk_imported", performed_by_id=user.id,
            summary=(
                f"{user.name or user.email} bulk-imported/updated {orgs_created} new + {orgs_updated} updated organization(s), "
                f"{contacts_created} new + {contacts_updated} updated contact(s), "
                f"{inquiries_created} new + {inquiries_updated} updated inquiry(ies), "
                f"{product_lines_added} additional product line(s) and {followups_created} follow-up(s) from a CSV file."
            ),
        ))
    db.commit()

    trimmed_errors = errors[:MAX_ERRORS_RETURNED]
    return {
        "total_rows": len(rows),
        "organizations_created": orgs_created,
        "organizations_updated": orgs_updated,
        "contacts_created": contacts_created,
        "contacts_updated": contacts_updated,
        "inquiries_created": inquiries_created,
        "inquiries_updated": inquiries_updated,
        "product_lines_added": product_lines_added,
        "followups_created": followups_created,
        "rows_skipped": len(errors),
        "errors": trimmed_errors,
        "more_errors_not_shown": max(0, len(errors) - MAX_ERRORS_RETURNED),
    }
