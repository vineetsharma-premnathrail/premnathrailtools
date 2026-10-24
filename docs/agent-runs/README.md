# Agent runs - per-requirement records

Each M/L requirement run through the `requirement-pipeline` skill leaves one folder here, so a later session can see what was asked, decided, found and released.

## Convention
One folder per run: `docs/agent-runs/YYYY-MM-DD-<slug>/` (date = day the run started; slug = short kebab-case name, e.g. `2026-10-24-po-tracking-filters`).

| File | Content | Written from |
|---|---|---|
| `requirement.md` | Request in business words, size (M/L), core-flow position, files already modified at start (protected), open questions + decisions taken | Manager intake |
| `spec.md` | Scope, out of scope, roles, flow, fields with reasons, acceptance criteria, open points | ba-agent (+ architecture/uiux notes) |
| `plan.md` | Steps, agents launched, file ownership, migration revision and head at launch | Manager `update_plan` |
| `findings.md` | Review/QA/security results by severity, owner, status (open/fixed/risk-accepted by user), duplicates merged | Review-wave agents' reports |
| `final-report.md` | Files changed, test and security results, risks, release status (not pushed / approved / pushed / verified), next actions | Manager |

## Rules
- The Manager writes these files from the agents' final reports; agents do not edit this folder unless the brief says so.
- Start a run by copying `_template/` and renaming it.
- No secrets: no passwords, DB URLs, IPs, tokens, personal data. Paths and commit hashes are fine.
- Never overwrite another run's folder; a follow-up is a new folder that links to the old one.
- Records are history, not living docs; module docs stay in `docs/02-modules/`.

## Where this is linked
`docs/` uses numbered folders (00-11) plus unnumbered `releases/`. This folder is unnumbered like `releases/`. To make it discoverable, add a row to the table in `docs/README.md` (after the `releases/` row): `agent-runs/ - Per-requirement agent run records (requirement, spec, plan, findings, final report)`. Not done here because only the files for this task were in scope.
