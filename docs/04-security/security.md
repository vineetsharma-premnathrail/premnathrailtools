# ERP-PremnathRail — Security Implementation Guide

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Platform / Cross-cutting
**Document:** Security Implementation Guide
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document describes how security is actually implemented in ERP-PremnathRail.

It focuses on implemented controls rather than generic security recommendations.

The document covers:

* Authentication
* Authorization
* Microsoft Entra ID
* Microsoft Teams authentication
* API keys
* Session management
* SharePoint security
* Microsoft Graph
* OWASP protections
* Secrets management
* Audit logging
* Data protection
* Database and API hardening
* Current security gaps

---

# 2. Security Architecture

ERP-PremnathRail separates security into three independent access layers:

```text
Microsoft Entra ID
       │
       ▼
Identity / Authentication
       │
       ▼
ERP Application Authorization
       │
       ├── Role
       ├── Assigned Applications
       └── ERP Permissions
       │
       ▼
SharePoint / Graph Access
       │
       └── Application Identity
```

These layers have different responsibilities.

---

# 3. Access Layer 1 — Microsoft Entra ID

Microsoft Entra ID proves the identity of the user.

It answers:

> Is this a valid company identity?

It does **not** determine which ERP modules or business records the user can access.

The portal establishes its own session after successful Microsoft authentication.

---

# 4. Access Layer 2 — Application Authorization

ERP-PremnathRail controls application access independently.

Authorization is based on:

* `role`
* `assigned_apps`
* `erp_permissions`

Conceptually:

```text
User
 │
 ├── Role
 ├── Assigned Applications
 └── ERP Permissions
          │
          ▼
     Application Access
```

Azure authentication therefore does not automatically grant ERP permissions.

---

# 5. Access Layer 3 — SharePoint / Microsoft Graph

SharePoint document access is performed using the ERP application's Microsoft Graph identity.

The backend uses:

```text
get_app_graph_token
```

with:

```text
Sites.Selected
```

This means the portal accesses SharePoint as an application rather than as the currently signed-in user.

Therefore:

```text
ERP User SharePoint Permission
        ≠
ERP Portal Document Permission
```

The portal's own authorization model determines whether a user can retrieve a document through the application.

---

# 6. Primary Authentication — Microsoft SSO

ERP-PremnathRail does not provide password-based login.

The primary login flow uses Microsoft OAuth authorization code authentication.

Flow:

```text
User
 ↓
/auth/login
 ↓
Microsoft Entra ID
 ↓
Authentication
 ↓
/auth/callback
 ↓
User validation
 ↓
Local User record
 ↓
JWT session
 ↓
session_token cookie
```

---

# 7. Email Domain Validation

During OAuth callback processing, the user's email domain can be validated against:

```text
DOMAIN_EMAIL
```

when configured.

This provides an additional restriction to authorized organizational identities.

---

# 8. ERP Session Token

After successful authentication, the backend creates its own JWT session token.

The token is delivered using:

```text
session_token
```

as an HTTP-only browser cookie.

Cookie security depends on:

```text
SECURE_COOKIES
```

When enabled:

```text
SameSite=None
Secure
HttpOnly
```

Otherwise:

```text
SameSite=Lax
HttpOnly
```

---

# 9. OAuth State Protection

OAuth `state` is stored server-side.

Current behavior:

* In-memory storage
* 10-minute TTL
* Maximum 500 pending states

The state value is not stored in a browser cookie.

This protects the login callback against OAuth CSRF/state-forgery attacks.

---

# 10. Microsoft Teams Authentication

ERP-PremnathRail supports authentication from Microsoft Teams.

The Teams authentication endpoint:

```text
/auth/teams-token
```

validates the Teams token before processing it.

Validation includes:

* `aud`
* `iss`
* JWT signature
* JWKS verification
* Replay protection

---

# 11. Teams Token Replay Protection

Teams authentication uses the JWT `jti` value.

A replay set prevents the same token from being reused.

The Microsoft tenant JWKS is cached with a one-hour TTL.

RS256 signature validation is performed using `python-jose`.

---

# 12. Teams Graph Access

The Teams authentication flow may attempt an On-Behalf-Of exchange:

```text
acquire_token_on_behalf_of
```

If the Graph token exchange fails, authentication itself can still succeed.

Only Graph-dependent features for that session may become unavailable.

---

# 13. Teams Session Exchange

