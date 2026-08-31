# Bug Tracking

## Current state (honest assessment, 2026-08-14)

There is **no dedicated in-repo bug tracker** in active use for this project
today:

- `gh issue list` against this repo's GitHub remote returned
  `HTTP 401: Requires authentication` in this environment, so a definitive
  "GitHub Issues has/hasn't been used" check couldn't be completed live —
  but nothing in the repo itself (no `.github/ISSUE_TEMPLATE/`, no
  `CONTRIBUTING.md` referencing an issue workflow, no `BUGS.md` or similar)
  indicates GitHub Issues is set up or used as a tracker.
- No `.github/ISSUE_TEMPLATE/` directory exists — there's no bug-report or
  feature-request template configured.
- No other tracker config (Jira, Linear, Trello board links, etc.) was found
  referenced anywhere in the repo.
- The closest thing to a bug record today is git commit history itself —
  e.g. commits like `Fix mobile layout overflow, add real camera capture,
  responsive text sizing` or `Fix purchase` describe fixes after the fact,
  but there's no structured "reported → triaged → fixed → verified" record
  anywhere.

**If you have `gh` authenticated and want to confirm directly:**
```bash
gh auth status
gh issue list --repo <owner>/<repo> --limit 50
gh label list --repo <owner>/<repo>
```
If that comes back with real issues/labels, this file should be updated to
say so and point at the actual workflow in use, rather than the
recommendation below.

## Recommendation

Until something is confirmed in place, use **GitHub Issues** on this repo as
the bug tracker — it's already colocated with the code and requires no new
tooling. Suggested minimum setup:

1. Add `.github/ISSUE_TEMPLATE/bug_report.md` with at least: steps to
   reproduce, expected vs. actual behavior, module affected
   (erp/crm/rnd/purchase/p2p/main), environment
   (browser/mobile, staging/prod), and severity.
2. Use labels per module (`module:erp`, `module:crm`, `module:rnd`,
   `module:purchase`, `module:p2p`, `module:main`) plus
   severity labels (`severity:blocker`, `severity:major`,
   `severity:minor`).
3. Link bugs found during UAT (`UAT.md`) directly in the sign-off table by
   issue number.
4. Reference the fixing commit/PR in the issue when closed, so there's a
   traceable link from bug → fix.

## Suggested bug report template (until a real one exists)

```
**Module:** erp / crm / rnd / purchase / p2p / main
**Severity:** blocker / major / minor / cosmetic
**Environment:** browser + OS, or mobile device; staging or production

**Steps to reproduce:**
1.
2.
3.

**Expected behavior:**

**Actual behavior:**

**Screenshots / logs (if any):**

**Found during:** UAT / manual testing / automated test failure / production report
```

## Relationship to automated tests

If a reported bug is fixable, add or update a regression test under
`backend/app/tests/` covering it (see `TESTING.md` for the file naming and
fixture conventions already in use) so it can't silently reappear. There is
currently no CI pipeline enforcing this (see `TESTING.md`'s CI/CD section),
so this has to be a manual discipline for now, not something a pipeline
will catch for you.
