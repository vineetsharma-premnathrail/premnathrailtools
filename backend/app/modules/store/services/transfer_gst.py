"""GST on stock transport between plants (SAP STO / MIGO 303-305 with an
inter-company-code-like tax step).

Under GST every state registration is a separate "distinct person"
(CGST Act sec. 25(4)); a stock transfer between two of them is a supply even
without consideration (Schedule I para 2). So, at dispatch:

  same GSTIN (same plant, or plants under one registration)
      -> DELIVERY CHALLAN (CGST Rules, rule 55) — no tax; stock moves at cost.
  different GSTINs
      -> TAX INVOICE at the transfer value. Default value = the item's moving
         average cost (rule 28: where the receiving unit can take full input
         credit, the invoice value is accepted as the open market value).
         IGST when the states differ, CGST + SGST otherwise.
  plants in different states
      -> an e-way bill number is required before the goods leave.

The stock itself still moves at cost (transfer_out / transfer_in at the
dispatch value) and is IN TRANSIT — on neither store's balance — until the
receiving store confirms receipt."""
from __future__ import annotations

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.accounts.services.gst import GST_STATE_CODES, split_tax, state_code_for_name, state_code_from_gstin
from app.modules.organization.models.branch import Branch
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_transfer import StoreStockTransfer

DOCUMENT_LABELS = {"delivery_challan": "Delivery challan", "tax_invoice": "Tax invoice"}


def plant_gst(db: Session, location_id: int) -> dict:
    """GST identity of the plant a store belongs to: branch, GSTIN, state."""
    from app.modules.accounts.services.gst import company_gst_profile
    from app.modules.organization.models.branch_address import BranchAddress

    loc = db.get(StoreLocation, location_id)
    branch = db.get(Branch, loc.branch_id) if loc is not None and loc.branch_id else None
    company_gstin, company_state = company_gst_profile(db)
    if branch is None:
        return {"branch": None, "name": loc.name if loc else str(location_id), "gstin": company_gstin, "state_code": company_state}
    gstin = (branch.gstin or "").strip().upper() or None
    state = branch.state_code or state_code_from_gstin(gstin)
    if not state:
        addr = (db.query(BranchAddress).filter(BranchAddress.branch_id == branch.id, BranchAddress.is_active == True)  # noqa: E712
                .order_by(BranchAddress.is_primary.desc(), BranchAddress.id).first())
        state = state_code_for_name(addr.state) if addr else None
    if not gstin and state and state == company_state:
        gstin = company_gstin  # a plant in the company's home state with no own GSTIN works under the company's registration
    return {"branch": branch, "name": branch.name, "gstin": gstin, "state_code": state}


def classify(db: Session, transfer: StoreStockTransfer) -> dict:
    """Which document the transfer needs. Raises ValueError (what to fix)."""
    src, dst = plant_gst(db, transfer.from_location_id), plant_gst(db, transfer.to_location_id)
    same_plant = src["branch"] is not None and dst["branch"] is not None and src["branch"].id == dst["branch"].id
    if same_plant or (src["branch"] is None and dst["branch"] is None):
        return {"document_type": "delivery_challan", "inter_state": False, "from": src, "to": dst}
    if not src["state_code"] and not dst["state_code"]:
        # Neither plant has GST data: treated as one registration (challan).
        return {"document_type": "delivery_challan", "inter_state": False, "from": src, "to": dst}
    for side in (src, dst):
        if not side["state_code"]:
            raise ValueError(f"Plant {side['name']} has no GST state — set its GSTIN (or state) in Organization › Plants, "
                             "so the transfer can be put on a delivery challan or a tax invoice.")
    inter_state = src["state_code"] != dst["state_code"]
    if inter_state:
        for side in (src, dst):
            if not side["gstin"]:
                raise ValueError(
                    f"Plant {side['name']} ({GST_STATE_CODES.get(side['state_code'], side['state_code'])}) has no GSTIN. A transfer to "
                    "another state is a taxable supply between distinct persons and needs both plants' GSTINs on the tax invoice — "
                    "enter it in Organization › Plants.")
    distinct = bool(src["gstin"] and dst["gstin"] and src["gstin"] != dst["gstin"])
    return {"document_type": "tax_invoice" if distinct else "delivery_challan", "inter_state": inter_state, "from": src, "to": dst}


def _fy(d: date) -> str:
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start % 100:02d}{(start + 1) % 100:02d}"


