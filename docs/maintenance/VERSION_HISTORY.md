# Version History

## There is no semantic versioning for this application

This repository does **not** use semantic version tags (no `v1.2.3`-style
git tags exist), and there is no coordinated release process. Confirmed by:

- `frontend/package.json` has `"version": "0.1.0"` — the Next.js scaffold
  default. It has not been bumped since project creation and is not read
  anywhere at runtime for display or compatibility checks.
- `backend/` has no `pyproject.toml`, `setup.py`, or `VERSION` file at all —
  there is no backend version identifier of any kind. (A `backend/venv/`
  contains hundreds of `version.py` files, but those all belong to
  third-party packages, not this project.)
- No `CHANGELOG.md` with version headers existed prior to this document; the
  in-app "What's New" feed (`frontend/src/lib/changelog.ts`) is organized by
  **date**, not version.
- No compatibility matrix or version-pinning scheme ties a frontend build to
  a specific backend build (see `UPGRADE_MIGRATION_GUIDE.md`).

The one exception is the **Teams app manifest**
(`teams-app/manifest.json`), which does carry its own version field (bumped
to `1.4.2` in commit `10fb435`) because the Microsoft Teams app store
requires it. That version is scoped to the Teams packaging only and has no
relationship to the web app's backend or frontend state.

## What this repo uses instead: rolling release via git history

Both `main` branches (frontend and backend live in the same monorepo) are
deployed straight from `main` — every commit that lands on `main` is a
potential deploy. There are no release branches, no tags, and no staged
rollout mechanism visible in the repo.

Practically, that means **git commit hashes and dates are the closest thing
to release checkpoints** this project has. When you need to answer "what was
running on date X" or "roll back to before feature Y," use:

```bash
git log --oneline --since="<date>"
git log --oneline --until="<date>"
```

### Informal checkpoints (recent, from `git log`)

| Date (local) | Commit | What changed |
|---|---|---|
| 2026-08-06 | `d383e23` | Mobile layout overflow fix, real camera capture |
| 2026-08-06 | `2f9fd51` | CRM activity attachments |
| 2026-08-05 | `d51ca3b` | Purchase requisition route cleanup |
| 2026-08-05 | `5f2e3a0` | Activity form Universal ID dropdown |
| 2026-08-05 | `0726ae7` | PR item remarks/photos, service material attachments |
| 2026-08-03 | `cf2eb47` | Feedback feature added |
| 2026-08-03 | `4d5f503` | Security fixes: LaTeX injection in R&D report builders |
| 2026-08-02 | `a2f98a8` | Word-based Minutes of Meeting export |
| 2026-08-01 | `b39642b` | Manual PR status override |
| earlier | `5e74a18` | Purchase Requisition module added (foundational) |
| earlier | `c264408` | Consolidated to a single Dockerfile |
| earlier | `6632a4b` | Initial commit |

The database schema *does* have a reliable, ordered history — Alembic
migration revisions under `backend/alembic/versions/` form a linear chain
(each with a `down_revision`), so `alembic history` is the authoritative
"what changed and in what order" record for the database specifically. See
`UPGRADE_MIGRATION_GUIDE.md` for details.

## Recommendation if formal versioning is ever wanted

If the team decides to introduce semver later:

- Bump `frontend/package.json` `"version"` on each deploy.
- Add a `backend/app/__init__.py` `__version__` or a `backend/VERSION` file.
- Tag the corresponding commit: `git tag -a vX.Y.Z -m "..."`.
- Start recording version numbers (not just dates) in `CHANGELOG.md`.

Until that happens, treat every commit on `main` as a rolling, unversioned
release, and use commit hashes/dates for reference instead of version
numbers.
