'use client'

// Purchase Orders › Create PO › "Upload Tally POs" (2026-10-27). POs already
// approved in Tally come in from an Excel file: check the file (nothing saved),
// then upload — every PO gets a portal number, keeps its Tally number, and is
// ready for goods receipt at once. Optionally attach each Tally PO's PDF.

import { useRef, useState } from 'react'
import { purchaseOrdersApi, type TallyPoPreview } from '@/lib/api'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { BRAND, TEXT, GLASS } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { extractErrorMessages } from '@/lib/validation'
import { RowCount } from '@/components/shared/ui'

type Created = Awaited<ReturnType<typeof purchaseOrdersApi.tallyCommit>>['created']

const inr = (n: number) => `₹ ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const th: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', fontSize: 11, fontWeight: 700, color: TEXT.muted, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '7px 10px', fontSize: 12.5, verticalAlign: 'top' }

export default function TallyPOUploadDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<TallyPoPreview | null>(null)
  const [created, setCreated] = useState<Created | null>(null)
  const [attachFor, setAttachFor] = useState<number | null>(null)
  const [attached, setAttached] = useState<Record<number, string>>({})
  const [error, setError] = useState('')
  const close = () => { if (!busy) onClose() }
  useEscapeKey(true, close)

  const downloadTemplate = async () => {
    try {
      const url = window.URL.createObjectURL(await purchaseOrdersApi.tallyTemplate())
      const a = document.createElement('a')
      a.href = url
      a.download = 'tally_po_upload_template.xlsx'
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not download the template — check your connection and try again.').join(' '))
    }
  }

  const pick = (f: File | null) => {
    setFile(f)
    setPreview(null)
    setError('')
  }

  const check = async () => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      setPreview(await purchaseOrdersApi.tallyPreview(file))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not check the file — make sure it is the .xlsx template (or CSV) and try again.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  const upload = async () => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      setCreated((await purchaseOrdersApi.tallyCommit(file)).created)
      onUploaded?.()
    } catch (err) {
      setError(extractErrorMessages(err, 'Upload failed and nothing was saved — check the file and try again.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  const attach = async (f: File | undefined) => {
    const poId = attachFor
    if (pdfRef.current) pdfRef.current.value = ''
    if (!f || poId === null) return
    setBusy(true)
    setError('')
    try {
      const res = await purchaseOrdersApi.tallyAttachDocument(poId, f)
      setAttached((a) => ({ ...a, [poId]: res.document_filename }))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not attach the PDF — the PO is saved; try attaching again.').join(' '))
    } finally {
      setBusy(false)
      setAttachFor(null)
    }
  }

  const canUpload = !!preview && preview.with_errors === 0 && preview.ready > 0

  const footer = created ? (
    <button type="button" style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={close} disabled={busy}><SheetIcon name="check" size={16} />Done</button>
  ) : (
    <>
      <button type="button" style={sheetBtn('secondary', SHEET.INK, busy)} onClick={close} disabled={busy}>Cancel</button>
      {!preview ? (
        <button type="button" style={sheetBtn('primary', SHEET.BLUE, !file || busy)} disabled={!file || busy} onClick={check}>
          <SheetIcon name="search" size={16} />{busy ? 'Checking…' : 'Check file'}
        </button>
      ) : (
        <button type="button" style={sheetBtn('primary', SHEET.BLUE, !canUpload || busy)} disabled={!canUpload || busy} onClick={upload}>
          <SheetIcon name="upload" size={16} />{busy ? 'Uploading…' : `Upload ${preview.ready} PO${preview.ready === 1 ? '' : 's'}`}
        </button>
      )}
    </>
  )

  return (
    <FormSheet width={preview || created ? 960 : 620} icon="upload" title="Upload Tally POs"
      subtitle="Purchase orders already approved in Tally. They get a portal PO number and are ready for goods receipt at once."
      onClose={close} busy={busy} footer={footer}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />

        {!created && (
          <SheetSection icon="doc" title="Excel file">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={downloadTemplate}><SheetIcon name="doc" size={15} />Download template</button>
              <input ref={fileRef} type="file" aria-label="Tally PO Excel file" accept=".xlsx,.csv"
                onClick={(e) => { e.currentTarget.value = '' }}
                onChange={(e) => pick(e.target.files?.[0] || null)}
                style={{ ...sheetInput, flex: '1 1 240px', width: 'auto', padding: '5px 10px' }} />
            </div>
            <p style={sheetHint}>
              One row per PO line; rows with the same Tally PO no. become one PO. Vendor = vendor code or GSTIN, item = Item Master code
              or the item&apos;s Tally code — names are not matched. Nothing is saved until you press Upload, and either every PO is saved or none.
            </p>
          </SheetSection>
        )}

        {preview && !created && (
          <SheetSection icon="list" title={`Check result — ${preview.ready} ready, ${preview.with_errors} with problems, ${preview.lines} line(s)`}>
            {preview.with_errors > 0 && (
              <p role="alert" style={{ fontSize: 12.5, color: '#dc2626', margin: '0 0 10px' }}>
                Fix the problems shown in red in the Excel file, then pick it again and press Check file. Nothing has been saved.
              </p>
            )}
            <div style={{ maxHeight: 340, overflow: 'auto', border: `1px solid ${BRAND.primary}22`, borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: `${BRAND.primary}0d`, position: 'sticky', top: 0 }}>
                    <th style={th}>Tally PO no. <RowCount count={preview.pos.length} /></th><th style={th}>PO date</th><th style={th}>Vendor</th>
                    <th style={th}>Lines</th><th style={{ ...th, textAlign: 'right' }}>Value</th><th style={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.pos.map((p, i) => (
                    <tr key={p.tally_po_no ?? `rows-${i}`} style={{ borderTop: `1px solid ${GLASS.border}` }}>
                      <td style={{ ...td, fontWeight: 600 }}>{p.tally_po_no ?? '—'}</td>
                      <td style={td}>{p.po_date ? formatDate(p.po_date) : '—'}</td>
                      <td style={td}>{p.vendor_name ? <>{p.vendor_name} <span style={{ color: TEXT.muted }}>({p.vendor_code})</span></> : '—'}</td>
                      <td style={td}>{p.lines.length}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{p.lines.length ? inr(p.total_value) : '—'}</td>
                      <td style={td}>
                        {p.errors.length === 0
                          ? <span style={{ color: '#16a34a', fontWeight: 600 }}>Ready</span>
                          : <ul style={{ margin: 0, paddingLeft: 16, color: '#dc2626' }}>{p.errors.map((e, j) => <li key={j}>{e}</li>)}</ul>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SheetSection>
        )}

        {created && (
          <SheetSection icon="check" title={`${created.length} PO${created.length === 1 ? '' : 's'} uploaded`}>
            <p style={{ ...sheetHint, marginTop: 0 }}>
              They are in Tracking and the store can receive them now. Attach each Tally PO print (PDF) if you have it — optional, and it can&apos;t be replaced once attached.
            </p>
            <input ref={pdfRef} type="file" accept="application/pdf,.pdf" aria-label="Tally PO PDF" style={{ display: 'none' }}
              onChange={(e) => attach(e.target.files?.[0])} />
            <div style={{ maxHeight: 340, overflow: 'auto', border: `1px solid ${BRAND.primary}22`, borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: `${BRAND.primary}0d` }}>
                    <th style={th}>Portal PO no. <RowCount count={created.length} /></th><th style={th}>Tally PO no.</th><th style={th}>Vendor</th>
                    <th style={th}>Lines</th><th style={{ ...th, textAlign: 'right' }}>Value</th><th style={th}>Tally PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {created.map((c) => (
                    <tr key={c.id} style={{ borderTop: `1px solid ${GLASS.border}` }}>
                      <td style={{ ...td, fontWeight: 600 }}>{c.po_number}</td>
                      <td style={td}>{c.tally_po_no}</td>
                      <td style={td}>{c.vendor_name}</td>
                      <td style={td}>{c.lines}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{inr(c.total_value)}</td>
                      <td style={td}>
                        {attached[c.id]
                          ? <span style={{ color: '#16a34a' }}>{attached[c.id]}</span>
                          : (
                            <button type="button" style={sheetBtn('secondary', SHEET.INK, busy)} disabled={busy}
                              onClick={() => { setAttachFor(c.id); pdfRef.current?.click() }}>
                              <SheetIcon name="clip" size={14} />{busy && attachFor === c.id ? 'Attaching…' : 'Attach PDF'}
                            </button>
                          )}
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
