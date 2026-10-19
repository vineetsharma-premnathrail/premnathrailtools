"""Design / Electrical / Hydraulic ↔ Order Projects (sales/order_projects.py).

RRVs are built to order: every confirmed Sales Order with an RRV line gets an
Order Project (OP-YYYY-NNN), one element per vehicle. This module is the
engineering side of it:

* Link helpers — `clean_op_link` validates an (order_project_id,
  order_project_element_id) pair a form sent (design requests, BOMs,
  electrical jobs, hydraulic systems) and `fill_op_labels` adds the chip
  labels to responses.
* Project hook — when a project is created (or an amendment adds vehicles of
  a model it didn't have), each distinct RRV model of the order is checked:
  a model whose product item already has a RELEASED Design BOM is a repeat
  model (no design work — the BOM is noted on its timeline and shown in the
  360 view); any other model gets a Design request linked to the project,
  prefilled from the order, and the Design heads are told — exactly like a
  request raised by hand. Idempotent (one request per project + model).
* 360 provider 'design' — per vehicle: request status, customer approval of
  its drawings, BOM release, plus the linked electrical job / hydraulic
  system in the detail line.
* Billing — when the customer has approved every drawing of a project that
  needs customer approval, the order's 'drawing_approval' billing milestone
  falls due (accounts/services/billing.py trigger_event — the same call as
  Sales "Mark due", which stays available).

Imported at startup from design/routes/__init__.py."""
from __future__ import annotations

import logging
from datetime import date

from sqlalchemy.orm import Session, selectinload

from app.modules.design.access import head_ids, next_number, year_prefix
from app.modules.design.bom_service import released_bom_revision
from app.modules.design.models.bom import DesignBom
from app.modules.design.models.document import DesignDocument
from app.modules.design.models.event import DesignEvent
from app.modules.design.models.request import DesignRequest, DesignRequirementRevision, DESIGN_REQUEST_ACTIVE_STATUSES
from app.modules.design.models.submission import DesignCustomerSubmission, DesignSubmissionLine
from app.modules.design.service import add_event, released_revision
from app.modules.main.models.user import User
from app.modules.sales import order_projects as ops
from app.modules.sales.models.order import SalesOrder, SalesOrderLine
from app.modules.sales.models.order_project import OrderProject, OrderProjectElement

logger = logging.getLogger("design")

OP_FIELDS = ("order_project_id", "order_project_element_id")
_REQUEST_ENTITY = "design_request"
_APPROVED = ("approved", "approved_with_comments")


# ---------------------------------------------------------------- link helpers

def clean_op_link(db: Session, data: dict, *, current_project_id: int | None = None,
                  current_element_id: int | None = None) -> None:
    """Validate the Order Project fields in `data` (a create payload, or the
    changed fields of an update) and normalise them in place. An element
    alone fills its project; a different project clears an element of the
    old one. A new link must be to an active / on-hold project and a live
    element; an unchanged link is kept even if the project closed since."""
    if not any(k in data for k in OP_FIELDS):
        return
    pid = data["order_project_id"] if "order_project_id" in data else current_project_id
    if "order_project_element_id" in data:
        eid = data["order_project_element_id"]
    else:
        eid = current_element_id if (pid or None) == (current_project_id or None) else None
    pid, eid = pid or None, eid or None
    if eid:
        unchanged = eid == current_element_id
        project, _el = ops.resolve_element(db, eid, project_id=pid, allow_cancelled=unchanged)
        if not unchanged and project.id != current_project_id:
            ops.resolve_project(db, project.id)
        pid = project.id
    elif pid and pid != current_project_id:
        ops.resolve_project(db, pid)
    data["order_project_id"], data["order_project_element_id"] = pid, eid


