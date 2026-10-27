# CRM Reports (management dashboards)

**Asked (2026-10-27, owner):** a Reports section inside CRM where management sees data graphically: how many leads came in, how many per month, and similar.

**Core-flow position:** Customer → BD (CRM). Read-only analytics over CRM inquiries (= leads) and their quotations; no data model change.

## Decisions taken (ERP-standard defaults)
- Built on the shared reports framework (`backend/app/core/reporting`), same Power BI-style page as Service › Reports (owner feedback 2026-10-26: ready-made dashboards, no report builder).
- Lead = CRM inquiry (not deleted). Received date = inquiry created date (IST). Won = stage Order Received / status Closed - Ordered; Lost = Closed - Not Ordered.
- Pages: Leads (overview), Open pipeline (as of today), Won & Lost (by closed date, lost reasons, competitors), Quotations, Sales team (per BD owner).
- New permission tab CRM › Reports (view / export / print) and feature Reports › People & performance (per-BD-owner figures; without it the Sales team page shows only the viewer's own leads).
- Money (expected value, quoted value) only with CRM › Inquiries & Tenders › Prices & margins. Domestic (₹) and Export ($) quoted values are kept apart, never added.
- Data scope: everything starts from the viewer's CRM data scope on inquiries.
- Tenders are not in v1 (separate record, different stages); can be added as a third dataset later.
