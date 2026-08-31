# Environment Variables

Quick-reference `.env` variable list. For what each one actually configures and production-enforcement details, see [CONFIGURATION.md](./CONFIGURATION.md).

## Backend (`backend/.env`)

All fields below are read by `Settings` in `backend/app/core/config.py` (`env_file=".env"`, `extra="ignore"` — unknown keys in `.env` are silently ignored, so typos in variable names fail silently rather than erroring).

```env
# App identity
APP_NAME="Premnathrail Portal"
ENVIRONMENT=development            # "production" enables strict SECRET_KEY validation — see CONFIGURATION.md

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/premnathrail_portal

# URLs / CORS / hosts
FRONTEND_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000
ALLOWED_HOSTS=localhost,127.0.0.1,testserver
TRUSTED_PROXIES=                    # comma-separated proxy IPs; empty = fail-closed, no X-Forwarded-For trust
APP_BASE_URL=http://localhost:8000

# Azure AD (Microsoft login)
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
AZURE_TENANT_ID=
AZURE_REDIRECT_URI=http://localhost:8000/auth/callback   # NOTE: verify against the actual mounted path, see caveat below
DOMAIN_EMAIL=

# Auth / sessions
SECRET_KEY=                         # REQUIRED, 32+ chars, in production (enforced at startup)
ACCESS_TOKEN_EXPIRE_MINUTES=1440
SECURE_COOKIES=false                # set true in production (HTTPS)

# SharePoint (file attachments via Microsoft Graph)
SHAREPOINT_SITE_ID=
SHAREPOINT_FOLDER=ERP-media

# Email notifications
SENDER_EMAIL=
TEAM_EMAIL=
PURCHASE_EMAIL=
```

**Caveat on `AZURE_REDIRECT_URI`:** the auth routes module (`backend/app/modules/main/routes/auth.py`) declares `router = APIRouter(prefix="/auth", ...)` and is mounted in `main.py` with `app.include_router(auth_routes.router, prefix="/api/v1")`, which would put the real callback path at `/api/v1/auth/callback`, not the bare `/auth/callback` shown in the default above. Confirm the actual registered path in your Azure App Registration matches whatever `main.py` mounts today before relying on the default value — this same mismatch exists in `docs/setup/SETUP.md` and is called out there too.

## Frontend

Frontend reads env vars via `process.env.NEXT_PUBLIC_*` (Next.js convention — any var without the `NEXT_PUBLIC_` prefix is server-only and won't reach client bundles).

```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1   # optional; frontend/src/lib/api.ts falls back to this exact value if unset
```

Only one `NEXT_PUBLIC_` variable was found referenced in `frontend/src/lib/api.ts`:
```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'
```
No `.env.example` audit was performed beyond this — if the frontend grows more `NEXT_PUBLIC_*` vars, add them here.

Note: `frontend/next.config.ts` proxies `/api/:path*` to `http://127.0.0.1:8000/api/:path*` at the Next.js server level (`rewrites()`), which is a separate mechanism from `NEXT_PUBLIC_API_URL` — the rewrite only takes effect in production/standalone deployments serving both apps from one origin; local dev with `NEXT_PUBLIC_API_URL` pointing straight at `http://localhost:8000/api/v1` bypasses it.

## Cross-references

- [CONFIGURATION.md](./CONFIGURATION.md) — full explanation of each setting and prod enforcement
- [DEVELOPMENT_SETUP.md](./DEVELOPMENT_SETUP.md) — local setup walkthrough
- [../setup/SETUP.md](../setup/SETUP.md) — original setup guide (has some outdated `.env` guidance corrected here)