The Teams popup flow uses:

```text
/auth/teams-exchange
```

A one-time code is returned to the main frame and exchanged for normal ERP session cookies.

The code currently has:

```text
120-second TTL
```

This supports authentication inside the cross-site Teams iframe environment.

---

# 14. API-Key Authentication

ERP-PremnathRail also supports API-key authentication for external clients.

API keys use the format:

```text
pew_<random>
```

The raw key is never permanently stored.

---

# 15. API-Key Storage

The raw API key is transformed using:

```text
HMAC-SHA256(raw_key, SECRET_KEY)
```

Only the resulting digest is stored.

The raw key:

* Is displayed once
* Is not persisted
* Is not logged
* Cannot be recovered from the database

---

# 16. API-Key Authorization

A validated API key creates a synthetic user:

```text
role = "api_service"
```

The synthetic user receives the API key's:

```text
allowed_apps
```

The same application authorization system is then used.

```text
API Key
 ↓
Synthetic User
 ↓
allowed_apps
 ↓
require_app_access()
 ↓
Application
```

---

# 17. Session Resolution Order

`get_current_user` checks credentials in this order:

```text
1. X-API-Key
2. session_token cookie
3. Authorization: Bearer
```

The first available credential wins.

There is no fallback chaining after a credential is selected.

---

# 18. Session Lifetime

The application session lifetime is controlled by:

```text
ACCESS_TOKEN_EXPIRE_MINUTES
```

The default is:

```text
24 hours
```

There is currently no refresh-token rotation.

After expiration, the user authenticates again through Microsoft SSO.

---

# 19. Authorization Model

Authentication answers:

> Who is the user?

Authorization answers:

> What may the user do?

ERP-PremnathRail application authorization is independent of Microsoft Entra permissions.

The main authorization attributes are:

```text
role
assigned_apps
erp_permissions
```

---

# 20. Administrator Authorization

An administrator has:

```text
role = "admin"
```

Administrators bypass application-module and granular ERP permission checks.

Administrator access is controlled by the application itself.

---

# 21. Application-Level Access

Users receive application/module access through:

```text
assigned_apps
```

The application determines the effective application list using:

```text
User.get_apps()
```

Ordinary users receive only their assigned applications.

---

# 22. ERP Granular Permissions

ERP currently provides action-level permissions:

```text
project_view
project_create
project_edit
project_delete

sr_view
sr_create
sr_edit
sr_delete
```

These are stored in:

```text
erp_permissions
```

---

# 23. Backend Authorization

Module access is enforced through:

```text
require_app_access(app_name)
```

For example:

```text
Depends(require_app_access("erp"))
```

Unauthorized application access results in:

```text
HTTP 403
```

---

# 24. ERP Permission Enforcement

Fine-grained ERP permissions are evaluated using:

```text
has_erp_permission(user, permission)
```

Administrators automatically pass the permission check.

Ordinary users must possess the required permission.

---

# 25. Frontend Authorization

The frontend uses:

```text
useRequireApp(appName)
useRequireErpPermission(permission, fallback)
```

These controls manage navigation and user experience.

They are not the primary security boundary.

The backend authorization layer remains authoritative.

---

# 26. SharePoint Document Security

All SharePoint document access is performed server-side.

Architecture:

```text
User
 ↓
ERP Frontend
 ↓
ERP Backend
 ↓
Microsoft Graph
 ↓
SharePoint
 ↓
Document
```

The frontend does not directly authenticate to SharePoint for portal document retrieval.

---

# 27. App-Only Graph Identity

The backend obtains an application Graph token through:

```text
get_app_graph_token
```

using:

```text
Sites.Selected
```

This separates SharePoint permissions from individual user permissions.

The portal therefore maintains predictable document-access behavior even if users have different direct SharePoint permissions.

---

# 28. Raw SharePoint URLs

Raw SharePoint `webUrl` values are not returned to the frontend for direct document access.

Instead, the backend provides document content through portal endpoints such as:

```text
GET /crm/documents/{document_id}/content
```

The backend:

1. Authenticates the user.
2. Applies ERP authorization.
3. Retrieves the document through Graph.
4. Streams the content to the client.

---

# 29. External Document Sharing

Some documents must be shared with people who do not have ERP accounts.

ERP-PremnathRail therefore supports signed document-share tokens.

Example use case:

