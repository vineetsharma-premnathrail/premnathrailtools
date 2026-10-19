from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import ensure_can_delete, require_app_access, require_feature_action, require_tab_access, require_tab_action
from app.core.permission_registry import can_feature, can_view_tab
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.services import approval_engine as engine
from app.modules.production.authz import BOM_ENTITY, BOM_KEY, ensure_not_pending, submit_and_self_approve
from app.modules.production.models.bom import ProductionBom, ProductionBomItem, ProductionBomOperation
from app.modules.production.models.work_order import ProductionWorkOrder
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.production.schemas.bom import (
    ProductionBomCreate, ProductionBomUpdate, ProductionBomResponse,
    ProductionBomItemPayload, ProductionBomOperationPayload,
    ProductionBomFromDesignPayload, ProductionBomDesignDiff, ProductionDesignSource,
    ProductionBomDisciplineMergeResponse, ProductionBomMergeDisciplinePayload, ProductionDisciplineSource, ProductionExplosion,
)
from app.modules.production import discipline, effectivity, explosion
from app.modules.production.sensitive import mask_bom, mask_explosion, sees_costs
from app.modules.production import notify as prod_notify
from app.modules.production.models.bom import ProductionBomDisciplineMerge
from app.modules.production import design_transfer
from app.modules.design.models.bom import DesignBom, DesignBomRevision
from app.modules.production.service import generate_bom_number, bom_standard_cost, item_unit_cost
from app.modules.accounts.services.co_activity import workstation_rate_map
from app.modules.accounts.services.co_overhead import overhead_for
from app.modules.store.models.item import StoreItem

_CAN_CREATE = require_tab_action("production", "bom", "create")
_CAN_EDIT = require_tab_action("production", "bom", "edit")
_CAN_DELETE = require_tab_action("production", "bom", "delete")


router = APIRouter(
    prefix="/production/boms", tags=["Production"],
    dependencies=[Depends(require_app_access("production"))],
)


def _to_responses(db: Session, boms: list[ProductionBom], user: User | None = None) -> list[ProductionBomResponse]:
    """Batched: one query per related table for the whole list, not per BOM.
    With `user`, costs are blanked unless they hold the costs switch (BOM, or
    Work Orders — the New Work Order form reads a BOM)."""
    if not boms:
        return []
    item_ids = {b.product_item_id for b in boms} | {line.component_item_id for b in boms for line in b.items}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(item_ids)).all()}
    ws_ids = {op.workstation_id for b in boms for op in b.operations if op.workstation_id}
    workstations = {w.id: w for w in db.query(ProductionWorkstation).filter(ProductionWorkstation.id.in_(ws_ids)).all()} if ws_ids else {}
    rates = workstation_rate_map(db, set(workstations))  # CO activity prices, else flat hourly_rate
    user_ids = {b.created_by_id for b in boms} | {b.activated_by_id for b in boms} | {b.transferred_by_id for b in boms}
    user_ids.discard(None)
    design_ids = {b.design_bom_id for b in boms if b.design_bom_id}
    design_boms = {d.id: d for d in db.query(DesignBom).filter(DesignBom.id.in_(design_ids)).all()} if design_ids else {}
    users = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    wo_counts = dict(db.query(ProductionWorkOrder.bom_id, func.count(ProductionWorkOrder.id)).filter(
        ProductionWorkOrder.bom_id.in_([b.id for b in boms]), ProductionWorkOrder.is_deleted == False  # noqa: E712
    ).group_by(ProductionWorkOrder.bom_id).all())

    from app.modules.accounts.models.vendor import Vendor
    from app.modules.design.models.change_notice import DesignChangeNotice
    from app.modules.design.models.document import DesignDocument
    vendor_ids = {op.vendor_id for b in boms for op in b.operations if op.vendor_id}
    vendors = {v.id: v.name for v in db.query(Vendor).filter(Vendor.id.in_(vendor_ids)).all()} if vendor_ids else {}
    doc_ids = {line.document_id for b in boms for line in b.items if line.document_id}
    docs = {d.id: d for d in db.query(DesignDocument).filter(DesignDocument.id.in_(doc_ids)).all()} if doc_ids else {}
    ecn_ids = {b.ecn_id for b in boms if b.ecn_id}
    ecns = {e.id: e.ecn_number for e in db.query(DesignChangeNotice).filter(DesignChangeNotice.id.in_(ecn_ids)).all()} if ecn_ids else {}
    comp_ids = {line.component_item_id for b in boms for line in b.items if line.component_item_id}
    with_bom = {pid for (pid,) in db.query(ProductionBom.product_item_id).filter(
        ProductionBom.product_item_id.in_(comp_ids), ProductionBom.is_deleted == False,  # noqa: E712
        ProductionBom.status.in_(("active", "scheduled")),
    ).all()} if comp_ids else set()
    merges: dict[int, list] = {}
    for m in db.query(ProductionBomDisciplineMerge).filter(ProductionBomDisciplineMerge.bom_id.in_([b.id for b in boms])).all():
        merges.setdefault(m.bom_id, []).append(m)
    merge_user_ids = {m.merged_by_id for ms in merges.values() for m in ms if m.merged_by_id} - set(users)
    if merge_user_ids:
        users.update({u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(merge_user_ids)).all()})

    out = []
    for bom in boms:
        resp = ProductionBomResponse.model_validate(bom)
        resp.ecn_number = ecns.get(bom.ecn_id)
        resp.discipline_merges = []
        for m in merges.get(bom.id, []):
            mr = ProductionBomDisciplineMergeResponse.model_validate(m)
            mr.merged_by_name, mr.line_count = users.get(m.merged_by_id), len(m.quantities or {})
            resp.discipline_merges.append(mr)
        product = items.get(bom.product_item_id)
        if product:
            resp.product_code, resp.product_name, resp.product_uom = product.item_code, product.item_name, product.uom
        for line in resp.items:
            line.has_bom = line.component_item_id in with_bom
            doc = docs.get(line.document_id)
            if doc is not None:
                line.document_number = getattr(doc, "doc_number", None) or getattr(doc, "document_number", None)
            item = items.get(line.component_item_id)
            if item:
                line.item_code, line.item_name, line.uom = item.item_code, item.item_name, item.uom
                line.unit_cost = item_unit_cost(item)
        for op in resp.operations:
            ws = workstations.get(op.workstation_id)
            op.workstation_name = f"{ws.code} — {ws.name}" if ws else None
            op.vendor_name = vendors.get(op.vendor_id)
        resp.created_by_name = users.get(bom.created_by_id)
        resp.activated_by_name = users.get(bom.activated_by_id)
        resp.standard_material_cost, resp.standard_labour_cost = bom_standard_cost(db, bom, items=items, rates=rates)
        resp.standard_overhead_cost = overhead_for(db, getattr(bom, "branch_id", None), None, resp.standard_material_cost,
                                                   resp.standard_labour_cost)["overhead"]
        resp.work_order_count = wo_counts.get(bom.id, 0)
        design = design_boms.get(bom.design_bom_id)
        if design is not None:
            resp.design_bom_number = design.bom_number
            resp.transferred_by_name = users.get(bom.transferred_by_id)
            latest = design_transfer.released_revision(design)
            if latest is not None:
                resp.latest_design_revision_id, resp.latest_design_revision_label = latest.id, latest.revision_label
                # Only the product's live versions can go out of date.
                resp.design_outdated = bom.status in ("draft", "active") and latest.id != bom.design_bom_revision_id
        out.append(resp)
    if user is not None and not sees_costs(user, "bom", "work_orders"):
        for resp in out:
            mask_bom(resp)
    return out