def op_label_maps(db: Session, rows) -> tuple[dict[int, OrderProject], dict[int, OrderProjectElement]]:
    pids = {getattr(r, "order_project_id", None) for r in rows} - {None}
    eids = {getattr(r, "order_project_element_id", None) for r in rows} - {None}
    projects = {p.id: p for p in db.query(OrderProject).filter(OrderProject.id.in_(pids)).all()} if pids else {}
    elements = {e.id: e for e in db.query(OrderProjectElement).filter(OrderProjectElement.id.in_(eids)).all()} if eids else {}
    return projects, elements


def fill_op_labels(db: Session, rows, responses) -> None:
    """Sets order_project_number / _element_no / _element_label / _display on
    each response (same order as rows) — what OrderProjectChip shows."""
    maps = op_label_maps(db, rows)
    for row, resp in zip(rows, responses):
        set_op_label(resp, row, maps)


def set_op_label(resp, row, maps) -> None:
    projects, elements = maps
    p = projects.get(getattr(row, "order_project_id", None))
    if not p:
        return
    el = elements.get(getattr(row, "order_project_element_id", None))
    resp.order_project_number = p.op_number
    resp.order_project_element_no = el.element_no if el else None
    resp.order_project_element_label = el.label if el else None
    resp.order_project_display = ops.element_display(p, el) if el else f"{p.op_number} · {p.title}"


# ---------------------------------------------------------------- models of an order

def _product(db: Session, product_id: int | None):
    if not product_id:
        return None
    from app.modules.products.models.product import Product
    return db.get(Product, product_id)


def line_item_id(db: Session, line: SalesOrderLine) -> int | None:
    """The Item Master code of the RRV a line sells: the line's own product
    item, else the Product Management product's item."""
    if line.product_item_id:
        return line.product_item_id
    product = _product(db, line.product_id)
    return product.store_item_id if product else None


def line_model(db: Session, line: SalesOrderLine) -> tuple[str, str]:
    """(key, display name) of a line's RRV model — lines of the same model
    share one design request."""
    product = _product(db, line.product_id)
    if product:
        return f"p{product.id}", (product.name or product.model_number or product.code).strip()
    if line.product_item_id:
        from app.modules.store.models.item import StoreItem
        item = db.get(StoreItem, line.product_item_id)
        if item:
            return f"i{item.id}", (item.item_name or item.item_code).strip()
    name = " ".join((line.rrv_model or line.description or f"Line {line.line_number}").split())
    return f"n{name.lower()}", name[:120]


def released_bom_for_item(db: Session, item_id: int | None):
    """(bom, released revision) of an item's released Design BOM — the
    standard one (no project link) first, then the newest. None if none."""
    if not item_id:
        return None
    boms = (db.query(DesignBom).options(selectinload(DesignBom.revisions))
            .filter(DesignBom.product_item_id == item_id, DesignBom.is_deleted == False,  # noqa: E712
                    DesignBom.status == "active")
            .order_by(DesignBom.order_project_id.isnot(None), DesignBom.pm_project_id.isnot(None),
                      DesignBom.erp_project_id.isnot(None), DesignBom.id.desc()).all())
    for b in boms:
        rev = released_bom_revision(b)
        if rev:
            return b, rev
    return None


def _request_title(model: str, project: OrderProject) -> str:
    who = project.customer_name or "customer"
    tail = f" — {project.op_number}"
    head = f"{model} for {who}"
    return head[: 255 - len(tail)] + tail


def _date_txt(d: date | None) -> str:
    return d.strftime("%d-%m-%Y") if d else "—"


