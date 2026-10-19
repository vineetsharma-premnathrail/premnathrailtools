"""CRM quotations against R&D's released technical offers — draft, sent, revised, negotiating, accepted (won) and rejected (lost).

Done through the real API as the DEMO BD Executive (only the inquiry owner may
quote on an inquiry and record the customer's response). Numbering
(QT-<inquiry>-NN, "-rN" on each revision), the copy of the technical offer
number/date onto the quotation, and the revision audit are the app's own.

Approvals: a CRM quotation has no internal approval step in this app — the
Sales approval limits (Sales Head ≤ ₹50 L, + Director ≤ ₹2 Cr, + Partner
above or on non-standard terms; Organization › Approval Workflows) apply to
the SALES ORDER raised from the accepted quotation (see seed_sales.py).

What a tester finds:

  dmrc_rrv          DMRC, 2 x RRV-8W + spares + training, against TO R1 — sent, revised once (validity extended,
                    "-r1"), ACCEPTED; its Word document is created ("Save & Edit in Word").
  nr_rgm_lost       NR, RGM-16 at ₹98 L — sent, REJECTED (price above the imported machine).
  nr_rgm            NR, RGM-16 re-quoted at ₹95 L — ACCEPTED.
  lt_metro_cw       L&T Metro, 4 x CW-BOX — sent, revised (unit price lowered, "-r1"), customer NEGOTIATING.
  lt_metro_cw_draft L&T Metro, option with air-brake upgrade — DRAFT (not sent).
  crw_hre           not quoted: its technical offer is still a draft at R&D (quoting a draft is refused).

Inquiry stages move with it: Quotation Sent → Negotiation (stage log), status "Quotation Sent".

demo.data keys set here:

  quotations  dict key -> quotation dict from the API (+ "inquiry_key", "offer_key").
              Keys: dmrc_rrv, nr_rgm_lost, nr_rgm, lt_metro_cw, lt_metro_cw_draft.
"""
from __future__ import annotations

from datetime import timedelta

from demo._common import LABEL

PAY_TERMS = "20% advance against bank guarantee, 70% on delivery at site, 10% after commissioning & acceptance."

# key: (inquiry key, offer key, quote age (days) or None for draft, response, items, delivery, revision)
#   items: (description, product code or None, details, qty, unit price ₹, GST %)
#   revision: None, "validity" (extend valid-until) or ("price", line index, new unit price)
QUOTES = {
    "dmrc_rrv": ("dmrc_rrv", "dmrc_rrv", 8, "Accepted",
                 [(f"{LABEL} Rail-cum-Road Vehicle RRV-8W, 1435 mm gauge", "DEMO-RRV-8W",
                   "Hydraulic rail guide gear, 3 t crane, Stage V engine\nTotal 30 months warranty", 2, 14500000, 18),
                  (f"{LABEL} Recommended spares kit for 2 years", None, "As per annexure", 1, 650000, 18),
                  (f"{LABEL} Operator & maintainer training (5 days at depot)", None, None, 1, 150000, 18)],
                 "9 months from PO (first vehicle), second vehicle +1 month", "validity"),
    "nr_rgm_lost": ("nr_rgm", "nr_rgm", 15, "Rejected",
                    [(f"{LABEL} Rail Grinding Machine RGM-16, 1676 mm gauge", "DEMO-RGM-16",
                      "Dust extraction, profile measurement, RDSO profile library", 1, 9800000, 18)],
                    "12 months from PO", None),
    "nr_rgm": ("nr_rgm", "nr_rgm", 4, "Accepted",
               [(f"{LABEL} Rail Grinding Machine RGM-16, 1676 mm gauge", "DEMO-RGM-16",
                 "Dust extraction, profile measurement, RDSO profile library\nSpares for 2 years included", 1, 9500000, 18)],
               "12 months from PO", None),
    "lt_metro_cw": ("lt_metro_cw", "lt_metro_cw", 6, "Negotiating",
                    [(f"{LABEL} Material Wagon CW-BOX, 40 t, 1435 mm", "DEMO-CW-BOX",
                      "Drop sides, rail & sleeper stanchions, coupler 1105 mm", 4, 2900000, 18)],
                    "6 months from PO", ("price", 0, 2800000)),
    "lt_metro_cw_draft": ("lt_metro_cw", "lt_metro_cw", None, "— Awaiting —",
                          [(f"{LABEL} Material Wagon CW-BOX with twin-pipe air brake upgrade", "DEMO-CW-BOX",
                            "Option B — air brake compatible with metro rakes", 4, 3150000, 18)],
                          "7 months from PO", None),
}

# Inquiry stage moves once quoted (owner only): key -> stages appended to the stage log.
STAGES = {"dmrc_rrv": ["Quotation Sent", "Negotiation"], "nr_rgm": ["Quotation Sent", "Negotiation"],
          "lt_metro_cw": ["Quotation Sent"]}


def _model(demo, code):
    p = demo.data.get("products", {}).get(code) if code else None
    return p.get("model_number") if p else None


