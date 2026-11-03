# Plan

Head at launch: `b8d2f6a1c3e5` (another session's staged, uncommitted migration — re-check before chaining).

| Step | Who | Files |
|---|---|---|
| Spec + architecture | Manager (agents stalled) | spec.md |
| Model + migration | database-agent | `backend/app/modules/main/models/role.py`, `backend/alembic/versions/<rev>_role_visibility_rules.py` |
| Core + routes + tests | backend-agent | NEW `backend/app/core/visibility.py`; `backend/app/core/features/p2p.py` (append registration); `backend/app/modules/main/routes/roles.py`; `backend/app/modules/main/routes/auth.py` (/me) + `backend/app/modules/main/schemas/auth.py`; `backend/app/modules/p2p/routes/p2p_requests.py` (own hunks only — file has another session's unstaged edits); NEW `backend/app/tests/test_visibility_rules.py` |
| UI | frontend-agent | NEW `frontend/src/lib/visibility.ts`; NEW `frontend/src/components/organization/VisibilityRuleDialog.tsx`; `frontend/src/app/dashboard/organization/roles/[id]/page.tsx`; `frontend/src/components/p2p/P2PRequestList.tsx`; `frontend/src/app/dashboard/p2p/new/page.tsx` (own hunks only — another session's edits present) |
| Registries | Manager | `frontend/src/components/organization/PermissionMatrixEditor.tsx` (chip), `frontend/src/types/index.ts` (User.visibility, Role.visibility_rules, registry.visibility) |
| Docs | documentation-agent | ADR `docs/11-decisions/`, module doc, What's New |
| Integration, review wave, release gate | integration / security / qa / reviewer / accessibility / whitehat / devops | — |