def _to_response(db: Session, bom: ProductionBom, user: User | None = None) -> ProductionBomResponse:
    return _to_responses(db, [bom], user)[0]


def _get_or_404(db: Session, bom_id: int) -> ProductionBom:
    bom = db.query(ProductionBom).filter(ProductionBom.is_deleted == False, ProductionBom.id == bom_id).first()  # noqa: E712
    if not bom:
        raise HTTPException(status_code=404, detail=f"BOM #{bom_id} not found")
    return bom


def _require_draft(bom: ProductionBom, action: str, db: Session | None = None) -> None:
    if bom.status != "draft":
        raise HTTPException(
            status_code=409,
            detail=f"BOM {bom.bom_number} is {bom.status}, so it can't be {action}. "
                   "Use 'New Version' to create an editable draft copy instead.",
        )
    if db is not None:
        ensure_not_pending(db, BOM_ENTITY, bom.id, f"BOM {bom.bom_number}", action)


def _validate_categories(db: Session, items: list[ProductionBomItemPayload]) -> None:
    """CS01 item categories: stock / non-stock lines need an Item Master
    code; a text line needs its text; a document line its drawing."""
    for n, line in enumerate(items, start=1):
        cat = line.item_category or "stock"
        if cat in ("stock", "non_stock") and not line.component_item_id:
            raise HTTPException(status_code=400, detail=f"Line {n} is a {cat.replace('_', '-')} item but has no component. Pick the Store item, "
                                                        "or change the line to a text / document line.")
        if cat == "text" and not (line.line_text or "").strip():
            raise HTTPException(status_code=400, detail=f"Line {n} is a text line — enter the text (e.g. an assembly note) or remove the line.")
        if cat == "text":
            line.component_item_id = None
        if cat == "document":
            if not line.document_id:
                raise HTTPException(status_code=400, detail=f"Line {n} is a document line — pick the Design drawing / document it refers to.")
            from app.modules.design.models.document import DesignDocument
            if not db.query(DesignDocument.id).filter(DesignDocument.id == line.document_id).first():
                raise HTTPException(status_code=404, detail=f"Line {n}: Design document #{line.document_id} not found.")


def _validate_operations(db: Session, operations: list[ProductionBomOperationPayload]) -> None:
    """CA01 control keys: an external (subcontracted) step names its job-work vendor."""
    from app.modules.accounts.models.vendor import Vendor
    for op in operations:
        if (getattr(op, "control_key", None) or "internal") != "external":
            continue
        if not op.vendor_id:
            raise HTTPException(status_code=400, detail=f"Operation {op.sequence} {op.operation_name} is external (subcontracted) — pick the "
                                                        "job-work vendor who does it.")
        vendor = db.query(Vendor).filter(Vendor.id == op.vendor_id).first()
        if vendor is None:
            raise HTTPException(status_code=404, detail=f"Vendor #{op.vendor_id} (operation {op.sequence}) not found in the vendor master.")
        status = getattr(vendor, "status", None)
        if status and status != "active":
            raise HTTPException(status_code=409, detail=f"Vendor {vendor.name} is {status}, so a job-work step can't be given to it. "
                                                        "Pick an active vendor, or unblock it in Finance › Vendors.")


