# ERP-PremnathRail — Disaster Recovery Plan

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Operations
**Document:** Disaster Recovery Plan
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Initial Plan

---

# 1. Purpose

This document defines the recovery approach for ERP-PremnathRail following a major failure involving:

* Database loss or corruption
* Application server/host loss
* Complete environment loss

It is separate from the Incident Runbook, which addresses operational incidents that do not require complete environment recovery.

This is an initial recovery plan. It has not yet been confirmed through a complete disaster-recovery rehearsal.

---

# 2. Scope

This plan covers:

1. Database failure
2. Application infrastructure failure
3. Complete environment failure
4. Application redeployment
5. Database restoration
6. Authentication and integration restoration
7. Post-recovery validation

Routine application incidents remain covered by the Incident Runbook.

---

# 3. Current Recovery Posture

| Capability                | Current Status                           |
| ------------------------- | ---------------------------------------- |
| Database backup procedure | Documented                               |
| Automated backup          | Not currently confirmed                  |
| Backup encryption         | Recommended; configuration not confirmed |
| Restore testing           | Not currently confirmed                  |
| RTO                       | Not defined                              |
| RPO                       | Not defined                              |
| Multi-region failover     | Not currently implemented                |
| Recovery runbook          | This document                            |
| On-call contacts          | Not yet defined                          |

The Disaster Recovery Plan should therefore be treated as an initial operational document rather than evidence of tested disaster-recovery capability.

---

# 4. Recovery Objectives

Two recovery objectives must be formally defined by project leadership.

## 4.1 Recovery Time Objective — RTO

**RTO:** Maximum acceptable time required to restore the ERP application after a major failure.

**Current value:** TBD

## 4.2 Recovery Point Objective — RPO

**RPO:** Maximum acceptable amount of data that may be lost based on the available backup/recovery point.

**Current value:** TBD

These values should be approved before the disaster-recovery process is considered complete.

---

# 5. Recovery Architecture

The recovery process is based on restoring the application's major components:

```text
                Disaster
                   │
                   ▼
          Assess Failure Scope
                   │
          ┌────────┼────────┐
          ▼        ▼        ▼
       Database   Host    Environment
          │        │        │
          └────────┼────────┘
                   ▼
          Restore Infrastructure
                   │
                   ▼
           Restore Database
                   │
                   ▼
          Deploy ERP Application
                   │
                   ▼
       Restore Configuration/Secrets
                   │
                   ▼
        Verify Azure Authentication
                   │
                   ▼
       Verify SharePoint / Graph
                   │
                   ▼
          Application Smoke Test
                   │
                   ▼
             Resume Service
```

---

# 6. Scenario A — Database Loss or Corruption

## Recovery Procedure

### Step 1 — Stop or Restrict Application Access

Prevent users from continuing transactions against the affected database where possible.

### Step 2 — Identify the Latest Valid Backup

Identify the most recent usable database backup according to the Backup & Restore procedure.

Do not assume a backup exists without verifying it.

### Step 3 — Restore Database

Restore the database using the applicable PostgreSQL restore procedure.

### Step 4 — Verify Database Integrity

Confirm:

* Database is accessible.
* Required tables exist.
* Important records are accessible.
* Database connectivity works.
* No unexpected corruption remains.

### Step 5 — Verify Alembic State

Confirm that the restored database migration state is compatible with the application currently being deployed.

### Step 6 — Application Smoke Test

Verify critical functionality:

* Authentication
* User access
* ERP
* CRM
* Purchase
* P2P
* R&D
* Relevant document/file functionality

### Step 7 — Resume Service

Return the application to normal operation only after critical validation passes.

---

# 7. Scenario B — Application Host Loss

If the application host is lost while the database remains available:

1. Provision a replacement host.
2. Configure the required runtime environment.
3. Restore required secrets/configuration from the approved secret store.
4. Deploy the ERP-PremnathRail Docker image/application.
5. Configure the production environment variables.
6. Connect the application to the existing database.
7. Verify database connectivity.
8. Verify `/health`.
9. Verify authentication.
10. Verify critical application workflows.
11. Restore normal traffic.

Secrets must not be recovered from source control.

---

# 8. Scenario C — Complete Environment Loss

For complete infrastructure loss:

```text
Infrastructure
      ↓
Database
      ↓
Application
      ↓
Configuration
      ↓
Authentication
      ↓
Integrations
      ↓
Validation
      ↓
Production Recovery
```

## Recovery Procedure

### Step 1 — Provision Infrastructure

Create the required replacement infrastructure.

### Step 2 — Restore Database

Restore the latest valid database backup.

### Step 3 — Deploy Application

Deploy ERP-PremnathRail using the approved deployment/Docker procedure.

### Step 4 — Restore Configuration

Configure:

* Database connection
* Application secret
* Azure authentication configuration
* Allowed origins/hosts
* SharePoint configuration
* Email configuration
* Other required environment variables

### Step 5 — Verify Azure Authentication

If the production domain has changed, update the Azure application registration redirect URI accordingly.

### Step 6 — Verify Microsoft Integrations

Verify:

* Azure authentication
* Microsoft Graph
* SharePoint file access
* Microsoft Teams application integration
* Email notification functionality

### Step 7 — Validate Application

Perform the production recovery smoke test.

### Step 8 — Resume Operations

Return the system to users after successful validation.

---

# 9. Critical Recovery Validation

The following should be verified after recovery:

