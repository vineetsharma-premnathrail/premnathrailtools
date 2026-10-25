# Final report + manual UAT script

## Checks run (Manager, 2026-10-24)
- `npx tsc --noEmit`: clean.  `npm run test:ui`: 1154 files, 0 errors, 0 warnings.
- Backend targeted tests (qa-agent): vendors 13, approvals 18, purpose rules + PO tracking 27, service requests 87, quotations 10 - all passed.
- NOT run: full backend suite (~10 min, needed before push), Playwright layout tests (need the owner's running app + `npm run test:ui:login`), any browser check.

## Open items
- ~32 `<Checkbox>` call sites still have no accessible name (page-by-page aria-label work).
- `maintenance/WorkOrderPurchaseCard.tsx` item picker opens on focus; add `data-no-autofocus` if it can be a sheet's first field.
- Browser Back/Forward and address bar are not covered by the workflow-editor unsaved-changes guard (tab close/reload and all link clicks are).
- Tab "Approves in" in the role editor still shows for users without Users view (shows an explanatory note instead of hanging).
- Owner decisions: one vendor form vs two; plain-word names for "Internal order"/"Cost centre".
- Heads-up: commit 405ee2a (another session) changed R&D calculator look/dropdown behaviour (no formulas).
- Heads-up: staged deletion of RequirementProjectsCard.tsx removes the UI to link a requirement to a project.

## UAT script (do in the browser; "Before" = old symptom)
Run at 1366px unless stated. Sign in as the named role.

**A. Workflow editor** (Organization > Approval workflows > any workflow)
1. Tab to a switch ("Approval needed" etc.), press Space. Before: switch skipped by Tab. Expected: visible ring, Space toggles.
2. Change a stage, then click Back, the sidebar, or the Delegations link. Before: edits lost silently. Expected: dialog "Leave without saving?" (Leave / stay). Footer shows "Unsaved changes".
3. Click Reset to default. Expected: danger dialog "Reset to default now?" explaining it applies immediately and waiting documents keep their approvers.
4. Help text should read "the approver must also have the Approve permission on <Module> > <Tab>" (no raw `p2p:...` codes).
5. Keyboard only: reach flow nodes, Up/Down, Remove (named stage asks to confirm), clear a number condition (stays empty, not 0).

**B. Popups** (any form popup, e.g. Create Task)
1. Tab repeatedly. Before: focus left the popup. Expected: loops inside. Esc closes and focus returns to the opener.
2. Open a confirm over a popup; Esc closes only the confirm, focus returns into the popup.
3. A popup whose first field is a date: the calendar must NOT open by itself.
4. Click a field label: its input gets focus. File area: Tab + Enter/Space opens the picker once.
5. Click into a text box: ONE orange ring (no glow + border + outline stack).

**C. Purchase requisition form** (Procurement > New)
1. Pick Production: Charged To shows a fixed value with "Set by the purpose". 
2. Empty pickers explain why (Charged To / Machine project).
3. Two lines: Remove button is the first column and works. Table fits at 1366px.
4. Submit with something missing: error dialog with the reason; closing it moves focus to the field to fix.

**D. Vendors** (Procurement > Vendors; Finance > Masters & Setup > Vendors)
1. Loading, no-permission and failed-load each show their own message (not a white page / not "No vendors yet").
2. List is in vendor code order. 
3. Save with a bad email/PIN/GSTIN (not 15 chars): specific message per field; MSME with payment days > 45 blocked. A blank GSTIN is allowed.
4. If the employee list fails to load for "Referred by": error with "Reload the page, or choose External".

**E. PO tracking** (Procurement > Purchase orders)
1. Sort buttons in column headers work with the keyboard. 
2. Tab to a PO number, press Space/Enter: detail opens. Below 1180px the detail is a dialog: Tab stays inside, Esc closes, focus returns.
3. A failed filter load does not get wiped by a successful list load.

**F. Purpose rules card** (Procurement settings)
1. Failed load: card shows the real error + Try again (does not vanish). 
2. View-only user: all controls (including dropdowns and chips) are inert.

**G. Quotation bar** (CRM inquiry > quotation)
1. Approve asks "Approve this quotation?". 2. If approval details fail to load: message + Try again; buttons not silently gone.

**H. Service request**
1. Priority reachable by keyboard (arrow keys) with a visible ring. 2. New request: "Request Date - today" read-only; existing request: shows its created date. 3. Status stepper steps are buttons (Enter/Space). 4. Failed load: red card with reason, Try again and Back.

**I. Role editor** - user with Roles but not Users view: members panel shows an explanatory message, not endless "Loading...".

**J. Security sign-in log** - failed load shows the real error (not "0 events").

**K. Colours** - status pills/chips and the selected dropdown text are clearly readable (>= 4.5:1).

Also eyeball: one R&D calculator page (buttons/dropdowns, shared CSS changed), vendor dropdowns elsewhere (now code order), and that the PO drawer sits below date/select popovers.
