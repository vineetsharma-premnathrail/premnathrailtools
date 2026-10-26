'use client'

import { useRef, useState } from 'react'
import { storeApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT } from '@/lib/theme'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn } from '@/components/shared/FormSheet'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { RowCount } from '@/components/shared/ui'

interface ImportResult {
  posted: { row: number; item_code: string; item_name: string; warehouse: string; entry_type: string; stock_effect: string; quantity: number; uom: string }[]
  would_post: number
  errors: { row: number; item_code: string; reason: string }[]
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', position: 'sticky', top: 0, whiteSpace: 'nowrap' }
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
      a.download = 'opening_stock_import_template.csv'
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
    <FormSheet width={result ? 760 : 580} icon="upload" title="Opening Stock Import"
      subtitle="Stock already on the shelves at go-live (or when a new store opens) — admin only." onClose={close} busy={busy}
      footer={!result ? <>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, busy)} onClick={close} disabled={busy}>Cancel</button>
        <button type="button" style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={upload} disabled={busy}><SheetIcon name="upload" size={16} />{busy ? 'Importing…' : 'Import'}</button>
      </> : <>
        <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => { setResult(null); setFile(null) }}>{failed ? 'Upload fixed file' : 'Import another file'}</button>
        <button type="button" style={sheetBtn('primary', SHEET.BLUE)} onClick={close}><SheetIcon name="check" size={16} />Done</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>
        )}
        {!result ? (
          <>
            <SheetSection icon="doc" title="File Format">
              <p style={{ fontSize: 13, color: SHEET.BODY, margin: '0 0 12px', lineHeight: 1.6 }}>
                Columns: <b>item_code</b>, <b>warehouse</b> (code or name), <b>quantity</b>, <b>rate</b> (book value per unit), batch_number, <b>reference_number</b> (e.g. the count
                sheet OPENING-STOCK-2026), transaction_date (YYYY-MM-DD, blank = today), <b>remarks</b>. Day-to-day stock comes in through GRN, Returns and Transfers.
                If <b>any</b> row has a problem, <b>nothing is posted</b> — fix the rows listed and upload the same file again.
              </p>
              <button type="button" onClick={downloadTemplate} style={sheetBtn('secondary')}><SheetIcon name="doc" size={15} />Download template</button>
            </SheetSection>
            <SheetSection icon="upload" title="Upload">
              <div
                onClick={() => fileRef.current?.click()}
                style={{ border: '1.5px dashed #cbd5e1', borderRadius: 12, padding: '18px 14px', textAlign: 'center', cursor: 'pointer', fontSize: 13, color: file ? SHEET.INK : SHEET.MUTED }}
              >
                <SheetIcon name="clip" size={22} color={SHEET.BLUE} />
                <div style={{ marginTop: 6 }}>{file ? file.name : <>Click to choose a <b>.csv</b> or <b>.xlsx</b> file</>}</div>
              </div>
              <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={(e) => { setFile(e.target.files?.[0] || null); setError('') }} />
            </SheetSection>
          </>
        ) : (
          <SheetSection icon={failed ? 'alert' : 'check'} title={failed ? 'Nothing Posted' : 'Posted'} color={failed ? '#dc2626' : '#15803d'}>
            <p style={{ fontSize: 13, color: failed ? '#dc2626' : '#15803d', fontWeight: 600, margin: '0 0 14px' }}>
              {failed
                ? `Nothing was posted — ${result.errors.length} row${result.errors.length === 1 ? ' has a problem' : 's have problems'}. ${result.would_post} other row${result.would_post === 1 ? ' was' : 's were'} fine. Fix the rows below and upload again.`
                : `${result.posted.length} opening-stock line${result.posted.length === 1 ? '' : 's'} posted.`}
            </p>
            <div style={{ maxHeight: 340, overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                {failed ? (
                  <>
                    <thead><tr><th style={th}>Row <RowCount count={result.errors.length} /></th><th style={th}>Item Code</th><th style={th}>Problem / Fix</th></tr></thead>
                    <tbody>{result.errors.map((r) => (
                      <tr key={r.row}><td style={td}>{r.row}</td><td style={{ ...td, fontWeight: 600 }}>{r.item_code || '—'}</td><td style={{ ...td, color: '#b91c1c' }}>{r.reason}</td></tr>
                    ))}</tbody>
                  </>
                ) : (
                  <>
                    <thead><tr><th style={th}>Row <RowCount count={result.posted.length} /></th><th style={th}>Item</th><th style={th}>Store</th><th style={th}>Type</th><th style={{ ...th, textAlign: 'right' }}>Quantity</th></tr></thead>
                    <tbody>{result.posted.map((r) => (
                      <tr key={r.row}><td style={td}>{r.row}</td><td style={td}><b>{r.item_code}</b> {r.item_name}</td><td style={td}>{r.warehouse}</td>
                        <td style={td}>{r.entry_type}</td><td style={{ ...td, fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: r.stock_effect === 'in' ? '#15803d' : '#b45309' }}>{r.stock_effect === 'in' ? '+' : '−'}{Number(r.quantity).toLocaleString('en-IN', { maximumFractionDigits: 3 })} {r.uom || ''}</td></tr>
                    ))}</tbody>
                  </>
                )}
              </table>
            </div>
          </SheetSection>
        )}
      </div>
    </FormSheet>
  )
}
