'use client'

import { useEffect, useRef, useState } from 'react'
import { storeApi } from '@/lib/api'
import { StoreStockEntry } from '@/types'
import { TEXT } from '@/lib/theme'
import { formatDateTime } from '@/lib/format'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn } from '@/components/shared/FormSheet'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

/**
 * One manual stock entry (SE-…): its lines and supporting documents.
 * Opened by entry number (from Movements) or with the entry itself (right
 * after posting). Documents can be added later (an invoice that came after
 * the goods) but never removed — they are the evidence for the entry.
 */
export default function StockEntryDialog({ entryNumber, entry: initial, canAttach, onClose }: {
  entryNumber?: string | null
  entry?: StoreStockEntry | null
  canAttach: boolean
  onClose: () => void
}) {
  const [entry, setEntry] = useState<StoreStockEntry | null>(initial || null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // Store › Items › Stock value & rates (the server blanks them too).
  const seeValues = useCan().canFeature('store', 'items', 'stock_values', 'view')

  useEffect(() => {
    if (initial || !entryNumber) return
    storeApi.getStockEntryByNumber(entryNumber).then(setEntry)
      .catch((err) => setError(extractErrorMessages(err, `Could not load stock entry ${entryNumber}.`).join(' ')))
  }, [entryNumber, initial])

  const openFile = async (attId: number, name: string) => {
    if (!entry) return
    setError('')
    const tab = window.open('', '_blank')
    try {
      const url = URL.createObjectURL(await storeApi.stockEntryAttachmentBlob(entry.id, attId))
      if (tab) { tab.location.href = url; tab.document.title = name } else window.open(url, '_blank')
    } catch (err) {
      tab?.close()
      setError(extractErrorMessages(err, `Could not open ${name}.`).join(' '))
    }
  }

  const addFiles = async (files: FileList | null) => {
    if (!entry || !files?.length) return
    setBusy(true)
    setError('')
    try {
      setEntry(await storeApi.addStockEntryAttachments(entry.id, Array.from(files)))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not attach the files.').join(' '))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
  const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, color: TEXT.secondary, borderTop: '1px solid rgba(0,0,0,0.05)' }

  return (
    <FormSheet width={760} icon="doc" title={entry ? entry.entry_number : entryNumber || 'Stock Entry'}
      subtitle={entry ? `${entry.entry_type_label || entry.entry_type} · ${entry.location_name} · ${entry.entry_date} · by ${entry.created_by_name || '—'}` : 'Loading…'}
      onClose={onClose} busy={busy}
      footer={<>
        {entry && canAttach && (
          <>
            <input ref={fileRef} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt" onChange={(e) => addFiles(e.target.files)} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}><SheetIcon name="clip" size={15} />{busy ? 'Uploading…' : 'Attach Document'}</button>
          </>
        )}
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}>Close</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>
        )}
        {!entry ? (
          !error && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Loading…</p>
        ) : (
          <>
            {(entry.vendor_name || entry.invoice_number || entry.remarks) && (
              <p style={{ fontSize: 12.5, color: SHEET.BODY, margin: '0 0 16px' }}>
                {entry.vendor_name && <>Vendor: <b>{entry.vendor_name}</b> · </>}
                {entry.invoice_number && <>Invoice / challan: <b>{entry.invoice_number}</b> · </>}
                {entry.remarks}
              </p>
            )}

            <SheetSection icon="box" title="Lines">
              <div style={{ overflow: 'auto', borderRadius: 10, border: `1px solid ${SHEET.LINE}` }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                  <thead><tr>{['Item', 'Qty', 'Batch', ...(seeValues ? ['Rate', 'Value'] : [])].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {entry.lines.map((l) => (
                      <tr key={l.id}>
                        <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{l.item_code} — {l.item_name}</td>
                        <td style={td}>{l.quantity} {l.uom}</td>
                        <td style={td}>{l.batch_number || '—'}</td>
                        {seeValues && <td style={td}>{l.unit_cost != null ? `₹ ${l.unit_cost.toLocaleString('en-IN')}` : '—'}</td>}
                        {seeValues && <td style={td}>{l.value != null ? `₹ ${l.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SheetSection>

            <SheetSection icon="clip" title={`Documents (${entry.attachments.length})`}>
              {entry.attachments.length === 0 ? (
                <p style={{ fontSize: 12.5, color: SHEET.MUTED, margin: 0 }}>No documents attached.</p>
              ) : entry.attachments.map((a) => (
                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${SHEET.LINE}` }}>
                  <span style={{ fontSize: 13, color: SHEET.INK, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.file_name}
                    <span style={{ fontSize: 11.5, color: SHEET.MUTED }}> · {a.file_size ? `${(a.file_size / 1024).toFixed(0)} KB · ` : ''}{formatDateTime(a.created_at)}</span>
                  </span>
                  <span onClick={() => openFile(a.id, a.file_name)} style={{ color: SHEET.BLUE, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Open</span>
                </div>
              ))}
            </SheetSection>
          </>
        )}
      </div>
    </FormSheet>
  )
}
