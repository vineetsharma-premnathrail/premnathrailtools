# ERP-PremnathRail — Environment Variables

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Setup & Development
**Document:** Environment Variables
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document provides the complete environment-variable reference required to configure ERP-PremnathRail.

It is intended as a quick fill-in-the-blank reference for:

* Local development
* Testing
* Staging
* Production deployment

Detailed configuration behavior is documented separately in **Configuration**.

---

# 2. Backend Environment File

Backend variables are stored in:

```text
backend/.env
```

The variables are loaded by:

```text
backend/app/core/config.py
```

The settings class uses:

```text
env_file=".env"
extra="ignore"
```

Unknown environment variables are therefore ignored by the configuration system.

A misspelled variable name may consequently fail silently.

---

# 3. Backend Environment Template

```env
# ============================================================
# ERP-PremnathRail Backend Environment
# ============================================================

# ------------------------------------------------------------
# Application
# ------------------------------------------------------------

APP_NAME="Premnathrail Portal"

ENVIRONMENT=development


# ------------------------------------------------------------
# Database
# ------------------------------------------------------------

DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/premnathrail_portal


# ------------------------------------------------------------
# Application URLs
# ------------------------------------------------------------

FRONTEND_URL=http://localhost:3000

APP_BASE_URL=http://localhost:8000


# ------------------------------------------------------------
# CORS / Hosts
# ------------------------------------------------------------

ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000

ALLOWED_HOSTS=localhost,127.0.0.1,testserver

TRUSTED_PROXIES=


# ------------------------------------------------------------
# Microsoft Entra ID
# ------------------------------------------------------------

AZURE_CLIENT_ID=

AZURE_CLIENT_SECRET=

AZURE_TENANT_ID=

AZURE_REDIRECT_URI=http://localhost:8000/api/v1/auth/callback

DOMAIN_EMAIL=


# ------------------------------------------------------------
# Authentication / Sessions
# ------------------------------------------------------------

SECRET_KEY=

ACCESS_TOKEN_EXPIRE_MINUTES=1440

SECURE_COOKIES=false


# ------------------------------------------------------------
# SharePoint / Microsoft Graph
# ------------------------------------------------------------

SHAREPOINT_SITE_ID=

SHAREPOINT_FOLDER=ERP-media


# ------------------------------------------------------------
# Email Notifications
# ------------------------------------------------------------

SENDER_EMAIL=

TEAM_EMAIL=

PURCHASE_EMAIL=

RND_EMAIL=
```

---

# 4. Application Variables

## `APP_NAME`

Defines the application display name.

Current value:

```text
Premnathrail Portal
```

---

## `ENVIRONMENT`

Defines the runtime environment.

Typical values:

```text
development
production
```

Production mode activates additional security validation.

---

# 5. Database Variables

## `DATABASE_URL`

Defines the PostgreSQL connection string.

Example:

```text
postgresql+psycopg://user:password@localhost:5432/premnathrail_portal
```

This value must be supplied for the backend to connect to PostgreSQL.

---

# 6. URL Variables

## `FRONTEND_URL`

Defines the canonical frontend application URL.

Development:

```text
http://localhost:3000
```

---

## `APP_BASE_URL`

Defines the backend/application base URL used when generating absolute application links.

Development:

```text
http://localhost:8000
```

---

# 7. CORS Variables

## `ALLOWED_ORIGINS`

Comma-separated list of permitted browser origins.

Development example:

```text
http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000
```

---

# 8. Host Validation

## `ALLOWED_HOSTS`

Comma-separated list of trusted application hostnames.

Development example:

```text
localhost,127.0.0.1,testserver
```

Production should contain only the hosts actually used by the application.

---

# 9. Trusted Proxy Configuration

## `TRUSTED_PROXIES`

Comma-separated list of trusted proxy IP addresses.

Example:

```text
10.0.0.10,10.0.0.11
```

An empty value means no proxies are trusted by default.

This affects processing of forwarded client-IP information.

---

# 10. Microsoft Entra ID Variables

## `AZURE_CLIENT_ID`

Microsoft Entra application registration client ID.

---

## `AZURE_CLIENT_SECRET`

Microsoft Entra application client secret.

This is sensitive and must never be committed to source control.

---

## `AZURE_TENANT_ID`

Microsoft Entra tenant identifier.

---

## `AZURE_REDIRECT_URI`

OAuth callback URL.

Development value:

```text
http://localhost:8000/api/v1/auth/callback
```

This value must exactly match the redirect URI registered in the Microsoft Entra application.

---

# 11. Redirect URI Important Note

The authentication route is mounted as:

```text
/api/v1
    +
/auth
    +
/callback
```

Therefore the actual callback endpoint is:

```text
/api/v1/auth/callback
```

The shorter:

```text
/auth/callback
```

must not be used as the development redirect URI.

---

# 12. `DOMAIN_EMAIL`

Defines an optional organizational email-domain restriction.

Example:

```text
premnathrail.com
```

If empty, no email-domain restriction is configured by this setting.

---

# 13. Authentication Variables

## `SECRET_KEY`

