"""R&D intake, Sales retired (Stage 1), priority Standard / Urgent.

Schema (reversible)
  * rnd_requirements, rnd_requirement_revisions: the R&D intake record (R&D ID
    RDR-YYYY-NNNN, revisions R0, R1, ... that carry accept / return state).
  * rnd_requirement_tasks: progress_percent, revision_no.
  * rnd_project_tasks: progress_percent.
  * rnd_technical_offers: origin, document_id, requirement_revision_no, notes.
  * rnd_requirement_doc_visibility.category, rnd_documents.category.
  * pm_projects.source_kind / source_id (optional CRM source of a New Project).
  * priority server defaults become 'standard'.

Data (steps M1-M9, each idempotent, counts logged; NOT reversed by downgrade)
  M1 intake back-fill from crm_rnd_requests (+ records that only carry
     technical_offer_sent_at); open requests become Accepted so the review
     queue is not flooded.
  M2 document categories ('other' for requirement documents, mapped from
     doc_type for project documents).
  M3 Word-created offers that were never released go back to draft with a
     "upload the final file" note; released and superseded offers are kept.
  M4 R&D project origin: product_improvement -> existing_projects; the other
     three -> new_project.
  M5 priority: high / critical / urgent -> urgent, everything else -> standard
     on 18 columns and the maintenance priority_* settings.
  M6 task progress: closed / submitted = 100, open with a checklist = share of
     ticked steps, else 0.
  M7 role / user grants: Sales and Products grants move to CRM > Products,
     removed R&D features and Design / Electrical / Hydraulic Requirements and
     the CRM Discussion feature are dropped, R&D Tasks and view on PM All
     Projects are added for R&D holders.
  M8 Sales approval workflows deactivated, pending Sales approvals cancelled.
  M9 Sales quotation settings and the Sales head move to the CRM module.

No table is dropped. Every added column is nullable or has a server default,
and CHECK constraints are added after the back-fill, so it is safe on a live
database. On an empty database every data step finds nothing and does nothing.

Revision ID: d0f4d65f9d55
Revises: c3e5a7b9d1f2
Create Date: 2026-10-30
"""
import logging
from datetime import datetime, timedelta, timezone

from alembic import op
import sqlalchemy as sa

revision = "d0f4d65f9d55"
down_revision = "c3e5a7b9d1f2"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

IST = timezone(timedelta(hours=5, minutes=30))

# table -> (priority column(s), nullable?) mapped by M5, and the server default each had before (downgrade).
PRIORITY_COLUMNS = [
    ("crm_inquiries", "priority", False),
    ("crm_inquiries", "followup_priority", True),
    ("crm_tenders", "priority", False),
    ("design_requests", "priority", False),
    ("design_change_notices", "priority", False),
    ("electrical_jobs", "priority", False),
    ("maintenance_requests", "priority", False),
    ("maintenance_work_orders", "priority", False),
    ("production_work_orders", "priority", False),
    ("production_rrv_builds", "priority", False),
    ("p2p_requests", "priority", False),
    ("pm_projects", "priority", False),
    ("pm_project_tasks", "priority", False),
    ("pm_task_subtasks", "priority", False),
    ("rnd_projects", "priority", False),
    ("rnd_project_tasks", "priority", False),
    ("rnd_requirement_tasks", "priority", False),
    ("erp_service_requests", "priority", False),
]
OLD_PRIORITY_DEFAULTS = {
    "crm_tenders": "Medium", "design_requests": "medium", "design_change_notices": "medium",
    "electrical_jobs": "normal", "maintenance_requests": "normal", "maintenance_work_orders": "normal",
    "production_work_orders": "normal", "production_rrv_builds": "normal", "p2p_requests": "medium",
    "pm_projects": "medium", "pm_project_tasks": "medium", "pm_task_subtasks": "medium",
    "rnd_projects": "medium", "rnd_project_tasks": "medium", "rnd_requirement_tasks": "medium",
}

# crm_rnd_requests.status -> rnd_requirement_revisions.status
REVISION_STATUS = {"open": "accepted", "responded": "responded", "superseded": "superseded", "returned": "returned"}
REQUIREMENT_STATUSES = ("submitted", "accepted", "returned", "responded")

