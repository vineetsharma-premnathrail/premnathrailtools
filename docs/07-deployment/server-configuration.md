# ERP-PremnathRail — Server Configuration

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Deployment
**Document:** Server Configuration
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the server-side configuration required to run ERP-PremnathRail in production.

Application configuration is supplied through environment variables and consumed by the backend configuration layer.

---

# 2. Configuration Architecture

```text
Production Environment
        │
        ▼
Environment Variables
        │
        ▼
backend/app/core/config.py
        │
        ├── Database
        ├── Authentication
        ├── Security
        ├── Networking
        ├── SharePoint
        └── Notifications
```

Local development may use `backend/.env`; Docker production deployments use the container's runtime environment.

---

# 3. Core Application Settings

| Setting                       | Production Requirement   | Purpose                                   |
| ----------------------------- | ------------------------ | ----------------------------------------- |
| `APP_NAME`                    | `Premnathrail Portal`    | Application identity                      |
| `ENVIRONMENT`                 | `production`             | Enables production configuration behavior |
| `DATABASE_URL`                | Required                 | PostgreSQL connection                     |
| `SECRET_KEY`                  | Required, 32+ characters | Token/session signing                     |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | As approved              | Authentication token lifetime             |

When `ENVIRONMENT=production`, the application refuses to start if `SECRET_KEY` is missing, remains the placeholder, or is shorter than 32 characters.

---

# 4. Database Configuration

The application uses PostgreSQL.

Example:

```text
postgresql+psycopg://user:password@host:5432/premnathrail_portal
```

`DATABASE_URL` is also used by Alembic for database migrations.

The database is external to the Docker application container.

---

# 5. Network Configuration

| Setting           | Purpose                       |
| ----------------- | ----------------------------- |
| `FRONTEND_URL`    | Canonical frontend URL        |
| `ALLOWED_ORIGINS` | CORS allowed origins          |
| `ALLOWED_HOSTS`   | Trusted HTTP hostnames        |
| `TRUSTED_PROXIES` | Reverse-proxy IP addresses    |
| `SECURE_COOKIES`  | Secure authentication cookies |

Production values must replace localhost development values.

---

# 6. Reverse Proxy Configuration

The production architecture places a reverse proxy in front of the application.

```text
Internet
   │
   ▼
HTTPS Reverse Proxy
   │
   ▼
Docker :3000
   │
   ├── Next.js
   │
   └── FastAPI :8000
```

The reverse proxy is responsible for TLS termination.

---

# 7. Trusted Proxy

`TRUSTED_PROXIES` identifies the proxy addresses trusted to provide forwarding headers.

This is important because the application uses the client IP for security controls such as rate limiting.

The production configuration must contain the actual trusted proxy address rather than blindly trusting forwarded headers.

---

# 8. Allowed Hosts

`ALLOWED_HOSTS` controls which HTTP `Host` headers are accepted.

Example:

```text
ALLOWED_HOSTS=portal.premnathrail.com
```

The public production hostname must be included.

---

# 9. CORS

Production CORS should contain only the approved application origins.

Example:

```text
ALLOWED_ORIGINS=https://portal.premnathrail.com
```

Development origins such as:

```text
http://localhost:3000
```

should not be used as production application origins unless specifically required.

---

# 10. Secure Cookies

For production HTTPS:

```text
SECURE_COOKIES=true
```

This is particularly relevant to the Microsoft Teams embedded application because cross-site cookie behavior requires secure HTTPS deployment.

---

# 11. Microsoft Azure Authentication

ERP-PremnathRail uses Microsoft Azure/Entra ID for authentication.

Required settings:

```text
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
AZURE_TENANT_ID
AZURE_REDIRECT_URI
```

Authentication is handled through the configured Microsoft identity application.

---

# 12. Azure Redirect URI

The actual application callback route is:

```text
/api/v1/auth/callback
```

Therefore the production value must use the application's real public HTTPS address.

Example:

```text
https://portal.premnathrail.com/api/v1/auth/callback
```

The same URI must be registered in the Azure application configuration.

---

# 13. Email Domain Restriction