def _validate_lines(
    db: Session, product_item_id: int,
    items: list[ProductionBomItemPayload], operations: list[ProductionBomOperationPayload],
) -> None:
    _validate_categories(db, items)
    _validate_operations(db, operations)
    component_ids = [line.component_item_id for line in items
                     if line.component_item_id and (line.item_category or "stock") in ("stock", "non_stock")]
    if product_item_id in component_ids:
        raise HTTPException(status_code=400, detail="A product can't be a component of its own BOM. Remove it from the component list.")
    if len(component_ids) != len(set(component_ids)):
        raise HTTPException(status_code=400, detail="The same component is listed more than once. Merge the duplicate lines into one quantity.")
    found = {i.id for i in db.query(StoreItem.id).filter(StoreItem.id.in_(component_ids)).all()} if component_ids else set()
    missing = [str(i) for i in component_ids if i not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"Component item(s) #{', #'.join(missing)} not found in the Store item master")
    inactive = [i.item_code for i in db.query(StoreItem).filter(StoreItem.id.in_(component_ids), StoreItem.status != "active").all()] if component_ids else []
    if inactive:
        raise HTTPException(status_code=409, detail=f"Component(s) {', '.join(inactive)} are inactive or discontinued in Store. Pick an active replacement or reactivate them in Store first.")

    sequences = [op.sequence for op in operations]
    if len(sequences) != len(set(sequences)):
        raise HTTPException(status_code=400, detail="Two routing operations share the same sequence number. Give each operation a unique sequence (e.g. 10, 20, 30).")
    ws_ids = {op.workstation_id for op in operations if op.workstation_id}
    if ws_ids:
        found_ws = {w.id for w in db.query(ProductionWorkstation.id).filter(
            ProductionWorkstation.id.in_(ws_ids), ProductionWorkstation.is_deleted == False  # noqa: E712
        ).all()}
        missing_ws = [str(i) for i in ws_ids if i not in found_ws]
        if missing_ws:
            raise HTTPException(status_code=404, detail=f"Workstation(s) #{', #'.join(missing_ws)} not found")


def _replace_lines(
    bom: ProductionBom,
    items: list[ProductionBomItemPayload] | None, operations: list[ProductionBomOperationPayload] | None,
) -> None:
    if items is not None:
        bom.items = [
            ProductionBomItem(
                component_item_id=line.component_item_id if (line.item_category or "stock") != "text" else None, quantity=line.quantity,
                scrap_percent=line.scrap_percent, remarks=line.remarks, sort_order=idx, make_buy=line.make_buy,
                item_category=line.item_category or "stock", line_text=(line.line_text or "").strip() or None,
                document_id=line.document_id if (line.item_category or "stock") == "document" else None,
                source_tag=line.source_tag,
            )
            for idx, line in enumerate(items)
        ]
    if operations is not None:
        bom.operations = [
            ProductionBomOperation(
                sequence=op.sequence, operation_name=op.operation_name.strip(), workstation_id=op.workstation_id,
                setup_hours=op.setup_hours, run_hours_per_unit=op.run_hours_per_unit,
                requires_inspection=op.requires_inspection, instructions=op.instructions,
                control_key=op.control_key, confirmation=op.confirmation, print_on_job_card=op.print_on_job_card,
                vendor_id=op.vendor_id if op.control_key == "external" else None,
                external_cost=op.external_cost if op.control_key == "external" else None,
            )
            for op in sorted(operations, key=lambda o: o.sequence)
        ]


def _check_window(valid_from, valid_to) -> None:
    try:
        effectivity.validate_window(valid_from, valid_to)
    except effectivity.EffectivityError as e:
        raise HTTPException(status_code=e.status, detail=str(e))


def _item_payload(i: ProductionBomItem, quantity: float | None = None) -> ProductionBomItemPayload:
    """A stored line as an edit payload (keeps category, text and source)."""
    return ProductionBomItemPayload(
        component_item_id=i.component_item_id, quantity=quantity if quantity is not None else i.quantity,
        scrap_percent=i.scrap_percent, remarks=i.remarks, make_buy=i.make_buy, item_category=i.item_category or "stock",
        line_text=i.line_text, document_id=i.document_id, source_tag=i.source_tag,
    )


def _copy_operation(o: ProductionBomOperation) -> ProductionBomOperation:
    return ProductionBomOperation(
        sequence=o.sequence, operation_name=o.operation_name, workstation_id=o.workstation_id, setup_hours=o.setup_hours,
        run_hours_per_unit=o.run_hours_per_unit, requires_inspection=o.requires_inspection, instructions=o.instructions,
        control_key=o.control_key or "internal", confirmation=o.confirmation or "optional",
        print_on_job_card=True if o.print_on_job_card is None else o.print_on_job_card,
        vendor_id=o.vendor_id, external_cost=o.external_cost,
    )


def _next_version(db: Session, product_item_id: int) -> int:
    last = db.query(func.max(ProductionBom.version)).filter(ProductionBom.product_item_id == product_item_id).scalar()
    return (last or 0) + 1


@router.get("", response_model=list[ProductionBomResponse])
async def list_boms(
    status_filter: str | None = Query(None, alias="status"),
    product_item_id: int | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("production", "bom")),
):
    if effectivity.apply_due_effectivity(db):
        db.commit()
    query = db.query(ProductionBom).filter(ProductionBom.is_deleted == False)  # noqa: E712
    if status_filter:
        query = query.filter(ProductionBom.status == status_filter)
    if product_item_id:
        query = query.filter(ProductionBom.product_item_id == product_item_id)
    if search:
        like = f"%{search}%"
        query = query.join(StoreItem, StoreItem.id == ProductionBom.product_item_id).filter(
            (ProductionBom.bom_number.ilike(like)) | (StoreItem.item_name.ilike(like)) | (StoreItem.item_code.ilike(like))
        )
    return _to_responses(db, query.order_by(ProductionBom.created_at.desc()).all(), _tab)