OFFER_UPLOAD_NOTE = "Offer creation was replaced by upload — upload the final file"

CRUD = ("view", "create", "edit", "delete")
REMOVED_REQ_FEATURES = {"milestones", "milestone_status", "departments", "discussion", "access"}
REMOVED_PROJ_FEATURES = {"milestones", "milestone_status"}


# ---------------------------------------------------------------- helpers
def _insp():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return _insp().has_table(table)


def _columns(table: str) -> dict:
    return {c["name"]: c for c in _insp().get_columns(table)}


def _add_column(table: str, column: sa.Column) -> None:
    if column.name not in _columns(table):
        op.add_column(table, column)


def _drop_column(table: str, name: str) -> None:
    if _has_table(table) and name in _columns(table):
        op.drop_column(table, name)


def _index_names(table: str) -> set:
    return {i["name"] for i in _insp().get_indexes(table)}


def _check_names(table: str) -> set:
    return {c["name"] for c in _insp().get_check_constraints(table)}


def _fk_names(table: str) -> set:
    return {f["name"] for f in _insp().get_foreign_keys(table)}


def _load(value):
    import json
    if value is None:
        return []
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return []
    return list(value)


def _ist_year(ts) -> int:
    if ts is None:
        return datetime.now(IST).year
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(IST).year