def _requirement_text(so: SalesOrder, project: OrderProject, lines: list[SalesOrderLine], vehicles: list[OrderProjectElement],
                      model: str) -> str:
    parts = [
        f"New RRV model for confirmed order {so.display_number} (Order Project {project.op_number}).",
        f"Customer: {so.customer_name or '—'}",
        f"Customer PO / LOA: {so.customer_po_number or so.loa_number or '—'}"
        + (f" dated {_date_txt(so.customer_po_date)}" if so.customer_po_date else ""),
        f"Model: {model}",
        f"Vehicles: {len(vehicles)} — " + ", ".join(
            f"{v.label} by {_date_txt(v.contractual_date)}" for v in sorted(vehicles, key=lambda v: v.element_no)),
    ]
    for ln in lines:
        parts.append(f"\nOrder line {ln.line_number}: {ln.description.strip()}")
        if (ln.specification or "").strip():
            parts.append(f"Specification:\n{ln.specification.strip()}")
        if ln.customer_line_ref:
            parts.append(f"Customer line ref: {ln.customer_line_ref}")
    parts.append("\nNo released BOM exists for this model, so Design prepares the drawings (customer approval where "
                 "the contract needs it) and the BOM against this project.")
    return "\n".join(parts)[:20000]


def _notify_new_request(db: Session, req: DesignRequest, actor: User | None, project: OrderProject) -> None:
    from app.utils.notifications import notify_user
    from app.modules.design.events import notify_design_event
    msg = (f"Sales order confirmed — {req.request_number} ({req.title}) was opened for the new model"
           + (f", required by {req.due_date:%d-%m-%Y}" if req.due_date else "") + ". Accept it and assign a lead designer.")
    heads = set(head_ids(db))
    for uid in heads:
        if actor and uid == actor.id:
            continue
        notify_user(db, uid, f"New design request: {req.request_number}", msg, "design_request_new",
                    entity_type=_REQUEST_ENTITY, entity_id=req.id)
    try:
        notify_design_event(db, None, "request_raised", req, entity_type=_REQUEST_ENTITY, actor=actor,
                            title=f"New design request: {req.request_number}", message=msg, skip=heads)
    except Exception:  # noqa: BLE001 — role notifications never block the order
        logger.exception("Design role notification failed for %s (%s)", req.request_number, project.op_number)


def on_order_project(db: Session, project: OrderProject, so: SalesOrder, actor: User | None,
                     new_elements: list[OrderProjectElement]) -> None:
    """register_project_hook: design requests for new models, repeat models noted."""
    new_vehicles = [el for el in new_elements if el.kind == "vehicle"]
    if not new_vehicles:
        return
    lines = {ln.id: ln for ln in so.lines if ln.line_type == "rrv"}
    groups: dict[str, dict] = {}
    for el in new_vehicles:
        ln = lines.get(el.sales_order_line_id)
        if ln is None:
            continue
        key, name = line_model(db, ln)
        g = groups.setdefault(key, {"name": name, "lines": [], "vehicles": [], "item_id": None})
        if ln not in g["lines"]:
            g["lines"].append(ln)
        g["vehicles"].append(el)
        g["item_id"] = g["item_id"] or line_item_id(db, ln)

    existing = db.query(DesignRequest).filter(DesignRequest.order_project_id == project.id,
                                              DesignRequest.is_deleted == False).all()  # noqa: E712
    for g in groups.values():
        found = released_bom_for_item(db, g["item_id"])
        if found:
            bom, rev = found
            note = f"Repeat model for {project.op_number} ({so.display_number}) — {len(g['vehicles'])} vehicle(s)"
            seen = db.query(DesignEvent.id).filter(DesignEvent.bom_id == bom.id, DesignEvent.action == "order_project_repeat",
                                                   DesignEvent.comment.like(f"Repeat model for {project.op_number} %")).first()
            if not seen:
                add_event(db, "order_project_repeat", actor, bom_id=bom.id, bom_revision_id=rev.id, comment=note)
            continue
        prefix = f"{g['name']} for "
        if any(r.title.startswith(prefix) for r in existing):
            continue  # this model already has its request on the project
        dates = [v.contractual_date for v in g["vehicles"] if v.contractual_date]
        req = DesignRequest(
            request_number=next_number(db, DesignRequest.request_number, year_prefix("DRQ")),
            title=_request_title(g["name"], project), source="project", customer_id=so.customer_id,
            crm_reference=f"{so.display_number} · PO {so.customer_po_number or so.loa_number or '—'}"[:255],
            requirement=_requirement_text(so, project, g["lines"], g["vehicles"], g["name"]),
            requirement_revision=0, reviewed_revision=-1, priority="high", due_date=min(dates) if dates else None,
            status="open", waiting_on="design", requested_by_id=actor.id if actor else so.created_by_id,
            order_project_id=project.id, order_project_element_id=None,
        )
        db.add(req)
        db.flush()
        db.add(DesignRequirementRevision(request_id=req.id, revision=0, requirement=req.requirement,
                                         change_note="Original requirement (from the confirmed sales order)",
                                         revised_by_id=req.requested_by_id))
        add_event(db, "request_created", actor, request_id=req.id,
                  comment=f"Opened automatically for {project.op_number} when {so.display_number} was confirmed")
        existing.append(req)
        _notify_new_request(db, req, actor, project)
    db.flush()


