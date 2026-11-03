# Findings (review wave 2026-11-02)

Agents: security, reviewer, qa, accessibility (all static — dev servers were not running, nothing seen live). ba-agent and architecture-agent stalled; the Manager wrote spec.md inline.

| # | Sev | Raised by | Finding | Owner | Status |
|---|---|---|---|---|---|
| 1 | Medium | security | Purpose restriction bypassed by omitting `purpose` (direct POST, and the PR Import always omits it) | backend | fix: empty purpose refused for restricted non-draft; import refused for restricted users |
| 2 | Medium | security | Non-admin role editor can remove a visibility rule from a role they hold or from an applies-to-everyone role (self-loosening) | backend | fix: 403 for non-admin on own/default roles |
| 3 | Major | reviewer | Priority restriction cosmetic on the New PR form (default `standard` always sent; with Request Details hidden the form can never submit) | frontend + backend | fix: form preselects first allowed value, keep-current only when editing; clean_rules refuses hide Request Details + Priority without Standard |
| 4 | Major | reviewer | Editing an old PR whose Purpose the role no longer offers shows a blank Purpose (meta already filtered server-side, keep-value branch dead) | backend + frontend | fix: /meta returns all purposes with `allowed`; form filters `allowed || current` |
| 5 | Major (a11y) | accessibility | Dialog footer may clip at 390px; error not tied to control; no group labels; locked-note not associated; chip name lacks the row label; customised chip text 3.3:1 | frontend / Manager | fix: dialog a11y pass (frontend-agent); chip sr-only label + #C2410C (Manager, done) |
| 6 | Low | security | Wrong-typed rule fields → 500 instead of 422 | backend | fix: isinstance checks in clean_rules |
| 7 | Low | security | Non-str value on PATCH → TypeError 500 | backend | fix: 422 |
| 8 | Low | security | Stale stored value fails open (restriction silently lifted) | backend | fix: fails closed with a real 422 |
| 9 | Low | security/reviewer | Create/copy role audit omits visibility rules | backend | fix |
| 10 | Low | reviewer | Stale top-level catalogue key blocks every role save | backend | fix: dropped silently with a log |
| 11 | Low | security | Service-Request / work-order PRs ignore the Priority rule | — | by design (PR form only); hint text says so |
| 12 | Low | reviewer | requirement.md said "stripped where feasible"; implementation is UI-only for sections/columns (ADR 0005 option E) | Manager | owner informed in the final report; requirement.md noted |
| 13 | Low | reviewer | Docs carry "(as specified / build in progress)" markers | Manager | remove after fix loop |
| 14 | Info | reviewer | Migration chains on another session's staged, uncommitted `b8d2f6a1c3e5` — must be committed together or after it | Manager | check at release gate |
| 15 | Pre-existing | accessibility | Shared useFocusTrap: Shift+Tab from the title escapes the dialog (affects every dialog); shared Checkbox border/fill contrast 1.5:1 / 2.6:1; P2PRequestList rows open only by click | — | not changed (shared components, visual gate); listed for the owner |
| 16 | Pre-existing | backend-agent | `test_p2p_pr_purpose_item_types::test_new_requisition_refuses_item_type_that_does_not_fit_the_purpose` fails on clean HEAD too (capital purchase accepted without internal order) | — | not this change; reported to owner |
