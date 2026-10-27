'use client'

// Invoice / challan files of a Before-PO receipt: list with view + download,
// attach buttons, delete (uploader only, Store side). Used on the Store detail
// popup and on the PO page (Procurement side).

import { useRef, useState } from 'react'
import { prePoStoreApi, prePoProcurementApi, PrePoAttachment, PrePoDocType, PrePoReceipt, PRE_PO_DOC_LABEL } from '@/lib/prePoApi'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { extractErrorMessages } from '@/lib/validation'
import { useAuthStore } from '@/store/authStore'
import { formatDateTime } from '@/lib/format'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { SheetIcon, SheetError, SHEET, sheetBtn } from '@/components/shared/FormSheet'

const sizeText = (n?: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

export default function PrePoAttachments({ receipt, side, canUpload, onChanged }: {
  receipt: PrePoReceipt; side: 'store' | 'p2p'; canUpload: boolean; onChanged: (r: PrePoReceipt) => void
}) {
  const me = useAuthStore((s) => s.user)
  const api = side === 'store' ? prePoStoreApi : prePoProcurementApi
  const fileRef = useRef<HTMLInputElement>(null)
  const [docType, setDocType] = useState<PrePoDocType>('invoice')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [delFor, setDelFor] = useState<PrePoAttachment | null>(null)
  const atts = receipt.attachments || []
  const open = receipt.status !== 'cancelled'

  const pick = (t: PrePoDocType) => { setDocType(t); setError(''); fileRef.current?.click() }
  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError('')
    try { onChanged(await api.uploadAttachment(receipt.id, file, docType)) }
    catch (err) { setError(extractErrorMessages(err, `Could not attach ${file.name} — check the file type and size (same limits as purchase request files) and try again.`)) }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const view = (a: PrePoAttachment, download: boolean) =>
    openAttachmentBlob(() => api.attachmentBlob(receipt.id, a.id), download ? a.filename : undefined)
      .catch((err) => setError(extractErrorMessages(err, `Could not open ${a.filename} — try again.`)))
  const remove = async () => {
    const a = delFor
    if (!a || side !== 'store') return
    setBusy(true)
    try { await prePoStoreApi.deleteAttachment(receipt.id, a.id); onChanged(await prePoStoreApi.get(receipt.id)); setDelFor(null) }
    catch (err) { setDelFor(null); setError(extractErrorMessages(err, `Could not delete ${a.filename} — only the person who attached it can delete it.`)) }
    finally { setBusy(false) }
  }

  return (
    <div data-tour="bpo-attachments">
      <SheetError error={error} />
      {atts.length === 0 && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: '0 0 10px' }}>No invoice or challan attached yet.</p>}
      {atts.map((a) => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: `1px solid ${SHEET.LINE}`, flexWrap: 'wrap' }}>
          <SheetIcon name="clip" size={15} color={SHEET.MUTED} />
          <span style={{ fontSize: 12, fontWeight: 700, color: SHEET.INK, minWidth: 56 }}>{PRE_PO_DOC_LABEL[a.doc_type] || a.doc_type}</span>
          <span style={{ fontSize: 13, color: SHEET.INK, flex: '1 1 160px', wordBreak: 'break-word' }}>{a.filename} <span style={{ color: SHEET.MUTED, fontSize: 11.5 }}>{sizeText(a.size)}{a.uploaded_by_name ? ` · ${a.uploaded_by_name}` : ''}{a.created_at ? ` · ${formatDateTime(a.created_at)}` : ''}</span></span>
          <button type="button" onClick={() => view(a, false)} style={sheetBtn('ghost', SHEET.BLUE)}>View</button>
          <button type="button" onClick={() => view(a, true)} style={sheetBtn('ghost', SHEET.BLUE)}>Download</button>
          {side === 'store' && open && receipt.status !== 'closed' && (a.uploaded_by_id == null || a.uploaded_by_id === me?.id) && (
            <button type="button" aria-label={`Delete ${a.filename}`} title="Delete" disabled={busy} onClick={() => setDelFor(a)} style={sheetBtn('ghost', '#be123c')}><SheetIcon name="trash" size={15} /></button>
          )}
        </div>
      ))}
      {canUpload && open ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <input ref={fileRef} type="file" hidden accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" onChange={(e) => upload(e.target.files?.[0])} />
          <button type="button" disabled={busy} onClick={() => pick('invoice')} data-tour="bpo-attach-invoice-btn" style={sheetBtn('secondary', SHEET.INK, busy)}><SheetIcon name="upload" size={15} />{busy && docType === 'invoice' ? 'Uploading…' : 'Attach invoice'}</button>
          <button type="button" disabled={busy} onClick={() => pick('challan')} data-tour="bpo-attach-challan-btn" style={sheetBtn('secondary', SHEET.INK, busy)}><SheetIcon name="upload" size={15} />{busy && docType === 'challan' ? 'Uploading…' : 'Attach challan'}</button>
        </div>
      ) : !canUpload && open && <p style={{ fontSize: 12, color: SHEET.MUTED, margin: '8px 0 0' }}>Attaching files needs {side === 'store' ? 'Create permission on GRN' : 'Create or Edit permission on Purchase Orders'}.</p>}
      <ConfirmDialog open={!!delFor} title="Delete this file?" message={delFor ? `${delFor.filename} will be removed from the receipt.` : ''} confirmLabel="Delete"
        onConfirm={remove} onCancel={() => setDelFor(null)} />
    </div>
  )
}
