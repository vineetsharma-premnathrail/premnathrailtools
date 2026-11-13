# Sales Library (CRM) — requirement

**Date:** 2026-11-12. **Size:** L (new tables, uploads, permissions, new CRM tab).
**Core flow:** Customer → **BD** (sales support material used while working inquiries/tenders). Reads Products master; links to PM projects (PEW) and Customer Organizations as references only.

## Business ask (owner)
One organised place in CRM for sales material: product catalogues, demo videos, images,
price lists, standard quotations, company profile / presentations, technical datasheets,
project / customer references and templates. Upload any file type, nested folders,
link files to products / projects / customers, versions, expiry dates, confidential
access, preview, download, search, favourites, share inside the team.

## Owner decisions (2026-11-12, in chat)
1. **Project section = references only.** Case studies, completion photos/videos, reference letters,
   project presentations. Drawings stay in Design (revisions), customer requirements stay on the
   inquiry/tender. No copies of those in the Library.
2. **Folders = user-created nested folders** (not fixed sections). Seed the 7 suggested top folders;
   users may add / rename / move folders. Guard rails: delete only an empty folder; move cannot
   create a loop.
3. **No approval** before publishing anything (pricing included). Pricing folders still force an
   expiry date on every document in them.
4. **Share = internal only** (copy portal link / notify a colleague). No download audit log.

## Manager decisions (ERP standard, logged)
- One central document record + versions; products / projects / customers are *links*, never copies.
- Files live in SharePoint at a stable path `Sales Library/<doc id>/v<n>-<file>` so renaming or
  moving folders never moves files.
- A folder may be linked to a product: files uploaded into it auto-link that product.
  Product detail page gets a "Sales Resources" tab built from links.
- Confidential = folder flag; confidential folders/documents visible only with the
  `crm:sales_library.confidential:view` feature (admin always).
- No data scope (company-wide library); deny-by-default through the new CRM tab permission.
- BA step done by the Manager from the owner's answers (no separate ba-agent); architecture in spec.md.
