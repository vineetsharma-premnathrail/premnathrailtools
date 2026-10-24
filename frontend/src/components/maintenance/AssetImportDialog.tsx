'use client'

import { useState } from 'react'
import axios from 'axios'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAssetImportResult } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SHEET, SheetIcon, SheetSection, sheetBtn } from '@/components/shared/FormSheet'

/** Excel import of the existing machine list: download template → choose
 * file → Validate (dry run, nothing saved) → Import (all-or-nothing, only
 * enabled once validation shows no errors). */

async function blobError(err: unknown, fallback: string): Promise<string> {
  if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
    try {
      const parsed = JSON.parse(await err.response.data.text())
      if (parsed?.detail) return String(parsed.detail)
    } catch { /* not JSON */ }
  }
  return extractErrorMessages(err, fallback).join(' ')
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', whiteSpace: 'nowrap', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', position: 'sticky', top: 0, zIndex: 1 }
const tdStyle: React.CSSProperties = { padding: '7px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }

export default function AssetImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<MaintenanceAssetImportResult | null>(null)
  const [busy, setBusy] = useState<'' | 'template' | 'validate' | 'import'>('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const close = () => {
    if (busy) return
    setFile(null); setResult(null); setError(''); setDone('')
    onClose()
  }
  useEscapeKey(open, close)
  if (!open) return null

  const downloadTemplate = async () => {
    setBusy('template'); setError('')
    try {
      const blob = await maintenanceApi.downloadAssetImportTemplate()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'maintenance_asset_import_template.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(await blobError(err, 'Could not download the template.'))
    } finally {
      setBusy('')
    }
  }

  const validate = async () => {
    if (!file) return
    setBusy('validate'); setError(''); setDone(''); setResult(null)
    try {
      setResult(await maintenanceApi.importAssets(file, true))
    } catch (err) {
      setError(extractErrorMessages(err, 'Validation failed.').join(' '))
    } finally {
      setBusy('')
    }
  }

  const runImport = async () => {
    if (!file) return
    setBusy('import'); setError('')
    try {
      const r = await maintenanceApi.importAssets(file, false)
      setDone(`${r.created} asset(s) imported into the register.`)
      setResult(null); setFile(null)
      onImported()
    } catch (err) {
      setError(extractErrorMessages(err, 'Import failed — nothing was saved.').join(' '))
    } finally {
      setBusy('')
    }
  }

  const canImport = !!file && !!result && result.error_rows === 0 && result.total_rows > 0 && !busy
  const badRows = result?.rows.filter((r) => r.errors.length) ?? []

  return (
    <FormSheet width={820} icon="upload" title="Import assets from Excel" onClose={close} busy={!!busy}
      subtitle="Load your existing machine list in one go. Validate first — nothing is saved until every row is correct, and then all rows are saved together."
      footer={<>
        <button type="button" onClick={close} disabled={!!busy} style={sheetBtn('secondary', SHEET.INK, !!busy)}>{done ? 'Close' : 'Cancel'}</button>
        <button data-tour="maint-import-validate" type="button" onClick={validate} disabled={!file || !!busy} style={sheetBtn('secondary', SHEET.INK, !file || !!busy)}>
          <SheetIcon name="check" size={16} />{busy === 'validate' ? 'Validating…' : 'Validate'}
        </button>
        <button data-tour="maint-import-run" type="button" onClick={runImport} disabled={!canImport} style={sheetBtn('primary', SHEET.BLUE, !canImport)}>
          <SheetIcon name="upload" size={16} />{busy === 'import' ? 'Importing…' : result && !result.error_rows ? `Import ${result.total_rows} asset(s)` : 'Import'}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {error}
          </div>
        )}
        {done && (
          <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#15803d', fontSize: 13 }}>
            {done}
          </div>
        )}

        <SheetSection icon="doc" title="Template & File">
          <ol style={{ fontSize: 13, color: SHEET.BODY, paddingLeft: 18, margin: 0, lineHeight: 1.9 }}>
            <li>
              <button data-tour="maint-import-template" type="button" onClick={downloadTemplate} disabled={!!busy} style={sheetBtn('secondary', SHEET.INK, !!busy)}>
                <SheetIcon name="doc" size={14} />{busy === 'template' ? 'Downloading…' : 'Download template'}
              </button>
              <span style={{ color: SHEET.MUTED }}> — one machine per row; the Instructions sheet lists the allowed categories, criticality and your plant names.</span>
            </li>
            <li>
              <input data-tour="maint-import-file" type="file" accept=".xlsx,.xlsm"
                onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); setDone(''); setError('') }}
                style={{ fontSize: 13 }} />
            </li>
            <li>Validate, fix any rows the check reports, then Import.</li>
          </ol>
        </SheetSection>

        {result && (
          <SheetSection icon="list" title="Validation result">
            <p style={{ fontSize: 13, margin: '0 0 8px', color: result.error_rows ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
              {result.error_rows
                ? `${result.error_rows} of ${result.total_rows} row(s) have errors — fix them in the file and validate again.`
                : `All ${result.total_rows} row(s) are valid and ready to import.`}
            </p>
            <div style={{ border: `1px solid ${SHEET.LINE}`, borderRadius: 12, overflow: 'auto', maxHeight: 320 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Row</th>
                    <th style={thStyle}>Asset code</th>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>{badRows.length ? 'Problems' : 'Plant · Category'}</th>
                  </tr>
                </thead>
                <tbody>
                  {(badRows.length ? badRows : result.rows).map((r) => (
                    <tr key={r.row}>
                      <td style={tdStyle}>{r.row}</td>
                      <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {r.asset_code || '—'}{r.auto_code && <span style={{ fontSize: 11, color: TEXT.muted, fontWeight: 400 }}> (auto)</span>}
                      </td>
                      <td style={tdStyle}>{r.name || '—'}</td>
                      <td style={tdStyle}>
                        {r.errors.length
                          ? <ul style={{ margin: 0, paddingLeft: 16, color: '#b91c1c' }}>{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                          : <span style={{ color: TEXT.muted }}>{r.plant} · {r.category}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SheetSection>
        )}
      </div>
    </FormSheet>
  )
}
