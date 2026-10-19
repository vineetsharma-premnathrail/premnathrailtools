'use client'

import { useRef, useState } from 'react'
import { storeApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT } from '@/lib/theme'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn } from '@/components/shared/FormSheet'
import { useEscapeKey } from '@/hooks/useEscapeKey'

interface ImportResult {
  created: { row: number; item_code: string; item_name: string; item_type: string; category: string | null }[]
  existing: { row: number; item_name: string; existing_code: string | null; existing_name: string; reason: string }[]
  errors: { row: number; item_name: string; reason: string }[]
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

/** Bulk import for the Item Master: rows that already exist are skipped and
 *  listed next to the new items that were saved. */
export default function ItemImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
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
      const blob = await storeApi.downloadItemImportTemplate()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'item_master_import_template.csv'
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
      const res: ImportResult = await storeApi.importItems(file)
      setResult(res)
      if (res.created.length) onImported()
    } catch (err) {
      setError(extractErrorMessages(err, 'Import failed.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet width={result ? 760 : 580} icon="upload" title="Import Items"
      subtitle="Bulk-add items to the Item Master from a CSV or Excel file." onClose={close} busy={busy}
      footer={!result ? <>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, busy)} onClick={close} disabled={busy}>Cancel</button>
        <button type="button" style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={upload} disabled={busy}><SheetIcon name="upload" size={16} />{busy ? 'Importing…' : 'Import'}</button>
      </> : <>
        <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => { setResult(null); setFile(null) }}>Import another file</button>
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
                Columns: item_type, category, subcategory, <b>item_name</b>, <b>uom</b>, technical_specification.
                Item codes are generated automatically. Items whose name and technical specification both already exist are <b>not saved</b> — you&apos;ll see them listed after the import.
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
          <SheetSection icon="list" title="Import Result">
            <p style={{ fontSize: 13, color: SHEET.MUTED, margin: '0 0 16px' }}>
              {result.created.length} new item{result.created.length === 1 ? '' : 's'} saved · {result.existing.length} already existed (not saved)
              {result.errors.length ? ` · ${result.errors.length} with problems (not saved)` : ''}
            </p>

            <Block title="New items saved" color="#15803d" count={result.created.length}>
              <thead><tr><th style={th}>Row</th><th style={th}>Item Code</th><th style={th}>Name</th><th style={th}>Type</th><th style={th}>Category</th></tr></thead>
              <tbody>{result.created.map((r) => (
                <tr key={r.row}><td style={td}>{r.row}</td><td style={{ ...td, fontWeight: 700 }}>{r.item_code}</td><td style={td}>{r.item_name}</td><td style={td}>{r.item_type}</td><td style={td}>{r.category || '—'}</td></tr>
              ))}</tbody>
            </Block>

            <Block title="Already exist — not saved" color="#b45309" count={result.existing.length}>
              <thead><tr><th style={th}>Row</th><th style={th}>Name in file</th><th style={th}>Existing Item</th><th style={th}>Why</th></tr></thead>
              <tbody>{result.existing.map((r) => (
                <tr key={r.row}><td style={td}>{r.row}</td><td style={td}>{r.item_name}</td>
                  <td style={td}>{r.existing_code ? <><b>{r.existing_code}</b> {r.existing_name}</> : '—'}</td><td style={td}>{r.reason}</td></tr>
              ))}</tbody>
            </Block>

            {result.errors.length > 0 && (
              <Block title="Problems — not saved" color="#dc2626" count={result.errors.length}>
                <thead><tr><th style={th}>Row</th><th style={th}>Name</th><th style={th}>Fix</th></tr></thead>
                <tbody>{result.errors.map((r) => (
                  <tr key={r.row}><td style={td}>{r.row}</td><td style={td}>{r.item_name || '—'}</td><td style={td}>{r.reason}</td></tr>
                ))}</tbody>
              </Block>
            )}
          </SheetSection>
        )}
      </div>
    </FormSheet>
  )
}
