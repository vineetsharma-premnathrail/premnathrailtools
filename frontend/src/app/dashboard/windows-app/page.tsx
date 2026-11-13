'use client'

// "Premnathrail Portal for Windows" — any signed-in employee downloads the
// Windows app (desktop/, Electron) here, with the install steps from IT's
// installation guide (owner, 2026-11-13). The app opens the live portal, so it
// never needs reinstalling for portal updates. The file sits in SharePoint;
// the button asks the API for a short-lived download link.

import { useCallback, useEffect, useState } from 'react'
import { WindowsLogo, DownloadSimple, ShieldCheck, Warning } from '@phosphor-icons/react'
import { useProtectedPage, useAuth } from '@/hooks/useAuth'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { GLASS, SHADOWS, TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { desktopAppApi, type DesktopAppInfo } from '@/lib/desktopAppApi'
import { inDesktopApp } from '@/components/shared/DesktopRefreshButton'
import { openDesktopAppUpload } from '@/components/shared/DesktopAppDownload'

const card: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 12px' }
const h3: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#c2410c', letterSpacing: '.04em', textTransform: 'uppercase', margin: '18px 0 10px' }

const mb = (n?: number | null) => (n ? `${(n / (1024 * 1024)).toFixed(1)} MB` : '')
const day = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
}

// From IT's "Premnathrail Portal Desktop Installation Guide" (download now comes from this page, not SharePoint).
const PHASES: { title: string; steps: { title: string; text: string; img?: string }[] }[] = [
  {
    title: 'Download',
    steps: [
      { title: 'Download the installer', text: 'Click “Download for Windows” above. The browser saves “Premnathrail Portal Setup <version>.exe” (about 90 MB) in your Downloads; its progress shows in the browser’s Downloads panel.', img: '1-download.png' },
    ],
  },
  {
    title: 'Allow the download (browser warning)',
    steps: [
      { title: 'Choose “Keep”', text: 'Microsoft Edge may say the file “isn’t commonly downloaded”. That is normal for a company-only app. In the Downloads panel, hover over the file, click the … menu and choose Keep.', img: '2-keep.png' },
      { title: 'Choose “Keep anyway”', text: 'In “Make sure you trust … before you open it”, click the arrow next to Delete and choose Keep anyway.', img: '3-keep-anyway.png' },
      { title: 'Open the installer', text: 'Click Open file in the Downloads panel (or open the file from your Downloads folder). If Windows shows “Windows protected your PC”, click More info, then Run anyway.', img: '4-open-file.png' },
    ],
  },
  {
    title: 'Install',
    steps: [
      { title: 'Choose who can use it', text: '“Anyone who uses this computer (all users)” installs it for everyone (needs administrator rights); “Only for me” needs none. Click Next.', img: '5-who.png' },
      { title: 'Confirm the folder', text: 'Keep the suggested folder (C:\\Program Files\\Premnathrail Portal; about 325 MB free space needed) and click Install. If Windows asks “Do you want to allow this app to make changes to your device?”, click Yes.', img: '6-folder.png' },
      { title: 'Finish and log in', text: 'Leave “Run Premnathrail Portal” ticked and click Finish. The app opens the portal; log in with your company Microsoft account. A shortcut is put on the desktop and in the Start menu.', img: '7-finish.png' },
    ],
  },
]

// Step numbers run on across the phases (1 … 7).
const FIRST_STEP = PHASES.map((_, i) => 1 + PHASES.slice(0, i).reduce((sum, p) => sum + p.steps.length, 0))