@router.post("", response_model=ProductionBomResponse)
async def create_bom(
    payload: ProductionBomCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(_CAN_CREATE),
):
    product = db.query(StoreItem).filter(StoreItem.id == payload.product_item_id).first()
    if not product:
        raise HTTPException(status_code=404, detail=f"Product item #{payload.product_item_id} not found in the Store item master")
    if product.status != "active":
        raise HTTPException(status_code=409, detail=f"Product {product.item_code} is {product.status} in Store. Reactivate it in Store before building a BOM for it.")
    released = design_transfer.released_design_for_product(db, product.id)
    if released:
        dbom, drev = released
        raise HTTPException(
            status_code=409,
            detail=f"{product.item_code} has a released Design BOM ({dbom.bom_number} {drev.revision_label}), so its components "
                   "must come from Design, not be keyed in by hand. Use 'Transfer from Design' on the BOM & Routing page, "
                   "then add the routing and any shop consumables to that draft.",
        )
    existing_draft = db.query(ProductionBom).filter(
        ProductionBom.product_item_id == payload.product_item_id,
        ProductionBom.status == "draft",
        ProductionBom.is_deleted == False,  # noqa: E712
    ).first()
    if existing_draft:
        raise HTTPException(
            status_code=409,
            detail=f"{existing_draft.bom_number} (v{existing_draft.version}) is already an open draft for this product. "
                   "Edit or activate that draft instead of starting another one.",
        )
    _validate_lines(db, payload.product_item_id, payload.items, payload.operations)
    _check_window(payload.valid_from, payload.valid_to)

    bom = ProductionBom(
        bom_number=generate_bom_number(db),
        product_item_id=payload.product_item_id,
        version=_next_version(db, payload.product_item_id),
        base_quantity=payload.base_quantity,
        description=payload.description,
        remarks=payload.remarks,
        status="draft",
        created_by_id=user.id,
        valid_from=payload.valid_from, valid_to=payload.valid_to,
        change_number=(payload.change_number or "").strip() or None,
    )
    _replace_lines(bom, payload.items, payload.operations)
    db.add(bom)
    db.commit()
    db.refresh(bom)
    return _to_response(db, bom, user)


# ---------------------------------------------------------------------------
# eBOM -> mBOM transfer
# ---------------------------------------------------------------------------

def _mbom_state(boms: list[ProductionBom], rev: DesignBomRevision) -> tuple[str, ProductionBom | None]:
    """Where Production stands on a released eBOM revision: the active mBOM
    or a draft taken from it, a live mBOM from an older revision (or keyed by
    hand before Design released one), or nothing yet."""
    live = [b for b in boms if b.status in ("draft", "active")]
    for status, state in (("active", "current"), ("draft", "draft")):
        hit = next((b for b in live if b.status == status and b.design_bom_revision_id == rev.id), None)
        if hit:
            return state, hit
    other = next((b for b in live if b.status == "active"), None) or next((b for b in live if b.status == "draft"), None)
    return ("outdated", other) if other else ("none", None)


@router.get("/design-sources", response_model=list[ProductionDesignSource])
async def list_design_sources(
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_feature_action("production", "bom", "design_link", "view")),
):
    """Released Design BOM revisions Production can build from, with the
    state of the matching mBOM — 'none' and 'outdated' are the to-do list."""
    designs = [d for d in design_transfer.live_design_boms(db) if design_transfer.released_revision(d)]
    product_ids = {d.product_item_id for d in designs}
    products = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(product_ids)).all()} if product_ids else {}
    mboms: dict[int, list[ProductionBom]] = {}
    if product_ids:
        for b in db.query(ProductionBom).filter(
            ProductionBom.product_item_id.in_(product_ids), ProductionBom.is_deleted == False,  # noqa: E712
        ).all():
            mboms.setdefault(b.product_item_id, []).append(b)
    needle = (search or "").strip().lower()
    out = []
    for d in designs:
        rev = design_transfer.released_revision(d)
        product = products.get(d.product_item_id)
        haystack = (d.bom_number, d.title, product.item_code if product else None, product.item_name if product else None)
        if needle and not any(needle in (v or "").lower() for v in haystack):
            continue
        state, mbom = _mbom_state(mboms.get(d.product_item_id, []), rev)
        out.append(ProductionDesignSource(
            design_bom_id=d.id, design_bom_number=d.bom_number, title=d.title, design_bom_revision_id=rev.id,
            revision_label=rev.revision_label, released_at=rev.released_at, line_count=len(rev.lines),
            product_item_id=d.product_item_id, product_code=product.item_code if product else None,
            product_name=product.item_name if product else None, mbom_state=state,
            mbom_id=mbom.id if mbom else None, mbom_number=mbom.bom_number if mbom else None,
            mbom_version=mbom.version if mbom else None, mbom_status=mbom.status if mbom else None,
            mbom_revision_label=mbom.design_revision_label if mbom else None,
        ))
    order = {"none": 0, "outdated": 1, "draft": 2, "current": 3}
    out.sort(key=lambda r: (order[r.mbom_state], r.design_bom_number))
    return out


