# Component Diagram

Derived from `backend/app/main.py` (router wiring), `frontend/src/lib/api.ts` (API client
surface), and `backend/app/utils/sharepoint.py` / `backend/app/modules/main/routes/auth.py`
(integrations). See [ARCHITECTURE.md](ARCHITECTURE.md) for prose detail per module.

```mermaid
flowchart TB
    subgraph Browser["Browser / Microsoft Teams Tab"]
        NextApp["Next.js App Router\nfrontend/src/app/**"]
        ApiClient["frontend/src/lib/api.ts\n(erpApi, crmApi, purchaseApi, prRequestApi, usersApi, authApi, ...)"]
        AuthStore["frontend/src/store/authStore.ts\n(zustand — no token in JS storage)"]
        TeamsJs["@microsoft/teams-js\n(Teams SDK init)"]
        NextApp --> ApiClient
        NextApp --> AuthStore
        NextApp --> TeamsJs
    end

    subgraph Backend["FastAPI Backend (backend/app/main.py)"]
        MW["Middleware:\nCORS -> TrustedHost -> LoggingMiddleware -> OWASPMiddleware"]
        subgraph Routers["Routers (/api/v1 prefix)"]
            RMain["main: auth, users, notifications,\nfeedback, api_keys, presence"]
            RErp["erp: projects, service_requests"]
            RPurchase["purchase: purchase_requisitions\n(ERP-origin PRs)"]
            RPR["p2p: p2p_requests\n(standalone PRs, any dept)"]
            RCrm["crm: organizations, inquiries, tenders,\nactivities, notes, documents, workflow,\ndashboard, bulk_import"]
            RRnd["rnd (prefix /api/v1/rnd):\ncalculations, history,\nbraking/hydraulic/qmax/spline/\ntractive_effort/vehicle_performance/\nload_distribution tools"]
        end
        Services["Business logic in routes/ and\nservice.py (p2p)"]
        Models["SQLAlchemy 2.0 Mapped[...] models\nper module (models/*.py)"]
        MW --> Routers
        Routers --> Services --> Models
    end

    Postgres[("PostgreSQL\n(Alembic-managed schema)")]

    subgraph MSGraph["Microsoft 365 / Entra ID"]
        EntraID["Entra ID (Azure AD)\nOAuth2 login"]
        Graph["Microsoft Graph API"]
        SPSite["SharePoint site\n(file storage)"]
        SendMail["Graph sendMail\n(app-only, notification emails)"]
        Teams["Microsoft Teams\n(tab host + notifications)"]
    end

    ApiClient -- "REST over HTTPS\n(cookie session_token or Bearer/API key)" --> MW
    Models --> Postgres

    RMain -- "OAuth2 redirect/callback" --> EntraID
    RErp -- "upload/download via\napp/utils/sharepoint.py" --> Graph
    RPR -- "upload/download via\napp/utils/sharepoint.py" --> Graph
    Graph --> SPSite
    RErp -- "app/utils/notifications.py" --> SendMail
    RCrm -- "app/utils/notifications.py" --> SendMail
    TeamsJs -- "teams-js SDK\n(context, auth, notifications)" --> Teams
    EntraID -. "issues tokens consumed by\nGraph calls server-side" .-> Graph
```

## Notes on what's proxied vs direct

- The frontend **never** calls Microsoft Graph or SharePoint directly — all of that goes
  through the FastAPI backend (`app/utils/sharepoint.py`, `app/utils/notifications.py`),
  which holds the app-only Graph credentials (`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`/
  `AZURE_TENANT_ID` in `backend/app/core/config.py`).
- The frontend does load `@microsoft/teams-js` directly in the browser to detect/behave
  correctly inside a Teams tab (iframe context, SSO context) — see
  [INTEGRATION_ARCHITECTURE.md](INTEGRATION_ARCHITECTURE.md) for the full breakdown and
  cross-links to the how-to docs.
- The JWT session lives in an httponly `session_token` cookie (never exposed to page
  JS); `frontend/src/store/authStore.ts` documents this explicitly in a comment. A
  separate `Authorization: Bearer` / `X-API-Key` path exists for tooling — see
  [../api/API.md](../api/API.md).
