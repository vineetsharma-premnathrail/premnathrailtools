# ERP-PremnathRail — Threat Model

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Platform / Cross-cutting
**Document:** Threat Model
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document identifies security threats, attack surfaces, trust boundaries, and mitigations for ERP-PremnathRail.

The analysis uses the **STRIDE** framework:

* Spoofing
* Tampering
* Repudiation
* Information Disclosure
* Denial of Service
* Elevation of Privilege

It complements the Security Document and Permission Matrix.

---

# 2. Scope

The threat model covers:

* FastAPI backend
* Next.js frontend
* PostgreSQL database
* Microsoft Entra ID
* Microsoft Teams
* Microsoft Graph
* SharePoint
* Email infrastructure
* Reverse proxy / hosting infrastructure
* External API clients
* External document recipients

---

# 3. Protected Assets

Key assets include:

### Business Data

* CRM organizations
* Inquiries
* Tenders
* Quotations
* ERP projects
* Service Requests
* Purchase Requisitions
* Vendor information
* Purchase Order references

### Inventory

* Store items
* Stock balances
* Stock transactions
* Store locations

### Personnel

* HR records
* User identities
* User authorization information

### Engineering

* Engineering documents
* Electrical work orders
* R&D calculation data

### Authentication Credentials

* Session JWT
* API keys
* Document-share tokens
* OAuth-related credentials

### Documents

* SharePoint documents
* Document metadata
* Shared document links

### Audit Information

* `AuditLog` records
* Request identifiers
* Security-relevant activity

---

# 4. Trust Boundaries

The primary trust boundaries are:

```text
Browser / Teams Client
        │
       HTTPS
        ↓
Next.js Frontend
        │
       HTTPS
        ↓
FastAPI Backend
   │       │       │
   │       │       └── Email
   │       │
   │       └──────── Microsoft Graph / Entra ID
   │
   └──────────── PostgreSQL

FastAPI Backend
        │
        └── App-only Graph
                ↓
            SharePoint

External API Client
        │
     X-API-Key
        ↓
FastAPI Backend

External Recipient
        │
 Signed Share Token
        ↓
FastAPI Backend
```

---

# 5. Spoofing Threats

| Threat                      | Attack Surface                | Mitigation                                                | Status                            |
| --------------------------- | ----------------------------- | --------------------------------------------------------- | --------------------------------- |
| Forged session token        | Session cookie / Bearer token | JWT signature validation and production secret validation | Mitigated                         |
| Stolen API key reuse        | `X-API-Key`                   | Raw key shown once; only HMAC-SHA256 digest is stored     | Mitigated                         |
| Teams token replay          | `/auth/teams-token`           | `jti` replay protection and RS256/JWKS verification       | Mitigated                         |
| IP spoofing                 | `X-Forwarded-For`             | Trusted-proxy configuration fails closed                  | Mitigated if correctly configured |
| OAuth state forgery         | OAuth callback                | Server-side state with TTL                                | Mitigated                         |
| Forged document-share token | Shared document endpoint      | Cryptographically signed document-scoped token            | Mitigated                         |

---

# 6. Tampering Threats

| Threat                        | Attack Surface           | Mitigation                                               | Status    |
| ----------------------------- | ------------------------ | -------------------------------------------------------- | --------- |
| SQL Injection                 | User-supplied query data | SQLAlchemy parameterization and OWASP middleware         | Mitigated |
| Unexpected request fields     | POST/PATCH/PUT           | Pydantic validation                                      | Mitigated |
| Oversized JSON payload        | Request body             | 512 KB JSON limit                                        | Mitigated |
| Oversized multipart payload   | File upload              | 10 GB multipart limit                                    | Mitigated |
| Bulk-delete abuse             | Collection DELETE        | Bare collection deletion rejected                        | Mitigated |
| Shared document manipulation  | SharePoint document      | Document ID scoped access and fresh SharePoint retrieval | Mitigated |
| Audit trail manipulation/gaps | Several modules          | Missing AuditLog coverage                                | Gap       |

---

# 7. Repudiation Threats

Repudiation occurs when a user can deny having performed an action because sufficient evidence was not recorded.

## Current Audit Coverage

Audit logging currently covers relevant operations in:

* ERP
* CRM inquiries
* CRM organizations
* CRM tenders
* Purchase
* P2P

