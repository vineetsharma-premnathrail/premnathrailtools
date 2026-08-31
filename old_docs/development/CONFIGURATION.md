# Configuration

Backend configuration is a single Pydantic `Settings` class in `backend/app/core/config.py`, loaded from a `.env` file (`model_config = SettingsConfigDict(env_file=".env", extra="ignore")`). Frontend configuration is limited to a handful of `NEXT_PUBLIC_*` vars plus `frontend/next.config.ts`. This doc covers *what each setting configures and its default/enforcement*; for a plain enumerate-and-fill-in-your-.env reference see [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md).

## Backend: `Settings` (`backend/app/core/config.py`)

| Field | Purpose | Default |
|---|---|---|
| `app_name` | Display name used in FastAPI title, `/health` response | `"Premnathrail Portal"` |
| `environment` | Switches prod-only validation (see below); also returned by `/health` | `"development"` |
| `database_url` | SQLAlchemy connection string (PostgreSQL) | `""` (must be set) |
| `FRONTEND_URL` | Canonical frontend origin, used in redirects/emails | `"http://localhost:3000"` |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list, parsed into `allowed_origins_list` | `"http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000"` |
| `ALLOWED_HOSTS` | Comma-separated `TrustedHostMiddleware` allow-list, parsed into `allowed_hosts_list` | `"localhost,127.0.0.1,testserver"` |
| `TRUSTED_PROXIES` | Comma-separated proxy IPs trusted for `X-Forwarded-*` headers, parsed into `trusted_proxies_set` | `""` (fail-closed — no proxies trusted by default) |
| `AZURE_CLIENT_ID` | Azure AD app registration client ID (Microsoft login) | `""` |
| `AZURE_CLIENT_SECRET` | Azure AD app registration secret | `""` |
| `AZURE_TENANT_ID` | Azure AD tenant ID | `""` |
| `AZURE_REDIRECT_URI` | OAuth redirect callback URL registered with Azure | `"http://localhost:8000/auth/callback"` |
| `DOMAIN_EMAIL` | Company email domain used to restrict/validate logins | `""` |
| `SECURE_COOKIES` | Whether auth cookies are set `Secure` (should be `true` behind HTTPS in prod) | `False` |
| `SECRET_KEY` | Signing key for sessions/tokens and HMAC (also used to hash API keys — see `middleware/api_key.py`) | placeholder `"..."` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT/session token lifetime | `1440` (24h) |
| `SHAREPOINT_SITE_ID` | Microsoft Graph SharePoint site ID for file storage (`app/utils/sharepoint.py`) | `""` |
| `SHAREPOINT_FOLDER` | Target SharePoint folder name for uploaded attachments | `"ERP-media"` |
| `SENDER_EMAIL` | From-address for outbound notification emails | `""` |
| `TEAM_EMAIL` | Notification recipient for general team alerts | `""` |
| `PURCHASE_EMAIL` | Notification recipient for purchase-module alerts | `""` |
| `APP_BASE_URL` | Base URL the backend uses to construct absolute links (e.g. in emails) | `"http://localhost:8000"` |

Computed convenience properties (not raw settings): `allowed_origins_list`, `allowed_hosts_list`, `trusted_proxies_set` — all derived by splitting the corresponding comma-separated string field.

### Production enforcement

Only one field currently has an enforced production check, a `model_validator(mode="after")`:

```python
@model_validator(mode="after")
def _reject_placeholder_secret_in_production(self) -> "Settings":
    if self.environment == "production" and (not self.SECRET_KEY or self.SECRET_KEY == "..." or len(self.SECRET_KEY) < 32):
        raise ValueError(
            "SECRET_KEY must be set to a strong, unique value (32+ chars) when environment=production. "
            "Refusing to start with a placeholder/weak key, since it would let anyone forge session tokens."
        )
    return self
```

The app will refuse to start in `environment="production"` if `SECRET_KEY` is empty, still the placeholder `"..."`, or shorter than 32 characters. No other field (`database_url`, `SECURE_COOKIES`, Azure credentials, etc.) has an equivalent enforced check — misconfiguring them fails at first use (e.g. a DB connection error, or Azure OAuth failing at login) rather than at startup. Anyone adding a new required-in-prod setting should follow this same `model_validator` pattern.

## Middleware-driven configuration

Several `Settings` fields directly parameterize middleware wired in `backend/app/main.py`:
- `ALLOWED_ORIGINS` → `CORSMiddleware(allow_origins=settings.allowed_origins_list, allow_credentials=True, allow_methods=["GET","POST","PUT","PATCH","DELETE","OPTIONS"], allow_headers=["Authorization","Content-Type","X-Requested-With"])`
- `ALLOWED_HOSTS` → `TrustedHostMiddleware(allowed_hosts=settings.allowed_hosts_list)`
- `TRUSTED_PROXIES` → consumed by `app/middleware/owasp.py` when determining the real client IP from `X-Forwarded-For`.
- `SECRET_KEY` → also used by `app/middleware/api_key.py`'s `hash_api_key()` as the HMAC key for hashing external API keys before storing them (raw key is never persisted).

## Frontend configuration

Frontend has no equivalent `Settings` class — configuration is just environment variables read at build/runtime and `frontend/next.config.ts`.

- `NEXT_PUBLIC_API_URL` — read in `frontend/src/lib/api.ts`:
  ```ts
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'
  ```
  Falls back to `http://localhost:8000/api/v1` if unset.

`frontend/next.config.ts` (full contents, quoted):
```ts
const FRAME_ANCESTORS = [
  "'self'",
  "https://teams.microsoft.com",
  "https://*.teams.microsoft.com",
  "https://teams.cloud.microsoft",
  "https://*.teams.cloud.microsoft",
].join(" ");

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  devIndicators: false,
  images: { unoptimized: true },
  experimental: { optimizePackageImports: ["@/"] },
  onDemandEntries: { maxInactiveAge: 25 * 1000, pagesBufferLength: 5 },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://127.0.0.1:8000/api/:path*" },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: `frame-ancestors ${FRAME_ANCESTORS};` },
        ],
      },
    ];
  },
};
```

Notes:
- `output: "standalone"` — in production the frontend and backend share one container/host; the backend binds `127.0.0.1:8000` only (not exposed externally), and the `/api/:path*` rewrite lets the browser call a single origin while Next.js proxies to the local backend.
- The CSP `frame-ancestors` allowlist is specifically scoped to Microsoft Teams domains — this app is intended to be embeddable inside Teams (see the `auth/teams-success/` page in `frontend/src/app/`).
- `images: { unoptimized: true }` disables Next.js image optimization (likely because the app is not deployed behind a CDN/image-optimizer-capable host).

## Cross-references

- [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) for a plain `.env` reference list
- [DEVELOPMENT_SETUP.md](./DEVELOPMENT_SETUP.md) for how to actually populate these locally
- [../security/](../security/) for the broader security posture these settings support
