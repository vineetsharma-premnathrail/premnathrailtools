"""Order Projects merged into Project Management projects.

Owner decision 2026-10-27 (docs/agent-runs/2026-10-27-project-budget-and-order-project-merge):
the Order Project entity (sales_order_projects) is removed. Each row becomes a
pm_projects row (same project code), its elements become that project's Units
(table sales_order_project_elements renamed to pm_project_elements, column
order_project_id renamed project_id), and every consumer column
order_project_id / order_project_element_id now points to pm_projects /
pm_project_elements. pm_projects and erp_projects get lifecycle_stage.

Steps (each guarded, so a fresh install or a re-run is safe):
 1. pm_projects + sales_order_id (unique), customer_id, branch_id, lifecycle_stage
 2. erp_projects + lifecycle_stage (unlinked machines -> 'closed', linked -> project's stage)
 3. drop every FK that points at sales_order_projects / sales_order_project_elements
    (names discovered with the inspector), rename the element table + column
 4. copy sales_order_projects rows into pm_projects (reusing a row with the same
    project_code), build old id -> new id map
 5. remap elements.project_id and every consumer order_project_id (one CASE UPDATE per table)
 6. create the new FKs (ON DELETE SET NULL for consumers, CASCADE for elements)
 7. drop sales_order_projects

Constraint work (steps 3 and 6) runs on PostgreSQL only; SQLite test databases
are built by create_all from the models.

Downgrade restores the schema and rebuilds sales_order_projects from the PM
projects that have a sales_order_id (ids are kept, so no remap is needed).
Not restored on downgrade: the PM project rows created by the upgrade stay in
pm_projects; their lifecycle stage and the machines' stage are dropped;
consumer links to PM projects without a sales order are set to NULL.

Revision ID: b8d4f2a6c1e7
Revises: f6c2a8d4e1b9
"""
from alembic import op
import sqlalchemy as sa

revision = "b8d4f2a6c1e7"
down_revision = "f6c2a8d4e1b9"
branch_labels = None
depends_on = None

OLD_PROJ = "sales_order_projects"
OLD_ELEM = "sales_order_project_elements"
NEW_ELEM = "pm_project_elements"
STATUS_MAP = {"active": "active", "on_hold": "on_hold", "delivered": "technically_complete",
              "closed": "closed", "cancelled": "cancelled"}


def _insp():
    return sa.inspect(op.get_bind())


def _pg() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _cols(table: str) -> set[str]:
    return {c["name"] for c in _insp().get_columns(table)}


def _fk_name(table: str, col: str) -> str:
    return f"{table}_{col}_fkey"[:63]


def _find_fks(referred: tuple[str, ...]) -> list[tuple[str, str | None, str]]:
    """(table, constraint name, column) of every single-column FK pointing at one of `referred`."""
    insp = _insp()
    out = []
    for t in insp.get_table_names():
        for fk in insp.get_foreign_keys(t):
            if fk.get("referred_table") in referred and len(fk.get("constrained_columns") or []) == 1:
                out.append((t, fk.get("name"), fk["constrained_columns"][0]))
    return out


def _tables_with_column(col: str, skip: tuple[str, ...]) -> list[str]:
    insp = _insp()
    return [t for t in insp.get_table_names() if t not in skip and col in {c["name"] for c in insp.get_columns(t)}]


def _case_update(bind, table: str, col: str, mapping: dict[int, int]) -> None:
    """One statement, so a chain like 1->5, 5->7 never double-moves a row."""
    if not mapping:
        return
    whens = " ".join(f"WHEN {int(o)} THEN {int(n)}" for o, n in mapping.items())
    ids = ", ".join(str(int(o)) for o in mapping)
    bind.execute(sa.text(f"UPDATE {table} SET {col} = CASE {col} {whens} END WHERE {col} IN ({ids})"))