The following areas currently have incomplete or unconfirmed audit coverage:

* CRM Activities
* CRM Notes
* CRM Documents
* CRM Workflow
* R&D
* Store
* HR
* Design
* Electrical

---

# 8. Request Traceability

Every request receives a:

```text
Request-ID
```

The identifier is logged together with the request outcome.

This supports technical request tracing even where a business-level audit record is unavailable.

---

# 9. Information Disclosure Threats

| Threat                             | Attack Surface            | Mitigation                                       | Status                              |
| ---------------------------------- | ------------------------- | ------------------------------------------------ | ----------------------------------- |
| Cross-module data exposure         | GET endpoints             | Application authorization and ERP permissions    | Mitigated for gated modules         |
| Raw SharePoint URL exposure        | Document responses        | Backend proxies document content                 | Mitigated                           |
| Shared token misuse                | Shared documents          | Document-specific, time-limited signed token     | Mitigated with residual bearer risk |
| Cross-department content exception | Technical Offer documents | Exact document-level exception                   | Accepted narrowly scoped risk       |
| Presence information disclosure    | Presence endpoints        | Authentication required                          | Accepted low-risk gap               |
| PII exposure at rest               | CRM/ERP data              | HTTPS, access controls and database restrictions | Accepted risk                       |
| Sensitive information in logs      | Application logging       | Sensitive values excluded from logging           | Mitigated                           |
| Verbose production errors          | HTTP 500 responses        | Production behavior not verified                 | Unverified                          |
| SSRF                               | URL-related inputs        | Private/loopback/link-local blocking             | Mitigated                           |

---

# 10. SharePoint Security Model

ERP-PremnathRail does not expose raw SharePoint URLs to the frontend.

Instead:

```text
User
 ↓
ERP Backend
 ↓
Microsoft Graph
 ↓
SharePoint
 ↓
Document Content
 ↓
ERP Backend
 ↓
User
```

The backend uses the application's Graph identity to retrieve protected SharePoint content.

---

# 11. Document Share Threat

External document recipients can access a shared document through a signed token.

The token is:

* Cryptographically signed
* Scoped to a specific document
* Time-limited

However, the token acts as a bearer credential during its validity period.

If a valid link is forwarded, another person possessing the link may access the document until expiry unless another revocation mechanism is introduced.

---

# 12. Denial-of-Service Threats

| Threat                               | Attack Surface     | Mitigation                                                        | Status       |
| ------------------------------------ | ------------------ | ----------------------------------------------------------------- | ------------ |
| Authentication brute force           | `/auth/*`          | 5 requests/minute and automatic banning after repeated violations | Mitigated    |
| Write flooding                       | Mutating endpoints | 40 requests/minute                                                | Mitigated    |
| Delete flooding                      | Delete endpoints   | 10 requests/minute                                                | Mitigated    |
| Oversized payload                    | Request body       | Payload limits                                                    | Mitigated    |
| Slow requests                        | Any endpoint       | Requests over 5 seconds logged                                    | Partial      |
| Repeated SharePoint fetches          | Document endpoints | General rate limits                                               | Partial      |
| Comprehensive endpoint rate limiting | All endpoints      | Current limits require reconciliation                             | Needs review |

---

# 13. Slow Request Risk

Slow requests are currently detected and logged when execution exceeds the configured threshold.

However:

```text
Detection ≠ Prevention
```

The current implementation does not confirm that slow requests are actively terminated or throttled.

Therefore this remains a partial DoS mitigation.

---

# 14. Elevation-of-Privilege Threats

| Threat                              | Attack Surface           | Mitigation                        | Status     |
| ----------------------------------- | ------------------------ | --------------------------------- | ---------- |
| Manipulating `assigned_apps`        | User management          | Admin-only user management routes | Mitigated  |
| ERP permission bypass               | ERP routes               | Backend permission checks         | Mitigated  |
| Frontend-only authorization         | Frontend hooks           | Backend remains authoritative     | Controlled |
| Purchase/P2P boundary inconsistency | P2P actions              | Current route inconsistency       | Gap        |
| Unenforced `service_permissions`    | User model               | No confirmed enforcement point    | Gap        |
| Document token escalation           | Shared document endpoint | Signed and document-scoped token  | Mitigated  |

---

# 15. Frontend Authorization Risk

