# Frontend Deployment

The frontend is **not deployed separately** in this repo — it is one
build stage inside the single root [`Dockerfile`](../deployment/DOCKER.md),
combined with the FastAPI backend into one container image and one
running process tree. This doc exists to cover the frontend-specific
parts of that build (Next.js version, scripts, env vars); for
platform-independent Vercel/S3/DigitalOcean options that are not what
this repo actually does, see the note at the bottom.

## Stack

From `frontend/package.json`:

- Next.js `16.2.11`
- React `19.2.4` / React DOM `19.2.4`
- TypeScript `^5`, ESLint `^9` / `eslint-config-next 16.2.11`, Tailwind
  CSS `^4`
- State/data: `@tanstack/react-query ^5`, `zustand ^5`, `axios ^1.18`
- `@microsoft/teams-js ^2.54.0` (Teams SSO embedding), `chart.js` /
  `react-chartjs-2` for charts

npm scripts (`frontend/package.json`):

| Script | Command | Use |
|---|---|---|
| `npm run dev` | `next dev` | Local development |
| `npm run build` | `next build` | Production build (also run inside the Docker image) |
| `npm run start` | `next start` | Serve a build without Docker |
| `npm run lint` | `eslint` | Lint |

## How it's actually built (inside the Docker image)

The root `Dockerfile` builds the frontend with Next.js's **standalone
output** mode across two stages (`frontend-deps`, `frontend-builder`),
then copies only `.next/standalone`, `.next/static`, and `public/` into
the final `production` stage — not the full `node_modules`/source tree.
The final image's `CMD` runs the standalone server directly:

```bash
node /app/frontend/server.js
```

`NEXT_PUBLIC_API_URL` is a build ARG, defaulting to `/api/v1` — a
same-origin relative path. Because the frontend and backend live in the
same container and the frontend proxies `/api/*` requests through to
the internal backend, no absolute backend URL or CORS setup is needed
for the packaged deployment. See [DOCKER.md](DOCKER.md) for the full
stage-by-stage breakdown.

`NEXT_PUBLIC_*` variables are **baked in at build time**, not read at
container start — to change one, rebuild the image with a different
`--build-arg`.

## Local development (no Docker)

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:3000` and expects the backend at
`http://localhost:8000` (default `NEXT_PUBLIC_API_URL` for local dev —
check `frontend/.env.local` if present). See the repo-root
`start-servers.bat` for a one-shot script that launches both backend and
frontend dev servers in separate windows on Windows.

## CORS

The frontend talks to the backend same-origin in the packaged
deployment (proxied through Next.js), so CORS does not apply there. It
only matters for local dev (frontend on `:3000`, backend on `:8000`,
different origins) or if you ever split frontend/backend into separate
deployed origins. That is fully covered in
[../setup/BACKEND_CORS_CONFIG.md](../setup/BACKEND_CORS_CONFIG.md) —
see that doc rather than duplicating it here, and cross-check
`ALLOWED_ORIGINS` in [SERVER_CONFIGURATION.md](SERVER_CONFIGURATION.md).

## Production checklist

- [ ] `npm run build` succeeds with no TypeScript errors
- [ ] `npm run lint` clean
- [ ] `NEXT_PUBLIC_API_URL` build arg correct if not using the default
      same-origin `/api/v1` path
- [ ] Rebuild (not just restart) the image after any `NEXT_PUBLIC_*` change

## If you ever split the frontend out as its own deployment

Nothing in this repo does this today (no Vercel project file, no S3/CDN
config, no separate frontend Dockerfile) — the platform-specific steps
for Vercel, S3+CloudFront, or DigitalOcean App Platform are not
documented here because they don't reflect what's actually deployed.
If you introduce a split deployment, you would need to reintroduce CORS
between the two origins (see the cross-linked CORS doc above) and set
`NEXT_PUBLIC_API_URL` to an absolute backend URL.

---

**See also:** [DOCKER.md](DOCKER.md) for the image build,
[DEPLOYMENT.md](DEPLOYMENT.md) for the full deploy flow.
