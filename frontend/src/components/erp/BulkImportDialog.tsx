'use client'

import { useRef, useState } from 'react'
import { erpApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { useEscapeKey } from '@/hooks/useEscapeKey'

interface ImportResult {
  created: { row: number; id: number; ref: string; name: string; detail: string }[]
  existing: { row: number; key: string; existing_ref: string | null; existing_label: string; reason: string }[]
  errors: { row: number; key: string; reason: string }[]
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', position: 'sticky', top: 0 }
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, color: TEXT.body, borderTop: '1px solid rgba(0,0,0,0.05)' }

function Block({ title, color, count, children }: { title: string; color: string; count: number; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color, margin: '0 0 6px' }}>{title} ({count})</p>
      {count > 0 && (
        <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>{children}</table>
        </div>
      )}
    </div>
  )
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

const COPY = {
  projects: {
    title: 'Import Machines',
    noun: 'machine',
    refLabel: 'Serial No.',
    keyLabel: 'Serial in file',
    template: 'machines_import_template.csv',
    report: 'machine_import_report.csv',
    help: (
      <>
        Upload a CSV or Excel file with the template&apos;s columns — only <b>serial_number</b> is required.
        A machine whose serial number is already registered (ignoring case and spaces, Recycle Bin included) is <b>not saved</b>.
        A new serial whose engine or chassis number already belongs to another machine is flagged as a problem.
        Tip: Export, edit and import the same sheet back — existing machines are skipped, never overwritten.
      </>
    ),
  },
  'service-requests': {
    title: 'Import Service Requests',
    noun: 'service request',
    refLabel: 'SR Number',
    keyLabel: 'Machine — Issue',
    template: 'service_requests_import_template.csv',
    report: 'service_request_import_report.csv',
    help: (
      <>
        Upload a CSV or Excel file — <b>machine_serial_number</b>, <b>issue_title</b> and <b>service_type</b> are required.
        Use it for new SRs (status Open) or for old SRs from the previous system (status Closed with Corrective Action, dates and costs).
        A row is a duplicate — and <b>not saved</b> — when its old_sr_number was already imported, or the same machine already has an SR
        with the same issue title on the same reported date. SR numbers are generated automatically; no client emails are sent.
      </>
    ),
  },
} as const

/** Bulk import for Machines / Service Requests: duplicates are skipped and
 *  listed next to the record they matched, problems are listed with how to
 *  fix them, and the whole result can be downloaded as a report. */
