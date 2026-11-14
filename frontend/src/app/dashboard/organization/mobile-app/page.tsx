'use client'

// Organization › Mobile App (portal admins only). Publish versions of the
// private Android app: the APK goes to the server, which stores it with the
// other ERP files and computes its SHA-256. Phones check for the newest active
// version on start and every few hours and update themselves.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Copy, Check } from '@phosphor-icons/react'
import { useRequireAdmin } from '@/hooks/useAuth'
import OrganizationNav from '@/components/organization/OrganizationNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import MessageDialog from '@/components/erp/MessageDialog'
import Checkbox from '@/components/Checkbox'
import { FormSheet, FileDropZone, SheetError, SheetField, sheetBtn, sheetInput, sheetHint, Optional } from '@/components/shared/FormSheet'
import { Pill, RowCount, TableScroll, iconBtnStyle, primaryBtnStyle, secondaryBtnStyle, smallSecondaryBtnStyle, smallDangerBtnStyle, tableStyle, thStyle, tdStyle, numThStyle, numTdStyle } from '@/components/shared/ui'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatFileSize, formatReleaseDate, mobileAppApi, type MobileAppRelease } from '@/lib/mobileAppApi'

const helper: React.CSSProperties = { fontSize: 13, color: TEXT.secondary, margin: '0 0 14px' }