def _load_released_revision(db: Session, revision_id: int) -> tuple[DesignBom, DesignBomRevision]:
    rev = db.query(DesignBomRevision).filter(DesignBomRevision.id == revision_id, DesignBomRevision.is_deleted == False).first()  # noqa: E712
    if rev is None:
        raise HTTPException(status_code=404, detail=f"Design BOM revision #{revision_id} not found")
    design = db.query(DesignBom).filter(DesignBom.id == rev.bom_id, DesignBom.is_deleted == False).first()  # noqa: E712
    if design is None:
        raise HTTPException(status_code=404, detail=f"The Design BOM of revision #{revision_id} was deleted")
    ref = f"{design.bom_number} {rev.revision_label}"
    if design.status == "obsolete":
        raise HTTPException(status_code=409, detail=f"{design.bom_number} is obsolete in Design, so it can't be transferred to Production. "
                                                    "Ask Design which BOM replaces it.")
    if rev.status != "released":
        hint = ("Design has superseded it — transfer the current released revision instead."
                if rev.status == "superseded" else "Only a released revision can be transferred — ask Design to finish its review and approval.")
        raise HTTPException(status_code=409, detail=f"{ref} is {rev.status.replace('_', ' ')}, not released. {hint}")
    return design, rev


@router.post("/from-design", response_model=ProductionBomResponse)
async def transfer_from_design(
    payload: ProductionBomFromDesignPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(require_feature_action("production", "bom", "design_link", "create")),
):
    """Takes the components of a released Design BOM revision into a draft
    Production BOM, keeping the link. The product's open draft (if any) is
    refreshed — Design's components replaced, scrap allowances, Production's
    own extra lines and the routing kept; otherwise the next version is
    started with the routing of the current active version. The draft then
    goes through the usual activation approval."""
    design, rev = _load_released_revision(db, payload.design_bom_revision_id)
    bom = transfer_revision(db, design, rev, user)
    db.commit()
    db.refresh(bom)
    return _to_response(db, bom, user)


def transfer_revision(db: Session, design: DesignBom, rev: DesignBomRevision, user: User) -> ProductionBom:
    """eBOM -> mBOM for one released revision (no commit). Also used when an
    ECN is implemented (production/ecm.py)."""
    ref = f"{design.bom_number} {rev.revision_label}"
    product = db.query(StoreItem).filter(StoreItem.id == design.product_item_id).first()
    if not product:
        raise HTTPException(status_code=404, detail=f"The product of {ref} (item #{design.product_item_id}) is no longer in the Store item master")
    if product.status != "active":
        raise HTTPException(status_code=409, detail=f"Product {product.item_code} is {product.status} in Store. Reactivate it in Store before building a BOM for it.")
    components = [c for c in design_transfer.design_components(rev) if c.quantity > 0]
    if not components:
        raise HTTPException(status_code=400, detail=f"{ref} has no lines with an Item Master code and a quantity, so there is nothing to transfer.")
    design_ids = {c.item_id for c in components}
    items = [ProductionBomItemPayload(component_item_id=c.item_id, quantity=c.quantity, remarks=c.remarks, make_buy=c.make_buy)
             for c in components]

    draft = db.query(ProductionBom).filter(
        ProductionBom.product_item_id == product.id, ProductionBom.status == "draft",
        ProductionBom.is_deleted == False,  # noqa: E712
    ).first()
    if draft is not None:
        ensure_not_pending(db, BOM_ENTITY, draft.id, f"BOM {draft.bom_number}", "refreshed from Design")
        per_unit = 1.0 / (draft.base_quantity or 1.0)
        scrap = {i.component_item_id: i.scrap_percent for i in draft.items}
        for line in items:
            line.scrap_percent = scrap.get(line.component_item_id, 0.0)
        # Lines Production keyed itself (no make/buy from Design, not in the
        # eBOM) — e.g. shop consumables — stay on the draft.
        # Text / document lines stay too. Discipline (E/H) lines are put back
        # from their merge records below, so they aren't kept twice.
        items += [
            _item_payload(i, round(i.quantity * per_unit, 4))
            for i in draft.items
            if i.make_buy is None and not i.source_tag and (i.component_item_id is None or i.component_item_id not in design_ids)
        ]
        _validate_lines(db, product.id, items, [])
        bom = draft
        bom.base_quantity = 1.0
        _replace_lines(bom, items, None)
        discipline.reapply_merges(db, bom)
    else:
        active = db.query(ProductionBom).filter(
            ProductionBom.product_item_id == product.id, ProductionBom.status == "active",
            ProductionBom.is_deleted == False,  # noqa: E712
        ).first()
        _validate_lines(db, product.id, items, [])
        bom = ProductionBom(
            bom_number=generate_bom_number(db), product_item_id=product.id, version=_next_version(db, product.id),
            base_quantity=1.0, description=design.title, status="draft", created_by_id=user.id,
            remarks=f"Transferred from Design {ref}" + (f"; routing copied from {active.bom_number} v{active.version}" if active else ""),
        )
        _replace_lines(bom, items, None)
        if active is not None:
            bom.operations = [_copy_operation(o) for o in active.operations]
            # Shop text lines and merged E/H parts of the active version carry over.
            for i in active.items:
                if (i.item_category or "stock") in ("text", "document") and i.make_buy is None:
                    bom.items.append(ProductionBomItem(
                        component_item_id=i.component_item_id, quantity=i.quantity, scrap_percent=i.scrap_percent, remarks=i.remarks,
                        sort_order=len(bom.items), item_category=i.item_category, line_text=i.line_text, document_id=i.document_id,
                    ))
        db.add(bom)
        db.flush()
        if active is not None:
            discipline.carry_merges(db, active, bom)
            db.flush()
            discipline.reapply_merges(db, bom)
    bom.design_bom_id, bom.design_bom_revision_id, bom.design_revision_label = design.id, rev.id, rev.revision_label
    bom.transferred_at, bom.transferred_by_id = datetime.now(timezone.utc), user.id
    db.flush()
    return bom