| Area           | Validation                                     |
| -------------- | ---------------------------------------------- |
| Application    | Application loads successfully                 |
| Health         | `/health` responds correctly                   |
| Authentication | Microsoft login works                          |
| Authorization  | Roles and permissions work                     |
| Database       | Read/write operations work                     |
| ERP            | Critical workflows work                        |
| CRM            | Critical workflows work                        |
| Purchase       | Critical workflows work                        |
| P2P            | Critical workflows work                        |
| R&D            | Applicable tools work                          |
| Files          | SharePoint-backed files work                   |
| Email          | Required notifications work                    |
| Teams          | Application integration works where applicable |
| Security       | Access restrictions remain enforced            |

---

# 10. Backup Dependency

Disaster recovery depends directly on the quality and availability of database backups.

The current backup documentation records manual PostgreSQL backups and does not establish an automated backup schedule.

Therefore:

**Actual recoverability depends on the latest valid backup available at the time of failure.**

The backup process should eventually provide:

* Regular backups
* Appropriate retention
* Secure storage
* Backup encryption
* Offsite/cloud storage
* Restore testing

---

# 11. Restore Testing

A backup should not be considered reliable solely because a backup file exists.

Restore testing should verify that the backup can actually recreate a usable application database.

Recommended process:

```text
Backup
  ↓
Test Restore
  ↓
Database Validation
  ↓
Application Connection
  ↓
Critical Workflow Test
  ↓
Record Result
```

The frequency of formal restore testing should be approved by project leadership.

---

# 12. Data Loss Consideration

Potential data loss depends on:

* Backup frequency
* Time of the latest successful backup
* Backup integrity
* Database corruption point
* Recovery method

The exact acceptable data-loss window cannot currently be stated because the project's RPO has not yet been defined.

---

# 13. Security During Recovery

Recovery activities must maintain the application's security controls.

The recovery process must not:

* Disable authentication unnecessarily.
* Expose the database directly to the public internet.
* Store secrets in source control.
* Share production credentials through insecure channels.
* Bypass application authorization permanently.

After recovery, authentication and authorization must be explicitly tested.

---

# 14. Microsoft Azure Authentication Recovery

ERP-PremnathRail uses Azure for authentication.

After infrastructure recovery:

1. Verify Azure application registration.
2. Verify tenant configuration.
3. Verify client credentials.
4. Verify redirect URI.
5. Verify production domain configuration.
6. Test Microsoft login.
7. Test unauthorized-domain handling where applicable.

If the production domain remains unchanged, unnecessary Azure configuration changes should be avoided.

---

# 15. SharePoint / Microsoft Graph Recovery

Where SharePoint is used for document storage, recovery should verify:

* Site configuration
* Application credentials
* Required Graph permissions
* Target SharePoint location
* File upload
* File retrieval
* File access permissions

---

# 16. Microsoft Teams Recovery

Where ERP-PremnathRail is deployed inside Microsoft Teams, recovery should verify:

* Teams application availability
* Application URL
* Authentication inside Teams
* Required permissions
* Camera/media functionality where applicable
* Teams-specific configuration

If the application URL changes, the Teams application configuration may also require updating.

---

# 17. Recovery Decision Authority

| Responsibility                     | Owner                                       |
| ---------------------------------- | ------------------------------------------- |
| Major recovery decision            | Madhav Arora Sir                            |
| Final production recovery approval | Madhav Arora Sir                            |
| Technical recovery execution       | Vineet Sharma                               |
| Application recovery validation    | Vineet Sharma                               |
| Business validation                | Relevant business users / department owners |

---

# 18. Recovery Communication

During a major disaster, communication should clearly identify:

* What failed
* Which services are affected
* Whether data is affected
* Current recovery status
* Expected next decision
* Recovery completion
* Any known data loss

An official contact/on-call list is currently not defined and should be established separately.

---

# 19. Recovery Records

Every actual disaster-recovery event should produce a historical recovery record.

Minimum information:

```text
Incident ID:
Date:
Failure Type:
Affected Systems:
Failure Start:
Recovery Start:
Recovery Complete:
Latest Backup Used:
Database Restore Result:
Application Restore Result:
Authentication Result:
Integration Result:
Data Loss:
RTO:
RPO:
Business Validation:
Final Approval:
Lessons Learned:
```

Historical recovery records should be retained and not overwritten.

---

# 20. Post-Recovery Review

After recovery, conduct a review covering:

* Root cause
* Recovery duration
* Data loss
* Backup quality
* Restore problems
* Application problems
* Security issues
* Communication problems
* Missing documentation
* Required infrastructure improvements

Any resulting corrective actions should be tracked separately.

---

# 21. Current Action Items

| Action                                | Status   |
| ------------------------------------- | -------- |
| Define RTO                            | TBD      |
| Define RPO                            | TBD      |
| Establish automated backup            | Required |
| Establish backup retention policy     | Required |
| Confirm backup encryption             | Required |
| Establish offsite backup              | Required |
| Perform documented restore test       | Required |
| Define recovery contacts              | Required |
| Decide multi-region/failover strategy | TBD      |
| Conduct full DR rehearsal             | Required |

---

# 22. Document Maintenance

This document should be updated when:

* Backup architecture changes.
* Deployment infrastructure changes.
* Azure authentication configuration changes.
* SharePoint/Graph architecture changes.
* Teams integration changes.
* Recovery procedures are tested.
* RTO/RPO are approved.
* Failover infrastructure is introduced.
* A real disaster-recovery event occurs.

The previous version should be retained as a historical record.

---

# 23. Related Documents

* Backup & Restore
* Deployment
* Docker
* Server Configuration
* Incident Runbook
* Monitoring & Alerting
* Maintenance Procedures
* Security Documentation
* Test Plan
* UAT

---

# 24. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 25. Document Information

**Document:** Disaster Recovery Plan
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Operations
**Version:** 1.0
**Status:** Initial Plan
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
