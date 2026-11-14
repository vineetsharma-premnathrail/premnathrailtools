'use client'

// "Premnath ERP for Android" — any signed-in employee downloads the private
// Android app here (phone or laptop). The button is a plain browser download of
// our API URL (sign-in cookie); the server redirects to a temporary file link.
// The app updates itself after the first install.

import { useCallback, useEffect, useState } from 'react'
import { AndroidLogo, DownloadSimple, ShieldCheck, Copy, Check } from '@phosphor-icons/react'
import { useProtectedPage } from '@/hooks/useAuth'
import { iconBtnStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { GLASS, SHADOWS, TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatFileSize, formatReleaseDate, mobileAppApi, type MobileAppLatest } from '@/lib/mobileAppApi'

const card: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 12px' }
const PAGE_PATH = '/dashboard/app'

const STEPS: { title: string; text: string }[] = [
  { title: 'Download', text: 'Open this page on your Android phone and tap “Download for Android”. The browser saves the app file (.apk) to Downloads.' },
  { title: 'Allow the install (first time only)', text: 'Open the downloaded file. If Android says “For your security, your phone is not allowed to install unknown apps”, tap Settings and turn on “Allow from this source” for your browser (Chrome) or the Files app, then go back.' },
  { title: 'Install and log in', text: 'Tap Install, open Premnath ERP and tap “Login with Microsoft” with your company account.' },
]

export default function AndroidAppPage() {
  const { isAuthorized, isLoading } = useProtectedPage()
  const [latest, setLatest] = useState<MobileAppLatest | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [started, setStarted] = useState(false)
  const [copied, setCopied] = useState(false)
  const [shaCopied, setShaCopied] = useState(false)

  // State is set only in the promise callbacks (never synchronously inside the effect).
  const load = useCallback(() => mobileAppApi.latest()
    .then((r) => { setLatest(r); setLoaded(true); setLoadError('') })
    .catch((e) => setLoadError(extractErrorMessages(e, 'Could not check the latest app version.').join(' '))), [])
  useEffect(() => { if (isAuthorized) void load() }, [isAuthorized, load])

  if (isLoading || !isAuthorized) return null

  const copyUrl = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}${PAGE_PATH}`); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked: the URL is on screen */ }
  }

  const copySha = async () => {
    if (!latest?.sha256) return
    try { await navigator.clipboard.writeText(latest.sha256); setShaCopied(true); setTimeout(() => setShaCopied(false), 1500) } catch { /* clipboard blocked: the code is on screen */ }
  }

  // Client-only: nothing renders before the sign-in check, so no server/client mismatch.
  const pageUrl = typeof window === 'undefined' ? PAGE_PATH : `${window.location.host}${PAGE_PATH}`

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <span style={{ width: 46, height: 46, borderRadius: 12, background: '#16a34a', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <AndroidLogo size={26} color="#fff" aria-hidden />
        </span>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Premnath ERP for Android</h1>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: '2px 0 0' }}>The company&apos;s own ERP app for your phone. Not on the Play Store — install it from here.</p>
        </div>
      </div>

      <div style={card} data-tour="app-download-card">
        {loadError && (
          <div role="alert" style={{ color: '#b91c1c', fontSize: 13 }}>
            Could not check the latest version: {loadError}{' '}
            <button type="button" style={{ ...secondaryBtnStyle, marginLeft: 8 }} onClick={() => void load()}>Try again</button>
          </div>
        )}
        {!loadError && !loaded && <p style={{ margin: 0, color: TEXT.muted, fontSize: 13 }}>Checking the latest version…</p>}
        {!loadError && loaded && !latest && (
          <div style={{ textAlign: 'center', padding: '18px 8px' }}>
            <AndroidLogo size={40} color="#a8a29e" aria-hidden />
            <h2 style={{ ...h2, margin: '10px 0 6px' }}>The Android app is not published yet</h2>
            <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>
              Your portal admin has not uploaded a version yet. Please check this page again later, or ask your admin when it will be available.
            </p>
          </div>
        )}
        {!loadError && latest && (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: TEXT.secondary }}>Latest version</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading }}>{latest.version_name}</div>
                <div style={{ fontSize: 12.5, color: TEXT.secondary }}>
                  Released {formatReleaseDate(latest.released_at)} · {formatFileSize(latest.file_size)}
                </div>
              </div>
              {/* Plain top-level navigation (not XHR): the server redirects to a temporary
                  file link, and the browser's own download manager handles the big file. */}
              <a href={mobileAppApi.downloadUrl(latest.id)} download={`PremnathERP-${latest.version_name}.apk`}
                data-tour="app-download-btn" onClick={() => setStarted(true)}
                style={{ ...primaryBtnStyle, minHeight: 48, padding: '0 22px', fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
                <DownloadSimple size={20} aria-hidden />
                Download for Android
              </a>
            </div>
            {started && (
              <p role="status" style={{ fontSize: 13, color: TEXT.body, margin: '12px 0 0' }}>
                Your download starts in the browser… Check the browser&apos;s downloads (on a phone: the notification bar or the Files app › Downloads), then open the file to install.
                If nothing downloads, tap the button again; if it still fails, tell your portal admin.
              </p>
            )}
            {latest.sha256 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12.5, color: TEXT.secondary, marginBottom: 4 }}>Security check (optional): this code identifies the genuine file.</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, color: TEXT.body, padding: '6px 10px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', wordBreak: 'break-all', minWidth: 0 }}>SHA-256 {latest.sha256}</code>
                  <button type="button" onClick={copySha} aria-label={shaCopied ? 'SHA-256 copied' : 'Copy SHA-256'} title={shaCopied ? 'Copied' : 'Copy SHA-256'} style={{ ...iconBtnStyle, flexShrink: 0 }}>
                    {shaCopied ? <Check size={16} color="#16a34a" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>
            )}
            {latest.notes && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, marginBottom: 4 }}>What&apos;s new</div>
                <p style={{ fontSize: 13, color: TEXT.body, margin: 0, whiteSpace: 'pre-wrap' }}>{latest.notes}</p>
              </div>
            )}
            <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.secondary, margin: '16px 0 0' }}>
              <ShieldCheck size={16} color="#16a34a" aria-hidden />
              Install once — after that the app updates itself whenever a new version is published.
            </p>
          </>
        )}
      </div>

      <div style={card}>
        <h2 style={h2}>How to install</h2>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 14 }}>
          {STEPS.map((s, i) => (
            <li key={s.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {/* ui-audit-ignore-next-line custom-pill - round step number (1, 2, 3), not a status badge */}
              <span aria-hidden style={{ width: 28, height: 28, borderRadius: 999, background: '#fff7ed', color: '#c2410c', fontWeight: 700, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading }}>{s.title}</div>
                <div style={{ fontSize: 13, color: TEXT.body, marginTop: 2 }}>{s.text}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div style={card}>
        <h2 style={h2}>On a laptop? Open this page on your phone</h2>
        <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 10px' }}>Type this address in your phone&apos;s browser (Chrome) and log in with your company account:</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <code style={{ fontSize: 16, fontWeight: 600, color: TEXT.heading, padding: '8px 12px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0', wordBreak: 'break-all' }}>{pageUrl}</code>
          <button type="button" onClick={copyUrl} aria-label={copied ? 'Address copied' : 'Copy address'} title={copied ? 'Copied' : 'Copy address'} style={iconBtnStyle}>
            {copied ? <Check size={16} color="#16a34a" /> : <Copy size={16} />}
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '10px 0 0' }}>Android phones only. iPhones are not supported.</p>
      </div>
    </div>
  )
}