# ---------------------------------------------------------------- 360 provider

_REQ_LABEL = {"open": "Request open", "accepted": "Accepted", "in_progress": "In design", "on_hold": "On hold",
              "completed": "Design completed", "cancelled": "Request cancelled"}


def _approval_state(db: Session, doc_ids: list[int]) -> dict[int, str]:
    """{document_id: approved | rejected | pending | none} from customer submissions."""
    out = {d: "none" for d in doc_ids}
    if not doc_ids:
        return out
    rows = (db.query(DesignSubmissionLine.document_id, DesignSubmissionLine.response, DesignSubmissionLine.id)
            .join(DesignCustomerSubmission, DesignCustomerSubmission.id == DesignSubmissionLine.submission_id)
            .filter(DesignSubmissionLine.document_id.in_(doc_ids), DesignCustomerSubmission.is_deleted == False,  # noqa: E712
                    DesignCustomerSubmission.status != "cancelled")
            .order_by(DesignSubmissionLine.id).all())
    for doc_id, response, _ in rows:
        if response in _APPROVED:
            out[doc_id] = "approved"
        elif out[doc_id] != "approved":
            out[doc_id] = "rejected" if response == "rejected" else "pending"
    return out


def project_drawings(db: Session, request_ids: list[int]) -> list[DesignDocument]:
    if not request_ids:
        return []
    return (db.query(DesignDocument).options(selectinload(DesignDocument.revisions))
            .filter(DesignDocument.design_request_id.in_(request_ids), DesignDocument.is_deleted == False,  # noqa: E712
                    DesignDocument.status != "obsolete").all())


def _approval_set(docs: list[DesignDocument], state: dict[int, str]) -> list[DesignDocument]:
    """Drawings the customer must approve: those flagged for customer approval;
    if none is flagged, those sent to the customer at all."""
    flagged = [d for d in docs if d.customer_approval_required]
    return flagged or [d for d in docs if state.get(d.id, "none") != "none"]


def _engineering_bits(db: Session, project: OrderProject) -> tuple[dict, dict]:
    from app.modules.electrical.models.job import ElectricalJob
    from app.modules.hydraulic.models.system import HydSystem
    jobs = db.query(ElectricalJob).filter(ElectricalJob.order_project_id == project.id,
                                          ElectricalJob.is_deleted == False).all()  # noqa: E712
    systems = db.query(HydSystem).filter(HydSystem.order_project_id == project.id,
                                         HydSystem.is_deleted == False).all()  # noqa: E712
    return ({j.id: j for j in jobs}, {s.id: s for s in systems})