Frontend hooks such as:

```text
useRequireApp()
useRequireErpPermission()
```

provide navigation and user-experience protection.

They must not be considered the actual security boundary.

The security boundary is:

```text
Frontend Guard
       ↓
Backend Authorization
       ↓
Database / Business Operation
```

---

# 16. Purchase/P2P Authorization Risk

The current codebase has an inconsistency between:

```text
purchase
```

and:

```text
p2p
```

application permissions.

Some P2P routes require `p2p`, while several sub-actions require `purchase`.

Result:

```text
p2p access only
      ↓
List/Create
      ✓

Approve / Comment / Attach
      ↓
May receive 403
```

This requires a deliberate product decision.

---

# 17. `service_permissions` Risk

The User model contains:

```text
service_permissions
```

but no confirmed backend enforcement point was identified.

Until verified, this field should not be treated as an effective authorization mechanism.

The implementation should either:

1. Connect it to an actual authorization gate, or
2. Formally retire it if unused.

---

# 18. Audit Logging Gap

The most significant current threat-model gap is incomplete audit coverage.

Without audit records, it becomes harder to determine:

* Who changed data
* What changed
* When it changed
* Which account performed the action

The affected modules should therefore be explicitly reviewed for required audit coverage.

---

# 19. PII Protection

PII such as:

* Contact email
* Phone numbers
* Personnel information

is currently protected through:

* HTTPS
* Authorization
* Database access restrictions

Field-level encryption is not currently established as a universal control.

This is therefore an accepted risk requiring appropriate database-access restrictions.

---

# 20. Error Disclosure

Production error responses should not expose:

* Stack traces
* Internal filesystem paths
* Database details
* Secrets
* Internal implementation information

Current production behavior requires explicit verification.

**Status:** Unverified.

---

# 21. Threat Severity Overview

| Area                    | Current Assessment                         |
| ----------------------- | ------------------------------------------ |
| Authentication spoofing | Generally mitigated                        |
| SQL injection           | Mitigated                                  |
| Request tampering       | Mitigated                                  |
| Authorization           | Mostly mitigated                           |
| Auditability            | Significant gaps                           |
| SharePoint exposure     | Controlled                                 |
| Document sharing        | Controlled with bearer-token residual risk |
| DoS protection          | Partially implemented                      |
| P2P authorization       | Requires resolution                        |
| Service permissions     | Requires verification                      |
| Error disclosure        | Requires verification                      |
| PII encryption          | Accepted risk                              |

---

# 22. Open Security Gaps

Current open items:

1. Audit logging coverage across newer/uncovered modules.
2. Purchase/P2P authorization boundary.
3. `service_permissions` enforcement.
4. Slow-request prevention.
5. Comprehensive rate-limit reconciliation.
6. Production error-response verification.
7. Document-share token revocation.
8. Field-level PII encryption decision.
9. Automated dependency vulnerability scanning.

---

# 23. Recommended Priority

### Priority 1 — Authorization

Resolve the:

```text
purchase vs p2p
```

permission boundary.

### Priority 2 — Auditability

Determine and implement required audit logging across uncovered modules.

### Priority 3 — Permission Integrity

Verify or remove:

```text
service_permissions
```

### Priority 4 — Production Security

Verify production error responses and dependency scanning.

### Priority 5 — Document Sharing

Evaluate whether early token revocation is required.

---

# 24. Security Review Process

The threat model should be reviewed whenever the system introduces:

* New authentication mechanisms
* New external integrations
* New document-sharing mechanisms
* New sensitive data
* New application modules
* New authorization models
* Significant infrastructure changes

---

# 25. Threat Model Update Rules

Update this document when:

* A threat is newly identified.
* A mitigation is implemented.
* A mitigation is removed.
* A security gap is closed.
* A new integration is introduced.
* A new data type is introduced.
* Authentication changes.
* Authorization changes.
* Document-sharing architecture changes.

Resolved items should be moved to a **Closed Security Items** section rather than deleted from history.

---

# 26. Related Documents

* Security Document
* Permission Matrix
* Database Schema
* Database Relationships
* Database Indexes
* Project Charter
* BRD
* PRD
* Software Architecture Document
* HLD
* LLD

---

# 27. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 28. Document Information

**Document:** Threat Model
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Platform / Cross-cutting
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