def seed_quotations(demo) -> dict:
    from app.modules.crm.models.inquiry import Quotation

    bd = demo.data["people"]["bd"]
    inquiries = demo.data.get("inquiries", {})
    offers = demo.data.get("technical_offers", {})
    out, existing_by_inquiry = {}, {}
    for key, (inq_key, offer_key, age, response, items, delivery, revision) in QUOTES.items():
        inq = inquiries.get(inq_key)
        if not inq:
            demo.note("quotation", f"inquiry '{inq_key}' missing (crm seeder not run) — quotation {key} skipped")
            continue
        # Re-run: quotations already on this inquiry are reused in creation order.
        if inq_key not in existing_by_inquiry:
            existing_by_inquiry[inq_key] = [q.id for q in demo.db.query(Quotation).filter(Quotation.inquiry_id == inq["id"])
                                            .order_by(Quotation.id).all()]
        if existing_by_inquiry[inq_key]:
            qid = existing_by_inquiry[inq_key].pop(0)
            q = next(x for x in demo.call("GET", f"/crm/inquiries/{inq['id']}/quotations", bd) if x["id"] == qid)
            out[key] = {**q, "inquiry_key": inq_key, "offer_key": offer_key}
            continue
        offer = offers.get(offer_key)
        if offer and offer.get("status") != "released":
            offer = None
        if not offer:
            demo.note("quotation", f"no released technical offer '{offer_key}' — {key} quoted without the R&D offer link")
        customer = demo.data["customers"][inq["customer"]]
        contact = customer["contacts"][-1] if customer.get("contacts") else {}
        quote_date = demo.today - timedelta(days=age if age is not None else 0)
        q = demo.call("POST", f"/crm/inquiries/{inq['id']}/quotations", bd, json={
            "quotation_type": "Domestic", "gst_type": "IGST" if customer.get("state") != "Haryana" else "CGST_SGST",
            "quote_date": quote_date.isoformat(), "technical_offer_id": offer["id"] if offer else None,
            "client_name": customer["name"], "client_contact_name": contact.get("name"),
            "client_contact_email": contact.get("email"), "client_contact_phone": contact.get("mobile"),
            "valid_until": (quote_date + timedelta(days=45)).isoformat(), "pricing_mode": "itemwise",
            "delivery_time": delivery, "payment_terms": PAY_TERMS,
            "submitted_date": quote_date.isoformat() if age is not None else None,
            "quote_conditions": "FOR Destination", "notes": f"{LABEL} quotation — prices firm for the validity period.",
            "items": [{"description": d, "model_number": _model(demo, code), "details": det, "quantity": qty,
                       "unit_price": price, "gst_percent": gst} for d, code, det, qty, price, gst in items],
        })
        if revision == "validity":
            q = demo.call("PATCH", f"/crm/inquiries/{inq['id']}/quotations/{q['id']}", bd,
                          json={"valid_until": (quote_date + timedelta(days=90)).isoformat()})
        elif revision:
            _, idx, new_price = revision
            q = demo.call("PATCH", f"/crm/inquiries/{inq['id']}/quotations/{q['id']}", bd,
                          json={"items": [{"id": q["items"][idx]["id"], "unit_price": new_price}]})
        if response != "— Awaiting —":
            q = demo.call("PATCH", f"/crm/inquiries/{inq['id']}/quotations/{q['id']}", bd, json={"customer_response": response})
        out[key] = {**q, "inquiry_key": inq_key, "offer_key": offer_key if offer else None}
    demo.data["quotations"] = out
    demo.note("quotation", "quotations: " + ", ".join(f"{q['quot_number']} {q['customer_response']}"
                                                         + ("" if q.get("submitted_date") else " (draft)") for q in out.values()))
    return out


def seed_word_document(demo, quotes: dict) -> None:
    """"Save & Edit in Word" on the accepted DMRC quotation (managed Word document of record)."""
    q = quotes.get("dmrc_rrv")
    if not q:
        return
    status, body = demo.try_call("POST", f"/managed-documents/crm_quotation/{q['id']}", demo.data["people"]["bd"])
    if status >= 400:
        demo.note("quotation", f"Word document for {q['quot_number']} not created ({status}): {body}")
    else:
        demo.note("quotation", f"Word document created for {q['quot_number']}")


def seed_inquiry_stages(demo, quotes: dict) -> None:
    from app.modules.crm.models.stage_log import CrmStageLog

    bd = demo.data["people"]["bd"]
    inquiries = demo.data.get("inquiries", {})
    for key, stages in STAGES.items():
        inq = inquiries.get(key)
        if not inq or not any(q["inquiry_key"] == key for q in quotes.values()):
            continue
        logged = {s for (s,) in demo.db.query(CrmStageLog.stage).filter(CrmStageLog.related_module == "inquiry",
                                                                       CrmStageLog.related_id == inq["id"]).all()}
        if "Quotation Sent" in logged:   # re-run
            continue
        for stg in stages:
            demo.call("POST", f"/crm/inquiries/{inq['id']}/stages", bd, json={"stage": stg, "notes": f"{LABEL}: {stg}"})
        inquiries[key] = {**inquiries[key], **demo.call("PATCH", f"/crm/inquiries/{inq['id']}", bd, json={"status": "Quotation Sent"})}
    demo.note("quotation", "inquiry stages moved to Quotation Sent / Negotiation")


def seed(demo) -> None:
    quotes = seed_quotations(demo)
    seed_word_document(demo, quotes)
    seed_inquiry_stages(demo, quotes)
