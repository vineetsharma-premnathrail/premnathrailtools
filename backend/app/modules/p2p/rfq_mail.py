"""The RFQ email a vendor receives (2026-10-22): what we need, how much, by
when to quote, our late delivery clause and exactly what to put in the reply,
so the buyer can record it as a line quotation. Sent from the portal mailbox
with Reply-To = the buyer, so the vendor's reply lands with the buyer."""
from datetime import date
from html import escape

from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.main.models.user import User
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_invite import RFQVendorInvite
from app.modules.p2p.po_split import buy_qty_by_pr_item
from app.utils.email import _logo_header, _send_graph_mail

COMPANY = "Premnath Engineering Works"


def _qty(q: float) -> str:
    return f"{q:g}"


def _items_html(pr: P2PRequest) -> str:
    buy = buy_qty_by_pr_item(pr)
    rows = []
    for n, i in enumerate([i for i in pr.items if buy.get(i.id, 0) > 0], start=1):
        make = " / ".join(x for x in (i.make, i.part_code) if x)
        rows.append(
            f'<tr style="background:{"#f8fafc" if n % 2 else "#fff"}">'
            f'<td style="padding:8px 10px;border-top:1px solid #e2e8f0">{n}</td>'
            f'<td style="padding:8px 10px;border-top:1px solid #e2e8f0">{escape(i.item_name)}'
            + (f'<div style="color:#64748b;font-size:12px">{escape(make)}</div>' if make else "")
            + f'</td><td style="padding:8px 10px;border-top:1px solid #e2e8f0;text-align:right;white-space:nowrap">'
              f'{_qty(buy[i.id])} {escape(i.unit or "")}</td></tr>')
    head = ('<tr style="background:#0f172a;color:#fff">'
            '<th style="padding:8px 10px;text-align:left">#</th><th style="padding:8px 10px;text-align:left">Item</th>'
            '<th style="padding:8px 10px;text-align:right">Quantity</th></tr>')
    return f'<table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e2e8f0">{head}{"".join(rows)}</table>'


def build_rfq_email(rfq: RFQ, pr: P2PRequest, buyer: User | None, contact_name: str | None, reminder: bool) -> tuple[str, str]:
    due = rfq.quote_due_date.strftime("%d-%m-%Y") if rfq.quote_due_date else "as soon as possible"
    subject = (f"{'Reminder: ' if reminder else ''}Request for Quotation {rfq.rfq_number} — {COMPANY} "
               f"(quote by {due})")
    buyer_name = (buyer.name or buyer.email) if buyer else "Purchase Department"
    buyer_line = escape(buyer_name) + (f" · {escape(buyer.email)}" if buyer and buyer.email else "")
    intro = (f"This is a reminder for our request for quotation {escape(rfq.rfq_number)}. We have not received your quotation yet — "
             f"please send it by <strong>{due}</strong>." if reminder else
             f"Please send us your best quotation for the items below by <strong>{due}</strong>.")
    note = (f'<div style="border-left:4px solid #f97316;background:#fff7ed;padding:12px 14px;margin:0 0 18px;font-size:13px;'
            f'white-space:pre-wrap">{escape(rfq.invite_message)}</div>' if rfq.invite_message else "")
    late = (f'<p style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#64748b;margin:18px 0 6px">'
            f'Late delivery clause</p><p style="margin:0;font-size:13px;white-space:pre-wrap">{escape(rfq.late_delivery_clause)}</p>'
            if rfq.late_delivery_clause else "")
    body = f"""
    <p style="margin:0 0 10px;font-size:14px;color:#1e293b">Dear {escape(contact_name or "Sir / Madam")},</p>
    <p style="margin:0 0 18px;font-size:14px;color:#475569;line-height:1.6">{intro}</p>
    {note}
    {_items_html(pr)}
    <p style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#64748b;margin:18px 0 6px">Please include in your reply</p>
    <ol style="margin:0;padding-left:18px;font-size:13px;color:#1e293b;line-height:1.7">
      <li>Unit rate for each item (and any discount)</li>
      <li>GST % and HSN code</li>
      <li>Delivery time (days from the purchase order)</li>
      <li>Payment terms</li>
      <li>Freight and packing, if charged extra</li>
      <li>Validity of the quotation</li>
      <li>Your quotation as a PDF attachment, quoting <strong>{escape(rfq.rfq_number)}</strong></li>
    </ol>
    {late}
    <p style="margin:20px 0 0;font-size:14px;color:#1e293b">Regards,<br><strong>{buyer_line}</strong><br>Purchase Department, {COMPANY}</p>"""
    html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9">
<div style="font-family:Arial,sans-serif;max-width:660px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden">
  <div style="background:#fff;padding:20px 28px;border-bottom:3px solid #f97316">{_logo_header()}</div>
  <div style="background:#0f172a;padding:18px 28px">
    <p style="color:#94a3b8;font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">Request for Quotation</p>
    <h2 style="color:#fff;margin:0;font-size:20px;font-weight:700">{escape(rfq.rfq_number)}</h2>
  </div>
  <div style="padding:28px">{body}</div>
  <div style="background:#f8fafc;padding:14px 28px;border-top:1px solid #e2e8f0">
    <p style="font-size:11px;color:#94a3b8;margin:0;text-align:center">Reply to this email — it reaches our buyer directly.</p>
  </div>
</div></body></html>"""
    return subject, html


async def send_invite(db: Session, rfq: RFQ, pr: P2PRequest, invite: RFQVendorInvite, buyer: User | None,
                      contact_name: str | None, reminder: bool = False) -> tuple[bool, str]:
    """Emails one vendor. Returns (ok, the real reason when not)."""
    if not invite.email:
        return False, (f"{invite.vendor_name} has no email in the vendor master — add it under Procurement › Vendors, "
                       "then use Resend.")
    if not settings.SENDER_EMAIL:
        return False, "Email isn't configured on the server (SENDER_EMAIL is empty) — ask the portal administrator."
    subject, html = build_rfq_email(rfq, pr, buyer, contact_name, reminder)
    reply_to = [(buyer.email, buyer.name or buyer.email)] if buyer and buyer.email else None
    return await _send_graph_mail(settings.SENDER_EMAIL, subject, html, invite.email, invite.vendor_name,
                                  sender_name=f"{COMPANY} — Purchase", reply_to=reply_to)


def quote_due_default(db: Session) -> date:
    from datetime import timedelta
    from app.modules.p2p.settings import get_setting
    return date.today() + timedelta(days=int(get_setting(db, "rfq_quote_days") or 3))
