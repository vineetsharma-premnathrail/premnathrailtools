# Sales Library — spec (contract for all builders)

Read `requirement.md` first. Everything below is fixed; builders do not change names.

## 1. Placement
- New CRM tab **Sales Library**, permission key `crm:sales_library` (tab actions: view, create, edit, delete).
  Feature `confidential` (subtab type, actions `view` inherit `edit`) = see confidential folders/documents.
- URL: `/dashboard/crm/library`. CrmNav item after Products: `{ href: '/dashboard/crm/library', label: 'Sales Library', icon: 'folder' (or closest existing), subtabKey: 'sales_library' }`.
- Product detail page (`/dashboard/products/[id]`) gets a **Sales Resources** section/tab listing documents linked to that product, grouped by folder, with type counts (Catalogues / Videos / Pricing / Quotations come from folder names — just group by folder).

## 2. Data model (database-agent) — module `backend/app/modules/crm/models/library.py`
All tables use `TimestampMixin`; folders and documents also `SoftDeleteMixin`.

`crm_library_folders`
| col | type | why |
|---|---|---|
| id | int pk | |
| parent_id | FK crm_library_folders.id ON DELETE RESTRICT, null = root, index | nested folders |
| name | String(150) not null | |
| description | Text null | |
| product_id | FK products.id ON DELETE SET NULL, null, index | files uploaded here auto-link this product |
| is_confidential | bool default false | access control |
| is_pricing | bool default false | documents inside must carry an expiry date |
| sort_order | int default 0 | seeded folders keep 01..07 order |
| created_by_id | FK users.id SET NULL null | delete-own rule |
Unique among live rows: partial unique index on (coalesce(parent_id,0), lower(name)) WHERE is_deleted = false.

`crm_library_documents`
| col | type | why |
|---|---|---|
| id | int pk | |
| folder_id | FK crm_library_folders.id RESTRICT, not null, index | |
| title | String(200) not null | display name (defaults to file name) |
| description | Text null | |
| file_kind | String(20) not null | pdf / video / image / spreadsheet / document / presentation / other (derived from extension+mime on upload) |
| tags | JSON list of strings, default [] | search |
| expiry_date | Date null, index | outdated pricing; required when folder.is_pricing |
| current_version_no | int default 1 | |
| created_by_id | FK users.id SET NULL null, index | |

`crm_library_document_versions`
| id pk | document_id FK documents CASCADE index | version_no int | file_name String(255) | sharepoint_path String(1000) | sharepoint_url String(1000) null | file_size BigInteger null | mime_type String(255) null | change_note Text null | uploaded_by_id FK users SET NULL | created_at (TimestampMixin) |
Unique (document_id, version_no).

`crm_library_document_links` — one document, many links (never copies)
| id pk | document_id FK CASCADE index | link_type String(20) in ('product','project','organization') | link_id int not null | unique (document_id, link_type, link_id); index (link_type, link_id) |
(project = `pm_projects.id`, organization = `crm_organizations.id`, product = `products.id`; integrity checked in the route, no polymorphic FK.)

`crm_library_favorites` — pk (user_id FK users CASCADE, document_id FK documents CASCADE), created_at.

Migration: ONE file, `down_revision` = head at launch. Seeds 7 root folders (sort_order 1..7):
`Products`, `Project References`, `Pricing & Quotations` (is_pricing=true, is_confidential=true),
`Company Profile & Presentations`, `Technical Resources`, `Customer References`, `Templates`.
Register models in `app/modules/crm/models/__init__.py` (database-agent may edit that file) and return the
`alembic/env.py` / `main.py` import snippet for the Manager.

## 3. API (backend-agent) — `backend/app/modules/crm/routes/library.py`, schemas `crm/schemas/library.py`, prefix `/crm/library`
Every route: `require_tab_access("crm","sales_library")` + action check (`ensure_tab_action`). Confidential
folder/document → 404-style hidden unless `can_feature(user,"crm","sales_library","confidential","view")` or admin
(list endpoints filter them out; get-by-id returns 403 with a real message). Delete = `ensure_can_delete` (own only, admin any).
All errors: reason + how to fix. Lists sorted by name asc (folders) / title asc (documents) by default.

