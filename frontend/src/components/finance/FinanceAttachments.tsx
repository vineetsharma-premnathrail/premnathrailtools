'use client'

/** Supporting documents (voucher proof) on Finance documents — the vendor's
 *  bill on a purchase invoice, the working behind a journal, the bank advice
 *  on a receipt. Files live in SharePoint; bytes are always fetched through
 *  the backend's /content proxy, never the raw SharePoint URL.
 *
 *  - FinanceAttachments: the live list on a saved document (open / upload /
 *    delete; files are locked once the document is posted).
 *  - ProofPicker: files chosen on a create form, uploaded by the page after
 *    the document is saved (or staged first, for payment vouchers).
 *  - useProofCounts + ProofClip: the 📎 marker on a list. */
import { useEffect, useState } from 'react'
import { accountsApi, FinanceAttachmentEntity } from '@/lib/api'
import { financePaymentsApi } from '@/lib/financePaymentsApi'
import { FinanceAttachment } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'
import { ErrorBanner, inputStyle, secondaryBtnStyle } from '@/components/finance/financeUi'

export const PROOF_DOC_TYPES: Record<string, string> = {
  bill: 'Bill / tax invoice',
  bank_proof: 'Bank advice / UTR proof',
  working: 'Working / calculation',
  approval: 'Approval mail / note',
  customer_po: 'Customer PO',
  delivery_proof: 'Signed delivery / LR copy',
  other: 'Other',
}

/** The kinds offered on each document, most likely first. */
export const PROOF_KINDS: Record<FinanceAttachmentEntity, string[]> = {
  vendor_invoice: ['bill', 'approval', 'other'],
  party_note: ['bill', 'working', 'approval', 'other'],
  ar_transaction: ['customer_po', 'delivery_proof', 'approval', 'other'],
  journal: ['working', 'approval', 'bill', 'other'],
  payment: ['bill', 'bank_proof', 'approval', 'other'],
}

const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.eml,.msg'

function formatSize(bytes?: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: `1px solid ${BORDER.light}`, flexWrap: 'wrap' }
const nameStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer', flex: '1 1 200px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const metaStyle: React.CSSProperties = { fontSize: 11.5, color: TEXT.muted }
const kindStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: TEXT.secondary }
const removeStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#DC2626', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }

/** Files on a saved Finance document.
 *  `tabKey` — the Permission Matrix tab the document sits on (its "Supporting
 *  documents" feature decides view / upload / delete).
 *  `locked` — the document is posted / cancelled: files can still be added
 *  (unless cancelled) but never removed. */