def next_tax_invoice_number(db: Session, state_code: str, d: date) -> str:
    """BT<state>/<FY>/<NNNN> — one consecutive series per GSTIN (state) and
    financial year, at most 16 characters (CGST rule 46(b))."""
    from app.modules.store.service import _lock_number_series
    prefix = f"BT{state_code}/{_fy(d)}/"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StoreStockTransfer.tax_invoice_number)).filter(StoreStockTransfer.tax_invoice_number.like(f"{prefix}%")).scalar()
    return f"{prefix}{(int(last.rsplit('/', 1)[-1]) + 1) if last else 1:04d}"


def validate_eway(number: str | None, needed: bool, cls: dict) -> str | None:
    n = (number or "").strip().replace(" ", "") or None
    if n and not (n.isdigit() and len(n) == 12):
        raise ValueError(f"E-way bill number '{number}' is not valid — it is the 12-digit number from ewaybillgst.gov.in.")
    if needed and not n:
        raise ValueError(
            f"This transfer goes from {cls['from']['name']} ({GST_STATE_CODES.get(cls['from']['state_code'], '')}) to "
            f"{cls['to']['name']} ({GST_STATE_CODES.get(cls['to']['state_code'], '')}) — another state — so the goods need an "
            "e-way bill before they leave. Generate it on ewaybillgst.gov.in and enter the 12-digit number.")
    return n


def apply_tax(db: Session, transfer: StoreStockTransfer, cls: dict, rates: dict[int, float]) -> None:
    """Fills the GST data on a dispatched transfer. `rates` = transfer price
    per unit by line id (missing -> average cost the stock left at)."""
    from app.modules.store.services import valuation

    transfer.document_type = cls["document_type"]
    transfer.inter_state = cls["inter_state"]
    transfer.from_gstin, transfer.to_gstin = cls["from"]["gstin"], cls["to"]["gstin"]
    if cls["document_type"] != "tax_invoice":
        return
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([l.item_id for l in transfer.items])).all()}
    missing = [f"{items[l.item_id].item_code}" for l in transfer.items if items[l.item_id].gst_rate is None or not items[l.item_id].hsn_sac_code]
    if missing:
        raise ValueError(f"A tax invoice needs the HSN code and GST rate of every item — fill them in the Item Master for: {', '.join(missing)}.")
    taxable_total = cg = sg = ig = 0.0
    for line in transfer.items:
        rate = rates.get(line.id)
        if rate is None:
            rate = (line.dispatch_value / line.quantity) if line.dispatch_value and line.quantity else valuation.current_rate(db, line.item_id)
        if rate is None or rate <= 0:
            raise ValueError(f"'{items[line.item_id].item_name}' has no average cost to value the tax invoice at — enter its transfer price per unit.")
        taxable = round(float(rate) * float(line.quantity), 2)
        c, s, i = split_tax(taxable, float(items[line.item_id].gst_rate), cls["inter_state"])
        line.transfer_rate, line.gst_rate = round(float(rate), 4), float(items[line.item_id].gst_rate)
        line.taxable_value, line.tax_amount = taxable, round(c + s + i, 2)
        taxable_total += taxable
        cg, sg, ig = cg + c, sg + s, ig + i
    transfer.taxable_value = round(taxable_total, 2)
    transfer.cgst_amount, transfer.sgst_amount, transfer.igst_amount = round(cg, 2), round(sg, 2), round(ig, 2)
    transfer.tax_invoice_number = next_tax_invoice_number(db, cls["from"]["state_code"], date.today())


