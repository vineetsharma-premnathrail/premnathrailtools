# Final report: New Project = machine form (2026-10-27)

## Outcome
"+ New Project" in Project Management is the old machine form plus a first "Project" tab; one save creates the PM project and its machine (`erp_projects.pm_project_id`, migration `b6e2d8f4a1c7`). The project Overview shows every linked machine. No "Machine register" option is left in Project Management; Import / Export moved to All Projects › Past; the old machine list URL redirects to All Projects.

## Owner requests during the run
- No separate machine register option; one New Project button (done).
- Old machine data linked to projects (migration backfill by number; create/PATCH/import link by number with an audit row on the project; export "Project" column).
- All details shown inside Overview (done; no separate Machine tab).
- Demo: project → full details → milestone → task. Browser tools were not available and minting a real user's token was refused, so the flow runs as an end-to-end test (`test_demo_project_full_details_then_milestone_and_task`) on the test DB: PASS. Not seen live in the browser.

## Checks
- `test_pm_project_with_machine.py`: 18 passed.
- Targeted suite (`projects or erp or pew or import or machine or rbac or roles`): 406 passed, 1 xfailed.
- ruff F821 py312: clean. `alembic heads`: single (another session has since chained `d7f2a4c8e1b5` on top of `b6e2d8f4a1c7`).
- `npx tsc --noEmit`: clean. `npm run test:ui`: 2 errors, 1 warning, all in other sessions' files.
- Local DB upgraded to `b6e2d8f4a1c7` with the owner's OK (also ran `a9d3f5b7c1e2`, `e5b1d7c3a9f2` from other sessions).

## Review findings
| Finding | Severity | Status |
|---|---|---|
| Project creator could not see its machine in Overview (403) | High | Fixed: linked machine viewable/editable via PM project access + scope |
| Delete message pointed to non-existent "detach" / machine register | Medium | Fixed |
| Old machine list page still live with old wording | Medium | Fixed (redirect; back links) |
| PEW case/space mismatch could mis-link or block numbering | Medium | Fixed (normalise + upper/trim compare) |
| Migration LIKE wildcards / trim | Low | Fixed |
| Dead `link_unlinked_machines` path | Low | Removed |
| Export Project column outside scope; formula injection | Low | Fixed |
| No PM audit on machine-side link | Low | Fixed |
| `machine_id/serial` visible to PM viewers | Low | Accepted (serial = project number) |
| "WBS" wording in older PM errors | Low | Open, pre-existing |
| Via-PM access cannot upload/delete machine documents | Low | Open, owner to decide |

## Release status
Not committed, not pushed. Files share uncommitted hunks with the 2026-10-26 session; commit needs the owner's decision on bundling.