def _stage_for(statuses: list[str], op_status: str) -> str:
    live = [s for s in statuses if s != "cancelled"]
    if live and all(s == "delivered" for s in live):
        return "closed"
    if op_status == "closed":
        return "closed"
    if any(s in ("dispatched", "delivered") for s in live):
        return "dispatched"
    return "planned"


def _create_elem_indexes(table: str, id_col: str) -> None:
    for col in (id_col, "element_no", "sales_order_line_id", "sales_schedule_id", "status"):
        op.create_index(f"ix_{table}_{col}", table, [col])


def upgrade() -> None:
    bind = op.get_bind()
    insp = _insp()
    tables = set(insp.get_table_names())

    # 1. pm_projects columns
    pm_cols = _cols("pm_projects")
    with op.batch_alter_table("pm_projects") as batch:
        if "sales_order_id" not in pm_cols:
            batch.add_column(sa.Column("sales_order_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_pm_projects_sales_order_id", "sales_orders", ["sales_order_id"], ["id"])
            batch.create_unique_constraint("uq_pm_projects_sales_order_id", ["sales_order_id"])
        if "customer_id" not in pm_cols:
            batch.add_column(sa.Column("customer_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_pm_projects_customer_id", "crm_organizations", ["customer_id"], ["id"])
            batch.create_index("ix_pm_projects_customer_id", ["customer_id"])
        if "branch_id" not in pm_cols:
            batch.add_column(sa.Column("branch_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_pm_projects_branch_id", "branches", ["branch_id"], ["id"])
        if "lifecycle_stage" not in pm_cols:
            batch.add_column(sa.Column("lifecycle_stage", sa.String(30), nullable=False, server_default="planned"))

    # 2. erp_projects.lifecycle_stage
    erp_just_added = False
    if "erp_projects" in tables and "lifecycle_stage" not in _cols("erp_projects"):
        with op.batch_alter_table("erp_projects") as batch:
            batch.add_column(sa.Column("lifecycle_stage", sa.String(30), nullable=False, server_default="planned"))
        # Unlinked (past) machines stay serviceable: Delivered. Linked ones follow their project (below).
        bind.execute(sa.text("UPDATE erp_projects SET lifecycle_stage = 'closed' WHERE pm_project_id IS NULL"))
        erp_just_added = True

    # 3. FKs off the old tables, then rename the element table / column
    has_old_proj = OLD_PROJ in tables
    old_fks = _find_fks((OLD_PROJ, OLD_ELEM)) if (has_old_proj or OLD_ELEM in tables) else []
    if _pg():
        for table, name, _col in old_fks:
            if name:
                op.drop_constraint(name, table, type_="foreignkey")

    if OLD_ELEM in tables and NEW_ELEM not in tables:
        for ix in insp.get_indexes(OLD_ELEM):
            if ix.get("duplicates_constraint"):
                continue  # PostgreSQL: the index behind a unique constraint goes with the constraint
            op.drop_index(ix["name"], table_name=OLD_ELEM)
        if _pg():
            for uc in insp.get_unique_constraints(OLD_ELEM):
                if uc.get("name"):
                    op.drop_constraint(uc["name"], OLD_ELEM, type_="unique")
        op.rename_table(OLD_ELEM, NEW_ELEM)
        op.alter_column(NEW_ELEM, "order_project_id", new_column_name="project_id")
        if _pg():
            op.create_unique_constraint("uq_pm_project_element_no", NEW_ELEM, ["project_id", "element_no"])
        _create_elem_indexes(NEW_ELEM, "project_id")
    elif OLD_ELEM not in tables and NEW_ELEM not in tables:
        # fresh install that never had the old table
        op.create_table(
            NEW_ELEM,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("pm_projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("element_no", sa.String(40), nullable=False),
            sa.Column("kind", sa.String(10), nullable=False),
            sa.Column("label", sa.String(255), nullable=False),
            sa.Column("sales_order_line_id", sa.Integer(), sa.ForeignKey("sales_order_lines.id"), nullable=False),
            sa.Column("sales_schedule_id", sa.Integer(), sa.ForeignKey("sales_order_schedules.id"), nullable=True),
            sa.Column("quantity", sa.Numeric(18, 4), nullable=False, server_default="1"),
            sa.Column("contractual_date", sa.Date(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="planned"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.UniqueConstraint("project_id", "element_no", name="uq_pm_project_element_no"),
        )
        _create_elem_indexes(NEW_ELEM, "project_id")

    # 4. copy projects (element.project_id still holds the OLD id until step 5)
    mapping: dict[int, int] = {}
    if has_old_proj:
        rows = bind.execute(sa.text(
            "SELECT p.id, p.op_number, p.sales_order_id, p.customer_id, p.customer_name, p.title, "
            "p.project_manager_id, p.status, p.planned_start, p.planned_end, p.branch_id, p.created_by_id, "
            "p.created_at, so.so_number, so.customer_po_number "
            "FROM sales_order_projects p LEFT JOIN sales_orders so ON so.id = p.sales_order_id ORDER BY p.id"
        )).mappings().all()
        has_elem_table = NEW_ELEM in set(_insp().get_table_names())
        for r in rows:
            elem_statuses = [s for (s,) in bind.execute(
                sa.text(f"SELECT status FROM {NEW_ELEM} WHERE project_id = :pid"), {"pid": r["id"]}).all()] \
                if has_elem_table else []
            stage = _stage_for(elem_statuses, r["status"])
            existing = bind.execute(sa.text("SELECT id FROM pm_projects WHERE project_code = :c"),
                                    {"c": r["op_number"]}).first()
            if existing is not None:
                pm_id = existing[0]
                bind.execute(sa.text(
                    "UPDATE pm_projects SET "
                    "sales_order_id = COALESCE(sales_order_id, :so), customer_id = COALESCE(customer_id, :cu), "
                    "branch_id = COALESCE(branch_id, :br), "
                    "lifecycle_stage = CASE WHEN lifecycle_stage = 'planned' THEN :st ELSE lifecycle_stage END "
                    "WHERE id = :id"),
                    {"so": r["sales_order_id"], "cu": r["customer_id"], "br": r["branch_id"], "st": stage, "id": pm_id})
            else:
                created = r["created_at"]
                start = r["planned_start"] or (created.date() if hasattr(created, "date") else created)
                end = r["planned_end"] or start
                status = STATUS_MAP.get(r["status"], "active")
                manager = r["project_manager_id"] or r["created_by_id"]
                released = status != "cancelled"
                pm_id = bind.execute(sa.text(
                    "INSERT INTO pm_projects (project_code, name, client_name, customer_po_ref, sales_order_ref, "
                    "project_manager_id, start_date, target_handover_date, status, priority, created_by_id, "
                    "released_by_id, released_at, sales_order_id, customer_id, branch_id, lifecycle_stage, "
                    "created_at, updated_at) VALUES (:code, :name, :client, :po, :so_ref, :pm, :sd, :td, :status, "
                    "'medium', :cb, :rb, :ra, :so, :cu, :br, :stage, COALESCE(:ca, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) "
                    "RETURNING id"),
                    {"code": r["op_number"], "name": r["title"], "client": r["customer_name"] or "Customer",
                     "po": r["customer_po_number"] or "-", "so_ref": r["so_number"] or "-", "pm": manager,
                     "sd": start, "td": end, "status": status, "cb": r["created_by_id"],
                     "rb": manager if released else None, "ra": created if released else None,
                     "so": r["sales_order_id"], "cu": r["customer_id"], "br": r["branch_id"], "stage": stage,
                     "ca": created}).scalar_one()
            mapping[r["id"]] = pm_id

    # 5. remap element.project_id and every consumer order_project_id
    consumer_proj_cols: set[tuple[str, str]] = {
        (t, c) for t, _n, c in old_fks if t not in (OLD_PROJ, OLD_ELEM, NEW_ELEM) and c != "order_project_element_id"}
    consumer_elem_cols: set[tuple[str, str]] = {
        (t, c) for t, _n, c in old_fks if t not in (OLD_PROJ, OLD_ELEM, NEW_ELEM) and c == "order_project_element_id"}
    skip = (NEW_ELEM, OLD_ELEM, OLD_PROJ, "pm_projects")
    for t in _tables_with_column("order_project_id", skip=skip):
        consumer_proj_cols.add((t, "order_project_id"))
    for t in _tables_with_column("order_project_element_id", skip=skip):
        consumer_elem_cols.add((t, "order_project_element_id"))
    if mapping:
        _case_update(bind, NEW_ELEM, "project_id", mapping)
        for t, c in sorted(consumer_proj_cols):
            _case_update(bind, t, c, mapping)

    # 6. new FKs (element ids never change, only the FK target)
    if _pg():
        for table, col in sorted(consumer_proj_cols | consumer_elem_cols):
            target = NEW_ELEM if col == "order_project_element_id" else "pm_projects"
            if any(fk.get("constrained_columns") == [col] and fk.get("referred_table") == target
                   for fk in _insp().get_foreign_keys(table)):
                continue
            if target == "pm_projects":
                # defensive: a link whose project no longer exists would block the FK
                bind.execute(sa.text(f"UPDATE {table} SET {col} = NULL WHERE {col} IS NOT NULL "
                                     f"AND {col} NOT IN (SELECT id FROM pm_projects)"))
            op.create_foreign_key(_fk_name(table, col), table, target, [col], ["id"], ondelete="SET NULL")
        if not any(fk.get("referred_table") == "pm_projects" and fk.get("constrained_columns") == ["project_id"]
                   for fk in _insp().get_foreign_keys(NEW_ELEM)):
            bind.execute(sa.text(f"DELETE FROM {NEW_ELEM} WHERE project_id NOT IN (SELECT id FROM pm_projects)"))
            op.create_foreign_key(_fk_name(NEW_ELEM, "project_id"), NEW_ELEM, "pm_projects",
                                  ["project_id"], ["id"], ondelete="CASCADE")

    # machines linked to a PM project mirror its stage
    if erp_just_added:
        bind.execute(sa.text(
            "UPDATE erp_projects SET lifecycle_stage = (SELECT lifecycle_stage FROM pm_projects "
            "WHERE pm_projects.id = erp_projects.pm_project_id) WHERE pm_project_id IS NOT NULL"))

    # 7. drop the old table
    if has_old_proj:
        op.drop_table(OLD_PROJ)


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(_insp().get_table_names())

    if OLD_PROJ not in tables:
        op.create_table(
            OLD_PROJ,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("op_number", sa.String(30), nullable=False),
            sa.Column("sales_order_id", sa.Integer(), sa.ForeignKey("sales_orders.id"), nullable=False),
            sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=True),
            sa.Column("customer_name", sa.String(255), nullable=True),
            sa.Column("title", sa.String(400), nullable=False),
            sa.Column("project_manager_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("planned_start", sa.Date(), nullable=True),
            sa.Column("planned_end", sa.Date(), nullable=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        )
        op.create_index("ix_sales_order_projects_op_number", OLD_PROJ, ["op_number"], unique=True)
        op.create_index("ix_sales_order_projects_sales_order_id", OLD_PROJ, ["sales_order_id"], unique=True)
        op.create_index("ix_sales_order_projects_customer_id", OLD_PROJ, ["customer_id"])
        op.create_index("ix_sales_order_projects_status", OLD_PROJ, ["status"])
        # ids are kept: old id == pm_projects.id
        bind.execute(sa.text(
            "INSERT INTO sales_order_projects (id, op_number, sales_order_id, customer_id, customer_name, title, "
            "project_manager_id, status, planned_start, planned_end, branch_id, created_by_id, created_at, updated_at) "
            "SELECT id, project_code, sales_order_id, customer_id, client_name, name, project_manager_id, "
            "CASE status WHEN 'technically_complete' THEN 'delivered' WHEN 'planning' THEN 'active' ELSE status END, "
            "start_date, target_handover_date, branch_id, created_by_id, created_at, updated_at "
            "FROM pm_projects WHERE sales_order_id IS NOT NULL"))
        if _pg():
            bind.execute(sa.text("SELECT setval(pg_get_serial_sequence('sales_order_projects', 'id'), "
                                 "COALESCE((SELECT MAX(id) FROM sales_order_projects), 1))"))

    # consumer FKs off the PM tables
    fks = _find_fks(("pm_projects", NEW_ELEM))
    consumer_fks = [(t, n, c) for t, n, c in fks
                    if c in ("order_project_id", "order_project_element_id") and t != NEW_ELEM]
    if _pg():
        for t, n, c in fks:
            if n and ((t, n, c) in consumer_fks or (t == NEW_ELEM and c == "project_id")):
                op.drop_constraint(n, t, type_="foreignkey")
    # links to PM projects that have no sales order cannot exist on the old table
    skip = (NEW_ELEM, OLD_ELEM, OLD_PROJ, "pm_projects")
    for t in _tables_with_column("order_project_id", skip=skip):
        bind.execute(sa.text(f"UPDATE {t} SET order_project_id = NULL WHERE order_project_id IS NOT NULL "
                             f"AND order_project_id NOT IN (SELECT id FROM sales_order_projects)"))

    # element table back
    if NEW_ELEM in tables and OLD_ELEM not in tables:
        bind.execute(sa.text(f"DELETE FROM {NEW_ELEM} WHERE project_id NOT IN (SELECT id FROM sales_order_projects)"))
        for ix in _insp().get_indexes(NEW_ELEM):
            if ix.get("duplicates_constraint"):
                continue
            op.drop_index(ix["name"], table_name=NEW_ELEM)
        if _pg():
            for uc in _insp().get_unique_constraints(NEW_ELEM):
                if uc.get("name"):
                    op.drop_constraint(uc["name"], NEW_ELEM, type_="unique")
        op.alter_column(NEW_ELEM, "project_id", new_column_name="order_project_id")
        op.rename_table(NEW_ELEM, OLD_ELEM)
        if _pg():
            op.create_unique_constraint("uq_sales_op_element_no", OLD_ELEM, ["order_project_id", "element_no"])
            op.create_foreign_key(_fk_name(OLD_ELEM, "order_project_id"), OLD_ELEM, OLD_PROJ,
                                  ["order_project_id"], ["id"], ondelete="CASCADE")
        _create_elem_indexes(OLD_ELEM, "order_project_id")

    if _pg():
        for t, _n, c in consumer_fks:
            target = OLD_ELEM if c == "order_project_element_id" else OLD_PROJ
            op.create_foreign_key(_fk_name(t, c), t, target, [c], ["id"], ondelete="SET NULL")

    # drop the new columns
    if "erp_projects" in tables and "lifecycle_stage" in _cols("erp_projects"):
        with op.batch_alter_table("erp_projects") as batch:
            batch.drop_column("lifecycle_stage")
    pm_cols = _cols("pm_projects")
    with op.batch_alter_table("pm_projects") as batch:
        if "lifecycle_stage" in pm_cols:
            batch.drop_column("lifecycle_stage")
        if "branch_id" in pm_cols:
            batch.drop_constraint("fk_pm_projects_branch_id", type_="foreignkey")
            batch.drop_column("branch_id")
        if "customer_id" in pm_cols:
            batch.drop_index("ix_pm_projects_customer_id")
            batch.drop_constraint("fk_pm_projects_customer_id", type_="foreignkey")
            batch.drop_column("customer_id")
        if "sales_order_id" in pm_cols:
            batch.drop_constraint("uq_pm_projects_sales_order_id", type_="unique")
            batch.drop_constraint("fk_pm_projects_sales_order_id", type_="foreignkey")
            batch.drop_column("sales_order_id")
