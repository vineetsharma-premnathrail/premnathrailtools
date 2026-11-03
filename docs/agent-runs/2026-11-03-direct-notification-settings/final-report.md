# Final report: direct notifications under Role & Permissions (2026-11-03)

Status: built and checked locally. NOT committed, NOT pushed. Live screen check not run.

## Changed
- backend/app/core/notification_events.py: register_direct, DIRECT_BY_TYPE, direct_spec,
  resolve_direct_channels (+ per-session role cache), empty direct entry = off.
- backend/app/utils/notifications.py: _deliver (role/personal channels; approval bell always on;
  email queued until commit), notify_user, broadcast_notification.
- New catalog: backend/app/core/events/direct_{rnd_crm_projects,hr_org,supply_finance,service_engineering,scheduled}.py (243 types).
- backend/app/core/events/rnd.py: two supervisor-view labels.
- backend/app/modules/rnd/services/requirement_access.py: heads() no longer falls back to every R&D user.
- backend/app/modules/erp/notify.py, crm/services/notify.py: broadcast_except via _deliver.
- backend/app/modules/organization/services/approval_engine.py: requester decision = approval_decided.
- backend/app/modules/accounts/receivables_access.py: credit_release_decision.
- backend/app/tests/test_direct_notification_channels.py (new), test_notification_events.py (direct events).
- frontend/src/components/organization/RoleNotificationsEditor.tsx: direct vs watcher groups.

## Checks
- pytest direct + events + notifications: 17 passed, 3 failed (pre-existing: POST /erp/projects 403
  from another session's permission work, before any notification).
- ruff F821 py312 app alembic: clean. tsc: clean for these files (other sessions' CRM/ProductForm errors remain).
- npm run test:ui: 0 errors.
- Security review: no Critical/High. Reviewer: no Critical/High; Medium findings fixed.

## Open / decisions for owner
- is_head() still treats every R&D user as head when no R&D head is set (permissions, unchanged).
- Broadcast types can now be switched to Teams/email by a role editor (audience unchanged).
- quality_lot_assigned broadcast fallback defaults to bell + Teams.
- pm_dept_task, hr_safety, hr_leave each carry several events under one type (one default).
- crm requirement_movement.py texts still mention "every R&D user" (file had other sessions' edits; left).
- Personal Notifications tab shows defaults if role list fails to load (RoleMemberAccess.tsx, other session's file).