`DOMAIN_EMAIL` can restrict authentication to the organization's approved email domain.

Example:

```text
DOMAIN_EMAIL=@premnathrail.com
```

An empty value allows the application's current authentication logic to accept any email domain.

---

# 14. SharePoint Configuration

SharePoint is used for application attachment/file storage.

Required settings:

```text
SHAREPOINT_SITE_ID
SHAREPOINT_FOLDER
```

Example:

```text
SHAREPOINT_FOLDER=ERP-media
```

The SharePoint integration is handled through Microsoft Graph.

---

# 15. Email Notification Configuration

The application supports notification recipient configuration through:

```text
SENDER_EMAIL
TEAM_EMAIL
PURCHASE_EMAIL
RND_EMAIL
```

These values support application notification workflows.

---

# 16. Application Base URL

`APP_BASE_URL` is used when the backend creates absolute links, including links included in notifications.

Production should use the real application URL.

Example:

```text
APP_BASE_URL=https://portal.premnathrail.com
```

---

# 17. Security Middleware

The application includes security middleware covering areas such as:

* Rate limiting
* Security headers
* Request inspection
* Injection-pattern detection
* SSRF-pattern detection
* IP-based restrictions
* Security event logging

The middleware behavior depends partly on the network configuration, especially `TRUSTED_PROXIES`.

---

# 18. Production Configuration Example

```env
APP_NAME="Premnathrail Portal"
ENVIRONMENT=production

DATABASE_URL=postgresql+psycopg://user:password@db-host:5432/premnathrail_portal

SECRET_KEY=<strong-32+-character-secret>
ACCESS_TOKEN_EXPIRE_MINUTES=1440
SECURE_COOKIES=true

FRONTEND_URL=https://portal.premnathrail.com
APP_BASE_URL=https://portal.premnathrail.com

ALLOWED_ORIGINS=https://portal.premnathrail.com
ALLOWED_HOSTS=portal.premnathrail.com
TRUSTED_PROXIES=<approved-proxy-ip>

AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
AZURE_TENANT_ID=
AZURE_REDIRECT_URI=https://portal.premnathrail.com/api/v1/auth/callback
DOMAIN_EMAIL=@premnathrail.com

SHAREPOINT_SITE_ID=
SHAREPOINT_FOLDER=ERP-media

SENDER_EMAIL=
TEAM_EMAIL=
PURCHASE_EMAIL=
RND_EMAIL=
```

Production secrets must be supplied through the organization's approved secret-management mechanism.

---

# 19. Configuration Validation

Before production deployment, verify:

```text
[ ] ENVIRONMENT is correct
[ ] DATABASE_URL is correct
[ ] SECRET_KEY is strong
[ ] Azure credentials are configured
[ ] Azure redirect URI is correct
[ ] ALLOWED_ORIGINS is correct
[ ] ALLOWED_HOSTS is correct
[ ] TRUSTED_PROXIES is correct
[ ] SECURE_COOKIES=true behind HTTPS
[ ] SharePoint configuration is correct
[ ] Email configuration is correct
[ ] APP_BASE_URL is correct
```

---

# 20. Configuration Changes

Configuration should be changed when:

* Production hostname changes.
* Database changes.
* Azure application configuration changes.
* Teams deployment configuration changes.
* SharePoint configuration changes.
* Email configuration changes.
* Reverse-proxy infrastructure changes.
* Security requirements change.

Sensitive configuration changes should be controlled and documented.

---

# 21. Historical Configuration

Previous approved configuration versions should be retained when configuration changes materially affect production behavior.

Example:

```text
v1.0 — Initial production configuration
v1.1 — Production hostname update
v1.2 — Azure authentication configuration update
v2.0 — Infrastructure configuration change
```

Secrets themselves should **not** be stored in documentation history.

---

# 22. Related Documents

* Deployment Guide
* Docker
* CI/CD
* Backup & Restore
* Environment Variables
* Configuration
* Development Setup
* Security Documentation
* Microsoft Teams Integration
* SharePoint / Microsoft Graph Integration

---

# 23. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 24. Document Information

**Document:** Server Configuration
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Deployment
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
