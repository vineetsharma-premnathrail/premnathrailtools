# Findings (summary)

Find phase: accessibility-agent 33, uiux-agent 30, reviewer-agent 8 (+ staged-deletion note).
Fixed: all in-scope items. Open: see final-report.md.

Regressions found by the verify phase and fixed in round 1:
- DateField opened its calendar when the focus trap focused it first (fixed: data-no-autofocus).
- Focus was lost when a dialog with an autoFocus field closed (fixed: opener captured during render).
- Doubled/tripled focus ring on text inputs (fixed: single outline).
- Checkbox was role=switch everywhere (fixed: plain checkbox, asSwitch opt-in).
- Purpose rules read-only card: SearchableSelect still editable on screen (fixed: disabled).
- Service request existing record said "Request Date - today" (fixed: shows created date).
- PO drawer did not trap focus (fixed: useFocusTrap).
- Workflow unsaved-changes guard missed sidebar links (fixed: document click guard while dirty).
