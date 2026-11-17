"""drop R&D Experiments & Tests and Prototypes (owner, 2026-11-17)

Revision ID: b7e2d4f6a8c1
Revises: c5a8e2f4b6d9
Create Date: 2026-11-17 00:00:00.000000

The owner removed both R&D features completely (the "Prototype / Research"
project type stays):
- rnd_documents loses experiment_id / prototype_id (files stay on their project).
- rnd_experiments, rnd_prototype_bom_items and rnd_prototypes are dropped.
  Production BOMs released from a prototype stay in Production.
- Role / user grants: rnd:experiments* and rnd:prototypes* are removed. The
  old "BOM costs" switch (which also hid the project budget) is now
  rnd:projects.costs ("Budget & costs"), inheriting Prototype / Research View;
  see rewrite_grants for when it is added explicitly. The "Assign experiment
  to" rule and the "Prototype released" notification (roles and personal
  overrides) are dropped.

Downgrade restores the empty tables / columns only; the data is not recoverable
(take it from a backup).
"""
import json
import logging

from alembic import op
import sqlalchemy as sa

revision = "b7e2d4f6a8c1"
down_revision = "c5a8e2f4b6d9"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

_REMOVED_TABS = ("experiments", "prototypes")


def _insp():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _insp().get_table_names()


def _load(value):
    if value is None:
        return None
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value


def rewrite_grants(grants) -> list | None:
    """New grant list, or None when nothing changes. Pure (no DB / registry).

    Budget visibility: rnd:projects.costs inherits the Prototype / Research
    View, so an uncustomised projects tab already shows the budget. Only a list
    whose projects tab is customised (holds an rnd:projects.<feature> grant) and
    that saw the old BOM costs (explicit rnd:prototypes.costs:view, or Prototypes
    View on an uncustomised Prototypes tab) gets rnd:projects.costs:view added.
    Adding it anywhere else would customise the tab and silently cut its
    inherited Project tasks / team features, or open projects to a list that
    had no access to them."""
    if not isinstance(grants, list):
        return None
    triples = [g.split(":") for g in grants if isinstance(g, str) and g.count(":") == 2]
    proto_custom = any(m == "rnd" and t.startswith("prototypes.") for m, t, _ in triples)
    saw_costs = (["rnd", "prototypes.costs", "view"] in triples
                 or (not proto_custom and any(m == "rnd" and t == "prototypes" and a in ("view", "edit") for m, t, a in triples)))
    projects_custom = any(m == "rnd" and t.startswith("projects.") for m, t, _ in triples)
    has_costs = any(m == "rnd" and t == "projects.costs" for m, t, _ in triples)

    out: list = []
    for g in grants:
        if isinstance(g, str):
            parts = g.split(":")
            if len(parts) == 3 and parts[0] == "rnd" and parts[1].partition(".")[0] in _REMOVED_TABS:
                continue
        out.append(g)
    if saw_costs and projects_custom and not has_costs:
        out.append("rnd:projects.costs:view")
    return out if out != grants else None


def _rewrite_role_json(bind) -> None:
    changed = 0
    for table, col in (("roles", "permissions"), ("users", "granular_permissions")):
        if not _has_table(table) or col not in {c["name"] for c in _insp().get_columns(table)}:
            continue
        t = sa.table(table, sa.column("id", sa.Integer), sa.column(col, sa.JSON))
        for row in bind.execute(sa.select(t.c.id, t.c[col])).all():
            new = rewrite_grants(_load(row[1]))
            if new is not None:
                bind.execute(t.update().where(t.c.id == row[0]).values({col: new}))
                changed += 1

    role_cols = {c["name"] for c in _insp().get_columns("roles")} if _has_table("roles") else set()
    for col, drop in (
        ("assignee_rules", lambda k: k.startswith(("rnd:experiments", "rnd:prototypes"))),
        ("notification_events", lambda k: k == "rnd.prototype_released"),
        ("visibility_rules", lambda k: k.startswith(("rnd:experiments", "rnd:prototypes"))),
    ):
        if col not in role_cols:
            continue
        t = sa.table("roles", sa.column("id", sa.Integer), sa.column(col, sa.JSON))
        for row in bind.execute(sa.select(t.c.id, t.c[col])).all():
            data = _load(row[1])
            if isinstance(data, dict) and any(drop(k) for k in data):
                bind.execute(t.update().where(t.c.id == row[0]).values({col: {k: v for k, v in data.items() if not drop(k)}}))
                changed += 1
    # Personal notification overrides: a stale event key makes the user's overrides unsavable (422).
    user_cols = {c["name"] for c in _insp().get_columns("users")} if _has_table("users") else set()
    if "notification_overrides" in user_cols:
        t = sa.table("users", sa.column("id", sa.Integer), sa.column("notification_overrides", sa.JSON))
        for row in bind.execute(sa.select(t.c.id, t.c.notification_overrides)).all():
            data = _load(row[1])
            if isinstance(data, dict) and "rnd.prototype_released" in data:
                data = {k: v for k, v in data.items() if k != "rnd.prototype_released"}
                bind.execute(t.update().where(t.c.id == row[0]).values(notification_overrides=data))
                changed += 1
    log.info("R&D experiments/prototypes removal: %s role/user row(s) rewritten", changed)


