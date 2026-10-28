// Microsoft Teams single sign-on (the pattern Microsoft recommends for Teams
// tabs, same as Jira / Asana / Power BI): the Teams sign-in IS the portal
// sign-in. Inside Teams the browser often drops our cookies (the tab is a
// third-party iframe on Teams web, iPhone and some desktops), so the tab keeps
// the portal access token itself and sends it as a Bearer header; when it
// expires it asks Teams for a token again — silently, no screen.
//
// Deliberately free of imports from lib/api.ts (plain fetch): the API
// client's 401 handler calls into this file.

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'
const TEAMS_FLAG = 'pr-in-teams'

type TeamsSdk = typeof import('@microsoft/teams-js')

function readFlag(): boolean {
  try { return sessionStorage.getItem(TEAMS_FLAG) === '1' } catch { return false }
}

function setFlag() {
  try { sessionStorage.setItem(TEAMS_FLAG, '1') } catch { /* storage blocked — detection falls back to the checks below */ }
}

// The Teams app's tab URL carries ?inTeams=1 (teams-app/manifest.json); keep
// it for the whole tab session, since in-app redirects drop the query string.
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('inTeams') === '1') setFlag()

/** Best guess, without waiting for the Teams SDK, that this page runs inside Teams. */
export function looksLikeTeams(): boolean {
  if (typeof window === 'undefined') return false
  if (readFlag()) return true
  if (/\bTeams\//.test(navigator.userAgent)) return true
  try { return window.self !== window.top } catch { return true }
}

let initPromise: Promise<TeamsSdk | null> | null = null

/** The initialised Teams SDK, or null when not inside Teams. app.initialize()
 * never settles outside a Teams host, so it is raced against a timeout —
 * long when everything says "Teams" (Teams mobile can take several seconds
 * to hand over), short otherwise. */
export function initTeams(): Promise<TeamsSdk | null> {
  if (!initPromise) {
    const expectTeams = looksLikeTeams()
    const timeoutMs = expectTeams ? 12000 : 1500
    initPromise = (async () => {
      try {
        const teams = await import('@microsoft/teams-js')
        await Promise.race([
          teams.app.initialize(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('not in Teams')), timeoutMs)),
        ])
        setFlag()
        return teams
      } catch {
        // A slow Teams start (phone) may succeed on the next try — don't
        // remember the failure when everything said "Teams".
        if (expectTeams) initPromise = null
        return null
      }
    })()
  }
  return initPromise
}

async function postForToken(path: string, body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : `the server answered ${res.status}`
    throw new Error(`Teams sign-in was refused: ${detail}.`)
  }
  return String(data.access_token || '')
}

let signInFlight: Promise<string> | null = null

/** Silent Teams sign-in: a Teams SSO token in, a portal access token out.
 * `previousToken` (the tab's old, usually expired portal token) lets the
 * server continue the same session, so the app password is not asked again.
 * Concurrent callers share one attempt. */
export function teamsSilentSignIn(previousToken?: string | null): Promise<string> {
  if (!signInFlight) {
    signInFlight = (async () => {
      const teams = await initTeams()
      if (!teams) throw new Error('This page is not running inside Microsoft Teams.')
      let lastErr: unknown = null
      // Teams sometimes isn't ready to hand out a token on the first call.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 1500))
          const ssoToken = await teams.authentication.getAuthToken()
          return await postForToken('/auth/teams-token', { token: ssoToken, previous_token: previousToken || undefined })
        } catch (err) {
          lastErr = err
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(`Teams did not hand out a sign-in token (${String(lastErr)}).`)
    })().finally(() => { signInFlight = null })
  }
  return signInFlight
}

/** Teams sign-in through Microsoft's sign-in window — only when silent
 * sign-in needs the person (first-time consent, MFA). */
export async function teamsPopupSignIn(): Promise<string> {
  const teams = await initTeams()
  if (!teams) throw new Error('This page is not running inside Microsoft Teams.')
  const code = await teams.authentication.authenticate({
    url: new URL(`${API_URL}/auth/microsoft-login?next=/auth/teams-success`, window.location.href).toString(),
    width: 600,
    height: 640,
  })
  return postForToken('/auth/teams-exchange', { code })
}
