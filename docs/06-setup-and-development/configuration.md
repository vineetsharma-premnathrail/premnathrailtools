# ERP-PremnathRail — Configuration

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Setup & Development
**Document:** Configuration
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the configuration used by ERP-PremnathRail across the backend and frontend.

It describes:

* Application configuration
* Database configuration
* Microsoft Entra ID configuration
* Session configuration
* SharePoint configuration
* Email configuration
* CORS and trusted-host configuration
* Proxy configuration
* Frontend environment configuration
* Next.js runtime configuration
* Production configuration enforcement

This document describes configuration behavior currently implemented in the application.

---

# 2. Configuration Architecture

```text
ERP-PremnathRail
│
├── Backend
│   └── Pydantic Settings
│       └── .env
│
└── Frontend
    ├── NEXT_PUBLIC_* environment variables
    └── next.config.ts
```

Backend configuration is centralized through:

```text
backend/app/core/config.py
```

Frontend configuration is primarily controlled through environment variables and:

```text
frontend/next.config.ts
```

---

# 3. Backend Configuration

The backend uses a single Pydantic `Settings` class.

Configuration is loaded from:

```text
.env
```

The settings model uses:

```text
model_config = SettingsConfigDict(
    env_file=".env",
    extra="ignore"
)
```

Unknown environment variables are therefore ignored by the settings model.

---

# 4. Backend Settings Reference

| Setting                       | Purpose                                                 | Default                               |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------- |
| `app_name`                    | FastAPI display name and `/health` response             | `Premnathrail Portal`                 |
| `environment`                 | Environment identifier and production validation switch | `development`                         |
| `database_url`                | PostgreSQL / SQLAlchemy connection string               | Empty; must be supplied               |
| `FRONTEND_URL`                | Canonical frontend origin for redirects and emails      | `http://localhost:3000`               |
| `ALLOWED_ORIGINS`             | CORS origin allow-list                                  | Local development origins             |
| `ALLOWED_HOSTS`               | Trusted host allow-list                                 | `localhost,127.0.0.1,testserver`      |
| `TRUSTED_PROXIES`             | Trusted proxy IP addresses                              | Empty                                 |
| `AZURE_CLIENT_ID`             | Microsoft Entra application client ID                   | Empty                                 |
| `AZURE_CLIENT_SECRET`         | Microsoft Entra application secret                      | Empty                                 |
| `AZURE_TENANT_ID`             | Microsoft Entra tenant ID                               | Empty                                 |
| `AZURE_REDIRECT_URI`          | OAuth callback URL                                      | `http://localhost:8000/auth/callback` |
| `DOMAIN_EMAIL`                | Allowed organizational email domain                     | Empty                                 |
| `SECURE_COOKIES`              | Enables Secure authentication cookies                   | `False`                               |
| `SECRET_KEY`                  | JWT/session signing and API-key HMAC key                | Placeholder                           |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Session/JWT lifetime                                    | `1440`                                |
| `SHAREPOINT_SITE_ID`          | SharePoint site Graph ID                                | Empty                                 |
| `SHAREPOINT_FOLDER`           | Root SharePoint upload folder                           | `ERP-media`                           |
| `SENDER_EMAIL`                | Outbound email sender                                   | Empty                                 |
| `TEAM_EMAIL`                  | General team notification recipient                     | Empty                                 |
| `PURCHASE_EMAIL`              | Purchase notification recipient                         | Empty                                 |
| `RND_EMAIL`                   | R&D notification recipient                              | Empty                                 |
| `APP_BASE_URL`                | Backend base URL for generated absolute links           | `http://localhost:8000`               |

---

# 5. Computed Configuration Properties

The following values are derived from comma-separated configuration strings:

```text
allowed_origins_list
allowed_hosts_list
trusted_proxies_set
```

They are not independently configured environment variables.

---

# 6. Database Configuration

The database connection is configured through:

```text
database_url
```

The application uses PostgreSQL through SQLAlchemy.

The value must be supplied by the deployment environment.

There is no default production database connection string.

---

# 7. Frontend URL

The canonical frontend URL is configured through:

```text
FRONTEND_URL
```

It is used for operations such as:

* Redirect construction
* Email links
* Application-generated URLs

Development default:

```text
http://localhost:3000
```

---

# 8. Application Base URL

The backend uses:

```text
APP_BASE_URL
```

for constructing absolute application URLs.

Development default:

```text
http://localhost:8000
```

This setting should correspond to the backend's externally appropriate base URL when absolute backend links are required.

---

# 9. CORS Configuration

CORS origins are controlled by:

```text
ALLOWED_ORIGINS
```

The value is parsed into:

```text
allowed_origins_list
```