def _check_design_current(db: Session, bom: ProductionBom) -> None:
    """A draft taken from an eBOM revision Design has since superseded can't
    be activated — it would put an out-of-date structure on the shop floor."""
    if not bom.design_bom_id:
        return
    design = db.query(DesignBom).filter(DesignBom.id == bom.design_bom_id).first()
    latest = design_transfer.released_revision(design) if design else None
    if latest is not None and latest.id != bom.design_bom_revision_id:
        raise HTTPException(
            status_code=409,
            detail=f"{bom.bom_number} was taken from {design.bom_number} {bom.design_revision_label}, but Design has since released "
                   f"{latest.revision_label}. Use 'Refresh from Design' to pull in the current components before activating it.",
        )


def _can_read_bom(user: User = Depends(get_current_user)) -> User:
    # The New Work Order form loads the chosen BOM's lines, so Work Orders
    # users may read a BOM without holding the BOM & Routing tab itself.
    if not (can_view_tab(user, "production", "bom") or can_view_tab(user, "production", "work_orders")):
        raise HTTPException(
            status_code=403,
            detail="You need the BOM & Routing or Work Orders tab in Production to open a BOM. "
                   "Ask an admin to grant one in Users › Permission Matrix.",
        )
    return user


@router.get("/{bom_id}", response_model=ProductionBomResponse)
async def get_bom(
    bom_id: int,
    db: Session = Depends(get_db),
    _tab: User = Depends(_can_read_bom),
):
    bom = _get_or_404(db, bom_id)
    if effectivity.apply_due_effectivity(db, bom.product_item_id):
        db.commit()
        db.refresh(bom)
    return _to_response(db, bom, _tab)


@router.get("/{bom_id}/explosion", response_model=ProductionExplosion)
async def bom_explosion(
    bom_id: int,
    qty: float | None = Query(None, gt=0),
    levels: int = Query(explosion.MAX_DEPTH, ge=1, le=explosion.MAX_DEPTH),
    db: Session = Depends(get_db),
    _tab: User = Depends(require_feature_action("production", "bom", "explosion", "view")),
):
    """CS11/CS12: multi-level (indented) explosion through each sub-assembly's
    own valid BOM, with cumulative quantities (incl. scrap) and leaf cost."""
    bom = _get_or_404(db, bom_id)
    payload = explosion.explosion_payload(db, bom, qty or bom.base_quantity or 1.0, levels)
    if not sees_costs(_tab, "bom"):
        mask_explosion(payload)
    return payload


@router.get("/discipline-sources/list", response_model=list[ProductionDisciplineSource])
async def list_discipline_sources(
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_feature_action("production", "bom", "discipline_merge", "view")),
):
    """Electrical job BOMs and hydraulic BOMs, with whether each can be merged
    into a Production BOM yet (released + every line on an Item Master code)."""
    return discipline.list_sources(db, search)


@router.post("/{bom_id}/merge-discipline", response_model=ProductionBomResponse)
async def merge_discipline_bom(
    bom_id: int,
    payload: ProductionBomMergeDisciplinePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("production", "bom", "discipline_merge", "create")),
):
    """CWBPP: merge an electrical / hydraulic BOM into this draft, tagged with
    its source. Merging the same source again replaces its earlier quantities."""
    bom = _get_or_404(db, bom_id)
    _require_draft(bom, "changed", db)
    try:
        discipline.merge_into(db, bom, payload.source_type, payload.source_id, payload.multiplier, user.id)
    except discipline.DisciplineError as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e))
    db.commit()
    db.refresh(bom)
    return _to_response(db, bom, user)


@router.delete("/{bom_id}/discipline-merges/{merge_id}", response_model=ProductionBomResponse)
async def remove_discipline_merge(
    bom_id: int, merge_id: int,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_feature_action("production", "bom", "discipline_merge", "delete")),
):
    """Takes a merged electrical / hydraulic BOM back out of the draft."""
    bom = _get_or_404(db, bom_id)
    _require_draft(bom, "changed", db)
    merge = db.query(ProductionBomDisciplineMerge).filter(
        ProductionBomDisciplineMerge.id == merge_id, ProductionBomDisciplineMerge.bom_id == bom.id).first()
    if merge is None:
        raise HTTPException(status_code=404, detail=f"Merge #{merge_id} is not part of {bom.bom_number}")
    by_item = {i.component_item_id: i for i in bom.items if i.component_item_id}
    for key, q in (merge.quantities or {}).items():
        line = by_item.get(int(key))
        if line is None:
            continue
        line.quantity = round(line.quantity - float(q), 4)
        tags = [t for t in (line.source_tag or "").split("; ") if t and t != merge.source_label]
        line.source_tag = "; ".join(tags) or None
        if line.quantity <= 1e-9:
            bom.items.remove(line)
    db.delete(merge)
    db.commit()
    db.refresh(bom)
    return _to_response(db, bom, _perm)


