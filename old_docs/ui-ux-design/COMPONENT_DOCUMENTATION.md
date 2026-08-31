# Component Documentation

Catalog of reusable components under `frontend/src/components/`. Props and behavior are read directly from source — nothing inferred beyond what the code does. Cross-reference: [../product/PRODUCT.md](../product/PRODUCT.md).

## Shell / layout

### `Sidebar.tsx`
`export default function Sidebar({ user, onNavigate }: { user: User | null; onNavigate?: () => void })`
Sticky glass panel (`width: 260`, `borderRadius: 26`) rendered in the authenticated dashboard shell. Renders nav links filtered by `user.apps` (plus `Dashboard` always, `Users & Roles` only for `role === 'admin'`), a `FeedbackButton`/`UpdatesButton` pair, and a user-menu popover (avatar initials, email/designation/department rows via internal `InfoRow`, sign-out button that calls `logout()` then routes to `/login`). `onNavigate` is called on link click — used by the parent to close a mobile drawer.

### `ModuleCard.tsx`
```ts
{ title, description, icon, href, features, barColor, iconBg, iconColor, tagBg, tagColor }
```
Glass card used on the dashboard app-launcher grid. Hover state (local `useState`) swaps to a stronger glass tier and lifts (`translateY(-3px)`). Wraps its content in a Next `Link` to `href`. `features` renders as pill tags.

### `Navbar.tsx`
Not read in full detail during this pass — present under `frontend/src/components/Navbar.tsx`; used for a header bar distinct from `Sidebar`. Confirm its exact prop shape by reading the file directly if implementing against it.

## Feedback / confirmation

### `erp/ConfirmDialog.tsx`
```ts
{ open, title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true, onConfirm, onCancel }
```
Centered modal (click-outside-to-cancel via a full-screen overlay `onClick={onCancel}`, with `stopPropagation` on the inner card). Icon and confirm-button color switch red (`#dc2626`) when `danger`, else the brand gradient. Used for destructive confirmations (e.g. project delete in `projects/[id]/page.tsx`).

### `FeedbackBell.tsx` / `FeedbackButton.tsx` / `UpdatesButton.tsx`
Present under `frontend/src/components/`; render feedback/what's-new entry points referenced from `Sidebar.tsx` (`FeedbackButton variant="row"`, `UpdatesButton variant="row"`). Not read in full detail — inspect directly for exact prop contracts before reuse.

## Forms / inputs

### `ValidatedInput.tsx`
```ts
{ value, onChange, validator, errorMessage, style?, type = 'text', placeholder? }
```
Drop-in `<input>` replacement. Tracks `touched` (set on blur) so the red border + error text only appear after the field has been interacted with, not while the user is still typing a fresh value. Used for email and GST fields in `ProjectForm.tsx` with `isValidEmail`/`isValidGST` from `lib/validation`.

### `erp/SearchableSelect.tsx`
```ts
interface SearchableOption { value: string; label: string }
{ value, onChange, options, placeholder = 'Select...' }
```
Custom dropdown (not a native `<select>`) with a type-to-filter search box, click-outside-to-close (`mousedown` listener on a ref), max height `280` with internal scroll, "No matches." empty state.

### `erp/DateField.tsx`, `erp/PhoneField.tsx` (+ `isPhoneValid`), `erp/YearField.tsx` (+ `isFinancialYearValid`)
Field-level input wrappers used throughout `ProjectForm.tsx`. Each phone/year field exports its own validator function alongside the component (`isPhoneValid`, `isFinancialYearValid`) so the parent form can re-run the same validation logic at submit time rather than only reacting to onChange.

### `erp/SharePicker.tsx` (+ `useShareSelection` hook)
```ts
useShareSelection() -> {
  isPrivate, userIds, departments, designations,
  toggleUser, toggleDepartment, toggleDesignation,
  setAll, reset,
}

SharePicker({
  directory: DirectoryUser[], currentUserId?,
  isPrivate, onTogglePrivate,
  selectedUserIds, onToggleUser,
  selectedDepartments, onToggleDepartment,
  selectedDesignations, onToggleDesignation,
  disabled?,
})
```
Controls who can see a private document: a checkbox plus three independent, OR-matched pickers — specific people (excludes `currentUserId` from the list, chip-button style with search), whole departments, whole designations (both derived live from the `directory` prop via `Array.from(new Set(...))`, not a frozen snapshot). `useShareSelection`'s `setIsPrivate` wrapper auto-clears all three selections when turned off. Reused identically by the project-create/edit wizard's Documents tab and by the per-file "Manage access" flow on the Documents tab of the project detail page — confirmed by shared usage in `ProjectForm.tsx` and `projects/[id]/page.tsx`.

### `erp/ProjectForm.tsx`
```ts
{
  initial?: Partial<Project>, submitLabel: string,
  onSubmit: (payload, files: File[], shareOptions) => Promise<void>,
  onCancel: () => void, currentUserId?: number,
}
```
The full create/edit form for a Project — see SCREEN_SPECIFICATIONS.md §4 for a complete walkthrough of its 5 tabs, validation rules, and states. Notable internal building blocks defined in the same file (not separately exported): `Section`, `Row`, `Grid3`, `Field` — simple layout wrappers reused across all 5 tabs to keep field markup consistent.