def design_cells(db: Session, project: OrderProject, elements: list[OrderProjectElement]) -> dict[int, dict | None]:
    so = db.get(SalesOrder, project.sales_order_id)
    if so is None:
        return {}
    lines = {ln.id: ln for ln in so.lines}
    requests = db.query(DesignRequest).filter(DesignRequest.order_project_id == project.id,
                                              DesignRequest.is_deleted == False).all()  # noqa: E712
    boms = (db.query(DesignBom).options(selectinload(DesignBom.revisions))
            .filter(DesignBom.is_deleted == False,  # noqa: E712
                    (DesignBom.order_project_id == project.id)
                    | DesignBom.design_request_id.in_([r.id for r in requests] or [-1])).all())
    docs = project_drawings(db, [r.id for r in requests])
    state = _approval_state(db, [d.id for d in docs])
    jobs, systems = _engineering_bits(db, project)
    today = date.today()
    model_cache: dict[int, tuple[str, str]] = {}
    model_keys = set()
    for el in elements:
        ln = lines.get(el.sales_order_line_id)
        if ln is not None and el.kind == "vehicle":
            model_cache[ln.id] = model_cache.get(ln.id) or line_model(db, ln)
            model_keys.add(model_cache[ln.id][0])

    out: dict[int, dict | None] = {}
    for el in elements:
        if el.status == "cancelled":
            out[el.id] = None
            continue
        ln = lines.get(el.sales_order_line_id)
        mine = lambda rec: rec.order_project_element_id in (None, el.id)  # noqa: E731
        if el.kind == "vehicle" and ln is not None:
            _key, model = model_cache[ln.id]
            item_id = line_item_id(db, ln)
            reqs = [r for r in requests if mine(r) and (r.title.startswith(f"{model} for ") or len(model_keys) == 1)]
            req_ids = {r.id for r in reqs}
            my_boms = [b for b in boms if (b.design_request_id in req_ids)
                       or (b.order_project_id == project.id and mine(b) and (not item_id or b.product_item_id == item_id))]
        else:
            reqs = [r for r in requests if r.order_project_element_id == el.id]
            req_ids = {r.id for r in reqs}
            my_boms = [b for b in boms if b.design_request_id in req_ids
                       or (b.order_project_id == project.id and b.order_project_element_id == el.id)]
            item_id, model = None, None
        my_docs = [d for d in docs if d.design_request_id in req_ids]
        eng = []
        for j in jobs.values():
            if mine(j):
                eng.append(f"Electrical {j.job_number} {j.status.replace('_', ' ')}")
        for s in systems.values():
            if mine(s):
                eng.append(f"{s.system_type.capitalize()} {s.system_number} {s.status.replace('_', ' ')}")

        if not reqs and not my_boms:
            repeat = released_bom_for_item(db, item_id) if el.kind == "vehicle" else None
            if repeat:
                bom, rev = repeat
                out[el.id] = {"status": "repeat", "label": "Repeat model", "tone": "success",
                              "detail": "; ".join([f"Repeat model — BOM {bom.bom_number} rev {rev.revision_label}", *eng]),
                              "date": rev.released_at.date().isoformat() if rev.released_at else None}
            elif eng:
                out[el.id] = {"status": "engineering", "label": "Engineering linked", "tone": "info",
                              "detail": "; ".join(eng), "date": None}
            else:
                out[el.id] = None
            continue

        released = [(b, released_bom_revision(b)) for b in my_boms]
        released = [(b, r) for b, r in released if r]
        need = _approval_set(my_docs, state)
        approved = [d for d in need if state.get(d.id) == "approved"]
        rejected = [d for d in need if state.get(d.id) == "rejected"]
        drawings_ok = len(approved) == len(need)
        active = [r for r in reqs if r.status in DESIGN_REQUEST_ACTIVE_STATUSES]
        due = min((r.due_date for r in active if r.due_date), default=None) or min((r.due_date for r in reqs if r.due_date), default=None)

        if released and drawings_ok:
            status, label, tone = "bom_released", "BOM released", "success"
        elif rejected:
            status, label, tone = "customer_rejected", "Drawing rejected", "danger"
        elif need and not drawings_ok and any(state.get(d.id) == "pending" for d in need):
            status, label, tone = "awaiting_customer", "Awaiting customer approval", "info"
        elif released:
            status, label, tone = "bom_released", "BOM released — approval pending", "info"
        elif all(r.status == "cancelled" for r in reqs) and reqs:
            status, label, tone = "cancelled", "Request cancelled", "neutral"
        else:
            lead = next((r for r in active), reqs[0] if reqs else None)
            status = lead.status if lead else "in_progress"
            label = _REQ_LABEL.get(status, status.replace("_", " ").capitalize()) if lead else "BOM in progress"
            tone = "info" if status in ("accepted", "in_progress") else ("warning" if status == "on_hold" else "neutral")
        if tone != "success" and status != "cancelled" and due and due < today:
            tone = "warning"
            label = f"{label} — overdue"

        bits = [", ".join(r.request_number for r in reqs)] if reqs else []
        if my_docs:
            rel = sum(1 for d in my_docs if released_revision(d))
            bits.append(f"Drawings {rel}/{len(my_docs)} released")
        if need:
            bits.append(f"customer-approved {len(approved)}/{len(need)}" + (f", rejected {len(rejected)}" if rejected else ""))
        if released:
            bits.append("BOM " + ", ".join(f"{b.bom_number} rev {r.revision_label}" for b, r in released) + " released")
        elif my_boms:
            bits.append("BOM " + ", ".join(b.bom_number for b in my_boms) + " not released")
        if due:
            bits.append(f"required by {due:%d-%b-%Y}")
        bits += eng
        out[el.id] = {"status": status, "label": label, "tone": tone, "detail": " · ".join(x for x in bits if x) or None,
                      "date": due.isoformat() if due else None}
    return out