The backend configures:

```text
allow_credentials = True
```

Allowed methods include:

```text
GET
POST
PUT
PATCH
DELETE
OPTIONS
```

Allowed request headers include:

```text
Authorization
Content-Type
X-Requested-With
```

---

# 10. Trusted Hosts

Host validation is controlled by:

```text
ALLOWED_HOSTS
```

The value is parsed into:

```text
allowed_hosts_list
```

The default development values are:

```text
localhost
127.0.0.1
testserver
```

Production deployments must explicitly configure the appropriate application hostnames.

---

# 11. Trusted Proxies

Proxy trust is controlled by:

```text
TRUSTED_PROXIES
```

The value is parsed into:

```text
trusted_proxies_set
```

The default is empty.

This means the application does not trust forwarded client-IP headers unless a proxy is explicitly configured as trusted.

---

# 12. Microsoft Entra ID Configuration

Microsoft authentication uses:

```text
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
AZURE_TENANT_ID
AZURE_REDIRECT_URI
```

These values support the application's Microsoft OAuth authentication flow.

---

# 13. OAuth Redirect URI

The default development callback is:

```text
http://localhost:8000/auth/callback
```

Production must use the callback URL registered with the Microsoft Entra application.

The configured value must match the Microsoft Entra application registration.

---

# 14. Organizational Email Restriction

The application can restrict login identities using:

```text
DOMAIN_EMAIL
```

If configured, the user's email domain is validated during authentication.

If the setting is empty, the configuration does not impose a domain restriction.

---

# 15. Secure Cookies

Authentication cookie security is controlled by:

```text
SECURE_COOKIES
```

For HTTPS production deployments this should be enabled.

When enabled, authentication cookies use:

```text
Secure
HttpOnly
SameSite=None
```

This configuration supports the application's Microsoft Teams iframe scenario.

---

# 16. Secret Key

The application uses:

```text
SECRET_KEY
```

for security-sensitive cryptographic operations including:

* Session/JWT signing
* Token signing
* HMAC-based API-key hashing
* Other application security operations

The secret must never be committed to source control.

---

# 17. Production Secret Validation

When:

```text
environment = production
```

the application validates `SECRET_KEY`.

Startup is rejected if the secret is:

* Empty
* The placeholder `...`
* Shorter than 32 characters

The application therefore refuses to start with an obviously unsafe production signing key.

---

# 18. Production Validation Scope

Currently, the enforced startup validation specifically covers:

```text
SECRET_KEY
```

Other settings such as:

```text
database_url
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
AZURE_TENANT_ID
SECURE_COOKIES
```

do not currently have equivalent startup validation.

Incorrect values may instead fail when the relevant functionality is first used.

---

# 19. Adding Required Production Settings

When a future configuration value must be mandatory in production, the existing Pydantic model-validator approach should be used.

The validation should occur during application startup rather than waiting until the first request that uses the setting.

---

# 20. SharePoint Configuration

SharePoint storage uses:

```text
SHAREPOINT_SITE_ID
SHAREPOINT_FOLDER
```

`SHAREPOINT_SITE_ID` identifies the SharePoint site used through Microsoft Graph.

`SHAREPOINT_FOLDER` defines the configured root folder for uploaded files.

Default:

```text
ERP-media
```

---

# 21. Email Configuration

Outbound email configuration uses:

```text
SENDER_EMAIL
```

General team notifications use:

```text
TEAM_EMAIL
```

Purchase-module notifications use:

```text
PURCHASE_EMAIL
```

R&D notifications use:

```text
RND_EMAIL
```

These values determine the recipients/sender used by the application's notification functionality.

---

# 22. Session Lifetime

Session/JWT lifetime is controlled by:

```text
ACCESS_TOKEN_EXPIRE_MINUTES
```

Default:

```text
1440 minutes
```

which equals:

```text
24 hours
```

---

# 23. Middleware Configuration

Several configuration values directly control security middleware.

```text
ALLOWED_ORIGINS
        ↓
CORS Middleware

ALLOWED_HOSTS
        ↓
Trusted Host Middleware

TRUSTED_PROXIES
        ↓
Client IP Resolution

SECRET_KEY
        ↓
API-Key HMAC
```

---

# 24. API-Key Hashing

External API keys are hashed using:

```text
HMAC-SHA256
```

with:

```text
SECRET_KEY
```

as the HMAC key.

The raw API key is not stored in the database.

---

# 25. Frontend Configuration

The frontend does not use a backend-style Pydantic settings class.

Configuration is provided through:

```text
NEXT_PUBLIC_*
```

environment variables and static Next.js configuration.

---

# 26. Frontend API URL