### `erp/ServiceRequestForm.tsx`, `crm/OrganizationForm.tsx`, `crm/TenderForm.tsx`, `crm/InquiryForm.tsx`, `crm/NoteForm.tsx`, `crm/ActivityForm.tsx`
Domain-specific form components for ERP Service Requests and CRM entities, following the same general pattern as `ProjectForm.tsx` (tabbed or single-section forms with local validation). Not read in full during this pass — inspect each directly for its exact field list and validators before reuse; they are not interchangeable despite structural similarity.

## File handling

### `FileUploadPreview.tsx`
```ts
{ files: File[], onRemove: (index: number) => void, onConfirm: () => void, onCancel: () => void, uploading: boolean }
```
Renders a staged-file review list before anything is actually uploaded — shows an image thumbnail (via `URL.createObjectURL`, revoked on cleanup) or a generic file icon, per-file remove button (disabled while `uploading`), and Upload/Cancel actions. Returns `null` if `files.length === 0`. Used by both the Documents tab (`projects/[id]/page.tsx`) and `ProjectForm.tsx`'s Documents tab.

### `CameraCapture.tsx`
```ts
{ onCapture: (file: File) => void, onClose: () => void }
```
Full-screen modal wrapping a live `getUserMedia` video preview (rear camera preferred via `facingMode: { ideal: 'environment' }`) with a canvas-based snapshot capture, producing a `File` (`image/jpeg`, quality 0.92) passed to `onCapture`. Exists specifically because desktop browsers ignore the native `<input capture>` attribute — every desktop Chromium/Firefox browser opens a plain file picker instead of a camera, so this component provides a real webcam flow. Handles and displays two distinct permission/hardware errors: `NotAllowedError` ("Camera permission was denied...") and `NotFoundError` ("No camera was found on this device."), falling back to a generic "Could not access the camera." for anything else. Cleans up the media stream's tracks on unmount.

## Notifications

### `erp/NotificationBell.tsx`
No props (self-contained). Polls unread count every 30s (`setInterval`, cleared on unmount) via `notificationsApi.getUnreadCount()`. Bell badge shows `unreadCount` capped display at `"9+"`. Clicking opens a popover (click-outside-to-close) that lazy-loads the full notification list only on first open. Each notification is clickable and routes to the relevant entity via an internal `ENTITY_LINK` map keyed by `entity_type` (`service_request`, `project`, `organization`, `inquiry`, `tender`) — deleted entities are special-cased via a separate `DELETED_TYPE_LINK` map that redirects to the appropriate module's recycle bin instead of the (now-404ing) detail route, keyed by `notification_type` values like `sr_deleted`, `project_deleted`. Explicit loading state ("Loading…") and empty state ("No notifications yet.") on the popover body. "Mark all read" button appears only when `unreadCount > 0`.

## Navigation (module sub-nav)

### `erp/ErpNav.tsx`
No props. Tab strip for the ERP module: `Dashboard | Projects | Service Requests | Reports | Recycle Bin`, each with its own inline SVG icon (`TabIcon` internal helper, cases: `grid`, `truck`, `file`, `chart`, `trash`). Active-tab detection: exact match for the ERP root (`/dashboard/erp`), `startsWith` for all other tabs. Renders a `NotificationBell` at the right edge of the same row.

### `rnd/RndNav.tsx`, `crm/CrmNav.tsx`
Sibling sub-nav components for the R&D and CRM modules, structurally analogous to `ErpNav.tsx` (tab strip + active-route highlighting). Not read in full — confirm their specific tab lists directly before reuse.

## Domain-specific / module-scoped (catalogued but not detailed)

These exist under `components/` but were out of scope for detailed prop documentation in this pass — read them directly if building against them:

- `rnd/TerminalPanel.tsx`, `rnd/StatCard.tsx`, `rnd/ChartJsLineChart.tsx`, `rnd/ToolCalculatorPage.tsx` — R&D engineering-calculator UI (terminal-style output panel, stat tiles, line charts, a generic calculator-tool page shell).
- `crm/ui.tsx` — shared CRM primitive styles (imports from `lib/theme.ts`'s backward-compat `COLORS`/`RADII`/`BORDERS` aliases per that file's own comment).
- `crm/NumberedTextarea.tsx` — a textarea variant, likely for numbered list-style input (e.g. MOM items); confirm exact behavior in source.
- `legal/LegalPageShell.tsx` — layout wrapper for the legal pages (`/legal/privacy-policy`, `/legal/terms-of-use`, `/legal/permissions`) linked from the login screen's footer.

## Component reuse patterns worth noting

- **Glass-card visual pattern is not itself a component** — every "glass panel" (project detail `Card`, table wrappers, `ProjectForm`'s `Section`) is a one-off `<div style={{...}}>` with the same hand-copied blur/border/shadow values rather than a shared `GlassPanel` component. There is no single exported glass-panel primitive to document; see DESIGN_SYSTEM.md for the recipe these all duplicate.
- **Share-selection state (`useShareSelection`) is the one clear example of extracted, reusable logic** in this codebase — explicitly commented in `SharePicker.tsx` as existing specifically so three call sites don't each hand-roll the same 4 `useState` calls.
- **Drag-and-drop upload zones are copy-pasted, not shared** — the dropzone markup/styles in `ProjectForm.tsx`'s Documents tab and `projects/[id]/page.tsx`'s `DocumentsTab` are near-identical but implemented independently in each file, not via a shared `<FileDropzone>` component.