@router.get("/{bom_id}/design-diff", response_model=ProductionBomDesignDiff)
async def design_diff(
    bom_id: int,
    revision_id: int | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_feature_action("production", "bom", "design_link", "view")),
):
    """This BOM's components against its Design BOM — the latest released
    revision by default, or `revision_id` (e.g. the one it was taken from)."""
    bom = _get_or_404(db, bom_id)
    if not bom.design_bom_id:
        raise HTTPException(status_code=409, detail=f"{bom.bom_number} wasn't transferred from a Design BOM, so there is nothing to compare it with.")
    design = db.query(DesignBom).filter(DesignBom.id == bom.design_bom_id).first()
    if design is None:
        raise HTTPException(status_code=404, detail=f"The Design BOM {bom.bom_number} was taken from no longer exists.")
    latest = design_transfer.released_revision(design)
    if revision_id is not None:
        rev = db.query(DesignBomRevision).filter(DesignBomRevision.id == revision_id, DesignBomRevision.bom_id == design.id).first()
        if rev is None:
            raise HTTPException(status_code=404, detail=f"Revision #{revision_id} doesn't belong to {design.bom_number}.")
    else:
        rev = latest or db.query(DesignBomRevision).filter(DesignBomRevision.id == bom.design_bom_revision_id).first()
    if rev is None:
        raise HTTPException(status_code=404, detail=f"The revision of {design.bom_number} this BOM was taken from no longer exists.")
    rows = design_transfer.diff_rows(db, bom, rev)
    return ProductionBomDesignDiff(
        bom_id=bom.id, design_bom_id=design.id, design_bom_number=design.bom_number, design_bom_title=design.title,
        compared_revision_id=rev.id, compared_revision_label=rev.revision_label, linked_revision_label=bom.design_revision_label,
        latest_released_label=latest.revision_label if latest else None,
        outdated=bool(latest and latest.id != bom.design_bom_revision_id),
        differences=sum(1 for r in rows if r["change"] != "same"), rows=rows,
    )


