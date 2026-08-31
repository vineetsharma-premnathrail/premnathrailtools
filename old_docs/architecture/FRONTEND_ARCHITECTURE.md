# Frontend Architecture

> **Correction (verified against current code):** this document previously described a
> plain HTML/CSS/JS frontend with no framework. That is no longer accurate — it may have
> matched an early prototype, but the current frontend under `frontend/` is a
> **Next.js (App Router) + React + TypeScript** application. This rewrite is grounded in
> `frontend/package.json`, `frontend/next.config.ts`, and the actual `frontend/src/`
> tree.

## Overview

- Framework: **Next.js 16 (App Router)**, **React 19**, **TypeScript**.
- Styling: inline style objects using shared design tokens from `frontend/src/lib/theme.ts`
  — no CSS-in-JS library (styled-components/emotion) and no Tailwind wired into the
  dashboard pages (verify against `frontend/package.json`/`tailwind.config.*` if this
  changes).
- State: **zustand** store (`frontend/src/store/authStore.ts`) for auth state. The JWT
  itself is never held in JS-accessible storage — it lives only in an httponly
  `session_token` cookie set by the backend; the store only tracks derived
  logged-in/user state, per the comment in `authStore.ts`.
- API access: centralized in `frontend/src/lib/api.ts` — one exported object per backend
  module (`erpApi`, `crmApi`, `purchaseApi`, `prRequestApi`, `usersApi`, `authApi`, and
  others matching the backend modules below).
- Microsoft Teams integration: `@microsoft/teams-js` (`frontend/package.json`) is
  dynamically imported where needed — `frontend/src/app/login/page.tsx` (silent Teams SSO
  login attempt) and `frontend/src/app/auth/teams-success/page.tsx` (post-auth handoff
  when running inside a Teams tab).

## Project Structure

```
frontend/
├── next.config.ts
├── package.json
├── src/
│   ├── app/                          # Next.js App Router routes
│   │   ├── login/page.tsx            # Login (Microsoft SSO + Teams silent login)
│   │   ├── auth/teams-success/       # Teams-tab post-auth landing page
│   │   ├── legal/                    # Privacy policy, terms of use, permissions
│   │   └── dashboard/
│   │       ├── page.tsx              # Dashboard home
│   │       ├── erp/                  # Projects, Service Requests, Materials UI
│   │       ├── crm/                  # Organizations, Inquiries, Tenders, Activities UI
│   │       ├── purchase/             # ERP-origin Purchase Requisition UI
│   │       ├── p2p/ # Standalone P2P UI
│   │       ├── rnd/                  # R&D calculation tools UI
│   │       └── users/                # User/role admin UI
│   ├── components/                   # Shared/reusable components (e.g. Sidebar.tsx,
│   │                                  # erp/ProjectForm.tsx)
│   ├── hooks/                         # e.g. useAuth.ts
│   ├── lib/
│   │   ├── api.ts                    # Centralized API client (axios), per-module exports
│   │   └── theme.ts                  # Design tokens (colors, spacing, typography)
│   ├── store/
│   │   └── authStore.ts              # zustand auth store (no token in JS storage)
│   └── types/
│       └── index.ts                  # Shared TypeScript types
```

Each `dashboard/<module>/` folder roughly mirrors a backend module (`erp`, `crm`,
`purchase`, `p2p`, `rnd`, `users` for `main`'s user admin) — see
[ARCHITECTURE.md](ARCHITECTURE.md) for the backend module list and
[../development/MODULE_DOCUMENTATION.md](../development/MODULE_DOCUMENTATION.md) for
per-module detail.

## API Client Layer

`frontend/src/lib/api.ts` wraps axios and exposes one object per backend module (naming
observed in the file: `erpApi`, `crmApi`, `purchaseApi`, `prRequestApi`, `usersApi`,
`authApi`, plus request/response types re-used from `frontend/src/types/index.ts`). The
base URL comes from a `NEXT_PUBLIC_*` environment variable (see
[../development/ENVIRONMENT_VARIABLES.md](../development/ENVIRONMENT_VARIABLES.md) for
the exact variable name and default). Axios is configured with `withCredentials: true`
so the httponly `session_token` cookie is sent automatically; a response interceptor
handles `401` by clearing local auth state and redirecting to `/login` — see
[../development/ERROR_HANDLING.md](../development/ERROR_HANDLING.md) for the exact
behavior.

## Styling Convention

Dashboard pages (e.g. `frontend/src/app/dashboard/erp/projects/[id]/page.tsx`,
`frontend/src/components/erp/ProjectForm.tsx`) use plain inline `style={{ ... }}` objects
built from tokens exported by `frontend/src/lib/theme.ts` (colors, spacing, font sizes),
rather than a CSS-in-JS library or utility classes. This keeps styling colocated with
each component without adding a styling dependency. See
[../development/CODING_STANDARDS.md](../development/CODING_STANDARDS.md) for more.

## Auth Flow (frontend side)

1. `frontend/src/app/login/page.tsx` first tries a silent Teams SSO login (if
   `@microsoft/teams-js` detects a Teams host context), falling back to a normal
   redirect to the backend's `/auth/microsoft-login`.
2. The backend completes the Microsoft OAuth exchange server-side and redirects back
   with an httponly `session_token` cookie already set (see
   [DATA_FLOW_DIAGRAM.md](DATA_FLOW_DIAGRAM.md) for the full sequence).
3. `authStore.ts` reflects logged-in state by calling a backend "who am I" endpoint, not
   by reading the cookie (which JS cannot read, being httponly).
4. `frontend/src/app/auth/teams-success/page.tsx` exists specifically to hand control
   back to the Teams tab host after this completes inside Teams' iframe context.

## Related Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — backend module list and structure.
- [COMPONENT_DIAGRAM.md](COMPONENT_DIAGRAM.md) — full system component diagram.
- [INTEGRATION_ARCHITECTURE.md](INTEGRATION_ARCHITECTURE.md) — Microsoft integrations.
- [../development/CODING_STANDARDS.md](../development/CODING_STANDARDS.md) — frontend
  and backend coding conventions.