def upgrade() -> None:
    bind = op.get_bind()

    if _has_table("rnd_documents"):
        cols = {c["name"] for c in _insp().get_columns("rnd_documents")}
        fks = _insp().get_foreign_keys("rnd_documents")
        idx = {i["name"] for i in _insp().get_indexes("rnd_documents")}
        for col in ("experiment_id", "prototype_id"):
            if col not in cols:
                continue
            for fk in fks:
                if fk.get("constrained_columns") == [col] and fk.get("name"):
                    op.drop_constraint(fk["name"], "rnd_documents", type_="foreignkey")
            name = f"ix_rnd_documents_{col}"
            if name in idx:
                op.drop_index(name, table_name="rnd_documents")
            op.drop_column("rnd_documents", col)

    # rnd_experiments points at rnd_prototypes, so it goes first.
    for table in ("rnd_experiments", "rnd_prototype_bom_items", "rnd_prototypes"):
        if _has_table(table):
            op.drop_table(table)

    _rewrite_role_json(bind)


def downgrade() -> None:
    """Empty tables and columns only — the dropped data and grants are not restored."""
    if not _has_table("rnd_prototypes"):
        op.create_table(
            "rnd_prototypes",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("prototype_number", sa.String(length=50), nullable=False),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("rnd_projects.id"), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("version", sa.String(length=20), nullable=False, server_default="v1"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="design"),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("build_date", sa.Date(), nullable=True),
            sa.Column("findings", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("production_bom_id", sa.Integer(), sa.ForeignKey("production_boms.id"), nullable=True),
            sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("released_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_rnd_prototypes_prototype_number", "rnd_prototypes", ["prototype_number"], unique=True)
        op.create_index("ix_rnd_prototypes_project_id", "rnd_prototypes", ["project_id"])
    if not _has_table("rnd_prototype_bom_items"):
        op.create_table(
            "rnd_prototype_bom_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("prototype_id", sa.Integer(), sa.ForeignKey("rnd_prototypes.id", ondelete="CASCADE"), nullable=False),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True),
            sa.Column("item_code", sa.String(length=100), nullable=True),
            sa.Column("item_name", sa.String(length=255), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False, server_default="1"),
            sa.Column("uom", sa.String(length=20), nullable=True),
            sa.Column("unit_cost", sa.Float(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_rnd_prototype_bom_items_prototype_id", "rnd_prototype_bom_items", ["prototype_id"])
    if not _has_table("rnd_experiments"):
        op.create_table(
            "rnd_experiments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("experiment_number", sa.String(length=50), nullable=False),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("rnd_projects.id"), nullable=False),
            sa.Column("prototype_id", sa.Integer(), sa.ForeignKey("rnd_prototypes.id"), nullable=True),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("experiment_type", sa.String(length=20), nullable=False, server_default="lab_test"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="planned"),
            sa.Column("result", sa.String(length=20), nullable=True),
            sa.Column("objective", sa.Text(), nullable=True),
            sa.Column("method", sa.Text(), nullable=True),
            sa.Column("experiment_date", sa.Date(), nullable=True),
            sa.Column("conducted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("parameters", sa.JSON(), nullable=False),
            sa.Column("observations", sa.Text(), nullable=True),
            sa.Column("conclusion", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_rnd_experiments_experiment_number", "rnd_experiments", ["experiment_number"], unique=True)
        op.create_index("ix_rnd_experiments_project_id", "rnd_experiments", ["project_id"])
    if _has_table("rnd_documents"):
        cols = {c["name"] for c in _insp().get_columns("rnd_documents")}
        for col, target in (("experiment_id", "rnd_experiments.id"), ("prototype_id", "rnd_prototypes.id")):
            if col not in cols:
                op.add_column("rnd_documents", sa.Column(col, sa.Integer(), sa.ForeignKey(target), nullable=True))
                op.create_index(f"ix_rnd_documents_{col}", "rnd_documents", [col])
