'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { WindowsLogo, DownloadSimple, UploadSimple } from '@phosphor-icons/react'
import { desktopAppApi, DesktopAppInfo } from '@/lib/desktopAppApi'
import { inDesktopApp } from '@/components/shared/DesktopRefreshButton'
import { FormSheet, SheetField, SheetError, FileDropZone, sheetBtn, sheetInput } from '@/components/shared/FormSheet'
import { smallSecondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT } from '@/lib/theme'

/** Windows app (owner, 2026-11-13): a small "Download" line in the profile menu
 *  (website and Teams; hidden inside the Windows app itself). The portal admin
 *  also gets "Upload", which opens the upload popup in DesktopAppUploadHost —
 *  the host lives outside the menu so closing the menu never cuts an upload. */
const OPEN_UPLOAD = 'desktop-app:open-upload'
const UPDATED = 'desktop-app:updated'

const mb = (n?: number | null) => (n ? `${(n / (1024 * 1024)).toFixed(0)} MB` : '')

// Loaded once when the page opens (by DesktopAppUploadHost), NOT when the menu
// opens: the profile menu closes when the mouse leaves it, and a line appearing
// after a fetch grew the menu and moved it from under the mouse (closed itself).
let cached: DesktopAppInfo | null = null
function loadInfo() {
  desktopAppApi.info()
    .then((d) => { cached = d })
    .catch(() => { cached = { available: false } })
    .finally(() => window.dispatchEvent(new Event(UPDATED)))
}

/** Opens the one-time upload popup (portal admin), from anywhere on the page. */
export function openDesktopAppUpload() {
  window.dispatchEvent(new Event(OPEN_UPLOAD))
}

export const WINDOWS_APP_PAGE = '/dashboard/windows-app'

export default function DesktopAppDownload({ isAdmin, onDone }: { isAdmin: boolean; onDone: () => void }) {
  const router = useRouter()
  // The menu only renders after a click (client side), so reading these at first render is safe.
  const [info, setInfo] = useState<DesktopAppInfo | null>(() => cached)
  const [hidden] = useState(() => inDesktopApp())

  useEffect(() => {
    const sync = () => setInfo(cached)
    window.addEventListener(UPDATED, sync)
    return () => window.removeEventListener(UPDATED, sync)
  }, [])

  if (hidden || !info || (!info.available && !isAdmin)) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ color: TEXT.muted, display: 'inline-flex' }}><WindowsLogo size={15} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: 0 }}>Windows app</p>
        <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {info.available ? `Version ${info.version}${info.file_size ? ` · ${mb(info.file_size)}` : ''}` : 'Not uploaded yet'}
        </p>
      </div>
      {/* Like the Android app: the download page carries the file and the install steps (owner, 2026-11-13). */}
      <button type="button" onClick={() => { onDone(); router.push(WINDOWS_APP_PAGE) }}
        title={info.available ? 'Download the Windows app and see how to install it' : 'Upload the Windows app installer (one time)'}
        style={smallSecondaryBtnStyle}>
        {info.available ? <><DownloadSimple size={13} /> Download</> : <><UploadSimple size={13} /> Upload</>}
      </button>
    </div>
  )
}

/** Mounted once in the Sidebar (outside the profile menu): loads the Windows app
 *  details when the page opens, and holds the upload popup for the portal admin. */
export function DesktopAppUploadHost({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (!inDesktopApp()) loadInfo() }, [])

  useEffect(() => {
    if (!isAdmin) return
    const show = () => { setOpen(true); setVersion(''); setFiles([]); setError(null) }
    window.addEventListener(OPEN_UPLOAD, show)
    return () => window.removeEventListener(OPEN_UPLOAD, show)
  }, [isAdmin])

  if (!open) return null

  const fromName = files[0]?.name.match(/(\d+\.\d+\.\d+)/)?.[1] || ''
  const submit = async () => {
    const v = (version || fromName).trim()
    if (!files[0]) { setError('Choose the Setup .exe file from the desktop app build (desktop/dist).'); return }
    if (!v) { setError('Fill in the version, e.g. 1.0.2 — it is in the file name and in desktop/package.json.'); return }
    setBusy(true)
    setError(null)
    try {
      await desktopAppApi.upload(v, files[0])
      loadInfo()
      setOpen(false)
    } catch (e) {
      setError(extractErrorMessages(e, 'The upload did not finish. Check your connection and try again.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet icon="upload" title="Upload Windows app" subtitle="Everyone downloads this file from their profile menu. It replaces the current one."
      onClose={() => setOpen(false)} busy={busy} width={560} onSubmit={submit}
      footer={<>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} style={sheetBtn('secondary')}>Cancel</button>
        <button type="submit" disabled={busy} style={sheetBtn('primary', undefined, busy)}>{busy ? 'Uploading…' : 'Upload'}</button>
      </>}>
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SheetError error={error} />
        <SheetField label="Installer file" required hint="The 'Premnathrail Portal Setup x.y.z.exe' made by npm run build in desktop/.">
          <FileDropZone files={files} onChange={setFiles} accept=".exe" max={1} hint=".exe only · up to 500 MB" />
        </SheetField>
        <SheetField label="Version" required hint="Taken from the file name when left empty.">
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder={fromName || 'e.g. 1.0.2'} style={sheetInput} />
        </SheetField>
      </div>
    </FormSheet>
  )
}
