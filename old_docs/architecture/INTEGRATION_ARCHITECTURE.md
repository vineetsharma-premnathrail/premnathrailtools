# Integration Architecture

Architectural view of how the app talks to Microsoft Entra ID / Graph / SharePoint /
Teams — what's proxied through the backend vs called directly from the frontend, and
how tokens flow. For step-by-step how-to/setup instructions, see the integration
reference linked at the bottom. Grounded in:
`backend/app/modules/main/routes/auth.py`, `backend/app/auth/microsoft.py`,
`backend/app/utils/sharepoint.py`, `backend/app/utils/notifications.py`,
`frontend/package.json` (`@microsoft/teams-js`), and the two frontend Teams pages
(`frontend/src/app/login/page.tsx`, `frontend/src/app/auth/teams-success/page.tsx`).

## Two categories of Microsoft integration

### 1. User identity (delegated) — Entra ID / Azure AD

Used only for **authenticating the human**. Three code paths exist, all ending in the
same backend-issued JWT stored as an httponly `session_token` cookie:

- **Browser redirect (normal web login):** `GET /auth/microsoft-login` → Entra ID
  authorize endpoint → `GET /auth/callback` exchanges the auth code for a Microsoft
  access token (`app/auth/microsoft.py::exchange_code_for_token`) and fetches the
  profile from Graph (`get_microsoft_user_profile`). All token exchange happens
  **server-side**; the frontend only ever sees the final redirect + cookie.
- **Teams tab, silent SSO:** the frontend calls the Teams JS SDK's
  `authentication.getAuthToken()` directly in the browser (this is the one place the
  frontend talks to a Microsoft-adjacent API directly — it's actually Teams' own SDK,
  not Graph), then posts that token to `POST /auth/teams-token`. The backend verifies
  it against Entra ID's JWKS itself (signature, issuer, tenant id, audience, replay
  via `jti`) rather than trusting the client — see `_check_replay`/`_jwks_cache` in
  `auth.py`.
- **Teams tab, popup fallback:** same as the browser redirect, but `/auth/callback`
  detects the popup context (`next_path == "/auth/teams-success"`) and hands back a
  short-lived one-time code instead of setting cookies directly (a popup's cookie jar
  is isolated from the Teams main frame); `frontend/src/app/auth/teams-success/page.tsx`
  then calls `POST /auth/teams-exchange` from the main frame to actually receive the
  cookies.

After the Teams silent-SSO path, the backend also performs an **On-Behalf-Of (OBO)**
exchange (`msal.ConfidentialClientApplication.acquire_token_on_behalf_of`) to swap the
Teams SSO token for a Graph delegated token (`User.Read`, `Directory.Read.All`,
`User.Read.All` scopes), stored as the `ms_access_token` cookie. This is best-effort —
if OBO fails the portal login still succeeds, only Graph-delegated features degrade.

### 2. Application identity (app-only) — Microsoft Graph / SharePoint / Teams notifications

Used for **backend-to-Microsoft calls that aren't about the current user's identity**
at all — file storage and outbound notifications. These use a client-credentials
("app-only") token via `msal`, scoped to `https://graph.microsoft.com/.default`,
completely independent of any user's session:

- **SharePoint file storage** (`backend/app/utils/sharepoint.py`): every attachment
  upload/download/delete/preview across every module (ERP Service Requests/Materials,
  CRM Documents/Activity photos, both Purchase Requisition variants) goes through this
  one utility, authenticated with the app-only token (`get_app_graph_token()`), against
  a single configured `SHAREPOINT_SITE_ID`. **The frontend never talks to SharePoint or
  Graph directly for files** — it always uploads multipart form data to a FastAPI route,
  which streams it to Graph server-side. This also means Postgres only ever stores a
  *pointer* (`path`/`webUrl`) — never file bytes.
  - Small files (≤4 MB) use a single Graph `PUT .../content` call; larger files use a
    Graph upload session with 10 MB chunks (`_start_large_upload_session` /
    `_upload_large_file`).
  - Uploads are defended against disguised files: extension/content-type allowlist,
    a hard block on SVG/HTML/JS (stored-XSS vectors), a magic-byte signature check
    against the claimed extension, and a 2 GB size cap — all before any Graph call.
- **Teams activity-feed notifications** (`backend/app/utils/notifications.py`): the
  backend pushes native Teams bell/toast/mobile notifications via
  `POST /users/{id}/teamwork/sendActivityNotification` using the same app-only token
  pattern (`get_msal_app().acquire_token_for_client(...)`). This is unrelated to the
  Teams SSO flow above — it's an outbound push, not an inbound auth check, and it
  requires the Teams app manifest's catalog `id` (`TEAMS_APP_ID` in `notifications.py`)
  to match what's published to Teams.

## What's proxied through the backend vs called directly from the frontend

| Concern | Who calls Microsoft directly |
|---|---|
| OAuth2 authorize/token exchange (browser flow) | Backend only |
| Teams `getAuthToken()` (silent SSO) | **Frontend** (Teams JS SDK) — but the resulting token is then verified server-side, never trusted as-is |
| SharePoint file upload/download/delete/preview | Backend only (`utils/sharepoint.py`) |
| Teams activity-feed notifications (outbound) | Backend only (`utils/notifications.py`) |
| Fetching the signed-in user's Graph profile | Backend only, during login |

The only direct frontend→Microsoft touchpoint is the Teams JS SDK's client-side SSO
handshake; every file operation and every outbound notification is backend-mediated,
and both browser and Teams sessions converge on the same backend-issued JWT / httponly
cookie for authorizing subsequent API calls.

## Token summary

| Token | Issued by | Stored as | Scope |
|---|---|---|---|
| App JWT (`session_token`) | This backend (`create_access_token`) | httponly cookie (or Bearer header for tooling) | Portal session, 24h expiry |
| Microsoft delegated access token | Entra ID (OAuth code exchange or OBO) | `ms_access_token` httponly cookie | Graph calls made *on behalf of* the user (currently limited use — most Graph calls are app-only) |
| Graph app-only token | Entra ID (client-credentials grant, `msal`) | In-memory / cached per-process (`_jwks_cache` for JWKS; a separate cache inside `auth/microsoft.py` for the app token itself) | SharePoint file ops, Teams activity notifications |
| Teams SSO token | Teams client (via Teams JS SDK) | Never stored — verified once against JWKS, then exchanged for the app JWT | One-time, short-lived |

## Security notes worth flagging architecturally

- `X-API-Key` (see `app/middleware/api_key.py`) is a third, separate auth path for
  server-to-server integrations, checked before the cookie/JWT path in
  `get_current_user` — relevant if any future integration needs the portal's API
  without a user session.
- `_MAX_PENDING_STATES` / `_MAX_USED_TOKENS` caps and TTL-based purges in `auth.py`
  exist specifically to bound memory use against a flood of unauthenticated login
  attempts or SSO replay attempts — this is in-process state, so it resets on restart
  and does not survive across multiple app instances (relevant if this backend is ever
  horizontally scaled — see the Scaling Strategy note in
  [ARCHITECTURE.md](./ARCHITECTURE.md)).

---

See also: [Integration Reference](../integration/) for step-by-step how-to/reference docs.
