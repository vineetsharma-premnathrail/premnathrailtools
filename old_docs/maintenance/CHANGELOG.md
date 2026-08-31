# Changelog

This is a rolling, dated changelog for the Premnathrail Portal. The project
does not use semantic versioning (see `VERSION_HISTORY.md`), so entries are
grouped by date rather than release number.

Two sources feed this file:

1. **In-app "What's New" feed** — `frontend/src/lib/changelog.ts`, shown from
   the "Updates" button in the app navbar. This is the user-facing record of
   shipped changes and is reproduced verbatim below.
2. **Git commit history** (`git log`) for the same period, which additionally
   surfaces backend/infra changes that never got a user-facing changelog
   entry (they didn't need one — no visible behavior change for users).

When adding a new user-facing change, add an entry to
`frontend/src/lib/changelog.ts` first; mirror it here in the same edit or in
a follow-up housekeeping pass.

## 2026-08-05 — CRM Activities: photos & fixes

- Add photos to an Activity (camera or drag & drop) — visible from the
  Organization's Activities tab, the Inquiry's Activities tab, and the
  Activities list view.
- Fixed: an Organization's Activities tab now shows activities logged
  against its Inquiries/Tenders even if the activity was logged before the
  Inquiry was reassigned to this Organization.
- Fixed: logging an Activity against an Inquiry or Tender now offers a
  searchable dropdown of that organization's records instead of typing the
  ID by hand.
- Teams app: added camera/media permission so "Take photo" works inside
  Teams on mobile and desktop (requires reinstalling the updated Teams app
  package).

## 2026-08-05 — Purchase: material remarks & photos

- Purchase Requisition materials now have a remarks field for notes like
  vendor lead times.
- View material photos directly from the Purchase Requisition page — the
  same gallery uploaded from the Service Request's Materials tab.
- CRM Activities: added a date field, structured Minutes of Meeting items,
  and contact linking.

## 2026-08-03 — Feedback

- New "Feedback" nav item — send issues or suggestions straight to the admin
  team.
- Admins get a feedback bell on Users & Roles showing unread feedback, with
  a popup to review it.

## 2026-08-03 — MOM PDF export & login page cleanup

- CRM Inquiry "Export MOM" now offers a PDF download alongside Word (.docx).
- Minutes of Meeting "Responsibility" column now always shows the BD Owner,
  not a client contact.
- Cleaned up the sign-in page — removed the status badge, tagline, and
  duplicate logo.

## 2026-08-02 — Calendar fix

- The date picker calendar no longer gets clipped inside scrollable panels.

## 2026-08-02 — CRM: Minutes of Meeting export

- Export a formatted Minutes of Meeting Word document directly from an
  inquiry's Activities tab.
- Add/edit organizations from every CRM page, not just the Organizations
  list.
- Activities now show organization and contact context.

## 2026-08-02 — Service request email fix

- The Premnathrail logo in service request emails now displays correctly
  for all email clients.

## 2026-08-01 — Purchase module improvements

- Purchase Requisition status can now be manually overridden.
- Materials are automatically marked "issued" once fully received.

---

## Additional commit history (not reflected in the in-app feed)

The entries above are copied from `frontend/src/lib/changelog.ts`. The
following commits from the same ~120-day window touched code but were not
(or not separately) called out in the in-app feed — mostly backend
hardening, infra, and internal fixes:

### 2026-08-06

- `d383e23` — Fix mobile layout overflow, add real camera capture
  (`CameraCapture.tsx`), responsive text sizing on mobile.

### 2026-08-06 (earlier)

- `2f9fd51` — CRM activity attachments (backend model/routes/tests),
  supports the "add photos to an Activity" feature above.

### 2026-08-05

- `d51ca3b` — Purchase requisition route cleanup/simplification.
- `5f2e3a0` — Activity form: Universal ID now a searchable dropdown scoped
  to the org's Inquiries/Tenders instead of free text.
- `0726ae7` — PR item remarks/photos, CRM activity MOM improvements,
  service material attachments (the backend work behind several items
  above).

### 2026-08-03

- `ab35302` — Notification/permission-check wording and consistency fixes
  across CRM and ERP routes.
- `6dfa06f` — Teams app notification support.
- `4d5f503` — Security fixes to R&D report/PDF generation (LaTeX escaping
  in `braking`, `hydraulic`, and `spline` tool report builders — prevents
  injection via user-supplied values rendered into LaTeX).
- `cf2eb47` — Added user Feedback feature (backend model/routes/tests,
  `FeedbackBell`/`FeedbackButton` components, legal pages).
- `e4746bb`, `b726410` — Small CRM organization/inquiry form fixes.
- `2c0a4fd`, `7da9b2d` — Iteration on the "Updates" button component itself.

### 2026-08-02 and earlier (selected)

- `0bb3c39` — DateField calendar clipping fix (matches "Calendar fix" above).
- `a2f98a8` — Word-based Minutes of Meeting export, org-page add/edit
  everywhere, activity org/contact context.
- `843a1a0` — Service request email logo sent as inline CID attachment
  (fixes logo rendering across email clients).
- `b39642b` — Manual PR status override, auto-mark materials issued on
  full receipt.
- `47a23b1` — Machine Assets widget sort changed to natural sort by serial
  number.
- `c9ff1c1` — R&D: surface real PDF/report errors, add TeX Live to the
  Docker image.
- `5e74a18` — Added the Purchase Requisition module, raised from Service
  Request materials (foundational feature for the Purchase module).
- `10fb435` — Teams app manifest bumped to 1.4.2 (Teams app packaging has
  its own version number, unrelated to the web app — see
  `VERSION_HISTORY.md`).
- `d20f6c4`, `211ef8b`, `30f7c06` — CRM: ERP sub-permission docs, Activity
  follow-up reminder notifications, inline contact creation.
- `badedda`, `73845a5`, `1ef2962`, `e222141` — Auth/permissions hardening:
  account-switch fix, server-side ERP sub-permission enforcement, hiding
  UI the user lacks permission for, "Sync from Azure AD" button.
- `0a0e9da` — Fixed baseline Alembic migration for a genuinely fresh
  database.
- `c264408` — Consolidated to a single Dockerfile running both services.
- `3ff1cfa` — Wrapped `useSearchParams()` pages in `Suspense` to fix the
  production build.
- `4d04d0b` — Glass-shadow consistency, R&D deep-link fixes, validation/UX
  bugs, logo update.
- `c897977` — Added production Dockerfiles, enabled Next.js standalone
  output.
- `643c9d1` — Security and correctness fixes in auth, CORS config, CRM
  routes, and uploads.
- `a0e0b13` — Set up Alembic migrations, extended the User model for
  remote-DB parity.
- `6632a4b` — Initial commit (frontend, backend, docs, infra).

For full diffs, run `git log --stat` or `git show <hash>` from the repo
root.