export default function FinanceAttachments({ entityType, entityId, tabKey, locked = false, closed = false, required = false, onCountChange, label }: {
  entityType: FinanceAttachmentEntity
  entityId: number
  tabKey: string
  locked?: boolean
  closed?: boolean
  required?: boolean
  onCountChange?: (count: number) => void
  /** Heading shown above the files — rendered only for users who may see them. */
  label?: React.ReactNode
}) {
  const { user } = useAuth()
  const { canFeature } = useCan()
  const canView = canFeature('accounts', tabKey, 'proof', 'view')
  const canUpload = canFeature('accounts', tabKey, 'proof', 'create') && !closed
  const canRemove = canFeature('accounts', tabKey, 'proof', 'delete') && !locked
  const kinds = PROOF_KINDS[entityType]
  const [items, setItems] = useState<FinanceAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [docType, setDocType] = useState(kinds[0])
  const [uploading, setUploading] = useState(false)
  const [inputKey, setInputKey] = useState(0)
  const [pendingDelete, setPendingDelete] = useState<FinanceAttachment | null>(null)

  const [reloadTick, setReloadTick] = useState(0)
  const load = () => setReloadTick((t) => t + 1)

  useEffect(() => {
    if (!canView) return
    let cancelled = false
    accountsApi.listAttachments(entityType, entityId)
      .then((data) => { if (!cancelled) { setItems(data); onCountChange?.(data.length) } })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Could not load the supporting documents. Reload the page; if it keeps failing, check your Finance permissions.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, canView, reloadTick])

  if (!canView) return null

  const upload = async () => {
    if (!files.length) return
    setError(null)
    setUploading(true)
    try {
      await accountsApi.uploadAttachments(entityType, entityId, files, docType)
      setFiles([])
      setInputKey((k) => k + 1)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Upload failed — check the file is under the size limit and try again.'))
    } finally {
      setUploading(false)
    }
  }

  const open = async (a: FinanceAttachment) => {
    setError(null)
    try {
      const inline = (a.content_type || '').startsWith('image/') || a.content_type === 'application/pdf'
      await openAttachmentBlob(() => accountsApi.getAttachmentContent(a.id), inline ? undefined : a.filename)
    } catch (err) {
      setError(extractErrorMessages(err, `Couldn't open ${a.filename}.`))
    }
  }

  const confirmDelete = async () => {
    const a = pendingDelete
    setPendingDelete(null)
    if (!a) return
    setError(null)
    try {
      await accountsApi.deleteAttachment(a.id)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, `Couldn't delete ${a.filename}.`))
    }
  }

  return (
    <div data-tour="fin-proof">
      {label}
      <ErrorBanner error={error} />
      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ fontSize: 13, margin: 0, color: required ? '#b45309' : TEXT.muted, fontWeight: required ? 600 : 400 }}>
          {required ? 'No file attached yet — attach one before this goes for approval.' : 'No files attached yet.'}
        </p>
      ) : (
        <div>
          {items.map((a) => (
            <div key={a.id} style={rowStyle}>
              <span onClick={() => open(a)} style={nameStyle} title={`Open ${a.filename}`}>📎 {a.filename}</span>
              <span style={kindStyle}>{PROOF_DOC_TYPES[a.doc_type] || a.doc_type}</span>
              <span style={metaStyle}>{formatSize(a.size)}</span>
              <span style={metaStyle}>{a.created_by_name || ''} · {formatDateTime(a.created_at)}</span>
              {canRemove && (user?.role === 'admin' || user?.id === a.created_by_id) && (
                <button type="button" onClick={() => setPendingDelete(a)} style={removeStyle}>Delete</button>
              )}
            </div>
          ))}
        </div>
      )}

      {canUpload && (
        <div data-tour="fin-proof-upload" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <select style={{ ...inputStyle, width: 'auto', flex: '0 1 200px' }} value={docType} onChange={(e) => setDocType(e.target.value)}>
            {kinds.map((k) => <option key={k} value={k}>{PROOF_DOC_TYPES[k]}</option>)}
          </select>
          <input key={inputKey} type="file" multiple accept={ACCEPT}
            onChange={(e) => setFiles(Array.from(e.target.files || []))} style={{ ...inputStyle, flex: '1 1 220px', maxWidth: 360, width: 'auto' }} />
          <button type="button" onClick={upload} disabled={!files.length || uploading}
            style={{ ...secondaryBtnStyle, opacity: !files.length || uploading ? 0.6 : 1, cursor: !files.length || uploading ? 'not-allowed' : 'pointer' }}>
            {uploading ? 'Uploading…' : `Upload${files.length ? ` (${files.length})` : ''}`}
          </button>
        </div>
      )}
      {locked && items.length > 0 && (
        <p style={{ ...metaStyle, margin: '8px 0 0' }}>Posted — these files are part of the audit trail and can&apos;t be removed.</p>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete supporting document?"
        message={pendingDelete ? `${pendingDelete.filename} will be removed from this document.` : ''}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

/** A file chosen on a create form, with its kind. */
export type PickedProof = { key: string; file: File; docType: string }

/** File picker for a create form. The page uploads the picked files after the
 *  document is saved (uploadPickedProof) — or, for a payment voucher, stages
 *  them first (stagePickedProof) because the voucher posts on save. */
export function ProofPicker({ entityType, value, onChange, required = false, hint }: {
  entityType: FinanceAttachmentEntity
  value: PickedProof[]
  onChange: (v: PickedProof[]) => void
  required?: boolean
  hint?: React.ReactNode
}) {
  const kinds = PROOF_KINDS[entityType]
  const [docType, setDocType] = useState(kinds[0])
  const [inputKey, setInputKey] = useState(0)
  return (
    <div data-tour="fin-proof-picker">
      {value.length === 0 ? (
        <p style={{ fontSize: 12.5, margin: '0 0 8px', color: required ? '#b45309' : TEXT.muted, fontWeight: required ? 600 : 400 }}>
          {required ? 'Required — attach at least one file.' : 'No files chosen.'}
        </p>
      ) : value.map((p) => (
        <div key={p.key} style={rowStyle}>
          <span style={{ ...nameStyle, color: TEXT.body, cursor: 'default' }}>📎 {p.file.name}</span>
          <span style={kindStyle}>{PROOF_DOC_TYPES[p.docType] || p.docType}</span>
          <span style={metaStyle}>{formatSize(p.file.size)}</span>
          <button type="button" style={removeStyle} onClick={() => onChange(value.filter((x) => x.key !== p.key))}>Remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <select style={{ ...inputStyle, width: 'auto', flex: '0 1 200px' }} value={docType} onChange={(e) => setDocType(e.target.value)}>
          {kinds.map((k) => <option key={k} value={k}>{PROOF_DOC_TYPES[k]}</option>)}
        </select>
        <input key={inputKey} type="file" multiple accept={ACCEPT} style={{ ...inputStyle, flex: '1 1 220px', maxWidth: 360, width: 'auto' }}
          onChange={(e) => {
            const picked = Array.from(e.target.files || []).map((file) => ({ key: Math.random().toString(36).slice(2), file, docType }))
            if (picked.length) onChange([...value, ...picked])
            setInputKey((k) => k + 1)
          }} />
      </div>
      {hint && <p style={{ ...metaStyle, margin: '6px 0 0' }}>{hint}</p>}
    </div>
  )
}

/** Upload files picked on a create form to the saved document, one call per
 *  kind. Returns '' on success, or a message saying what didn't upload. */
export async function uploadPickedProof(entityType: FinanceAttachmentEntity, entityId: number, picked: PickedProof[], what: string): Promise<string> {
  const byKind = new Map<string, File[]>()
  picked.forEach((p) => byKind.set(p.docType, [...(byKind.get(p.docType) || []), p.file]))
  try {
    for (const [kind, files] of byKind) await accountsApi.uploadAttachments(entityType, entityId, files, kind)
    return ''
  } catch (err) {
    return `${what} was saved, but its supporting documents didn't upload: ${extractErrorMessages(err, 'the upload failed').join(' ')} Open it and upload them again under Supporting documents.`
  }
}

/** Stage files for a payment voucher before it is saved; returns their ids
 *  (pass them as attachment_ids). Throws with the real reason on failure. */
export async function stagePickedProof(picked: PickedProof[]): Promise<number[]> {
  const byKind = new Map<string, File[]>()
  picked.forEach((p) => byKind.set(p.docType, [...(byKind.get(p.docType) || []), p.file]))
  const ids: number[] = []
  for (const [kind, files] of byKind) (await accountsApi.stageAttachments(files, kind)).forEach((a) => ids.push(a.id))
  return ids
}

/** {document id: file count} for the rows on a list (refetched when the ids change). */
export function useProofCounts(entityType: FinanceAttachmentEntity, ids: number[], tabKey: string): Record<number, number> {
  const { canFeature } = useCan()
  const allowed = canFeature('accounts', tabKey, 'proof', 'view')
  const [loaded, setLoaded] = useState<{ key: string; counts: Record<number, number> }>({ key: '', counts: {} })
  const key = ids.join(',')
  useEffect(() => {
    if (!allowed || !key) return
    let cancelled = false
    accountsApi.attachmentCounts(entityType, key.split(',').map(Number))
      .then((data) => { if (!cancelled) setLoaded({ key, counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [Number(k), v])) }) })
      .catch(() => { /* the 📎 marker is a hint — the list works without it */ })
    return () => { cancelled = true }
  }, [entityType, key, allowed])
  return allowed && loaded.key === key ? loaded.counts : {}
}

/** 📎 n on a list row (nothing when the document has no files). */
export function ProofClip({ count }: { count?: number }) {
  if (!count) return null
  return <span title={`${count} supporting document${count === 1 ? '' : 's'}`} style={{ fontSize: 11.5, color: TEXT.secondary, whiteSpace: 'nowrap', marginLeft: 6 }}>📎{count > 1 ? ` ${count}` : ''}</span>
}

/** Finance › Settings › Supporting documents, as the forms need them. Reading
 *  settings is open to every Finance user; on failure the server still
 *  enforces the rules, so the defaults below only drive the hints. */
export type ProofRules = { purchaseInvoice: boolean; journal: boolean; payment: boolean; paymentAbove: number }

export function useProofRules(): ProofRules {
  const [rules, setRules] = useState<ProofRules>({ purchaseInvoice: true, journal: true, payment: false, paymentAbove: 0 })
  useEffect(() => {
    financePaymentsApi.getSettings().then((s) => setRules({
      purchaseInvoice: s.values.proof_required_purchase_invoice !== false,
      journal: s.values.proof_required_journal !== false,
      payment: s.values.proof_required_payment === true,
      paymentAbove: Number(s.values.proof_required_payment_above) || 0,
    })).catch(() => { /* keep defaults — the server enforces the real rule */ })
  }, [])
  return rules
}

/** Whether a payment / receipt voucher of this type and amount needs a file. */
export function paymentProofRequired(rules: ProofRules, paymentType: string, amount: number): boolean {
  return rules.payment && ['vendor', 'customer', 'expense', 'other_receipt'].includes(paymentType) && amount > rules.paymentAbove
}
