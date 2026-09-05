"""migrate purchase_requisitions data into p2p_requests and drop the purchase module's tables

Revision ID: b8e2f4a6c1d9
Revises: a6b3d9e1c4f7
Create Date: 2026-09-05 00:00:00.000000

The standalone `purchase` module (backend/app/modules/purchase) is being
removed entirely — all Purchase Requisitions raised from an ERP Service
Request's Materials tab are now created directly as P2PRequest rows (see
app/modules/erp/routes/service_requests.py's `_create_p2p_request_for_sr`).
This migration copies every existing `purchase_requisitions` row (and its
`purchase_requisition_items`) into `p2p_requests`/`p2p_request_items` so
history isn't lost, repoints `erp_service_materials.pr_id` at the migrated
p2p_requests rows, then drops the old tables.

Uses raw SQL / sa.text() only (no ORM model imports) since the `purchase`
module's models no longer exist in the codebase by the time this migration
runs.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8e2f4a6c1d9'
down_revision: Union[str, Sequence[str], None] = 'a6b3d9e1c4f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Old purchase_requisitions.category_code -> P2PRequest.category_code, for
# this one-time historical migration only (the ERP raise-PR endpoint itself
# now validates directly against P2P_CATEGORIES going forward).
_CATEGORY_MAP = {"HYD": "PNH", "ELE": "ELE"}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "purchase_requisitions" not in existing_tables:
        # Nothing to migrate (e.g. a fresh DB provisioned after this change) —
        # still need to repoint the FK below in case p2p_requests already exists.
        _repoint_service_material_fk(bind, inspector)
        return

    prs = bind.execute(sa.text("""
        SELECT pr.id, pr.pr_number, pr.project_id, pr.service_request_id, pr.status,
               pr.raised_by_id, pr.priority, pr.required_by_date, pr.purchase_reason,
               pr.category_code, pr.requirement_type, pr.approver_id, pr.approver_name,
               pr.po_number, pr.po_date, pr.expected_delivery_date,
               pr.created_at, pr.updated_at,
               sr.request_number AS sr_request_number,
               p.serial_number AS project_serial_number, p.model_name AS project_model_name
        FROM purchase_requisitions pr
        LEFT JOIN erp_service_requests sr ON sr.id = pr.service_request_id
        LEFT JOIN erp_projects p ON p.id = pr.project_id
    """)).mappings().all()

    id_map: dict[int, tuple[int, str]] = {}  # old PR id -> (new p2p_requests.id, p2p_number)

    for pr in prs:
        p2p_number = pr["pr_number"]
        category_code = _CATEGORY_MAP.get(pr["category_code"], "OTH")
        if pr["project_serial_number"]:
            project_label = (
                f"{pr['project_serial_number']} — {pr['project_model_name']}"
                if pr["project_model_name"] else pr["project_serial_number"]
            )
        else:
            project_label = f"Project #{pr['project_id']}"

        remarks = f"Migrated from legacy Purchase Requisition {pr['pr_number']}."
        if pr["purchase_reason"]:
            remarks += f" Reason: {pr['purchase_reason']}"

        result = bind.execute(sa.text("""
            INSERT INTO p2p_requests (
                p2p_number, category_code, project_label, required_date, requirement_type,
                request_date, department, requested_by_id, priority, approver_id, approver_name,
                remarks, status, po_number, po_date, expected_delivery, created_at, updated_at
            ) VALUES (
                :p2p_number, :category_code, :project_label, :required_date, :requirement_type,
                :request_date, NULL, :requested_by_id, :priority, :approver_id, :approver_name,
                :remarks, :status, :po_number, :po_date, :expected_delivery, :created_at, :updated_at
            ) RETURNING id
        """), {
            "p2p_number": p2p_number,
            "category_code": category_code,
            "project_label": project_label,
            "required_date": pr["required_by_date"],
            "requirement_type": pr["requirement_type"],
            "request_date": pr["created_at"].date() if pr["created_at"] else None,
            "requested_by_id": pr["raised_by_id"],
            "priority": pr["priority"] or "medium",
            "approver_id": pr["approver_id"],
            "approver_name": pr["approver_name"],
            "remarks": remarks,
            "status": pr["status"],
            "po_number": pr["po_number"],
            "po_date": pr["po_date"],
            "expected_delivery": pr["expected_delivery_date"],
            "created_at": pr["created_at"],
            "updated_at": pr["updated_at"],
        })
        new_id = result.scalar_one()
        id_map[pr["id"]] = (new_id, p2p_number)

        items = bind.execute(sa.text("""
            SELECT material_name, part_number, unit, quantity_requested
            FROM purchase_requisition_items WHERE purchase_requisition_id = :old_pr_id
        """), {"old_pr_id": pr["id"]}).mappings().all()
        for item in items:
            bind.execute(sa.text("""
                INSERT INTO p2p_request_items (p2p_request_id, item_name, part_code, unit, quantity)
                VALUES (:p2p_request_id, :item_name, :part_code, :unit, :quantity)
            """), {
                "p2p_request_id": new_id,
                "item_name": item["material_name"],
                "part_code": item["part_number"],
                "unit": item["unit"],
                "quantity": item["quantity_requested"],
            })

        bind.execute(sa.text("""
            UPDATE erp_service_materials SET pr_id = :new_id, pr_number = :p2p_number
            WHERE pr_id = :old_pr_id
        """), {"new_id": new_id, "p2p_number": p2p_number, "old_pr_id": pr["id"]})

    _repoint_service_material_fk(bind, inspector)

    op.drop_table("purchase_requisition_items")
    op.drop_table("purchase_requisitions")


def _repoint_service_material_fk(bind, inspector) -> None:
    """Drop the old erp_service_materials.pr_id -> purchase_requisitions.id FK
    (if present) and add erp_service_materials.pr_id -> p2p_requests.id."""
    inspector = sa.inspect(bind)  # re-inspect in case tables were just modified
    fks = inspector.get_foreign_keys("erp_service_materials")
    old_fk_name = None
    for fk in fks:
        if fk["constrained_columns"] == ["pr_id"] and fk.get("referred_table") == "purchase_requisitions":
            old_fk_name = fk["name"]
            break

    with op.batch_alter_table("erp_service_materials") as batch_op:
        if old_fk_name:
            batch_op.drop_constraint(old_fk_name, type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_erp_service_materials_pr_id_p2p_requests",
            "p2p_requests", ["pr_id"], ["id"],
        )


def downgrade() -> None:
    """Best-effort structural downgrade only — recreates the two dropped
    tables (matching their final column set) so the schema isn't left
    broken, but does NOT restore the migrated data back out of p2p_requests,
    and does NOT repoint erp_service_materials.pr_id back to them."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "purchase_requisitions" not in existing_tables:
        op.create_table(
            "purchase_requisitions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("pr_number", sa.String(length=50), nullable=False, unique=True, index=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=False, index=True),
            sa.Column("service_request_id", sa.Integer(), sa.ForeignKey("erp_service_requests.id"), nullable=False, index=True),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="submitted"),
            sa.Column("raised_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("priority", sa.String(length=10), nullable=False, server_default="medium"),
            sa.Column("required_by_date", sa.Date(), nullable=True),
            sa.Column("purchase_reason", sa.Text(), nullable=True),
            sa.Column("category_code", sa.String(length=10), nullable=True),
            sa.Column("requirement_type", sa.String(length=50), nullable=True),
            sa.Column("approver_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("approver_name", sa.String(length=150), nullable=True),
            sa.Column("vendor", sa.String(length=255), nullable=True),
            sa.Column("po_number", sa.String(length=100), nullable=True),
            sa.Column("po_date", sa.Date(), nullable=True),
            sa.Column("expected_delivery_date", sa.Date(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("closed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )

    if "purchase_requisition_items" not in existing_tables:
        op.create_table(
            "purchase_requisition_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("purchase_requisition_id", sa.Integer(), sa.ForeignKey("purchase_requisitions.id"), nullable=False),
            sa.Column("service_material_id", sa.Integer(), sa.ForeignKey("erp_service_materials.id"), nullable=False),
            sa.Column("material_name", sa.String(length=255), nullable=False),
            sa.Column("part_number", sa.String(length=100), nullable=True),
            sa.Column("unit", sa.String(length=20), nullable=False, server_default="pcs"),
            sa.Column("quantity_requested", sa.Float(), nullable=False, server_default="1"),
            sa.Column("quantity_received", sa.Float(), nullable=False, server_default="0"),
            sa.Column("item_status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("remarks", sa.String(length=1000), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )

    # Repoint erp_service_materials.pr_id back to purchase_requisitions.id —
    # data-wise this will orphan rows currently pointing at p2p_requests ids
    # that don't exist in the recreated (empty) purchase_requisitions table,
    # but keeps the schema/FK shape consistent with pre-migration state.
    inspector = sa.inspect(bind)
    fks = inspector.get_foreign_keys("erp_service_materials")
    p2p_fk_name = None
    for fk in fks:
        if fk["constrained_columns"] == ["pr_id"] and fk.get("referred_table") == "p2p_requests":
            p2p_fk_name = fk["name"]
            break
    with op.batch_alter_table("erp_service_materials") as batch_op:
        if p2p_fk_name:
            batch_op.drop_constraint(p2p_fk_name, type_="foreignkey")
        batch_op.create_foreign_key(
            "erp_service_materials_pr_id_fkey", "purchase_requisitions", ["pr_id"], ["id"],
        )
