# Disaster Recovery Plan — Premnathrail Portal

> Defines how the system will be restored after major failure. Distinct from [INCIDENT_RUNBOOK.md](INCIDENT_RUNBOOK.md) (day-to-day incident response) — this covers full-loss scenarios (database loss, host loss, region loss).

## 1. Scope

Major-failure scenarios: primary database loss/corruption, application host loss, or complete environment loss. Day-to-day incidents (elevated error rate, single failed request type) are covered by [INCIDENT_RUNBOOK.md](INCIDENT_RUNBOOK.md) instead.

## 2. Current State (as found)

| Capability | Status |
|---|---|
| Database backups | ✅ Documented — [BACKUP_RESTORE.md](../deployment/BACKUP_RESTORE.md) covers backup/restore procedure |
| Backup encryption | ⚠️ Recommended in `SECURITY.md` ("Encrypt backups") — not confirmed actually configured |
| Restore testing | ⚠️ `SECURITY.md` recommends "Test restore procedure monthly" — no evidence this is actually scheduled/executed found in this repo |
| RTO (Recovery Time Objective) | ❌ Not defined anywhere |
| RPO (Recovery Point Objective) | ❌ Not defined anywhere |
| Multi-region / failover | ❌ Not found — single deployment target assumed (`SERVER_CONFIGURATION.md`, `DOCKER.md`) |
| Documented recovery runbook (step-by-step) | ❌ Not found — this document is the first attempt at one |

## 3. Recovery Scenarios

### 3.1 Database Loss/Corruption

1. Stop application traffic (or accept it will error until restored)
2. Restore from most recent backup per [BACKUP_RESTORE.md](../deployment/BACKUP_RESTORE.md) procedure
3. Verify Alembic migration state matches `backend/migrations/` head after restore
4. Smoke-test critical paths: auth (`/auth/me`), one CRUD per module
5. Resume traffic

**Data loss window**: bounded by backup frequency — confirm actual backup cadence in `BACKUP_RESTORE.md` (this document does not restate it to avoid drift).

### 3.2 Application Host Loss

1. Redeploy from the `main` branch per [DEPLOYMENT.md](../deployment/DEPLOYMENT.md) / [DOCKER.md](../deployment/DOCKER.md)
2. Restore `.env` / secrets from the platform's secret store (not from git — secrets are never committed, per `SECURITY.md`)
3. Point at the existing (or restored) database
4. Verify `/health` and smoke-test

### 3.3 Complete Environment Loss (worst case)

1. Provision new infra per [SERVER_CONFIGURATION.md](../deployment/SERVER_CONFIGURATION.md)
2. Restore database from latest backup (§3.1)
3. Redeploy application (§3.2)
4. Re-configure Azure AD app registration redirect URIs if the domain changed
5. Re-verify SharePoint/Graph integration credentials

## 4. Gaps — Action Items

1. **Define RTO/RPO** — no target exists; a stakeholder must set these before this plan can be considered complete
2. **Schedule and log restore tests** — `SECURITY.md` recommends monthly; no evidence this happens
3. **Confirm backup encryption** — recommended but not verified as configured
4. **No failover/multi-region plan** — acceptable if the business accepts single-region risk, but should be an explicit decision, not a silent gap

## 5. Contacts

⚠️ Same gap as [Monitoring & Alerting](../runbook/MONITORING_ALERTING.md) and `SECURITY.md` §Incident Response — no on-call/ops contact list exists in this repo yet.

---
*Last updated: 2026-08-27. This is a first-pass plan derived from existing backup/deployment docs, not a tested/rehearsed DR plan — treat §4 as required next steps before relying on this in a real disaster.*
