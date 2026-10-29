"""Test helpers: point the Procurement approval workflows (central approval
engine, app/modules/p2p/approvals.py) at specific people, the way an admin
does in Organization › Approval Workflows."""
from app.modules.organization.services import approval_engine as engine
from app.modules.p2p.approvals import PO_KEY, PR_KEY


def set_pr_workflow(db, approver_ids, actor, mode="all"):
    """Every requisition submitted from now on goes to these people."""
    engine.save_workflow(db, PR_KEY, {"stages": [{
        "name": "PR approvers", "approver_rule": "specific_users",
        "rule_config": {"user_ids": list(approver_ids)}, "approval_mode": mode,
    }]}, actor)
    db.commit()


def set_po_workflow(db, approver_ids, actor, partner=False, mode="all"):
    """Every PO sent for approval from now on goes to these people (then any
    one Partner when `partner`)."""
    stages = []
    if approver_ids:
        stages.append({"name": "PO approvers", "approver_rule": "specific_users",
                       "rule_config": {"user_ids": list(approver_ids)}, "approval_mode": mode})
    if partner:
        stages.append({"name": "Partner (final approval)", "approver_rule": "partner"})
    engine.save_workflow(db, PO_KEY, {"stages": stages}, actor)
    db.commit()


# ── Item Master link (2026-10-11) ────────────────────────────────────────────
# Every PR line is picked from the Store Item Master (store_item_id); the
# server copies name / part code / unit / category from the master and
# ignores what the client typed. These helpers let a test keep writing lines
# by name: the master row is created with the name/unit/part code the test
# expects back.

def master_item(db, name, code=None, uom="NOS", **kw):
    """Get-or-create an active StoreItem called `name` and return it."""
    from app.modules.store.models.item import StoreItem

    item = db.query(StoreItem).filter(StoreItem.item_name == name).first()
    if item is not None:
        return item
    if code is None:
        n = db.query(StoreItem).count() + 1
        code = f"TST-{n:04d}"
        while db.query(StoreItem).filter(StoreItem.item_code == code).first() is not None:
            n += 1
            code = f"TST-{n:04d}"
    kw.setdefault("status", "active")
    item = StoreItem(item_code=code, item_name=name, uom=uom, **kw)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def link_line(db, line: dict) -> dict:
    """Give one PR line payload a store_item_id (in place, also returned):
    the master is got-or-created from the line's item_name/unit/part_code/
    category/make so the response snapshot matches what the test sent."""
    if line.get("store_item_id") or not line.get("item_name"):
        return line
    extra = {}
    if line.get("part_code"):
        extra["part_number"] = line["part_code"]
    if line.get("category"):
        extra["category"] = line["category"]
    if line.get("make"):
        extra["make"] = line["make"]
    line["store_item_id"] = master_item(db, line["item_name"], uom=line.get("unit") or "NOS", **extra).id
    return line


def link_items(db, payload: dict) -> dict:
    """Link every line of a PR / raise-pr payload to the Item Master."""
    for line in payload.get("items") or []:
        link_line(db, line)
    return payload


def attach_tally_po(db, po_id: int, ref: str | None = None) -> None:
    """Mark a draft PO as carrying its Tally PO (number + PDF), which
    submit_po_draft requires — for tests that aren't about the upload itself."""
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
    po = db.get(P2PPurchaseOrder, po_id)
    po.external_ref = ref or f"TALLY/{po.po_number}"
    po.document_filename = f"{po.po_number}.pdf"
    po.document_content_type = "application/pdf"
    po.document_sharepoint_path = f"test/{po.po_number}.pdf"
    # submit_po_draft also needs where the goods are delivered (ship-to store).
    if not po.ship_to_location_id:
        from app.modules.store.models.location import StoreLocation
        loc = db.query(StoreLocation).filter(StoreLocation.code == "TEST-SHIP").first()
        if loc is None:
            loc = StoreLocation(name="Test receiving store", code="TEST-SHIP", address="Test plant gate")
            db.add(loc)
            db.flush()
        po.ship_to_location_id = loc.id
    db.commit()
