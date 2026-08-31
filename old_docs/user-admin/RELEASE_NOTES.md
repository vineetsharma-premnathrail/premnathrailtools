# Release Notes

Chronological, user-facing changes to the portal. The primary source of truth is the in-app "What's New" changelog (the **Updates** button in the navbar), driven by [`frontend/src/lib/changelog.ts`](../../frontend/src/lib/changelog.ts) — that file is the living source; this document mirrors it plus additional context from git history for changes that shipped before the changelog existed. If the two ever disagree, trust `changelog.ts`.

---

## 2026-08-05 — CRM Activities: photos & fixes

- Add photos to an Activity (camera or drag & drop) — visible from the Organization's Activities tab, the Inquiry's Activities tab, and the Activities list view.
- Fixed: an Organization's Activities tab now shows activities logged against its Inquiries/Tenders even if the activity was logged before the Inquiry was reassigned to this Organization.
- Fixed: logging an Activity against an Inquiry or Tender now offers a searchable dropdown of that organization's records instead of typing the ID by hand.
- Teams app: added camera/media permission so "Take photo" works inside Teams on mobile and desktop (requires reinstalling the updated Teams app package).

## 2026-08-05 — Purchase: material remarks & photos

- Purchase Requisition materials now have a remarks field for notes like vendor lead times.
- View material photos directly from the Purchase Requisition page — the same gallery uploaded from the Service Request's Materials tab.
- CRM Activities: added a date field, structured Minutes of Meeting items, and contact linking.

## 2026-08-03 — Feedback

- New "Feedback" nav item — send issues or suggestions straight to the admin team.
- Admins get a feedback bell on Users & Roles showing unread feedback, with a popup to review it.

## 2026-08-03 — MOM PDF export & login page cleanup

- CRM Inquiry "Export MOM" now offers a PDF download alongside Word (.docx).
- Minutes of Meeting "Responsibility" column now always shows the BD Owner, not a client contact.
- Cleaned up the sign-in page — removed the status badge, tagline, and duplicate logo.

## 2026-08-02 — Calendar fix

- The date picker calendar no longer gets clipped inside scrollable panels.

## 2026-08-02 — CRM: Minutes of Meeting export

- Export a formatted Minutes of Meeting Word document directly from an inquiry's Activities tab.
- Add/edit organizations from every CRM page, not just the Organizations list.
- Activities now show organization and contact context.

## 2026-08-02 — Service request email fix

- The Premnathrail logo in service request emails now displays correctly for all email clients.

## 2026-08-01 — Purchase module improvements

- Purchase Requisition status can now be manually overridden.
- Materials are automatically marked "issued" once fully received.

---

## Earlier history (from git commit history, before the in-app changelog existed)

The entries above come directly from `changelog.ts`. The commits below predate that file (or landed without a matching changelog entry) — they're included here for a fuller timeline, grouped by theme rather than exact date since commit dates for this range are not independently verifiable beyond ordering. Undated/ambiguous commit messages (e.g. "fix", "updates", "updates2/3") are omitted where a specific user-facing change can't be determined from the message alone.

**Purchase Requisition module (standalone):**
- Added the standalone Purchase Requisition module, raised directly rather than from a Service Request's materials list (`5e74a18`, feat(purchase): add Purchase Requisition module raised from Service Request materials — note: this commit message describes the module family broadly; the standalone `p2p` app and its `/dashboard/p2p` UI are part of this same body of work per the module ground truth).
- Added PR item remarks/photos, CRM activity Minutes of Meeting improvements, and service material attachments (`0726ae7`).

**CRM:**
- Word-based Minutes of Meeting export, add/edit organization from any CRM page, and activity organization/contact context (`a2f98a8`).
- Inline contact creation and a related-record picker in Activity/Note forms (`30f7c06`).
- Daily reminder notifications for Activity follow-up dates (`211ef8b`).

**Access control / permissions:**
- Server-side enforcement of ERP sub-permissions, not just hiding buttons in the UI (`73845a5`).
- Hid nav entries and ERP action buttons for users lacking the relevant permission (`1ef2962`).
- Documented ERP sub-permission enforcement and its follow-up reminder job (`d20f6c4`).
- Added a "Sync from Azure AD" button to Users & Roles (`e222141`).

**Sign-in / Teams:**
- Let users switch Microsoft account on login (`badedda`).
- Notifications wired up inside the Teams app (`6dfa06f`, `ab35302`).
- Teams app manifest bumped to 1.4.2 with a color icon update (`10fb435`).

**Fixes & infra (less user-facing, included for completeness):**
- Security fixes across auth, CORS configuration, CRM routes, and uploads (`643c9d1`, `4d5f503`).
- DateField calendar clipping fix inside scrollable panels (`0bb3c39` — later reflected as the 2026-08-02 "Calendar fix" changelog entry).
- Service request email logo now sent as an inline CID attachment so it renders correctly across email clients (`843a1a0` — reflected as the 2026-08-02 "Service request email fix" changelog entry).
- Manual PR status override and auto-marking materials "issued" on full receipt (`b39642b` — reflected as the 2026-08-01 "Purchase module improvements" changelog entry).
- RFQ/PDF report error surfacing fix and Docker image TeX Live addition for R&D report generation (`c9ff1c1`).
- "Machine Assets" widget sort changed to natural sort by serial number (`47a23b1`).
- Fixed mobile layout overflow, added real camera capture, and responsive text sizing (`d383e23`, most recent commit at time of writing).

---

*This document was last assembled 2026-08-14 by cross-referencing `frontend/src/lib/changelog.ts` (entries through 2026-08-05) with `git log` (through commit `d383e23`). Newer changes will appear in `changelog.ts` and the in-app Updates button before they're reflected here — check that file directly for the most current list.*
