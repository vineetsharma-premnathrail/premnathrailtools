'use client'

import { useRef, useState } from 'react'
import { storeApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { useEscapeKey } from '@/hooks/useEscapeKey'

interface ImportResult {
  posted: { row: number; item_code: string; item_name: string; warehouse: string; entry_type: string; stock_effect: string; quantity: number; uom: string }[]
  would_post: number
  errors: { row: number; item_code: string; reason: string }[]
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', position: 'sticky', top: 0 }
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, color: TEXT.body, borderTop: '1px solid rgba(0,0,0,0.05)' }

/** Bulk stock entries (e.g. opening stock). All-or-nothing: if any row has a
 *  problem nothing is posted, so the fixed file can be uploaded again safely. */
export default function StockImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
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
      const blob = await storeApi.downloadStockImportTemplate()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'stock_entry_import_template.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not download the template.').join(' '))
    }
  }

  const upload = async () => {
    if (!file) { setError('Choose a .csv or .xlsx file first.'); return }
    setBusy(true); setError('')
    try {
      const res: ImportResult = await storeApi.importStock(file)
      setResult(res)
      if (res.posted.length) onImported()
    } catch (err) {
      setError(extractErrorMessages(err, 'Import failed.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  const failed = !!result && result.errors.length > 0

  return (
    <div onClick={close} className="dialog-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="dialog-panel" style={{ width: '100%', maxWidth: result ? 760 : 480, maxHeight: '90vh', overflow: 'auto', background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
        <p style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: '0 0 6px' }}>Import Stock Entries</p>

        {!result ? (
          <>
            <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 14px', lineHeight: 1.6 }}>
              Upload a CSV or Excel file with columns <b>item_code</b>, <b>warehouse</b> (code or name), <b>entry_type</b> (e.g. Receipt, Issue), <b>quantity</b>,
              vendor_name, batch_number, reference_number, transaction_date (YYYY-MM-DD, blank = today), remarks. Use it for opening stock or bulk receipts.
              If <b>any</b> row has a problem, <b>nothing is posted</b> — fix the rows listed and upload the same file again. Adjustments can&apos;t be imported.
            </p>
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
            <p style={{ fontSize: 13, color: failed ? '#dc2626' : '#15803d', fontWeight: 600, margin: '0 0 16px' }}>
              {failed
                ? `Nothing was posted — ${result.errors.length} row${result.errors.length === 1 ? ' has a problem' : 's have problems'}. ${result.would_post} other row${result.would_post === 1 ? ' was' : 's were'} fine. Fix the rows below and upload again.`
                : `${result.posted.length} stock entr${result.posted.length === 1 ? 'y' : 'ies'} posted.`}
            </p>

            <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                {failed ? (
                  <>
                    <thead><tr><th style={th}>Row</th><th style={th}>Item Code</th><th style={th}>Problem / Fix</th></tr></thead>
                    <tbody>{result.errors.map((r) => (
                      <tr key={r.row}><td style={td}>{r.row}</td><td style={{ ...td, fontWeight: 600 }}>{r.item_code || '—'}</td><td style={{ ...td, color: '#b91c1c' }}>{r.reason}</td></tr>
                    ))}</tbody>
                  </>
                ) : (
                  <>
                    <thead><tr><th style={th}>Row</th><th style={th}>Item</th><th style={th}>Store</th><th style={th}>Type</th><th style={th}>Quantity</th></tr></thead>
                    <tbody>{result.posted.map((r) => (
                      <tr key={r.row}><td style={td}>{r.row}</td><td style={td}><b>{r.item_code}</b> {r.item_name}</td><td style={td}>{r.warehouse}</td>
                        <td style={td}>{r.entry_type}</td><td style={{ ...td, fontWeight: 600, color: r.stock_effect === 'in' ? '#15803d' : '#b45309' }}>{r.stock_effect === 'in' ? '+' : '−'}{r.quantity} {r.uom}</td></tr>
                    ))}</tbody>
                  </>
                )}
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" style={secondaryBtnStyle} onClick={() => { setResult(null); setFile(null) }}>{failed ? 'Upload fixed file' : 'Import another file'}</button>
              <button type="button" style={primaryBtnStyle} onClick={close}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