```text
Technical Offer Request
        ↓
External Vendor
        ↓
Signed Document Link
```

---

# 30. Document Share Token

The application creates a signed JWT using:

```text
create_document_share_token()
```

The token is scoped to:

* Document type
* Document ID
* Expiration time

Default expiration:

```text
168 hours
```

or approximately seven days.

---

# 31. Document Share Verification

The shared-document endpoint:

```text
GET /crm/documents/{document_id}/shared-content
```

uses:

```text
verify_document_share_token()
```

The token must match the specific document ID.

A valid token for one document cannot simply be reused against another document.

---

# 32. Shared Document Security

Even external shared-document access does not expose the underlying SharePoint URL.

The flow remains:

```text
Signed Share Token
        ↓
ERP Backend
        ↓
Graph App Identity
        ↓
SharePoint
        ↓
Document Bytes
```

---

# 33. Cross-Department Document Exceptions

Two narrow exceptions exist for specific Technical Offer Request documents.

These allow certain logged-in users to retrieve an exact document even without the normal CRM application grant.

The exception is:

* Document-specific
* ID-specific
* Limited to document retrieval
* Does not expose the CRM document list
* Does not grant broader CRM access

---

# 34. OWASP Middleware

`OWASPMiddleware` is globally registered and processes requests across the application.

It provides defense-in-depth security controls covering:

* Broken Access Control
* Injection
* Insecure Design
* Security Misconfiguration
* Vulnerable Components
* Authentication/session risks
* Data integrity
* Logging/monitoring
* SSRF

---

# 35. Broken Access Control Protection

API requests without a valid:

* Bearer token
* Session cookie
* API key

are rejected unless the path is explicitly public.

The middleware also tracks repeated 404 behavior as potential scanning activity.

---

# 36. Injection Protection

The middleware scans relevant inputs for patterns associated with:

* SQL injection
* XSS
* Path traversal
* Template injection
* Command injection

Small JSON request bodies are also inspected for suspicious patterns.

URLs are percent-decoded before inspection.

SQLAlchemy parameterized queries provide the primary SQL-injection protection.

---

# 37. Request Size Protection

Current limits include:

```text
JSON:
512 KB

Multipart:
10 GB
```

These limits reduce oversized-payload abuse.

---

# 38. HTTP Method and Content-Type Protection

Mutating requests are checked against:

* Allowed HTTP methods
* Allowed Content-Type values

Requests using disallowed content types are rejected.

---

# 39. Security Headers

Responses include security-related headers such as:

```text
X-Content-Type-Options
Strict-Transport-Security
Content-Security-Policy
Referrer-Policy
Permissions-Policy
COOP
CORP
```

Server-identifying headers such as:

```text
Server
X-Powered-By
```

are removed.

---

# 40. Rate Limiting

Current rate-limit buckets include:

| Bucket         |   Limit |
| -------------- | ------: |
| Authentication |   5/min |
| Delete         |  10/min |
| Write          |  40/min |
| Default        | 200/min |

Repeated violations can result in automatic IP banning.

The current threshold is:

```text
10 violations
within 10 minutes
```

with a `429` response and `Retry-After`.

---

# 41. SSRF Protection

The security middleware blocks requests containing private, loopback, or link-local IP targets.

Relevant values include:

* Query parameters
* `X-Forwarded-For`
* `X-Real-IP`

This reduces server-side request-forgery risk.

---

# 42. Bulk Delete Protection

Collection-level DELETE operations are restricted.

The middleware rejects:

```text
DELETE /collection
```

with:

```text
405
```

ID-list style bulk deletion through query strings is rejected with:

```text
400
```

Per-resource deletion remains the supported pattern.

---

# 43. Secrets Management

Secrets are loaded through Pydantic settings from:

* Environment variables
* `.env`

Sensitive configuration is not hardcoded into source code.

Examples include:

```text
SECRET_KEY
Azure client ID
Azure client secret
Tenant ID
Database URL
Graph / SharePoint configuration
Mail configuration
```

---

# 44. Production Secret Validation

Production startup validates:

```text
SECRET_KEY
```

The application refuses to start when the production secret is:

* Empty
* Still a placeholder
* Less than 32 characters

This is enforced during configuration validation.

---

# 45. Other Secret Validation

Equivalent strength validation is not currently confirmed for:

```text
AZURE_CLIENT_SECRET
Database URL
```

