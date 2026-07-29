# Teams App Package — Ideal Portal

## Before you package

`manifest.json` currently assumes the Ideal app will be deployed on
**`erp.premnathrailtools.cloud`** (same domain as the legacy portal) and reuses
the legacy Teams app's `id` (`da0e9c5c-...`), so uploading this package will
show up in Teams Admin Center as an **update** to the existing "Premnathrail
Portal" listing, not a new app.

If either assumption is wrong, edit `manifest.json` first:

| If... | Change |
|---|---|
| Ideal deploys to a different domain | Update `developer.websiteUrl`, `staticTabs[0].contentUrl`/`websiteUrl`, and `validDomains` |
| You want a brand-new Teams listing instead of updating the old one | Generate a new GUID for `id` (e.g. `python -c "import uuid; print(uuid.uuid4())"`) |
| The Azure AD app registration changes | Update `webApplicationInfo.id`/`resource` — currently reuses the same `AZURE_CLIENT_ID` as legacy (`8e1e753c-...`), which the Ideal backend's `.env` already uses too, so no change needed unless you register a new Azure app |

Bump `version` (currently `1.0.0`) on every re-upload — Teams Admin Center
won't apply changes for a resubmission carrying the same version number as
what's already installed.

## Step 1 — Icons

Already present at `teams-app/color.png` (192×192, full colour) and
`teams-app/outline.png` (32×32, white/transparent) — copied from the legacy
package since it's the same company logo. Replace them here if you want a
different image; they must live at the zip root, not inside a subfolder.

## Step 2 — Build the ZIP

From `teams-app/`:

```powershell
cd D:\Desktop\PremnathrailPortal-Ideal\teams-app
Compress-Archive -Path manifest.json, color.png, outline.png -DestinationPath ..\PremnathrailPortal-Ideal-Teams.zip -Force
```

## Step 3 — Upload to Teams

1. Teams Admin Center → **Teams apps → Manage apps → Upload new app**
2. Upload the zip
3. Approve it
4. Users find it under **Teams → Apps → Built for your org**

## What's already wired up (no extra work needed)

- **CORS/CSP framing**: `frontend/next.config.ts` sets
  `Content-Security-Policy: frame-ancestors ...teams.microsoft.com...` so
  Teams is allowed to iframe the app (no `X-Frame-Options` — ALLOW-FROM isn't
  supported by Chromium/Teams desktop, so framing is CSP-only).
- **Cookies**: the backend already sets `SameSite=None` cookies when
  `SECURE_COOKIES=true` (required for cookies to survive inside a
  cross-site iframe) — see `app/modules/main/routes/auth.py`.
- **Silent SSO**: the login page tries `microsoftTeams.authentication.getAuthToken()`
  first (no popup, no prompt) via `POST /api/v1/auth/teams-token`, which
  validates the AAD token and does an On-Behalf-Of exchange for Graph access.
- **Popup SSO fallback**: if silent SSO fails (e.g. first-time consent needed),
  the login page falls back to `microsoftTeams.authentication.authenticate()`,
  which opens `/api/v1/auth/microsoft-login?next=/auth/teams-success` in a
  popup. That popup's `/auth/teams-success` page calls `notifySuccess(code)`
  to hand the one-time code back to the main frame (the popup's cookies are
  isolated from Teams' main iframe, so the actual session cookie is set by the
  main frame calling `POST /api/v1/auth/teams-exchange` with that code).

## Prerequisite: Azure AD app registration for Teams SSO

The Azure AD app (`AZURE_CLIENT_ID` in `.env`) needs, in **Expose an API**:
- Application ID URI set to `api://erp.premnathrailtools.cloud/8e1e753c-6c52-4e32-99fc-e70e1f02323e`
  (must match `webApplicationInfo.resource` in the manifest exactly)
- A scope named `access_as_user`, with the Teams desktop/web/mobile client
  IDs pre-authorized (`1fec8e78-bce4-4aaf-ab1b-5451cc387264`,
  `5e3ce6c0-2b1f-4285-8d4b-75ee78787346`, `d3590ed6-52b3-4102-aeff-aad2292ab01c`)
  — this is what makes the silent `getAuthToken()` SSO work without a
  consent prompt for users already in the tenant.

If this hasn't been configured yet, silent SSO will fail every time and every
user will fall through to the popup flow — still functional, just an extra
click.
