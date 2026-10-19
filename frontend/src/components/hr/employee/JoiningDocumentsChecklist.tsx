'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { hrApi } from '@/lib/api'
import { HrFormRules, HrRuleCondition, UserDocument } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { Req, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import DateField from '@/components/erp/DateField'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import { ErrorBanner, StatusPill, linkActionStyle, dangerActionStyle, formatDate, VERIFICATION_HEX } from '@/components/hr/masters/masterUi'

/** Who the documents belong to: a portal account, an HR record without one,
 *  or nothing yet (a new record — files are staged and uploaded after save). */
export type DocumentOwner = { kind: 'user'; id: number } | { kind: 'worker'; id: number } | null
/** A document picked on a new record, uploaded right after the record is saved. */
export type StagedDocument = { key: string; file: File; document_number: string; issue_date: string; expiry_date: string; remarks: string }

const ACCEPT = 'image/*,.pdf,.doc,.docx'
const MAX_BYTES = 25 * 1024 * 1024

function matches(cond: HrRuleCondition, ctx: Record<string, unknown>): boolean {
  if (cond === null) return true
  return cond.some((clause) => Object.entries(clause).every(([k, vals]) => (vals as unknown[]).includes(ctx[k])))
}
function sizeLabel(bytes?: number | null): string {
  if (!bytes) return ''
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Upload one document (a staged one after save, or straight from the panel). */
export async function uploadChecklistFile(owner: Exclude<DocumentOwner, null>, doc: StagedDocument) {
  const meta = { checklist_key: doc.key, document_number: doc.document_number, issue_date: doc.issue_date, expiry_date: doc.expiry_date, remarks: doc.remarks, confidentiality: 'Confidential' }
  return owner.kind === 'user' ? hrApi.uploadEmployeeDocument(owner.id, doc.file, meta) : hrApi.uploadWorkerDocument(owner.id, doc.file, meta)
}

function FailedUploads() {
  const failed = useSearchParams().get('docs_failed')
  if (!failed) return null
  return <ErrorBanner errors={[`The record was saved, but these documents didn't upload: ${failed}. Upload them again from Documents (Edit record).`]} />
}

/** After "Create Employee", names any picked documents whose upload failed (?docs_failed=…). */
export function UploadFailedNotice() {
  return <Suspense fallback={null}><FailedUploads /></Suspense>
}

const emptyDraft = (key = ''): Omit<StagedDocument, 'file'> & { file: File | null } => ({ key, file: null, document_number: '', issue_date: '', expiry_date: '', remarks: '' })

/** Employee documents: which are required (by worker category / employment
 *  type), upload with reference, issue and expiry dates, and HR verification
 *  (Verified / Rejected with remarks). A required document counts once a file
 *  of that type is uploaded AND verified. */
export default function JoiningDocumentsChecklist({ rules, ctx, owner, staged, onStage, onChanged }: {
  rules: HrFormRules
  /** Record values the required-document rules look at (worker_type, employment_type, has_login…). */
  ctx: Record<string, unknown>
  owner: DocumentOwner
  staged: StagedDocument[]
  onStage: (docs: StagedDocument[]) => void
  onChanged?: () => void
}) {
  const { can, canFeature } = useCan()
  // HR › Employees › Documents feature (Organization › Role & Permissions)
  const docFeature = (a: 'view' | 'create' | 'approve' | 'delete' | 'export') => canFeature('hr', 'employees', 'documents', a)
  const seeDocs = docFeature('view')
  const [docs, setDocs] = useState<UserDocument[]>([])
  const [reloadTick, setReloadTick] = useState(0)
  const [draft, setDraft] = useState(emptyDraft())
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [toDelete, setToDelete] = useState<UserDocument | null>(null)
  const [toReject, setToReject] = useState<UserDocument | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const load = () => setReloadTick((t) => t + 1)

  useEffect(() => {
    if (!owner || !seeDocs) return
    let live = true
    ;(owner.kind === 'user' ? hrApi.listEmployeeDocuments(owner.id) : hrApi.listWorkerDocuments(owner.id))
      .then((list) => { if (live) setDocs(list) })
      .catch((err) => { if (live) setErrors(extractErrorMessages(err, "Couldn't load the uploaded documents.")) })
    return () => { live = false }
  }, [owner, reloadTick, seeDocs])

  const required = Object.entries(rules.required_documents).filter(([, cond]) => matches(cond, ctx)).map(([k]) => k)
  const typed = docs.filter((d) => d.checklist_key)
  const rank: Record<string, number> = { verified: 3, pending: 2, rejected: 1 }
  const stateOf = (key: string): string | null => {
    let best: string | null = staged.some((s) => s.key === key) ? 'staged' : null
    for (const d of typed.filter((x) => x.checklist_key === key)) {
      const st = d.verification_status || 'pending'
      if (!best || best === 'staged' || rank[st] > (rank[best] || 0)) best = st
    }
    return best
  }
  const canUpload = can('hr', 'employees', owner ? 'edit' : 'create') && docFeature('create')
  const canVerify = !!owner && docFeature('approve')

  const add = async () => {
    const problems: string[] = []
    if (!draft.key) problems.push('Pick the document type.')
    if (!draft.file) problems.push('Choose the file to upload.')
    if (draft.file && draft.file.size > MAX_BYTES) problems.push(`'${draft.file.name}' is ${(draft.file.size / 1024 / 1024).toFixed(1)} MB; the limit is 25 MB. Compress or split it.`)
    if (draft.issue_date && draft.expiry_date && draft.expiry_date < draft.issue_date) problems.push('Expiry date is before the issue date.')
    if (problems.length) { setErrors(problems); return }
    const doc = { ...draft, file: draft.file as File }
    setErrors([])
    if (!owner) { onStage([...staged, doc]); setDraft(emptyDraft()); if (fileRef.current) fileRef.current.value = ''; return }
    setBusy(true)
    try {
      await uploadChecklistFile(owner, doc)
      setDraft(emptyDraft())
      if (fileRef.current) fileRef.current.value = ''
      load()
      onChanged?.()
    } catch (err) {
      setErrors(extractErrorMessages(err, `Couldn't upload '${doc.file.name}'.`))
    } finally { setBusy(false) }
  }

  const verify = async (d: UserDocument, status: 'verified' | 'rejected' | 'pending', remarks?: string) => {
    if (!owner) return
    setBusy(true)
    setErrors([])
    try {
      await (owner.kind === 'user' ? hrApi.verifyEmployeeDocument(owner.id, d.id, { status, remarks }) : hrApi.verifyWorkerDocument(owner.id, d.id, { status, remarks }))
      load()
      onChanged?.()
    } catch (err) {
      setErrors(extractErrorMessages(err, `Couldn't update '${d.document_name}'.`))
    } finally { setBusy(false) }
  }

  const view = (d: UserDocument) => {
    if (!owner) return
    const fetch = () => (owner.kind === 'user' ? hrApi.getEmployeeDocumentBlob(owner.id, d.id) : hrApi.getWorkerDocumentBlob(owner.id, d.id))
    openAttachmentBlob(fetch).catch((err) => setErrors(extractErrorMessages(err, `Couldn't open '${d.filename}'.`)))
  }

  const remove = async () => {
    const d = toDelete
    setToDelete(null)
    if (!d || !owner) return
    try {
      await (owner.kind === 'user' ? hrApi.deleteEmployeeDocument(owner.id, d.id) : hrApi.deleteWorkerDocument(owner.id, d.id))
      load()
      onChanged?.()
    } catch (err) {
      setErrors(extractErrorMessages(err, `Couldn't delete '${d.filename}'.`))
    }
  }

  const typeOptions = [...required, ...Object.keys(rules.documents).filter((k) => !required.includes(k))]
  const chip = (state: string | null) => {
    if (state === 'verified') return { t: '✓ Verified', c: '#16A34A' }
    if (state === 'pending') return { t: 'Awaiting verification', c: '#CA8A04' }
    if (state === 'rejected') return { t: 'Rejected — upload again', c: '#DC2626' }
    if (state === 'staged') return { t: 'Uploads on save', c: '#2563EB' }
    return { t: 'Not uploaded', c: '#64748B' }
  }
  const field = (label: string, node: React.ReactNode, style: React.CSSProperties) => <div style={style}><label style={sheetLabel}>{label.endsWith(' *') ? <>{label.slice(0, -2)} <Req /></> : label}</label>{node}</div>

  return (
    <div>
      <ErrorBanner errors={errors} />

      {required.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {required.map((k) => {
            const c = chip(stateOf(k))
            return (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 10, border: `1px solid ${c.c}40`, background: `${c.c}0d`, fontSize: 12.5 }}>
                <b style={{ color: TEXT.heading, fontWeight: 600 }}>{rules.documents[k]}</b><span style={{ color: c.c, fontWeight: 600 }}>{c.t}</span>
              </span>
            )
          })}
        </div>
      )}

      {canUpload && (
        <div style={{ border: `1px dashed ${BORDER.normal}`, borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {field('Document Type *', (
              <select style={sheetInput} value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })}>
                <option value="">— Select —</option>
                {typeOptions.map((k) => <option key={k} value={k}>{rules.documents[k]}{required.includes(k) ? ' (required)' : ''}</option>)}
              </select>
            ), { flex: '1 1 210px', maxWidth: 280 })}
            {field('File *', <input ref={fileRef} type="file" accept={ACCEPT} style={{ ...sheetInput, padding: 7 }} onChange={(e) => setDraft({ ...draft, file: e.target.files?.[0] || null })} />, { flex: '1 1 220px', maxWidth: 320 })}
            {field('Reference No.', <input style={sheetInput} value={draft.document_number} onChange={(e) => setDraft({ ...draft, document_number: e.target.value })} placeholder="If any" />, { flex: '0 1 150px', minWidth: 130 })}
            {field('Issue Date', <DateField value={draft.issue_date} onChange={(v) => setDraft({ ...draft, issue_date: v })} />, { flex: '0 1 150px', minWidth: 140 })}
            {field('Expiry Date', <DateField value={draft.expiry_date} onChange={(v) => setDraft({ ...draft, expiry_date: v })} />, { flex: '0 1 150px', minWidth: 140 })}
            {field('Remarks', <input style={sheetInput} value={draft.remarks} onChange={(e) => setDraft({ ...draft, remarks: e.target.value })} />, { flex: '1 1 180px', maxWidth: 300 })}
            <button type="button" disabled={busy} onClick={add} style={{ ...sheetBtn('primary', '#2563EB', busy), padding: '10px 16px' }}>{busy ? 'Uploading…' : owner ? 'Upload' : '+ Add'}</button>
          </div>
          {draft.key && rules.sensitive_documents.includes(draft.key) && <p style={{ ...sheetHint, margin: '6px 0 0' }}>Statutory / identity document — stored as HR Only (not shown on the employee&apos;s own My HR page).</p>}
        </div>
      )}

      {/* Picked on a new record */}
      {staged.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {staged.map((s, i) => (
            <div key={`${s.key}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: TEXT.secondary, flexWrap: 'wrap' }}>
              <StatusPill label="Uploads on save" hex="#2563EB" />
              <b style={{ color: TEXT.heading }}>{rules.documents[s.key]}</b>
              <span>{s.file.name} · {sizeLabel(s.file.size)}</span>
              {s.document_number && <span>Ref {s.document_number}</span>}
              <span style={{ ...dangerActionStyle, cursor: 'pointer' }} onClick={() => onStage(staged.filter((_, j) => j !== i))}>Remove</span>
            </div>
          ))}
        </div>
      )}

      {owner && (
        typed.length === 0
          ? <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>No documents uploaded yet.</p>
          : (
            <div style={{ border: `1px solid ${BORDER.normal}`, borderRadius: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760, fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#fdf1e6' }}>
                    {['Type', 'File', 'Ref. No.', 'Issue', 'Expiry', 'Verification', ''].map((h) => <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11.5, color: TEXT.secondary, fontWeight: 700 }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {typed.map((d) => {
                    const st = d.verification_status || 'pending'
                    const expired = d.expiry_date && d.expiry_date < new Date().toISOString().slice(0, 10)
                    return (
                      <tr key={d.id} style={{ borderTop: `1px solid ${BORDER.normal}` }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600, color: TEXT.heading }}>{rules.documents[d.checklist_key || ''] || d.document_type}</td>
                        <td style={{ padding: '8px 10px', maxWidth: 220 }}>
                          {docFeature('export') ? <span style={{ ...linkActionStyle, cursor: 'pointer', wordBreak: 'break-all' }} onClick={() => view(d)}>{d.filename}</span> : <span style={{ wordBreak: 'break-all' }}>{d.filename}</span>}
                          <div style={{ color: TEXT.muted }}>{sizeLabel(d.size)}</div>
                        </td>
                        <td style={{ padding: '8px 10px' }}>{d.document_number || '—'}</td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{formatDate(d.issue_date)}</td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: expired ? '#DC2626' : undefined, fontWeight: expired ? 700 : undefined }}>{formatDate(d.expiry_date)}{expired ? ' (expired)' : ''}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <StatusPill label={rules.verification_statuses[st] || st} hex={VERIFICATION_HEX[st] || '#64748B'} />
                          {d.verified_by_name && st !== 'pending' && <div style={{ color: TEXT.muted, marginTop: 3 }}>{d.verified_by_name} · {formatDate(d.verified_at)}</div>}
                          {d.remarks && <div style={{ color: st === 'rejected' ? '#DC2626' : TEXT.muted, marginTop: 3 }}>{d.remarks}</div>}
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {canVerify && st !== 'verified' && <span style={{ ...linkActionStyle, cursor: 'pointer', marginRight: 10 }} onClick={() => !busy && verify(d, 'verified')}>Verify</span>}
                          {canVerify && st !== 'rejected' && <span style={{ ...dangerActionStyle, cursor: 'pointer', marginRight: 10 }} onClick={() => !busy && setToReject(d)}>Reject</span>}
                          {docFeature('delete') && <span style={{ ...dangerActionStyle, cursor: 'pointer' }} onClick={() => setToDelete(d)}>Delete</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
      )}
      <p style={{ ...sheetHint, margin: '8px 0 0' }}>
        A required document counts once a file of that type is uploaded and Verified by HR. PDF, Word or photo, up to 25 MB each; several files per type are allowed.
      </p>

      <PromptDialog
        open={!!toReject}
        title="Reject document"
        message={toReject ? `Why is '${toReject.filename}' (${rules.documents[toReject.checklist_key || ''] || toReject.document_type}) rejected? The remark is kept on the document so it can be fixed and uploaded again.` : ''}
        confirmLabel="Reject"
        danger
        requireValue
        onConfirm={(v) => { const d = toReject; setToReject(null); if (d) verify(d, 'rejected', v) }}
        onCancel={() => setToReject(null)}
      />
      <ConfirmDialog
        open={!!toDelete}
        title="Delete document?"
        message={toDelete ? `Delete '${toDelete.filename}' (${rules.documents[toDelete.checklist_key || ''] || toDelete.document_type})? The file is removed from SharePoint too.` : ''}
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
