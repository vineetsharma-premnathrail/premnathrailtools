# External API Calls

This document enumerates every outbound HTTP call to a third-party API found in `backend/`. A grep for `import httpx`, `import requests`, and `import aiohttp` across `backend/app` turns up exactly one HTTP client library in use — `httpx` (async) — and every call site using it talks to **Microsoft Graph**. There is no `requests` or `aiohttp` usage anywhere in the backend, and no non-Microsoft third-party API is called from this codebase.

## httpx usage — all Microsoft Graph, no other external API

| File | Purpose | Target |
|---|---|---|
| `backend/app/auth/microsoft.py` | OAuth authorization-code exchange, user profile fetch, app-only token acquisition (MSAL wraps some of this, but the module also imports `httpx` directly for auxiliary Graph/AAD calls) | `login.microsoftonline.com`, `graph.microsoft.com` |
| `backend/app/utils/sharepoint.py` | SharePoint file upload/download/delete/preview (see `docs/integration/MICROSOFT_GRAPH.md` §1) | `https://graph.microsoft.com/v1.0/sites/{site-id}/drive/...` |
| `backend/app/utils/notifications.py` | Teams activity-feed push notification (see `MICROSOFT_GRAPH.md` §3) | `https://graph.microsoft.com/v1.0/users/{id}/teamwork/sendActivityNotification` |
| `backend/app/utils/email.py` | Outbound email via Graph `sendMail` (see `MICROSOFT_GRAPH.md` §2) | `https://graph.microsoft.com/v1.0/users/{sender}/sendMail` |
| `backend/app/modules/erp/routes/service_requests.py` (line ~1002, `/test-email` diagnostic route) | One-off diagnostic test email, same Graph `sendMail` endpoint as `email.py` | `https://graph.microsoft.com/v1.0/users/{sender}/sendMail` |
| `backend/app/modules/main/routes/auth.py` | Login/callback flow: authorization-code exchange, JWKS fetch for Teams SSO token validation, MSAL-based On-Behalf-Of token exchange (see `MICROSOFT_GRAPH.md` §5) | `login.microsoftonline.com`, Azure AD JWKS endpoint, `graph.microsoft.com` |

## Conclusion

Microsoft Graph (and the underlying Azure AD/Entra ID endpoints MSAL and the manual OAuth flow talk to) is the **only** external API this backend calls. There is no payment gateway, SMS provider, maps/geocoding service, analytics/telemetry API, weather API, or any other third-party REST/SOAP integration in the codebase. If a new external integration is added, it should be documented here alongside the config keys it introduces.
