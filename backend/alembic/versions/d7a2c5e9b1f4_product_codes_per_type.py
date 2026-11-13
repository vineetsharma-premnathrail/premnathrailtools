"""Product codes = running number per type; only three product types.

Owner decision 2026-11-12: the product code is no longer typed. Each type has
its own series 01, 02, 03 … and the types are only Rail-road vehicle
(`vehicle`), Rail bound vehicle (`rail_bound_vehicle`) and Application.

- products.old_code keeps the hand-typed code (PRT-RRV-AUG, CWR-FEED …).
- attachment → application; machine / equipment / service → vehicle.
- Codes renumbered per type in id order; code is unique per (type, code).
- accounts_number_series gets PRODUCTS/<type> = last number used.
- Every changed product gets an audit row saying what it was.
- Role visibility rules (roles.visibility_rules["crm:products"].options.product_type)
  get the same type mapping, so a role limited to e.g. "machine" keeps working.

Downgrade puts the old codes back; the type merge can't be undone (the old
type is in the audit row).

Revision ID: d7a2c5e9b1f4
Revises: c9e4a7d1f3b8
"""
from alembic import op
import sqlalchemy as sa

revision = "d7a2c5e9b1f4"
down_revision = "c9e4a7d1f3b8"
branch_labels = None
depends_on = None

TYPE_MAP = {"attachment": "application", "machine": "vehicle", "equipment": "vehicle", "service": "vehicle"}
OLD_LABELS = {"vehicle": "Rail-road vehicle", "machine": "Machine", "equipment": "Equipment", "attachment": "Attachment / accessory",
              "service": "Paid service", "application": "Application"}
NEW_LABELS = {"vehicle": "Rail-road vehicle", "rail_bound_vehicle": "Rail bound vehicle", "application": "Application"}


def _drop_code_unique(insp) -> None:
    """The old unique index/constraint on products.code alone (name differs between installs)."""
    for ix in insp.get_indexes("products"):
        if ix["column_names"] == ["code"]:
            op.drop_index(ix["name"], table_name="products")
    for uc in insp.get_unique_constraints("products"):
        if uc["column_names"] == ["code"]:
            op.drop_constraint(uc["name"], "products", type_="unique")


def _remap_role_visibility(bind) -> None:
    """Roles that limit the product Type dropdown keep working with the new types."""
    import json
    for rid, rules in bind.execute(sa.text("SELECT id, visibility_rules FROM roles")).fetchall():
        data = json.loads(rules) if isinstance(rules, str) else (rules or {})
        opts = ((data.get("crm:products") or {}).get("options") or {})
        values = opts.get("product_type")
        if not isinstance(values, list):
            continue
        mapped = list(dict.fromkeys(TYPE_MAP.get(v, v) for v in values if TYPE_MAP.get(v, v) in NEW_LABELS))
        if mapped == values:
            continue
        opts["product_type"] = mapped
        bind.execute(sa.text("UPDATE roles SET visibility_rules = :r WHERE id = :id"), {"r": json.dumps(data), "id": rid})


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "old_code" not in {c["name"] for c in insp.get_columns("products")}:
        op.add_column("products", sa.Column("old_code", sa.String(30), nullable=True))
        op.create_index("ix_products_old_code", "products", ["old_code"])

    _drop_code_unique(insp)

    rows = bind.execute(sa.text("SELECT id, code, product_type FROM products ORDER BY id")).fetchall()
    counters: dict[str, int] = {}
    for pid, code, ptype in rows:
        new_type = TYPE_MAP.get(ptype, ptype if ptype in NEW_LABELS else "vehicle")
        counters[new_type] = counters.get(new_type, 0) + 1
        new_code = f"{counters[new_type]:02d}"
        # COALESCE: a re-run never overwrites the hand-typed code with an already-given number.
        bind.execute(sa.text("UPDATE products SET old_code = COALESCE(old_code, :old), code = :code, product_type = :t WHERE id = :id"),
                     {"old": code, "code": new_code, "t": new_type, "id": pid})
        parts = [f"code {code} → {new_code}"]
        if new_type != ptype:
            parts.append(f"type {OLD_LABELS.get(ptype, ptype)} → {NEW_LABELS[new_type]}")
        bind.execute(sa.text(
            "INSERT INTO audit_logs (entity_type, entity_id, action, field_name, old_value, new_value, summary, module_key, performed_at) "
            "VALUES ('product', :id, 'updated', 'Code', :old, :new, :summary, 'crm', now())"),
            {"id": pid, "old": code, "new": new_code,
             "summary": "Product codes became a running number per type (owner, 2026-11-12): " + "; ".join(parts) + "."})

    _remap_role_visibility(bind)

    op.create_index("ix_products_code", "products", ["code"])
    op.create_unique_constraint("uq_products_type_code", "products", ["product_type", "code"])

    for t, last in counters.items():
        key = f"PRODUCTS/{t}"
        if bind.execute(sa.text("SELECT 1 FROM accounts_number_series WHERE series_key = :k"), {"k": key}).first():
            bind.execute(sa.text("UPDATE accounts_number_series SET last_number = GREATEST(last_number, :n) WHERE series_key = :k"),
                         {"k": key, "n": last})
        else:
            bind.execute(sa.text("INSERT INTO accounts_number_series (series_key, last_number, created_at, updated_at) "
                                 "VALUES (:k, :n, now(), now())"), {"k": key, "n": last})


def downgrade() -> None:
    op.drop_constraint("uq_products_type_code", "products", type_="unique")
    op.drop_index("ix_products_code", table_name="products")
    op.execute("UPDATE products SET code = old_code WHERE old_code IS NOT NULL")
    # A product added after the upgrade has no old code; make its number unique again.
    op.execute("UPDATE products SET code = product_type || '-' || code WHERE old_code IS NULL")
    op.create_index("ix_products_code", "products", ["code"], unique=True)
    op.drop_index("ix_products_old_code", table_name="products")
    op.drop_column("products", "old_code")
    op.execute("DELETE FROM accounts_number_series WHERE series_key LIKE 'PRODUCTS/%'")