function ProgressBar({ fraction, label }: { fraction: number | null; label: string }) {
  const pct = fraction == null ? null : Math.round(fraction * 100)
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: TEXT.secondary, marginBottom: 6 }}>
        <span>{label}</span><span>{pct == null ? '' : `${pct}%`}</span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}
        style={{ height: 8, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct ?? 100}%`, background: '#2563eb', opacity: pct == null ? 0.4 : 1, transition: 'width .2s' }} />
      </div>
    </div>
  )
}

function ShaCell({ sha }: { sha: string }) {
  const [copied, setCopied] = useState(false)
  if (!sha) return <>—</>
  const copy = async () => {
    try { await navigator.clipboard.writeText(sha); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked: the full value is in the tooltip */ }
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={sha}>
      <code style={{ fontSize: 12 }}>{sha.slice(0, 8)}…{sha.slice(-4)}</code>
      <button type="button" onClick={copy} aria-label={copied ? 'SHA-256 copied' : 'Copy full SHA-256'} title={copied ? 'Copied' : 'Copy full SHA-256'}
        style={{ ...iconBtnStyle, width: 28, height: 28, minHeight: 28 }}>
        {copied ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
      </button>
    </span>
  )
}

function parseCode(v: string): number | null {
  if (!v.trim()) return null
  const n = Number(v)
  return Number.isInteger(n) ? n : NaN
}

export default function MobileAppAdminPage() {
  const { isAuthorized, isLoading } = useRequireAdmin()
  const [rows, setRows] = useState<MobileAppRelease[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [publishOpen, setPublishOpen] = useState(false)
  const [editing, setEditing] = useState<MobileAppRelease | null>(null)
  const [deleting, setDeleting] = useState<MobileAppRelease | null>(null)
  const [deactivating, setDeactivating] = useState<MobileAppRelease | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  // State is set only in the promise callbacks (never synchronously inside the effect).
  const load = useCallback(() => mobileAppApi.list()
    .then((list) => {
      setRows([...list].sort((a, b) => a.version_code - b.version_code))
      setLoaded(true); setLoadError('')
    })
    .catch((e) => setLoadError(extractErrorMessages(e, 'Could not load the app versions.').join(' '))), [])
  useEffect(() => { if (isAuthorized) void load() }, [isAuthorized, load])

  const highestCode = useMemo(() => rows.reduce((m, r) => Math.max(m, r.version_code), 0), [rows])
  const newestActive = useMemo(() => [...rows].filter((r) => r.is_active).sort((a, b) => b.version_code - a.version_code)[0] ?? null, [rows])

  if (isLoading || !isAuthorized) return null

  const setActive = async (r: MobileAppRelease, active: boolean) => {
    setBusyId(r.id)
    try {
      await mobileAppApi.update(r.id, { is_active: active })
      setNotice(active
        ? `Version ${r.version_name} is active again. Phones and the download page get the newest active version.`
        : `Version ${r.version_name} is no longer offered to phones or on the download page.`)
      await load()
    } catch (e) {
      setError(extractErrorMessages(e, `Could not ${active ? 'activate' : 'deactivate'} version ${r.version_name}.`).join(' '))
    } finally { setBusyId(null) }
  }

  const doDelete = async () => {
    const r = deleting; setDeleting(null)
    if (!r) return
    setBusyId(r.id)
    try {
      await mobileAppApi.remove(r.id)
      setNotice(`Version ${r.version_name} (code ${r.version_code}) was deleted.`)
      await load()
    } catch (e) {
      setError(extractErrorMessages(e, `Could not delete version ${r.version_name}.`).join(' '))
    } finally { setBusyId(null) }
  }

  const fallbackAfter = (r: MobileAppRelease) => {
    const next = [...rows].filter((x) => x.is_active && x.id !== r.id).sort((a, b) => b.version_code - a.version_code)[0]
    return next ? `version ${next.version_name} (code ${next.version_code})` : 'nothing (the download page shows "not published yet")'
  }
  const deleteMessage = deleting
    ? `The APK of ${deleting.version_name} (code ${deleting.version_code}) is removed for good and cannot be downloaded again. Phones that already installed it keep working.`
      + (deleting.is_active && newestActive?.id === deleting.id ? ` Phones and the download page will then be offered ${fallbackAfter(deleting)}.` : '')
    : ''
  const deactivateMessage = deactivating
    ? `Phones will no longer be offered ${deactivating.version_name} and the download page stops showing it.`
      + (newestActive?.id === deactivating.id ? ` The newest version offered becomes ${fallbackAfter(deactivating)}.` : '')
      + ' Phones that already installed it keep it. You can activate it again later.'
    : ''

  return (
    <div>
      <OrganizationNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Mobile App</h1>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/dashboard/app" style={{ ...secondaryBtnStyle, textDecoration: 'none' }}>Open download page</Link>
          <button type="button" data-tour="mobile-app-publish" style={primaryBtnStyle} onClick={() => setPublishOpen(true)}>+ Publish new version</button>
        </div>
      </div>
      <p style={helper}>Phones update themselves after a version is published: the app checks on start and every 6 hours and installs the newest active version.</p>

      <MessageDialog open={!!error} variant="error" title="Mobile App" message={error} onClose={() => setError('')} />
      <MessageDialog open={!!notice} variant="success" title="Done" message={notice} onClose={() => setNotice('')} />
      <ConfirmDialog open={!!deleting} title={deleting ? `Delete version ${deleting.version_name}?` : ''} confirmLabel="Delete version"
        message={deleteMessage} onConfirm={doDelete} onCancel={() => setDeleting(null)} />
      <ConfirmDialog open={!!deactivating} title={deactivating ? `Deactivate version ${deactivating.version_name}?` : ''} confirmLabel="Deactivate"
        message={deactivateMessage}
        onConfirm={() => { const r = deactivating; setDeactivating(null); if (r) void setActive(r, false) }}
        onCancel={() => setDeactivating(null)} />

      <TableScroll minWidth={1080}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Version<RowCount count={rows.length} /></th>
              <th style={numThStyle}>Code</th>
              <th style={thStyle}>What&apos;s new</th>
              <th style={thStyle}>Update</th>
              <th style={thStyle}>Active</th>
              <th style={numThStyle}>Size</th>
              <th style={thStyle}>SHA-256</th>
              <th style={thStyle}>Uploaded</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loadError && (
              <tr><td colSpan={9} role="alert" style={{ ...tdStyle, color: '#b91c1c' }}>
                The versions could not be loaded: {loadError}{' '}
                <button type="button" style={{ ...secondaryBtnStyle, marginLeft: 8 }} onClick={() => void load()}>Try again</button>
              </td></tr>
            )}
            {!loadError && !loaded && <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>}
            {!loadError && loaded && rows.length === 0 && (
              <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No version published yet. Use “+ Publish new version” to upload the first APK.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>
                  {r.version_name}
                  {newestActive?.id === r.id && <div style={{ fontSize: 11.5, color: '#16a34a', fontWeight: 600 }}>Offered to phones now</div>}
                </td>
                <td style={numTdStyle}>{r.version_code}</td>
                <td style={{ ...tdStyle, maxWidth: 320, whiteSpace: 'pre-wrap' }}>{r.notes || '—'}</td>
                <td style={tdStyle}>
                  {r.required ? <Pill label="Required" hex="#DC2626" /> : <Pill label="Optional" hex="#78716c" />}
                  {r.min_supported_version_code ? <div style={{ fontSize: 11.5, color: TEXT.secondary, marginTop: 4 }}>Min supported: {r.min_supported_version_code}</div> : null}
                </td>
                <td style={tdStyle}>
                  <Checkbox asSwitch checked={r.is_active} disabled={busyId === r.id}
                    aria-label={`${r.is_active ? 'Deactivate' : 'Activate'} version ${r.version_name}`}
                    onChange={(e) => { if (e.target.checked) void setActive(r, true); else setDeactivating(r) }} />
                </td>
                <td style={numTdStyle}>{formatFileSize(r.file_size)}</td>
                <td style={tdStyle}><ShaCell sha={r.sha256} /></td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {r.uploaded_by_name || '—'}
                  <div style={{ fontSize: 11.5, color: TEXT.secondary }}>{formatReleaseDate(r.created_at || r.released_at)}</div>
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" style={smallSecondaryBtnStyle} disabled={busyId === r.id} onClick={() => setEditing(r)}>Edit</button>
                    <button type="button" style={smallDangerBtnStyle} disabled={busyId === r.id} onClick={() => setDeleting(r)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      {publishOpen && (
        <PublishSheet highestCode={highestCode} onClose={() => setPublishOpen(false)}
          onDone={async (r) => { setPublishOpen(false); setNotice(`Version ${r.version_name} (code ${r.version_code}) is published. Phones pick it up on their next check (app start or within 6 hours).`); await load() }} />
      )}
      {editing && (
        <EditSheet release={editing} onClose={() => setEditing(null)}
          onDone={async () => { setEditing(null); await load() }} />
      )}
    </div>
  )
}

function PublishSheet({ highestCode, onClose, onDone }: { highestCode: number; onClose: () => void; onDone: (r: MobileAppRelease) => void | Promise<void> }) {
  const [files, setFiles] = useState<File[]>([])
  const [versionName, setVersionName] = useState('')
  const [versionCode, setVersionCode] = useState(String(highestCode + 1))
  const [notes, setNotes] = useState('')
  const [required, setRequired] = useState(false)
  const [minSupported, setMinSupported] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  const submit = async () => {
    const problems: string[] = []
    const file = files[0]
    if (!file) problems.push('APK file: pick the .apk built for this version.')
    else if (!file.name.toLowerCase().endsWith('.apk')) problems.push(`APK file: "${file.name}" is not an .apk file. Pick the Android build file ending in .apk.`)
    if (!versionName.trim()) problems.push('Version name: type the version shown to people, e.g. 1.4.0.')
    const code = parseCode(versionCode)
    if (code == null || Number.isNaN(code) || code < 1) problems.push('Version code: type a whole number, e.g. ' + (highestCode + 1) + '.')
    else if (code <= highestCode) problems.push(`Version code: must be higher than ${highestCode} (the highest published so far), or phones will not see it as an update. Use ${highestCode + 1} or more.`)
    const min = parseCode(minSupported)
    if (min != null && (Number.isNaN(min) || min < 1)) problems.push('Min supported version code: type a whole number or leave it empty.')
    else if (min != null && code != null && !Number.isNaN(code) && min > code) problems.push(`Min supported version code: cannot be higher than this version's code (${code}).`)
    setErrors(problems)
    if (problems.length || !file || code == null) return
    setBusy(true); setProgress(0)
    try {
      const r = await mobileAppApi.publish({
        file, version_name: versionName.trim(), version_code: code, notes: notes.trim(), required,
        min_supported_version_code: min,
      }, setProgress)
      await onDone(r)
    } catch (e) {
      setErrors(extractErrorMessages(e, 'The version could not be published. Check the file and try again.'))
    } finally { setBusy(false); setProgress(null) }
  }

  return (
    <FormSheet icon="upload" title="Publish new version" subtitle="Upload the APK; phones update themselves after it is published."
      onClose={onClose} busy={busy} width={620} onSubmit={submit} tour="mobile-app-publish-form"
      footer={<>
        <button type="button" style={sheetBtn('secondary')} disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" style={sheetBtn('primary', undefined, busy)} disabled={busy}>{busy ? 'Publishing…' : 'Publish'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={errors} />
        <p role="note" style={{ fontSize: 12.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '8px 12px', margin: '0 0 14px' }}>
          Version code must match the app file&apos;s own version code (the +N in the app version), otherwise phones will refuse the update.
        </p>
        <div style={{ marginBottom: 16 }}>
          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>APK file <span aria-hidden="true" style={{ color: '#be123c' }}>*</span></span>
          <FileDropZone files={files} onChange={setFiles} accept=".apk" max={1} hint=".apk · one file" tour="mobile-app-apk" />
        </div>
        <div className="ui-cols" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 16 }}>
          <SheetField label="Version name" required hint="Shown to people, e.g. 1.4.0.">
            <input style={sheetInput} value={versionName} onChange={(e) => setVersionName(e.target.value)} placeholder="1.4.0" disabled={busy} />
          </SheetField>
          <SheetField label="Version code" required hint={`Whole number, higher than ${highestCode}. Must match the build.`}>
            <input style={sheetInput} type="number" min={highestCode + 1} step={1} value={versionCode} onChange={(e) => setVersionCode(e.target.value)} disabled={busy} />
          </SheetField>
        </div>
        <SheetField label={<>What&apos;s new <Optional /></>} hint="Shown on the download page and in the app's update screen." style={{ marginBottom: 16 }}>
          <textarea style={{ ...sheetInput, minHeight: 90, resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy}
            placeholder="e.g. Store: faster item search. Fixes for photo upload." />
        </SheetField>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, alignItems: 'start' }}>
          <div>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }} id="mobile-app-required-label">Update required</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 34 }}>
              <Checkbox asSwitch checked={required} disabled={busy} aria-labelledby="mobile-app-required-label" onChange={(e) => setRequired(e.target.checked)} />
              <span style={{ fontSize: 13 }}>{required ? 'Yes' : 'No'}</span>
            </div>
            <p style={sheetHint}>Yes = older phones are blocked with &quot;Please update to continue&quot; until they update.</p>
          </div>
          <SheetField label={<>Min supported version code <Optional /></>} hint="Phones below this code must update, even when the update is not required.">
            <input style={sheetInput} type="number" min={1} step={1} value={minSupported} onChange={(e) => setMinSupported(e.target.value)} disabled={busy} />
          </SheetField>
        </div>
        {busy && <ProgressBar fraction={progress != null && progress >= 1 ? null : progress} label={progress != null && progress >= 1 ? 'Uploaded, the server is checking and storing the file…' : 'Uploading APK…'} />}
      </div>
    </FormSheet>
  )
}