The frontend reads:

```text
NEXT_PUBLIC_API_URL
```

through:

```text
frontend/src/lib/api.ts
```

Default:

```text
http://localhost:8000/api/v1
```

If the variable is not configured, the frontend falls back to this development URL.

---

# 27. Next.js Configuration

The frontend configuration is maintained in:

```text
frontend/next.config.ts
```

Current configuration includes:

```text
output: standalone
reactStrictMode: true
devIndicators: false
images: { unoptimized: true }
```

---

# 28. Standalone Deployment

The frontend uses:

```text
output: "standalone"
```

This supports the application's deployment model where frontend and backend can operate within the same production container/host architecture.

---

# 29. Backend API Rewrite

Next.js proxies API requests through:

```text
/api/:path*
```

to:

```text
http://127.0.0.1:8000/api/:path*
```

Conceptually:

```text
Browser
   ↓
Same Application Origin
   ↓
Next.js
   ↓
127.0.0.1:8000
   ↓
FastAPI
```

This allows the browser to communicate through a single application origin.

---

# 30. Microsoft Teams Frame Configuration

The frontend configures:

```text
Content-Security-Policy
```

using:

```text
frame-ancestors
```

The current allowed Teams origins include:

```text
https://teams.microsoft.com
https://*.teams.microsoft.com
https://teams.cloud.microsoft
https://*.teams.cloud.microsoft
```

This allows the ERP application to operate inside supported Microsoft Teams environments.

---

# 31. Image Configuration

Next.js image optimization is disabled:

```text
images:
  unoptimized: true
```

The current application therefore does not depend on Next.js image optimization infrastructure.

---

# 32. React Configuration

React strict mode is enabled:

```text
reactStrictMode: true
```

This helps identify certain development-time problems and unsafe React patterns.

---

# 33. Development Entry Configuration

Next.js development configuration includes:

```text
onDemandEntries
```

with:

```text
maxInactiveAge: 25 * 1000
pagesBufferLength: 5
```

These settings affect development-page lifecycle behavior.

---

# 34. Configuration Flow

The overall configuration flow is:

```text
Environment Variables
        ↓
Backend Settings
        ↓
Application Components
        ↓
Middleware
        ↓
Routes / Services
        ↓
External Integrations
```

Frontend configuration follows:

```text
Environment Variables
        +
next.config.ts
        ↓
Next.js Application
        ↓
Browser
```

---

# 35. Local Development Configuration

Typical development configuration includes:

```text
environment=development

FRONTEND_URL=http://localhost:3000

APP_BASE_URL=http://localhost:8000

ALLOWED_ORIGINS=
http://localhost:3000,
http://localhost:5173,
http://127.0.0.1:3000

ALLOWED_HOSTS=
localhost,
127.0.0.1,
testserver
```

Sensitive credentials must still be supplied separately.

---

# 36. Production Configuration Principles

Production configuration should:

* Use HTTPS.
* Use a strong unique `SECRET_KEY`.
* Enable secure cookies.
* Configure the real frontend origin.
* Configure the real backend/application URL.
* Restrict CORS origins.
* Restrict allowed hosts.
* Configure trusted proxies explicitly where required.
* Supply valid Microsoft Entra credentials.
* Supply valid database credentials.
* Configure the correct SharePoint site.
* Configure production notification addresses.

---

# 37. Configuration Security

Configuration containing secrets must not be committed to source control.

Sensitive values include:

```text
SECRET_KEY
AZURE_CLIENT_SECRET
DATABASE_URL
```

and any other credential or access token.

Environment-specific configuration should be maintained separately from application source code.

---

# 38. Configuration Change Rules

Update this document when:

* A new environment variable is introduced.
* An existing configuration variable changes meaning.
* A default changes.
* Production validation changes.
* Authentication configuration changes.
* SharePoint configuration changes.
* Email configuration changes.
* Teams/CSP configuration changes.
* API routing configuration changes.
* Deployment configuration changes.

---

# 39. Historical Versions

Previous approved configuration documentation should be retained.

Example:

```text
v1.0
Initial configuration baseline

v1.1
Additional configuration setting

v1.2
Security/deployment configuration update

v2.0
Major configuration architecture change
```

The current version describes the active configuration.

Historical versions preserve previous configuration decisions.

---

# 40. Related Documents

* Environment Variables
* Development Setup
* Project Structure
* Coding Standards
* Software Architecture
* HLD
* LLD
* Security Implementation Guide
* Threat Model
* Microsoft Graph Integration
* SharePoint Document Storage
* Microsoft Teams Integration
* Deployment Configuration

---

# 41. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 42. Document Information

**Document:** Configuration
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Setup & Development
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