@router.patch("/{bom_id}", response_model=ProductionBomResponse)
async def update_bom(bom_id: int, payload: ProductionBomUpdate, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    bom = _get_or_404(db, bom_id)
    _require_draft(bom, "edited", db)
    updates = payload.model_dump(exclude_unset=True, exclude={"items", "operations"})
    _check_window(updates.get("valid_from", bom.valid_from), updates.get("valid_to", bom.valid_to))
    if "change_number" in updates:
        updates["change_number"] = (updates["change_number"] or "").strip() or None
    _validate_lines(
        db, bom.product_item_id,
        payload.items if payload.items is not None else [_item_payload(i) for i in bom.items],
        payload.operations if payload.operations is not None else [],
    )
    for field, val in updates.items():
        setattr(bom, field, val)
    if payload.items is not None:
        # The edit form doesn't carry Design's make/buy — keep it per component.
        kept = {i.component_item_id: i.make_buy for i in bom.items}
        tags = {i.component_item_id: i.source_tag for i in bom.items if i.component_item_id}
        for line in payload.items:
            if line.make_buy is None:
                line.make_buy = kept.get(line.component_item_id)
            if line.source_tag is None and line.component_item_id:
                line.source_tag = tags.get(line.component_item_id)
    if payload.operations is not None and not sees_costs(_perm, "bom", "work_orders"):
        # The user never saw the external charges (costs switch) — a blank one
        # in their payload means "unchanged", not "cleared".
        kept_cost = {o.sequence: o.external_cost for o in bom.operations}
        for op in payload.operations:
            if op.external_cost is None and op.control_key == "external":
                op.external_cost = kept_cost.get(op.sequence)
    _replace_lines(bom, payload.items, payload.operations)
    db.commit()
    db.refresh(bom)
    return _to_response(db, bom, _perm)


def _activate(db: Session, bom: ProductionBom, user: User) -> None:
    """Makes a draft BOM the product's active version (the previous active
    one becomes obsolete). Runs when its activation is approved."""
    _require_draft(bom, "activated")
    if not bom.items:
        raise HTTPException(status_code=400, detail=f"BOM {bom.bom_number} has no components. Add at least one component before activating it.")
    _check_design_current(db, bom)
    _validate_lines(
        db, bom.product_item_id,
        [_item_payload(i) for i in bom.items],
        [ProductionBomOperationPayload(sequence=o.sequence, operation_name=o.operation_name, workstation_id=o.workstation_id,
                                       control_key=o.control_key or "internal", vendor_id=o.vendor_id) for o in bom.operations],
    )

    # One active version per product: the previous one becomes obsolete —
    # or, when this version is valid only from a later date, runs until the
    # day before (status "scheduled" here meanwhile). Work orders already
    # exploded from it keep their own material lines.
    try:
        status = effectivity.activate_version(db, bom, user.id)
    except effectivity.EffectivityError as e:
        raise HTTPException(status_code=e.status, detail=str(e))
    product = db.query(StoreItem).filter(StoreItem.id == bom.product_item_id).first()
    when = f"in force from {bom.valid_from:%d-%m-%Y}" if status == "scheduled" and bom.valid_from else "now the active version"
    prod_notify.fire(db, "bom_activated", record=bom, entity_type=BOM_ENTITY, actor=user,
                     title=f"BOM activated: {bom.bom_number} v{bom.version}",
                     message=f"{bom.bom_number} v{bom.version} for {product.item_code + ' — ' + product.item_name if product else 'the product'} "
                             f"is {when}. New work orders explode from it.")
    if bom.ecn_id or bom.change_number:
        when = f"from {bom.valid_from:%d-%m-%Y}" if status == "scheduled" else "now"
        serial = f" (machines from serial {bom.effective_serial})" if bom.effective_serial else ""
        effectivity.flag_open_orders(
            db, bom.product_item_id, ecn_id=bom.ecn_id, exclude_bom_id=bom.id, actor_id=user.id,
            message=f"{bom.bom_number} v{bom.version} ({bom.change_number or 'engineering change'}) is in force {when}{serial}. "
                    "This order was built to an earlier BOM version — review its material and routing, decide on the WIP, "
                    "then clear the flag with what was done.",
        )


def _bom_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    if outcome != "approved":
        return  # rejected / returned / withdrawn: it simply stays a draft
    bom = db.query(ProductionBom).filter(ProductionBom.id == req.entity_id, ProductionBom.is_deleted == False).first()  # noqa: E712
    if bom is None:
        raise HTTPException(status_code=409, detail=f"BOM #{req.entity_id} was deleted — reject or withdraw this approval instead.")
    _activate(db, bom, actor)


engine.register_transaction(engine.TransactionType(
    key=BOM_KEY, module_key="production", subtab_key="bom", label="BOM activation",
    feature_key="lifecycle",  # inbox decides on BOM › Activate, obsolete & new versions › Approve
    entity_type=BOM_ENTITY, url="/dashboard/production/bom/{id}",
    description="A draft BOM becomes the product's active version (the previous one goes obsolete).",
    default_stages=[engine.StageDef("BOM approver", "permission", {"permission": "production:bom:approve"})],
    # As before: anyone holding BOM › Approve activates — including their own draft.
    require_permission=True, allow_self_approval=True,
    on_decided=_bom_decided,
))


@router.post("/{bom_id}/activate", response_model=ProductionBomResponse)
async def activate_bom(
    bom_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
):
    """Submits the draft for activation through the central approval engine
    (workflow "production.bom_activation"). A BOM approver activates it in
    the same click; a user with only Edit sends it to the approvers."""
    if not (can_feature(user, "production", "bom", "lifecycle", "approve") or can_feature(user, "production", "bom", "lifecycle", "submit")):
        raise HTTPException(status_code=403, detail="You need 'Submit' (to submit) or 'Approve' (to activate) on Production › BOM & Routing › "
                                                    "Activate, obsolete & new versions. Ask an admin to grant it in Organization › Role & Permissions.")
    bom = _get_or_404(db, bom_id)
    _require_draft(bom, "activated")
    if not bom.items:
        raise HTTPException(status_code=400, detail=f"BOM {bom.bom_number} has no components. Add at least one component before activating it.")
    _check_design_current(db, bom)
    try:
        req = submit_and_self_approve(
            db, BOM_KEY, entity_id=bom.id, requester=user, title=f"BOM {bom.bom_number} v{bom.version} activation",
            reference=bom.bom_number, admin_note="Activated directly by an admin",
        )
    except HTTPException:
        db.rollback()
        raise
    if req.status == "pending":
        prod_notify.fire(db, "bom_activation_submitted", record=bom, entity_type=BOM_ENTITY, actor=user,
                         skip=prod_notify.pending_approver_ids(req), background_tasks=background_tasks,
                         title=f"BOM waiting for activation: {bom.bom_number} v{bom.version}",
                         message=f"{user.name or user.email} submitted {bom.bom_number} v{bom.version} ({len(bom.items)} component(s)) "
                                 "for activation. Review it and approve in the Approval inbox or on the BOM.")
    db.commit()
    db.refresh(bom)
    return _to_response(db, bom, user)


@router.post("/{bom_id}/obsolete", response_model=ProductionBomResponse)
async def obsolete_bom(bom_id: int, db: Session = Depends(get_db),
                       _perm: User = Depends(require_feature_action("production", "bom", "lifecycle", "approve"))):
    bom = _get_or_404(db, bom_id)
    if bom.status != "active":
        raise HTTPException(status_code=409, detail=f"Only an active BOM can be made obsolete — {bom.bom_number} is {bom.status}.")
    bom.status = "obsolete"
    db.commit()
    db.refresh(bom)
    return _to_response(db, bom, _perm)


@router.post("/{bom_id}/new-version", response_model=ProductionBomResponse)
async def new_bom_version(
    bom_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(require_feature_action("production", "bom", "lifecycle", "create")),
):
    source = _get_or_404(db, bom_id)
    existing_draft = db.query(ProductionBom).filter(
        ProductionBom.product_item_id == source.product_item_id,
        ProductionBom.status == "draft",
        ProductionBom.is_deleted == False,  # noqa: E712
    ).first()
    if existing_draft:
        raise HTTPException(
            status_code=409,
            detail=f"{existing_draft.bom_number} (v{existing_draft.version}) is already an open draft for this product. "
                   "Edit or activate that draft instead of starting another one.",
        )
    bom = ProductionBom(
        bom_number=generate_bom_number(db),
        product_item_id=source.product_item_id,
        version=_next_version(db, source.product_item_id),
        base_quantity=source.base_quantity,
        description=source.description,
        remarks=f"Copied from {source.bom_number} v{source.version}",
        status="draft",
        created_by_id=user.id,
    )
    bom.items = [
        ProductionBomItem(component_item_id=i.component_item_id, quantity=i.quantity, scrap_percent=i.scrap_percent, remarks=i.remarks,
                          sort_order=i.sort_order, make_buy=i.make_buy, item_category=i.item_category or "stock",
                          line_text=i.line_text, document_id=i.document_id, source_tag=i.source_tag)
        for i in source.items
    ]
    # Same components, so the copy keeps the Design link (and shows "Design
    # changed" when a newer eBOM revision is out).
    bom.design_bom_id, bom.design_bom_revision_id = source.design_bom_id, source.design_bom_revision_id
    bom.design_revision_label, bom.transferred_at, bom.transferred_by_id = source.design_revision_label, source.transferred_at, source.transferred_by_id
    bom.operations = [_copy_operation(o) for o in source.operations]
    db.add(bom)
    db.flush()
    discipline.carry_merges(db, source, bom)
    db.commit()
    db.refresh(bom)
    return _to_response(db, bom, user)


@router.delete("/{bom_id}")
async def delete_bom(bom_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_DELETE)):
    bom = _get_or_404(db, bom_id)
    ensure_can_delete(user, bom, "production", "bom", what="BOM")
    _require_draft(bom, "deleted", db)
    bom.is_deleted = True
    bom.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"BOM {bom.bom_number} deleted"}