function EditSheet({ release, onClose, onDone }: { release: MobileAppRelease; onClose: () => void; onDone: () => void | Promise<void> }) {
  const [notes, setNotes] = useState(release.notes || '')
  const [required, setRequired] = useState(release.required)
  const [minSupported, setMinSupported] = useState(release.min_supported_version_code ? String(release.min_supported_version_code) : '')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const submit = async () => {
    const min = parseCode(minSupported)
    if (min != null && (Number.isNaN(min) || min < 1)) { setErrors(['Min supported version code: type a whole number or leave it empty.']); return }
    if (min != null && min > release.version_code) { setErrors([`Min supported version code: cannot be higher than this version's code (${release.version_code}).`]); return }
    setBusy(true); setErrors([])
    try {
      await mobileAppApi.update(release.id, { notes: notes.trim() || null, required, min_supported_version_code: min })
      await onDone()
    } catch (e) {
      setErrors(extractErrorMessages(e, `Could not save version ${release.version_name}.`))
    } finally { setBusy(false) }
  }

  return (
    <FormSheet icon="edit" title={`Edit version ${release.version_name}`} subtitle={`Version code ${release.version_code}. The APK itself cannot be changed; publish a new version instead.`}
      onClose={onClose} busy={busy} width={560} onSubmit={submit}
      footer={<>
        <button type="button" style={sheetBtn('secondary')} disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" style={sheetBtn('primary', undefined, busy)} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={errors} />
        <SheetField label={<>What&apos;s new <Optional /></>} style={{ marginBottom: 16 }}>
          <textarea style={{ ...sheetInput, minHeight: 90, resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
        </SheetField>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, alignItems: 'start' }}>
          <div>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }} id="mobile-app-edit-required-label">Update required</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 34 }}>
              <Checkbox asSwitch checked={required} disabled={busy} aria-labelledby="mobile-app-edit-required-label" onChange={(e) => setRequired(e.target.checked)} />
              <span style={{ fontSize: 13 }}>{required ? 'Yes' : 'No'}</span>
            </div>
            <p style={sheetHint}>Yes = older phones are blocked until they update.</p>
          </div>
          <SheetField label={<>Min supported version code <Optional /></>} hint="Phones below this code must update.">
            <input style={sheetInput} type="number" min={1} step={1} value={minSupported} onChange={(e) => setMinSupported(e.target.value)} disabled={busy} />
          </SheetField>
        </div>
      </div>
    </FormSheet>
  )
}