def decorate_note(db: Session, transfer: StoreStockTransfer, spec: dict) -> dict:
    """Turns the Stock Transfer Note spec into the GST document the transfer
    travels on: a tax invoice (with HSN, rate, taxable value and GST per line)
    or a delivery challan between plants. Same-plant transfers are unchanged."""
    if transfer.document_type is None:
        return spec
    src = plant_gst(db, transfer.from_location_id)
    dst = plant_gst(db, transfer.to_location_id)
    if src["branch"] is not None and dst["branch"] is not None and src["branch"].id == dst["branch"].id:
        return spec
    state = lambda c: f"{GST_STATE_CODES.get(c, '')} ({c})" if c else "—"  # noqa: E731
    gst_facts = [
        ("Supplier (sending plant)", f"{src['name']} · GSTIN {transfer.from_gstin or '—'} · State {state(src['state_code'])}"),
        ("Recipient (receiving plant)", f"{dst['name']} · GSTIN {transfer.to_gstin or '—'} · State {state(dst['state_code'])}"),
        ("Place of supply", state(dst["state_code"])),
        ("E-way bill no.", transfer.eway_bill_number),
    ]
    if transfer.document_type == "tax_invoice":
        items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([l.item_id for l in transfer.items])).all()}
        rows = []
        for n, l in enumerate(transfer.items, 1):
            it = items.get(l.item_id)
            rows.append([str(n), it.item_code if it else "", it.item_name if it else "", it.hsn_sac_code or "" if it else "",
                         f"{l.quantity:g}", it.uom or "" if it else "", f"{l.transfer_rate or 0:,.2f}", f"{l.taxable_value or 0:,.2f}",
                         f"{l.gst_rate or 0:g}%", f"{l.tax_amount or 0:,.2f}"])
        tax_bits = (f"IGST ₹ {transfer.igst_amount or 0:,.2f}" if transfer.inter_state
                    else f"CGST ₹ {transfer.cgst_amount or 0:,.2f} + SGST ₹ {transfer.sgst_amount or 0:,.2f}")
        total = (transfer.taxable_value or 0) + (transfer.cgst_amount or 0) + (transfer.sgst_amount or 0) + (transfer.igst_amount or 0)
        spec.update({
            "title": "TAX INVOICE — STOCK TRANSFER", "number": transfer.tax_invoice_number or transfer.transfer_number,
            "intro": ("Supply between distinct persons under the same PAN (CGST Act sec. 25(4), Schedule I para 2) — our own "
                      "material moving between two GST registrations. Valued at cost, accepted as open market value where the "
                      "recipient takes full input tax credit (CGST Rules, rule 28). Not a sale to a third party."),
            "facts": [("Transfer no.", transfer.transfer_number)] + gst_facts + list(spec["facts"]),
            "sections": [{"heading": "Goods", "columns": ["#", "Item code", "Description", "HSN", "Qty", "UoM", "Rate (₹)",
                                                          "Taxable (₹)", "GST", "Tax (₹)"],
                          "rows": rows, "widths": [0.3, 0.9, 1.8, 0.6, 0.5, 0.45, 0.75, 0.85, 0.45, 0.75]}],
            "statement": f"Taxable value ₹ {transfer.taxable_value or 0:,.2f}; {tax_bits}; invoice total ₹ {total:,.2f}. "
                         "Tax payable by the supplying GSTIN; input credit available to the receiving GSTIN.",
        })
    else:
        spec.update({
            "title": "DELIVERY CHALLAN — STOCK TRANSFER",
            "intro": ("Movement of our own goods within the same GST registration — not a supply (CGST Rules, rule 55: "
                      "transportation for reasons other than supply). No tax is charged."),
            "facts": gst_facts + list(spec["facts"]),
        })
    return spec


def in_transit_rows(db: Session) -> list[dict]:
    """Stock in transit between stores (dispatched, not yet received) — owned
    by the company, valued at the cost it left with, on neither store."""
    from app.modules.store.models.stock_transfer import StoreStockTransferItem
    locs = {l.id: l.name for l in db.query(StoreLocation).all()}
    rows = []
    q = (db.query(StoreStockTransferItem, StoreStockTransfer, StoreItem)
         .join(StoreStockTransfer, StoreStockTransfer.id == StoreStockTransferItem.transfer_id)
         .join(StoreItem, StoreItem.id == StoreStockTransferItem.item_id)
         .filter(StoreStockTransfer.status == "in_transit").order_by(StoreStockTransfer.dispatched_at, StoreStockTransfer.id))
    for line, t, it in q.all():
        rows.append({"transfer_id": t.id, "transfer_number": t.transfer_number, "document_type": t.document_type,
                     "tax_invoice_number": t.tax_invoice_number, "eway_bill_number": t.eway_bill_number,
                     "from_location": locs.get(t.from_location_id), "to_location": locs.get(t.to_location_id),
                     "dispatched_at": t.dispatched_at.isoformat() if t.dispatched_at else None,
                     "item_id": it.id, "item_code": it.item_code, "item_name": it.item_name, "uom": it.uom,
                     "quantity": line.quantity, "value": line.dispatch_value})
    return rows