# ---------------------------------------------------------------- schema
def _create_tables() -> None:
    if not _has_table("rnd_requirements"):
        op.create_table(
            "rnd_requirements",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("rd_number", sa.String(20), nullable=False),
            sa.Column("source", sa.String(20), nullable=False),
            sa.Column("record_id", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="submitted"),
            sa.Column("current_revision", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("first_received_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_received_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("rd_number", name="uq_rnd_requirement_number"),
            sa.UniqueConstraint("source", "record_id", name="uq_rnd_requirement_source_record"),
        )
        op.create_index("ix_rnd_requirements_record_id", "rnd_requirements", ["record_id"])
        op.create_index("ix_rnd_requirements_status", "rnd_requirements", ["status"])

    if not _has_table("rnd_requirement_revisions"):
        op.create_table(
            "rnd_requirement_revisions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("requirement_id", sa.Integer(), sa.ForeignKey("rnd_requirements.id", ondelete="CASCADE"), nullable=False),
            sa.Column("revision_no", sa.Integer(), nullable=False),
            sa.Column("revision_code", sa.String(30), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="submitted"),
            sa.Column("crm_rnd_request_id", sa.Integer(), sa.ForeignKey("crm_rnd_requests.id", ondelete="SET NULL"), nullable=True),
            sa.Column("movement_log_id", sa.Integer(), sa.ForeignKey("audit_logs.id", ondelete="SET NULL"), nullable=True),
            sa.Column("changed_fields", sa.JSON(), nullable=True),
            sa.Column("submitted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("reviewed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("review_remarks", sa.Text(), nullable=True),
            sa.Column("return_reason", sa.Text(), nullable=True),
            sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_reminded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("requirement_id", "revision_no", name="uq_rnd_requirement_revision_no"),
            sa.UniqueConstraint("revision_code", name="uq_rnd_requirement_revision_code"),
        )
        op.create_index("ix_rnd_requirement_revisions_requirement_id", "rnd_requirement_revisions", ["requirement_id"])
        op.create_index("ix_rnd_requirement_revisions_crm_rnd_request_id", "rnd_requirement_revisions", ["crm_rnd_request_id"])


def _add_columns() -> None:
    _add_column("rnd_requirement_tasks", sa.Column("progress_percent", sa.SmallInteger(), nullable=False, server_default="0"))
    _add_column("rnd_requirement_tasks", sa.Column("revision_no", sa.Integer(), nullable=True))
    _add_column("rnd_project_tasks", sa.Column("progress_percent", sa.SmallInteger(), nullable=False, server_default="0"))

    _add_column("rnd_technical_offers", sa.Column("origin", sa.String(10), nullable=False, server_default="rnd"))
    _add_column("rnd_technical_offers", sa.Column("document_id", sa.Integer(), nullable=True))
    _add_column("rnd_technical_offers", sa.Column("requirement_revision_no", sa.Integer(), nullable=True))
    _add_column("rnd_technical_offers", sa.Column("notes", sa.Text(), nullable=True))
    if "fk_rnd_technical_offers_document_id" not in _fk_names("rnd_technical_offers"):
        op.create_foreign_key("fk_rnd_technical_offers_document_id", "rnd_technical_offers", "crm_documents",
                              ["document_id"], ["id"], ondelete="SET NULL")
    if "ix_rnd_technical_offers_source_record" not in _index_names("rnd_technical_offers"):
        op.create_index("ix_rnd_technical_offers_source_record", "rnd_technical_offers", ["source", "record_id"])

    _add_column("rnd_requirement_doc_visibility", sa.Column("category", sa.String(40), nullable=True))
    _add_column("rnd_documents", sa.Column("category", sa.String(40), nullable=True))

    _add_column("pm_projects", sa.Column("source_kind", sa.String(20), nullable=True))
    _add_column("pm_projects", sa.Column("source_id", sa.Integer(), nullable=True))
    if "ix_pm_projects_source" not in _index_names("pm_projects"):
        op.create_index("ix_pm_projects_source", "pm_projects", ["source_kind", "source_id"])


def _priority_defaults() -> None:
    """Columns that carry a server default now default to 'standard'."""
    for table in sorted({t for t, _c, _n in PRIORITY_COLUMNS}):
        col = _columns(table).get("priority")
        if col is not None and col.get("default") is not None:
            op.alter_column(table, "priority", server_default="standard")


# ---------------------------------------------------------------- M1 intake
def _m1_intake(bind) -> None:
    from sqlalchemy import select

    req = sa.table("rnd_requirements", sa.column("id", sa.Integer), sa.column("rd_number"), sa.column("source"),
                   sa.column("record_id"), sa.column("status"), sa.column("current_revision"),
                   sa.column("first_received_at"), sa.column("last_received_at"))
    rev = sa.table("rnd_requirement_revisions", sa.column("requirement_id"), sa.column("revision_no"),
                   sa.column("revision_code"), sa.column("status"), sa.column("crm_rnd_request_id"),
                   sa.column("movement_log_id"), sa.column("submitted_by_id"), sa.column("submitted_at"),
                   sa.column("review_remarks"), sa.column("responded_at"), sa.column("created_at"))
    crr = sa.table("crm_rnd_requests", sa.column("id", sa.Integer), sa.column("source"), sa.column("record_id"),
                   sa.column("movement_log_id"), sa.column("requested_by_id"), sa.column("status"),
                   sa.column("created_at"), sa.column("responded_at"))

    existing = {(r.source, r.record_id) for r in bind.execute(select(req.c.source, req.c.record_id))}
    next_no: dict[int, int] = {}
    for (num,) in bind.execute(select(req.c.rd_number)):
        try:
            _p, year, seq = num.split("-")
            next_no[int(year)] = max(next_no.get(int(year), 0), int(seq))
        except ValueError:
            continue

    groups: dict[tuple, list] = {}
    for row in bind.execute(select(crr).order_by(crr.c.created_at, crr.c.id)):
        groups.setdefault((row.source, row.record_id), []).append(
            {"id": row.id, "movement_log_id": row.movement_log_id, "by": row.requested_by_id,
             "status": row.status, "at": row.created_at, "responded_at": row.responded_at})
    legacy = 0
    for source, table in (("inquiry", "crm_inquiries"), ("tender", "crm_tenders")):
        if not _has_table(table) or "technical_offer_sent_at" not in _columns(table):
            continue
        rows = bind.execute(sa.text(
            f"SELECT id, technical_offer_sent_at FROM {table} "
            f"WHERE technical_offer_sent_at IS NOT NULL AND is_deleted = false"
        )).all()
        for rid, sent_at in rows:
            if (source, rid) not in groups:
                groups[(source, rid)] = [{"id": None, "movement_log_id": None, "by": None, "status": "open",
                                          "at": sent_at, "responded_at": None}]
                legacy += 1

    def first_ts(item):
        ts = item[1][0]["at"]
        if ts is not None and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return (ts or datetime.now(timezone.utc), item[0][0], item[0][1])

    made = revisions = 0
    for (source, record_id), sends in sorted(groups.items(), key=first_ts):
        if (source, record_id) in existing:
            continue
        first_at = sends[0]["at"] or datetime.now(timezone.utc)
        last_at = sends[-1]["at"] or first_at
        year = _ist_year(first_at)
        next_no[year] = next_no.get(year, 0) + 1
        rd = f"RDR-{year}-{next_no[year]:04d}"
        statuses = []
        for send in sends:
            statuses.append(REVISION_STATUS.get(send["status"], "accepted"))
        latest = statuses[-1]
        status = latest if latest in REQUIREMENT_STATUSES else "accepted"
        req_id = bind.execute(req.insert().values(
            rd_number=rd, source=source, record_id=record_id, status=status,
            current_revision=len(sends) - 1, first_received_at=first_at, last_received_at=last_at,
        ).returning(req.c.id)).scalar_one()
        for n, send in enumerate(sends):
            bind.execute(rev.insert().values(
                requirement_id=req_id, revision_no=n, revision_code=f"{rd}-R{n}", status=statuses[n],
                crm_rnd_request_id=send["id"], movement_log_id=send["movement_log_id"],
                submitted_by_id=send["by"], submitted_at=send["at"] or first_at,
                review_remarks=("Accepted automatically when R&D requirement review was introduced "
                                "(work was already in progress)." if statuses[n] == "accepted" else None),
                responded_at=send["responded_at"] if statuses[n] == "responded" else None,
                created_at=send["at"] or first_at,
            ))
            revisions += 1
        made += 1
    log.info("M1 intake: %s requirement(s), %s revision(s) created (%s from records with no request row)",
             made, revisions, legacy)


# ---------------------------------------------------------------- M2-M4, M6
def _m2_doc_categories(bind) -> None:
    n1 = bind.execute(sa.text("""
        INSERT INTO rnd_requirement_doc_visibility (document_id, department, shared_with_all, category)
        SELECT d.id, 'rnd', true, 'other' FROM crm_documents d
        WHERE d.related_sub_module = 'rnd_requirement' AND d.is_deleted = false
          AND NOT EXISTS (SELECT 1 FROM rnd_requirement_doc_visibility v WHERE v.document_id = d.id)
    """)).rowcount
    n2 = bind.execute(sa.text(
        "UPDATE rnd_requirement_doc_visibility SET category = 'other' WHERE category IS NULL")).rowcount
    n3 = bind.execute(sa.text("""
        UPDATE rnd_documents SET category = CASE doc_type
            WHEN 'specification' THEN 'technical_specification'
            WHEN 'drawing' THEN 'drawing'
            WHEN 'test_report' THEN 'test_report'
            ELSE 'other' END
        WHERE category IS NULL
    """)).rowcount
    log.info("M2 doc categories: %s visibility row(s) added, %s requirement doc(s) and %s project doc(s) categorised", n1, n2, n3)


def _m3_offers(bind) -> None:
    n1 = bind.execute(sa.text(
        "UPDATE rnd_technical_offers SET status = 'draft', returned_reason = :note WHERE status = 'submitted'"
    ), {"note": OFFER_UPLOAD_NOTE}).rowcount
    n2 = bind.execute(sa.text(
        "UPDATE rnd_technical_offers SET returned_reason = :note WHERE status = 'draft' AND returned_reason IS NULL"
    ), {"note": OFFER_UPLOAD_NOTE}).rowcount
    log.info("M3 offers: %s submitted offer(s) back to draft, %s draft(s) annotated", n1, n2)


def _m4_origin(bind) -> None:
    n1 = bind.execute(sa.text("UPDATE rnd_projects SET origin = 'existing_projects' WHERE origin = 'product_improvement'")).rowcount
    n2 = bind.execute(sa.text(
        "UPDATE rnd_projects SET origin = 'new_project' "
        "WHERE origin IN ('new_development', 'process_research', 'customer_requirement')")).rowcount
    log.info("M4 origin: %s -> existing_projects, %s -> new_project", n1, n2)


def _m6_progress(bind) -> None:
    for table in ("rnd_requirement_tasks", "rnd_project_tasks"):
        done = bind.execute(sa.text(
            f"UPDATE {table} SET progress_percent = 100 WHERE status IN ('closed', 'submitted') AND progress_percent <> 100"
        )).rowcount
        t = sa.table(table, sa.column("id", sa.Integer), sa.column("status"), sa.column("checklist", sa.JSON),
                     sa.column("progress_percent", sa.Integer))
        updated = 0
        for row in bind.execute(sa.select(t.c.id, t.c.checklist).where(t.c.status == "open")).all():
            items = _load(row.checklist)
            if not items:
                continue
            pct = round(100 * sum(1 for i in items if isinstance(i, dict) and i.get("done")) / len(items))
            pct = min(pct, 99)  # an open task is never 100
            bind.execute(t.update().where(t.c.id == row.id).values(progress_percent=pct))
            updated += 1
        log.info("M6 progress %s: %s finished task(s) set to 100, %s open checklist task(s) computed", table, done, updated)


# ---------------------------------------------------------------- M5 priority
def _m5_priority(bind) -> None:
    for table, column, nullable in PRIORITY_COLUMNS:
        if not _has_table(table) or column not in _columns(table):
            continue
        case = f"CASE WHEN lower(trim({column})) IN ('urgent', 'critical', 'high') THEN 'urgent' ELSE 'standard' END"
        where = f"{column} IS DISTINCT FROM {case}" + (f" AND {column} IS NOT NULL" if nullable else "")
        n = bind.execute(sa.text(f"UPDATE {table} SET {column} = {case} WHERE {where}")).rowcount
        log.info("M5 priority %s.%s: %s row(s) changed", table, column, n)
    ms = sa.table("module_settings", sa.column("id", sa.Integer), sa.column("module_key"), sa.column("key"),
                  sa.column("value", sa.JSON))
    changed = 0
    rows = bind.execute(sa.select(ms.c.id, ms.c.value).where(
        ms.c.module_key == "maintenance", ms.c.key.like("priority\\_%", escape="\\"))).all()
    for row in rows:
        if not isinstance(row.value, str):
            continue
        new = "urgent" if row.value.strip().lower() in ("urgent", "critical", "high") else "standard"
        if new != row.value:
            bind.execute(ms.update().where(ms.c.id == row.id).values(value=new))
            changed += 1
    log.info("M5 priority maintenance settings: %s of %s row(s) changed", changed, len(rows))


# ---------------------------------------------------------------- M7 grants
def rewrite_grants(grants: list) -> list | None:
    """New grant list for one role / user, or None when nothing changes.

    Pure function (no DB, no registry import) so it is safe on an empty database
    and can be unit-tested."""
    grants = [g for g in grants if isinstance(g, str)]
    keep: list[str] = []
    products_tab: set[str] = set()      # actions on the (old) products tabs
    pricing: set[str] = set()           # actions on the (old) Pricing tab
    old_features: list[str] = []        # explicit crm:products.<f>:<a> carried over 1:1
    touched_sales = False
    holds_view_rnd = False              # R&D requirement / project viewer (all-projects view, tasks view)
    holds_tasks_view = False
    tasks_create = False
    rnd_tabs: dict[str, dict] = {"requirements": {"customised": False, "any": False, "tasks_create": False},
                                 "projects": {"customised": False, "any": False, "tasks_create": False}}

    for g in grants:
        parts = g.split(":")
        if len(parts) != 3:
            keep.append(g)
            continue
        mk, tk, a = parts
        base, _, fk = tk.partition(".")

        if mk in ("sales", "products"):
            touched_sales = True
            if tk == "*":
                if a == "*":
                    products_tab |= set(CRUD)
                    if mk == "sales":
                        pricing |= set(CRUD)
                elif a in CRUD:
                    products_tab.add(a)
                    if mk == "sales":
                        pricing.add(a)
            elif mk == "sales" and base == "products" and fk:
                old_features.append(f"crm:products.{fk}:{a}")
            elif base == "pricing" and not fk:
                if a in CRUD:
                    pricing.add(a)
            elif not fk and a in CRUD and (mk == "products" or base in ("products", "applications", "product_mapping")):
                products_tab.add(a)
            continue

        if mk == "rnd":
            if tk == "*":
                if a in ("*", "view"):
                    holds_view_rnd = True
                    holds_tasks_view = True
            elif base in ("requirements", "projects", "project_work"):
                if fk and ((base == "requirements" and fk in REMOVED_REQ_FEATURES)
                           or (base == "projects" and fk in REMOVED_PROJ_FEATURES)):
                    continue
                if a != "none":
                    holds_tasks_view = True
                    if base in ("requirements", "projects"):
                        holds_view_rnd = True
                        rnd_tabs[base]["any"] = True
                if fk and base in rnd_tabs:
                    rnd_tabs[base]["customised"] = True
                    if fk == "tasks" and a == "create":
                        rnd_tabs[base]["tasks_create"] = True
        elif mk in ("design", "electrical", "hydraulic") and base == "requirements":
            continue
        elif mk == "crm" and base == "inquiries_tenders" and fk == "discussion":
            continue
        keep.append(g)

    out = list(keep)

    def add(grant: str) -> None:
        if grant not in out:
            out.append(grant)

    if touched_sales:
        t_eff = (products_tab | {"view"}) if products_tab else set()
        p_eff = (pricing | {"view"}) if pricing else set()
        for a in CRUD:
            if a in t_eff:
                add(f"crm:products:{a}")
        if old_features:
            for g in old_features:
                add(g)
            for a in CRUD:
                if a in p_eff:
                    add(f"crm:products.pricing:{a}")
        elif p_eff != t_eff:
            # Pricing differed from the product tab: spell it out, because one feature grant
            # switches the tab's other features from "follow the tab" to "explicit only".
            for a in CRUD:
                if a in p_eff:
                    add(f"crm:products.pricing:{a}")
            if "view" in t_eff:
                add("crm:products.specifications:view")
                add("crm:products.prices:view")
        if p_eff and not t_eff:
            add("crm:products:view")

    if holds_tasks_view:
        add("rnd:tasks:view")
    for tab, st in rnd_tabs.items():
        if st["tasks_create"] or (st["any"] and not st["customised"]):
            tasks_create = True  # tasks "create" followed the tab's view until the tab was customised
    if tasks_create:
        add("rnd:tasks:create")
    if holds_view_rnd:
        add("projects:all_projects:view")

    return out if out != grants else None


def _m7_grants(bind) -> None:
    changed = 0
    for table, col in (("roles", "permissions"), ("users", "granular_permissions")):
        t = sa.table(table, sa.column("id", sa.Integer), sa.column(col, sa.JSON))
        for row in bind.execute(sa.select(t.c.id, t.c[col])).all():
            new = rewrite_grants(_load(row[1]))
            if new is not None:
                bind.execute(t.update().where(t.c.id == row[0]).values({col: new}))
                changed += 1
    log.info("M7 grants: %s role/user row(s) rewritten", changed)


# ---------------------------------------------------------------- M8, M9
def _m8_sales_approvals(bind) -> None:
    wf = bind.execute(sa.text(
        "UPDATE approval_workflows SET is_active = false WHERE module_key = 'sales' AND is_active = true")).rowcount
    steps = bind.execute(sa.text("""
        UPDATE approval_request_steps SET status = 'cancelled', comment = 'Sales module retired'
        WHERE status IN ('waiting', 'pending')
          AND request_id IN (SELECT id FROM approval_requests WHERE module_key = 'sales' AND status = 'pending')
    """)).rowcount
    reqs = bind.execute(sa.text("""
        UPDATE approval_requests SET status = 'cancelled', completed_at = now()
        WHERE module_key = 'sales' AND status = 'pending'
    """)).rowcount
    log.info("M8 sales approvals: %s workflow(s) deactivated, %s pending request(s) cancelled (%s step(s))", wf, reqs, steps)


def _m9_settings(bind) -> None:
    n1 = bind.execute(sa.text("""
        UPDATE module_settings s SET module_key = 'crm'
        WHERE s.module_key = 'sales' AND s.key LIKE 'quotation\\_%' ESCAPE '\\'
          AND NOT EXISTS (SELECT 1 FROM module_settings c WHERE c.module_key = 'crm' AND c.key = s.key
                          AND c.branch_id IS NOT DISTINCT FROM s.branch_id)
    """)).rowcount
    n2 = bind.execute(sa.text("""
        UPDATE module_settings s SET module_key = 'crm', key = 'quotation_head_id'
        WHERE s.module_key = 'sales' AND s.key = 'sales_head_id'
          AND NOT EXISTS (SELECT 1 FROM module_settings c WHERE c.module_key = 'crm' AND c.key = 'quotation_head_id'
                          AND c.branch_id IS NOT DISTINCT FROM s.branch_id)
    """)).rowcount
    log.info("M9 settings: %s quotation setting(s) and %s sales-head setting(s) moved to CRM", n1, n2)


# ---------------------------------------------------------------- upgrade / downgrade
def upgrade() -> None:
    bind = op.get_bind()
    _create_tables()
    _add_columns()
    _priority_defaults()

    _m1_intake(bind)
    _m2_doc_categories(bind)
    _m3_offers(bind)
    _m4_origin(bind)
    _m5_priority(bind)
    _m6_progress(bind)
    _m7_grants(bind)
    _m8_sales_approvals(bind)
    _m9_settings(bind)

    # CHECK constraints last: the back-fill above has already put every row in range.
    for table, name in (("rnd_requirement_tasks", "ck_rnd_req_task_progress"),
                        ("rnd_project_tasks", "ck_rnd_proj_task_progress")):
        if name not in _check_names(table):
            op.create_check_constraint(name, table, "progress_percent BETWEEN 0 AND 100")


def downgrade() -> None:
    """Schema only. The data steps M3-M9 (offer status, origins, priority values, grants,
    approval workflows, settings) are not reversed: the old values cannot be recovered.
    BD-uploaded offers (origin 'bd') stay as plain offers once the column is gone."""
    for table, name in (("rnd_requirement_tasks", "ck_rnd_req_task_progress"),
                        ("rnd_project_tasks", "ck_rnd_proj_task_progress")):
        if _has_table(table) and name in _check_names(table):
            op.drop_constraint(name, table, type_="check")

    if _has_table("pm_projects") and "ix_pm_projects_source" in _index_names("pm_projects"):
        op.drop_index("ix_pm_projects_source", table_name="pm_projects")
    _drop_column("pm_projects", "source_id")
    _drop_column("pm_projects", "source_kind")
    _drop_column("rnd_documents", "category")
    _drop_column("rnd_requirement_doc_visibility", "category")

    if _has_table("rnd_technical_offers"):
        if "ix_rnd_technical_offers_source_record" in _index_names("rnd_technical_offers"):
            op.drop_index("ix_rnd_technical_offers_source_record", table_name="rnd_technical_offers")
        if "fk_rnd_technical_offers_document_id" in _fk_names("rnd_technical_offers"):
            op.drop_constraint("fk_rnd_technical_offers_document_id", "rnd_technical_offers", type_="foreignkey")
    for name in ("notes", "requirement_revision_no", "document_id", "origin"):
        _drop_column("rnd_technical_offers", name)

    _drop_column("rnd_project_tasks", "progress_percent")
    _drop_column("rnd_requirement_tasks", "revision_no")
    _drop_column("rnd_requirement_tasks", "progress_percent")

    for table, old in OLD_PRIORITY_DEFAULTS.items():
        if _has_table(table) and _columns(table).get("priority", {}).get("default") is not None:
            op.alter_column(table, "priority", server_default=old)

    if _has_table("rnd_requirement_revisions"):
        op.drop_table("rnd_requirement_revisions")
    if _has_table("rnd_requirements"):
        op.drop_table("rnd_requirements")
