# Server Configuration

All application configuration is read from environment variables via
`backend/app/core/config.py` (`pydantic-settings`, reads `.env` in
`backend/` for local dev; in Docker, real process environment variables
— see [DOCKER.md](DOCKER.md)). This doc lists every setting and what it
actually controls in code. For the CORS-specific subset, see
[../setup/BACKEND_CORS_CONFIG.md](../setup/BACKEND_CORS_CONFIG.md)
(that doc is the source of truth for CORS setup steps — this page only
cross-references the relevant settings, it does not repeat that content).

## Core

| Setting | Default | Notes |
|---|---|---|
| `app_name` | `Premnathrail Portal` | Shown in `/health` response and API title |
| `environment` | `development` | Set to `production` to enable the `SECRET_KEY` strength check below |
| `database_url` | `""` | SQLAlchemy connection string, e.g. `postgresql+psycopg://user:pass@host:5432/dbname`. Also used directly by Alembic (`backend/alembic/env.py` reads `settings.database_url`, not a separate value in `alembic.ini`) |
| `SECRET_KEY` | `"..."` (placeholder) | JWT signing key. **The app refuses to start** if `environment=production` and this is unset, still the placeholder, or under 32 characters (`Settings._reject_placeholder_secret_in_production`) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` (24h) | JWT lifetime |

## Networking / reverse proxy

| Setting | Default | Notes |
|---|---|---|
| `FRONTEND_URL` | `http://localhost:3000` | Used for building links back to the frontend (e.g. in notification emails) |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000` | Comma-separated. Feeds `CORSMiddleware.allow_origins` in `app/main.py`. **Must be overridden in production** with the real frontend origin(s) — see [../setup/BACKEND_CORS_CONFIG.md](../setup/BACKEND_CORS_CONFIG.md) |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1,testserver` | Comma-separated. Feeds `TrustedHostMiddleware.allowed_hosts` in `app/main.py` — requests with a `Host` header not in this list are rejected outright. Must include the real production hostname |
| `TRUSTED_PROXIES` | `""` (empty — fails closed) | IPs of reverse proxies (e.g. Coolify/Traefik) allowed to set `X-Forwarded-For`. Empty by default deliberately: the header is trivially spoofable by a direct client otherwise, which would let `OWASPMiddleware`'s per-IP rate limiting and ban logic be bypassed. **Set this to your reverse proxy's IP in production** — see `backend/app/middleware/owasp.py` and `backend/app/core/config.py`'s comment on this field |
| `SECURE_COOKIES` | `False` | Teams runs the app inside an iframe (top-level site is `teams.microsoft.com`), so cross-site cookies need `SameSite=None`, which browsers only honor when `Secure=True` — i.e. only works served over HTTPS. Set `True` once the app is behind HTTPS in production |

## Microsoft Azure AD (auth)

| Setting | Notes |
|---|---|
| `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` | From the Azure App Registration. See [RUNBOOK.md](../runbook/RUNBOOK.md) troubleshooting for how to verify these |
| `AZURE_REDIRECT_URI` | Default `http://localhost:8000/auth/callback` — must be updated to the production backend's callback URL and registered in Azure |
| `DOMAIN_EMAIL` | e.g. `@premnathrail.com`; empty means allow any email domain to log in |

## SharePoint / email

| Setting | Notes |
|---|---|
| `SHAREPOINT_SITE_ID`, `SHAREPOINT_FOLDER` | Used by `backend/app/utils/sharepoint.py` for ERP attachment storage |
| `SENDER_EMAIL`, `TEAM_EMAIL`, `PURCHASE_EMAIL` | Used by `backend/app/utils/notifications.py` for app-only Graph `sendMail` notifications |
| `APP_BASE_URL` | Default `http://localhost:8000` — used to build absolute links in notification emails; set to the real production backend URL |

## Reverse proxy requirements

Since the container only exposes the frontend on port 3000 over plain
HTTP (see [DOCKER.md](DOCKER.md)), production deployments need a reverse
proxy in front doing TLS termination and forwarding the real client IP.
When you add one:

1. Set `TRUSTED_PROXIES` to that proxy's IP so `OWASPMiddleware` trusts
   its `X-Forwarded-For` header for rate-limiting/ban decisions.
2. Set `ALLOWED_HOSTS` to the public hostname the proxy forwards
   `Host:` as.
3. Set `SECURE_COOKIES=True` once HTTPS is in place.
4. Ensure the proxy forwards `Authorization` and standard headers
   through untouched — the API is Bearer-token based, not cookie-only.

## Security-relevant middleware (not configured via env, but relevant here)

`backend/app/middleware/owasp.py` applies fixed OWASP Top-10 protections
(rate limiting, injection/SSRF pattern scanning, security headers, IP
bans) that interact with the settings above (`TRUSTED_PROXIES` in
particular). See [RUNBOOK.md](../runbook/RUNBOOK.md#monitoring--logging)
for how its structured `[A01]`–`[A10]` log lines surface in practice.

---

**See also:** [../setup/BACKEND_CORS_CONFIG.md](../setup/BACKEND_CORS_CONFIG.md)
for CORS setup steps, [DEPLOYMENT.md](DEPLOYMENT.md) for the deploy flow
these settings feed into.