export default function BulkImportDialog({ kind, open, onClose, onImported }: {
  kind: 'projects' | 'service-requests'; open: boolean; onClose: () => void; onImported: () => void
}) {
  const copy = COPY[kind]
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)

  const close = () => {
    if (busy) return
    setFile(null); setError(''); setResult(null)
    onClose()
  }
  useEscapeKey(open, close)
  if (!open) return null

  const downloadTemplate = async () => {
    try {
      saveBlob(await erpApi.downloadImportTemplate(kind), copy.template)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not download the template.').join(' '))
    }
  }

  const upload = async () => {
    if (!file) { setError('Choose a .csv or .xlsx file first.'); return }
    setBusy(true); setError('')
    try {
      const res: ImportResult = await erpApi.bulkImport(kind, file)
      setResult(res)
      if (res.created.length) onImported()
    } catch (err) {
      setError(extractErrorMessages(err, 'Import failed.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  const downloadReport = () => {
    if (!result) return
    const rows: (string | number)[][] = [
      ...result.created.map((r) => [r.row, 'Saved', r.name || r.ref, r.ref, r.detail]),
      ...result.existing.map((r) => [r.row, 'Duplicate — not saved', r.key, r.existing_label, r.reason]),
      ...result.errors.map((r) => [r.row, 'Problem — not saved', r.key, '', r.reason]),
    ].sort((a, b) => Number(a[0]) - Number(b[0]))
    const lines = [['Row', 'Result', copy.keyLabel, 'Matched / Saved As', 'Reason'], ...rows].map((r) => r.map(csvCell).join(','))
    saveBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), copy.report)
  }

  const plural = (n: number) => `${n} ${copy.noun}${n === 1 ? '' : 's'}`

  return (
    <div onClick={close} className="dialog-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="dialog-panel" style={{ width: '100%', maxWidth: result ? 820 : 500, maxHeight: '90vh', overflow: 'auto', background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
        <p style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: '0 0 6px' }}>{copy.title}</p>

        {!result ? (
          <>
            <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 14px', lineHeight: 1.6 }}>{copy.help}</p>
            <button type="button" onClick={downloadTemplate} style={{ ...secondaryBtnStyle, marginBottom: 14 }}>Download template</button>
            <div
              onClick={() => fileRef.current?.click()}
              style={{ border: '1.5px dashed rgba(0,0,0,0.18)', borderRadius: 12, padding: '18px 14px', textAlign: 'center', cursor: 'pointer', fontSize: 13, color: file ? TEXT.heading : TEXT.muted, marginBottom: 14 }}
            >
              {file ? file.name : 'Click to choose a .csv or .xlsx file'}
            </div>
            <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={(e) => { setFile(e.target.files?.[0] || null); setError('') }} />
            {error && <p style={{ fontSize: 12.5, color: '#dc2626', margin: '0 0 12px' }}>{error}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" style={secondaryBtnStyle} onClick={close} disabled={busy}>Cancel</button>
              <button type="button" style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }} onClick={upload} disabled={busy}>{busy ? 'Importing…' : 'Import'}</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 16px' }}>
              {plural(result.created.length)} saved · {result.existing.length} duplicate{result.existing.length === 1 ? '' : 's'} (not saved)
              {result.errors.length ? ` · ${result.errors.length} with problems (not saved)` : ''}
            </p>

            <Block title="Saved" color="#15803d" count={result.created.length}>
              <thead><tr><th style={th}>Row</th><th style={th}>{copy.refLabel}</th><th style={th}>{kind === 'projects' ? 'Model' : 'Issue'}</th><th style={th}>{kind === 'projects' ? 'Client' : 'Machine · Status'}</th></tr></thead>
              <tbody>{result.created.map((r) => (
                <tr key={r.row}><td style={td}>{r.row}</td><td style={{ ...td, fontWeight: 700 }}>{r.ref}</td><td style={td}>{r.name || '—'}</td><td style={td}>{r.detail || '—'}</td></tr>
              ))}</tbody>
            </Block>

            <Block title="Duplicates — not saved" color="#b45309" count={result.existing.length}>
              <thead><tr><th style={th}>Row</th><th style={th}>{copy.keyLabel}</th><th style={th}>Matches</th><th style={th}>Why</th></tr></thead>
              <tbody>{result.existing.map((r) => (
                <tr key={r.row}><td style={td}>{r.row}</td><td style={td}>{r.key}</td>
                  <td style={td}>{r.existing_ref ? <b>{r.existing_label}</b> : r.existing_label}</td><td style={td}>{r.reason}</td></tr>
              ))}</tbody>
            </Block>

            {result.errors.length > 0 && (
              <Block title="Problems — not saved" color="#dc2626" count={result.errors.length}>
                <thead><tr><th style={th}>Row</th><th style={th}>{copy.keyLabel}</th><th style={th}>Fix</th></tr></thead>
                <tbody>{result.errors.map((r) => (
                  <tr key={r.row}><td style={td}>{r.row}</td><td style={td}>{r.key || '—'}</td><td style={td}>{r.reason}</td></tr>
                ))}</tbody>
              </Block>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" style={secondaryBtnStyle} onClick={downloadReport}>Download report</button>
              <button type="button" style={secondaryBtnStyle} onClick={() => { setResult(null); setFile(null) }}>Import another file</button>
              <button type="button" style={primaryBtnStyle} onClick={close}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
