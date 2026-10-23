'use client'

// Generic "Import from CSV / Excel" popup: download the template, pick a
// file, upload, then show what was added / skipped and why. The caller turns
// its API's result into `summary` lines + `errors`.

import { useRef, useState } from 'react'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { TEXT, GLASS, BRAND } from '@/lib/theme'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { extractErrorMessages } from '@/lib/validation'
import { createPortal } from 'react-dom'

export interface ImportOutcome {
  summary: string[]
  errors: { where: string; reason: string }[]
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function ImportDialog({ title, intro, templateName, getTemplate, upload, onClose, onImported }: {
  title: string
  intro: React.ReactNode
  templateName: string
  getTemplate: () => Promise<Blob>
  upload: (file: File) => Promise<ImportOutcome>
  onClose: () => void
  onImported?: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportOutcome | null>(null)
  const [error, setError] = useState('')
  const close = () => { if (!busy) onClose() }
  useEscapeKey(true, close)

  const template = async () => {
    try {
      saveBlob(await getTemplate(), templateName)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not download the template — try again.').join(' '))
    }
  }

  const run = async () => {
    const f = fileRef.current?.files?.[0]
    if (!f) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      setResult(await upload(f))
      onImported?.()
    } catch (err) {
      setError(extractErrorMessages(err, 'Import failed — check the file against the template and try again.').join(' '))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
      setFileName('')
    }
  }

  if (typeof document === 'undefined') return null
  // Portal to <body>: a glass card (backdrop-filter) would otherwise trap the
  // fixed backdrop inside itself instead of covering the screen.
  return createPortal(
    <div onClick={close} className="dialog-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="dialog-panel" style={{ width: '100%', maxWidth: result ? 760 : 560, maxHeight: '90vh', overflow: 'auto', background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>{title}</h2>
        <div style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 14px' }}>{intro}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" style={secondaryBtnStyle} onClick={template}>Download template</button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx" onChange={(e) => setFileName(e.target.files?.[0]?.name || '')} style={{ fontSize: 13 }} />
        </div>
        {error && (
          <div style={{ padding: '10px 14px', marginTop: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>
        )}
        {result && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, marginBottom: 10 }}>
              {result.summary.map((line) => <span key={line} style={{ color: '#16a34a', fontWeight: 600 }}>{line}</span>)}
              <span style={{ color: result.errors.length ? '#dc2626' : TEXT.muted }}>Skipped: <b>{result.errors.length}</b></span>
            </div>
            {result.errors.length > 0 && (
              <div style={{ maxHeight: 240, overflow: 'auto', border: `1px solid ${BRAND.primary}22`, borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: `${BRAND.primary}0d` }}>
                    <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, color: TEXT.muted }}>Where</th>
                    <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, color: TEXT.muted }}>Why it was skipped</th>
                  </tr></thead>
                  <tbody>
                    {result.errors.map((e, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${GLASS.border}` }}>
                        <td style={{ padding: '5px 10px', fontSize: 12.5, whiteSpace: 'nowrap' }}>{e.where}</td>
                        <td style={{ padding: '5px 10px', fontSize: 12.5, color: '#dc2626' }}>{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button type="button" style={secondaryBtnStyle} onClick={close} disabled={busy}>{result ? 'Done' : 'Cancel'}</button>
          <button type="button" style={{ ...primaryBtnStyle, opacity: fileName && !busy ? 1 : 0.5 }} disabled={!fileName || busy} onClick={run}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