# ---------------------------------------------------------------- drawing approval → billing

def on_customer_approval(db: Session, document_ids: list[int], *, on: date, actor: User | None) -> list[str]:
    """After customer approvals were recorded: for every Order Project whose
    drawings (requests linked to the project) now all carry the customer's
    approval, mark the order's 'drawing_approval' billing milestone due.
    Returns the order numbers whose milestone fell due."""
    if not document_ids:
        return []
    req_ids = {rid for (rid,) in db.query(DesignDocument.design_request_id)
               .filter(DesignDocument.id.in_(document_ids), DesignDocument.design_request_id.isnot(None)).all()}
    if not req_ids:
        return []
    project_ids = {pid for (pid,) in db.query(DesignRequest.order_project_id)
                   .filter(DesignRequest.id.in_(req_ids), DesignRequest.order_project_id.isnot(None)).all()}
    done = []
    if not project_ids:
        return done
    from app.modules.accounts.services import billing
    from app.modules.sales.views import get_order
    for pid in project_ids:
        project = db.get(OrderProject, pid)
        if project is None:
            continue
        all_req = [r.id for r in db.query(DesignRequest.id).filter(
            DesignRequest.order_project_id == pid, DesignRequest.is_deleted == False,  # noqa: E712
            DesignRequest.status != "cancelled").all()]
        docs = project_drawings(db, all_req)
        state = _approval_state(db, [d.id for d in docs])
        need = _approval_set(docs, state)
        if not need or any(state.get(d.id) != "approved" for d in need):
            continue
        try:
            so = get_order(db, project.sales_order_id)
        except Exception:  # noqa: BLE001
            continue
        if so.status not in billing.BILLABLE_ORDER_STATUSES:
            continue
        hit = billing.trigger_event(db, so, "drawing_approval", on=on, user_id=actor.id if actor else None)
        if hit:
            done.append(so.display_number)
            for rid in all_req:
                add_event(db, "drawing_milestone_due", actor, request_id=rid,
                          comment=f"Customer approved every drawing of {project.op_number} — the drawing-approval billing "
                                  f"milestone of {so.display_number} is now due")
    return done


ops.register_project_hook(on_order_project)
ops.register_department_provider("design", design_cells)
