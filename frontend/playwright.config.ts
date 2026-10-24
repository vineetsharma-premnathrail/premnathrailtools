import { defineConfig } from '@playwright/test'

// Runtime UI layout tests (e2e/). They open every dashboard page in a real
// browser at a laptop and a phone width and fail on layout bugs the static
// audit (scripts/ui-audit.mjs) can't see. Needs a running app:
//
//   1. Start the app yourself (frontend on :3000, backend on :8000).
//   2. Once:   npm run test:ui:login   — a browser opens, sign in with Microsoft,
//              the session is saved to e2e/.auth/state.json (git-ignored).
//   3. Then:   npm run test:ui:layout   (UI_BASE_URL=… to point elsewhere,
//              UI_ROUTES=/dashboard/crm,/dashboard/store to check a few pages).
//
// Uses the installed Microsoft Edge (channel msedge) — nothing to download.
// UI_BROWSER_CHANNEL=chrome to use Google Chrome instead.
const baseURL = process.env.UI_BASE_URL || 'http://localhost:3000'
const channel = process.env.UI_BROWSER_CHANNEL || 'msedge'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  workers: process.env.UI_WORKERS ? Number(process.env.UI_WORKERS) : 4,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, channel, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'login', testMatch: /auth\.setup\.ts/, use: { headless: false } },
    {
      name: 'laptop',
      testMatch: /layout\.spec\.ts/,
      use: { viewport: { width: 1366, height: 768 }, storageState: 'e2e/.auth/state.json' },
    },
    {
      name: 'phone',
      testMatch: /layout\.spec\.ts/,
      use: { viewport: { width: 390, height: 844 }, isMobile: false, hasTouch: true, storageState: 'e2e/.auth/state.json' },
    },
  ],
})
