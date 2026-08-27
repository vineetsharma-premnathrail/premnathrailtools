# Versioning Documentation — Premnathrail Portal

> Defines version numbering and release conventions.

## Current State (as found)

- **Frontend** (`frontend/package.json`): `"version": "0.1.0"` — has not been bumped since project init; not tracking actual release history via this field
- **Backend**: no version field found in `backend/` (no `pyproject.toml` with a version, no `__version__` constant located)
- **Release tracking today** actually happens via [RELEASE_NOTES.md](../user-admin/RELEASE_NOTES.md) and `frontend/src/lib/changelog.ts` (date-stamped entries, e.g. "2026-08-02 through 2026-08-05"), **not** via semantic version numbers

## Recommended Convention (Not Yet Adopted)

Since there's no existing scheme to preserve, adopt standard **SemVer** (`MAJOR.MINOR.PATCH`) going forward:

- **MAJOR** — breaking API change, or a scope change of the kind logged in `CHANGE_REQUEST.md` (e.g. the Accounts module addition would justify a MAJOR bump)
- **MINOR** — new module/feature, backward compatible (e.g. a new department module going live)
- **PATCH** — bug fix, no new functionality

## Where Version Should Live (Proposal)

- `frontend/package.json` `version` field — bump on every release
- Backend: add a `__version__` string to `backend/app/__init__.py` or expose it via `GET /health` — currently `/health` exists (per root `README.md`) but its response shape wasn't confirmed to include a version

## Relationship to Other Docs

- Every version bump should correspond to a new entry in [CHANGELOG.md](../../CHANGELOG.md) / [RELEASE_NOTES.md](../user-admin/RELEASE_NOTES.md)
- A MAJOR bump should trace back to an entry in [CHANGE_REQUEST.md](../product/CHANGE_REQUEST.md)

## Action Item

This is a **process gap**, not just a missing doc: there is currently no way to answer "what version is running in production right now" from the code itself. Recommend a stakeholder decide whether to adopt the SemVer scheme above before the next release.

---
*Last updated: 2026-08-27.*