export default function WindowsAppPage() {
  const { isAuthorized, isLoading } = useProtectedPage()
  const { user } = useAuth()
  const [info, setInfo] = useState<DesktopAppInfo | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState(false)
  const [error, setError] = useState('')
  const [insideApp] = useState(() => inDesktopApp())

  // State is set only in the promise callbacks (never synchronously inside the effect).
  const load = useCallback(() => desktopAppApi.info()
    .then((r) => { setInfo(r); setLoadError('') })
    .catch((e) => setLoadError(extractErrorMessages(e, 'Could not check the Windows app.').join(' '))), [])
  useEffect(() => { if (isAuthorized) void load() }, [isAuthorized, load])
  useEffect(() => {
    const reload = () => void load()
    window.addEventListener('desktop-app:updated', reload)
    return () => window.removeEventListener('desktop-app:updated', reload)
  }, [load])

  if (isLoading || !isAuthorized) return null

  const download = async () => {
    setBusy(true)
    setError('')
    try {
      const { url } = await desktopAppApi.downloadLink()
      // The link answers with "save as" (attachment), so this page stays open with the steps.
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setStarted(true)
    } catch (e) {
      setError(extractErrorMessages(e, 'The download link could not be made. Try again in a minute.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <span style={{ width: 46, height: 46, borderRadius: 12, background: '#0078d4', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <WindowsLogo size={26} color="#fff" aria-hidden />
        </span>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Premnathrail Portal for Windows</h1>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: '2px 0 0' }}>The portal as its own app on your computer — its own window, desktop shortcut, no browser tabs. Windows 10 / 11.</p>
        </div>
      </div>

      {/* Download + notes side by side on a wide screen, stacked on a narrow one. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ ...card, flex: '2 1 420px', minWidth: 0, marginBottom: 0 }}>
        {insideApp && (
          <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#15803d', margin: '0 0 14px' }}>
            <ShieldCheck size={16} aria-hidden /> You are already using the Windows app. Nothing to install.
          </p>
        )}
        {loadError && (
          <div role="alert" style={{ color: '#b91c1c', fontSize: 13 }}>
            Could not check the Windows app: {loadError}{' '}
            <button type="button" style={{ ...secondaryBtnStyle, marginLeft: 8 }} onClick={() => void load()}>Try again</button>
          </div>
        )}
        {!loadError && !info && <p style={{ margin: 0, color: TEXT.muted, fontSize: 13 }}>Checking the Windows app…</p>}
        {!loadError && info && !info.available && (
          <div style={{ textAlign: 'center', padding: '18px 8px' }}>
            <WindowsLogo size={40} color="#a8a29e" aria-hidden />
            <h2 style={{ ...h2, margin: '10px 0 6px' }}>The Windows app is not uploaded yet</h2>
            <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>
              {user?.role === 'admin'
                ? 'Upload the Setup .exe once (made by npm run build in desktop/); everyone can then download it here.'
                : 'Your portal admin has not uploaded it yet. Please check this page again later.'}
            </p>
            {user?.role === 'admin' && (
              <button type="button" onClick={openDesktopAppUpload} style={{ ...primaryBtnStyle, marginTop: 14 }}>Upload Windows app</button>
            )}
          </div>
        )}
        {!loadError && info?.available && (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: TEXT.secondary }}>Latest version</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading }}>{info.version}</div>
                <div style={{ fontSize: 12.5, color: TEXT.secondary }}>
                  {[day(info.released_at) && `Released ${day(info.released_at)}`, mb(info.file_size)].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button type="button" onClick={download} disabled={busy}
                style={{ ...primaryBtnStyle, minHeight: 48, padding: '0 22px', fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <DownloadSimple size={20} aria-hidden />
                {busy ? 'Preparing…' : 'Download for Windows'}
              </button>
            </div>
            {error && <p role="alert" style={{ fontSize: 13, color: '#b91c1c', margin: '12px 0 0' }}>{error}</p>}
            {started && (
              <p role="status" style={{ fontSize: 13, color: TEXT.body, margin: '12px 0 0' }}>
                Your download has started. Watch the browser&apos;s Downloads panel, then follow the steps below.
                If nothing downloads, click the button again; if it still fails, tell your portal admin.
              </p>
            )}
            <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.secondary, margin: '16px 0 0' }}>
              <ShieldCheck size={16} color="#16a34a" aria-hidden />
              Install once — the app always opens the live portal, so every portal update reaches it without reinstalling.
            </p>
          </>
        )}
        </div>
        <div style={{ ...card, flex: '1 1 280px', marginBottom: 0 }}>
          <h2 style={h2}>Good to know</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: TEXT.body, display: 'grid', gap: 6 }}>
            <li>Already installed? Running a newer installer upgrades it in place — your sign-in stays.</li>
            <li>Inside the app, the refresh icon next to the bell (or F5) reloads the page; Alt shows the menu (Home, Back, Zoom, Open in Browser).</li>
            <li>Word / SharePoint documents still open in your normal browser.</li>
          </ul>
        </div>
      </div>

      <div style={card}>
        <h2 style={h2}>How to install</h2>
        <p style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>
          <Warning size={16} color="#d97706" aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
          The app is made by the company and is not sold publicly, so Windows doesn&apos;t know it and shows safety warnings the first time. Steps 2–4 explain how to get past them.
        </p>
        {PHASES.map((phase, pi) => (
          <div key={phase.title}>
            <h3 style={h3}>{phase.title}</h3>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: 14, alignItems: 'stretch' }}>
              {phase.steps.map((s, si) => {
                const n = FIRST_STEP[pi] + si
                return (
                  <li key={s.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.7)', border: '1px solid #eef2f7', minWidth: 0 }}>
                    {/* ui-audit-ignore-next-line custom-pill - round step number (1, 2, 3), not a status badge */}
                    <span aria-hidden style={{ width: 28, height: 28, borderRadius: 999, background: '#fff7ed', color: '#c2410c', fontWeight: 700, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{n}</span>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading }}>{s.title}</div>
                      <div style={{ fontSize: 13, color: TEXT.body, marginTop: 2 }}>{s.text}</div>
                      </div>
                      {s.img && (
                        // eslint-disable-next-line @next/next/no-img-element -- small static screenshot from public/
                        <img src={`/windows-app-guide/${s.img}`} alt={`Screenshot: ${s.title}`} loading="lazy"
                          style={{ display: 'block', maxWidth: '100%', width: 'auto', maxHeight: 260, objectFit: 'contain', borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(15,23,42,0.06)' }} />
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        ))}
      </div>

    </div>
  )
}