Application cryptographic signing key.

It is used for security-sensitive operations such as:

* Session/token signing
* HMAC operations
* External API-key hashing

Production requires:

```text
32+ characters
```

and must not use:

```text
...
```

---

## `ACCESS_TOKEN_EXPIRE_MINUTES`

Defines authentication/session token lifetime.

Default:

```text
1440
```

which equals:

```text
24 hours
```

---

## `SECURE_COOKIES`

Controls whether authentication cookies use the `Secure` attribute.

Development:

```text
false
```

Production HTTPS:

```text
true
```

---

# 14. SharePoint Variables

## `SHAREPOINT_SITE_ID`

Microsoft Graph identifier of the SharePoint site used for ERP document storage.

This value is required for SharePoint-dependent functionality.

---

## `SHAREPOINT_FOLDER`

Root SharePoint folder used for application attachments.

Default:

```text
ERP-media
```

Other modules may use additional configured storage roots where applicable.

---

# 15. Email Variables

## `SENDER_EMAIL`

Mailbox used as the sender for outbound notification email.

---

## `TEAM_EMAIL`

Recipient for general team notifications.

---

## `PURCHASE_EMAIL`

Recipient for purchase-module notifications.

---

## `RND_EMAIL`

Recipient for R&D-module notifications.

---

# 16. Frontend Environment File

Frontend environment variables are maintained in:

```text
frontend/.env.local
```

Current frontend environment variable:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

---

# 17. `NEXT_PUBLIC_API_URL`

Defines the backend API base URL used by the frontend.

Development:

```text
http://localhost:8000/api/v1
```

The frontend currently falls back to this value when the variable is not configured.

---

# 18. Frontend Public Variables

Only variables prefixed with:

```text
NEXT_PUBLIC_
```

are intended to be exposed to browser-side code.

Therefore secrets must **never** be placed in a `NEXT_PUBLIC_*` variable.

Examples of values that must not be public:

```text
AZURE_CLIENT_SECRET
SECRET_KEY
DATABASE_URL
```

---

# 19. Local Development Configuration

Typical local configuration:

```text
Backend
http://localhost:8000

Frontend
http://localhost:3000

API
http://localhost:8000/api/v1
```

The backend CORS configuration must permit the frontend origin.

---

# 20. Production Configuration

Production values must be environment-specific.

At minimum, production configuration should replace development values for:

```text
ENVIRONMENT
DATABASE_URL
FRONTEND_URL
APP_BASE_URL
ALLOWED_ORIGINS
ALLOWED_HOSTS
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
AZURE_TENANT_ID
AZURE_REDIRECT_URI
SECRET_KEY
SECURE_COOKIES
SHAREPOINT_SITE_ID
SENDER_EMAIL
TEAM_EMAIL
PURCHASE_EMAIL
RND_EMAIL
```

---

# 21. Secret Management

The following values are sensitive:

```text
DATABASE_URL
AZURE_CLIENT_SECRET
SECRET_KEY
```

They must be protected from:

* Git repositories
* Public files
* Client-side bundles
* Frontend `NEXT_PUBLIC_*` variables
* Uncontrolled logs
* Public documentation

---

# 22. Environment Separation

Separate values should be maintained for:

```text
Development
Testing
Staging
Production
```

The same secret or production database credentials should not be reused across environments unless explicitly required and approved.

---

# 23. Variable Naming Convention

Backend environment variables use uppercase names:

```text
APP_NAME
DATABASE_URL
AZURE_CLIENT_ID
SECRET_KEY
```

Frontend public environment variables use:

```text
NEXT_PUBLIC_*
```

Example:

```text
NEXT_PUBLIC_API_URL
```

---

# 24. Adding a New Variable

When introducing a new environment variable:

```text
1. Add it to Settings/configuration.
2. Add it to this document.
3. Define its purpose.
4. Define whether it is required.
5. Define its development value/default.
6. Update deployment configuration.
7. Update relevant documentation.
```

---

# 25. Configuration Validation

Currently, production startup validation explicitly protects:

```text
SECRET_KEY
```

The application rejects production startup when the key is:

* Empty
* The placeholder `...`
* Shorter than 32 characters

Other required values may fail when their related functionality is first used.

---

# 26. Configuration Change Management

Update this document whenever:

* A variable is added.
* A variable is removed.
* A variable changes meaning.
* A default changes.
* A security requirement changes.
* A new external integration requires configuration.
* Deployment configuration changes.

---

# 27. Historical Versions

Previous approved versions should be retained.

Example:

```text
v1.0
Initial environment-variable baseline

v1.1
Additional configuration variables

v1.2
Integration configuration update

v2.0
Major configuration architecture change
```

The current version represents the active environment-variable contract.

---

# 28. Related Documents

* Configuration
* Development Setup
* Coding Standards
* Project Structure
* Microsoft Graph Integration
* SharePoint Document Storage
* Microsoft Teams Integration
* Security Implementation Guide
* Deployment Configuration

---

# 29. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 30. Document Information

**Document:** Environment Variables
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Setup & Development
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