| Method | Path | Notes |
|---|---|---|
| GET | `/summary` | `{folders, documents, videos, expired, expiring_30d, recent: [doc...] (last 8 by created_at)}` respecting confidential |
| GET | `/folders` | flat list `[{id,parent_id,name,description,product_id,product_name,is_confidential,is_pricing,sort_order,document_count,created_by_id}]` (frontend builds tree) |
| POST | `/folders` | create (name, parent_id, description, product_id, is_confidential, is_pricing). Child of a confidential folder is forced confidential. Duplicate name in same parent → 409 |
| PATCH | `/folders/{id}` | rename / move (parent_id) / flags. Moving into itself or a descendant → 422 "would create a loop" |
| DELETE | `/folders/{id}` | only when no live sub-folders and no live documents → else 409 listing counts |
| GET | `/documents` | query: `folder_id` (direct children only), `q` (title/description/tags/file name/linked product name, word-by-word AND, any order), `file_kind`, `product_id`, `project_id`, `organization_id`, `favorites=true`, `expiry=expired|expiring` , `include_subfolders=true`. Returns list items incl. folder_path ("Products › RRV"), links with names, current version (file_name, size, mime), is_favorite, is_expired, created_by_name, updated_at |
| GET | `/documents/{id}` | detail + versions list + links |
| POST | `/documents/upload-session` | body `{folder_id, file_name, file_size, mime_type, document_id?}` (document_id = new version of existing). Validates folder/perm then reuses `app.utils.sharepoint.create_upload_session` + upload token exactly like `crm/routes/documents.py` start_direct_upload. SharePoint path `Sales Library/<doc-or-pending id>/v<n>-<file>` (use a temp key then the doc id; follow existing pattern) |
| POST | `/documents/complete-upload` | body `{upload_token, title?, description?, tags?, expiry_date?, change_note?, links?:[{link_type,link_id}]}` → creates document + version 1, or new version (bumps current_version_no). Pricing folder without expiry_date → 422 "Pricing documents need an expiry date so outdated prices are flagged — pick the date the price list stops being valid." Auto-link folder.product_id |
| PATCH | `/documents/{id}` | title, description, tags, expiry_date, folder_id (move), links (replace set). create perm = `create`, these = `edit` |
| DELETE | `/documents/{id}` | soft delete |
| GET | `/documents/{id}/download-url?version_no=` | short-lived SharePoint download url (reuse `get_download_url`) |
| GET | `/documents/{id}/content?version_no=` | streamed bytes for in-app preview (pdf/image/video), reuse `download_file_content`; inline disposition |
| POST / DELETE | `/documents/{id}/favorite` | per user |
| GET | `/products/{product_id}/resources` | docs linked to product, grouped `[{folder_id, folder_path, documents:[...]}]` |
| POST | `/documents/{id}/share` | body `{user_ids:[int], message?}` → in-app notification (bell) to each, link to the library with the doc open. Register a direct notification type via existing `register_direct` pattern (return snippet if the registry file is needed) |

Pickers the form needs: products list (existing `/products`), PM projects (existing project picker endpoint), organizations (existing). Backend-agent: name which existing endpoints the frontend should use in its report.

Tests: `backend/app/tests/test_crm_sales_library.py` — folder loop guard, delete-non-empty 409, pricing expiry 422, confidential hidden from list and 403 on get, own-only delete, search word-by-word, version bump. Mock SharePoint.

## 4. Frontend (frontend-agent)
Files: `frontend/src/lib/salesLibraryApi.ts` (own api + types — do NOT edit lib/api.ts / types/index.ts),
`frontend/src/app/dashboard/crm/library/page.tsx`, `frontend/src/components/crm/library/**`,
`frontend/src/components/crm/CrmNav.tsx` (one nav item), product detail page Sales Resources section,
`frontend/src/lib/tour/configs/crmSalesLibrary.ts` (+ register it wherever crm tours are registered — report if that is a registry).

Screen (follow `premnathrail-ui-behavior`, `erp-ui-ux-design`):
- CrmNav above header. Header "Sales Library" + subtitle "All product, project and sales material in one place". Primary "+ Upload" button, secondary "+ New folder".
- Count cards: Folders, Documents, Videos, Expired — every card clickable as a filter toggle (Expired → expiry=expired, Videos → file_kind=video).
- Search box (word-by-word) + one FilterMenu funnel (file type, product, project, customer, favourites, expiry).
- Body: left folder tree (expand/collapse, folder actions in a ⋯ AnchoredPopover: New sub-folder, Rename/Edit, Move, Delete) — right: table of documents (Title + type icon, Folder, Linked to, Version, Expiry badge, Updated, ★). Breadcrumb above the table. Empty folder state with Upload button. "Recently added" strip on the root view.
- Row click → document detail panel (portal drawer or split view): preview (pdf iframe, image, `<video controls>`; others = "Preview not available — Download"), metadata, links, versions list (download any version), actions: Download, Upload new version, Edit details, Share, Favourite, Delete (ConfirmDialog).
- Upload = FormSheet popup: File (big files allowed; chunked direct upload via upload-session like CRM documents' uploader — reuse its client helper if one exists), Folder (Select tree), Title, Description, Tags (chips), Expiry date (required + hint when folder is pricing), Links (Products multi, Projects multi, Customers multi — shared Select). useFormDraft + DraftBanner for metadata. Idempotency handled by middleware.
- Folder form = FormSheet: Name, Parent, Description, Linked product, Confidential, Pricing toggles.
- Share = FormSheet: pick users (multi Select), message.
- Permission gating: hide Upload/New folder without create, Edit without edit, Delete without delete (own only — backend decides, show real error).
- Signed record links: deep link to a document uses `recordPath` / `useRecordId` (query param via the existing signed-ref helper), never a raw id in the URL.
- No window.confirm/alert/prompt; all popups via createPortal; no native `<select>`; 34/28 control scale; real error messages; no SAP words.

## 5. Acceptance criteria
1. Given CRM › Sales Library › View, when I open the tab, I see the 7 seeded folders, counts, recent files.
2. Given a nested folder, Delete is refused with the count of what is inside; an empty one deletes.
3. Moving a folder into its own child is refused with a real message.
4. Uploading a 200 MB mp4 works (chunked) and it plays in the preview.
5. Uploading into "Pricing & Quotations" without expiry is refused; with a past expiry date it shows "Expired".
6. Upload new version → version 2 is current; version 1 still downloadable.
7. A document linked to product RRV appears on the RRV product page under Sales Resources and when filtering by product.
8. A user without the confidential feature never sees the Pricing folder or its documents (list, search, summary, product page) and gets 403 on direct get.
9. Search "rrv demo" finds "RRV Product Demo.mp4" (any word order).
10. Favourite toggles; Favourites filter shows only mine.
11. Share sends a bell notification to the picked users that opens the document.
12. User without delete, or not the creator, cannot delete; admin can.