These values are trusted as supplied by the deployment environment.

---

# 46. API-Key Secret Handling

API keys receive stricter treatment.

The raw key:

```text
Displayed once
        ↓
HMAC-SHA256
        ↓
Digest stored
```

The application cannot recover the original usable key from its own database.

---

# 47. Audit Logging

ERP-PremnathRail uses a shared polymorphic:

```text
AuditLog
```

table.

It records information such as:

* Entity type
* Entity ID
* Action
* Field name
* Old value
* New value
* Summary
* User
* Timestamp

---

# 48. Current Audit Coverage

Confirmed audit-writing routes include:

* ERP Projects
* ERP Service Requests
* CRM Inquiries
* CRM Organizations
* CRM Tenders
* Purchase Requisitions
* P2P Requests

---

# 49. Audit Coverage Gap

The following areas currently do not write to `AuditLog`:

* CRM Activities
* CRM Notes
* CRM Documents
* CRM Workflow
* R&D

Audit coverage was also not confirmed for:

* Store
* HR
* Design
* Electrical

These areas require explicit review.

---

# 50. Soft Delete

The following major areas use soft deletion:

* ERP Projects
* ERP Service Requests
* CRM Inquiries
* CRM Organizations
* CRM Tenders

The implementation uses:

```text
deleted_at
```

rather than immediately deleting the record.

This supports the application's Recycle Bin functionality.

---

# 51. Delete Behavior in Other Modules

Soft-delete behavior was not confirmed for:

* Purchase
* P2P
* R&D

These areas may use hard deletion and should be verified against their model implementations when record-retention requirements are defined.

---

# 52. PII Protection

CRM and ERP contain contact information such as:

* Email
* Phone
* Client contact information

These fields are currently stored as normal database string values.

There is no universal application-level field encryption or masking.

Protection currently relies on:

* HTTPS
* Authorization
* Database access restrictions

---

# 53. SQL Injection Protection

Application queries use SQLAlchemy parameterized queries.

User input is not directly concatenated into SQL statements.

This provides the primary SQL injection defense.

OWASP middleware provides additional pattern-based defense in depth.

---

# 54. Pydantic Validation

Request bodies are validated through Pydantic schemas.

Validation controls:

* Field types
* Field lengths
* Expected fields
* Unexpected fields
* Request structure

---

# 55. CORS

Production CORS configuration is restricted to known application origins.

Wildcard production origins are not used.

---

# 56. Database Connections

Database connections use connection pooling.

Production database communication is expected to use encrypted connections.

This is partly an infrastructure/deployment responsibility rather than an application-code-only control.

---

# 57. Current Security Gaps

The following items remain open or require verification:

1. Automated dependency vulnerability scanning.
2. ERP `project_view` and `sr_view` backend enforcement.
3. `service_permissions` enforcement.
4. Purchase/P2P authorization inconsistencies.
5. Audit coverage gaps.
6. Production error-response verification.
7. Document-share token revocation.
8. PII field-level encryption decision.

---

# 58. Security Priorities

Recommended priority order:

### Priority 1

Resolve Purchase/P2P authorization boundaries.

### Priority 2

Establish required audit coverage across uncovered modules.

### Priority 3

Verify or retire `service_permissions`.

### Priority 4

Verify production error handling and dependency scanning.

### Priority 5

Evaluate document-share token revocation.

### Priority 6

Make an explicit decision regarding field-level PII encryption.

---

# 59. Security Change Management

This document should be updated whenever:

* Authentication changes
* Authorization changes
* A new external integration is introduced
* SharePoint access architecture changes
* A new document-sharing mechanism is introduced
* New sensitive data is stored
* Security middleware changes
* Secrets-management architecture changes
* Audit logging changes
* A security gap is resolved

---

# 60. Security Review

Security review should be performed whenever major changes are made to:

```text
Authentication
Authorization
Database
External Integrations
Document Storage
API Access
Infrastructure
```

Security documentation should reflect actual implementation rather than future intentions.

---

# 61. Related Documents

* Permission Matrix
* Threat Model
* Database Schema
* Database Relationships
* Database Indexes
* Database Migrations
* Project Charter
* BRD
* PRD
* Software Architecture Document
* HLD
* LLD
* Platform Module Overview

---

# 62. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 63. Document Information

**Document:** Security Implementation Guide
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Platform / Cross-cutting
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
