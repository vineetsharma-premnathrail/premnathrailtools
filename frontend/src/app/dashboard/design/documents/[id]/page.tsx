'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignDocumentDetail, DesignDocumentRevision, DesignLookupOption, DesignRevisionFile } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { secondaryBtnStyle, dangerBtnStyle, InfoRow } from '@/components/shared/ui'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { DOC_TYPE_LABELS, DISCIPLINE_LABELS, FILE_ROLE_LABELS, DESIGN_FILE_ACCEPT, formatBytes, toOptions } from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', in_review: 'In Review', in_approval: 'In Approval', released: 'Released', revising: 'Released · Revising', obsolete: 'Obsolete', superseded: 'Superseded',
}
const STATUS_HEX: Record<string, string> = {
  draft: '#78716c', in_review: '#2563EB', in_approval: '#7C3AED', released: '#16A34A', revising: '#0f766e', obsolete: '#DC2626', superseded: '#a8a29e',
}
const EVENT_LABELS: Record<string, string> = {
  created: 'created the document', details_updated: 'updated the details', revision_started: 'started a new revision',
  revision_updated: 'edited the revision', revision_discarded: 'discarded the draft revision', file_added: 'added files', file_removed: 'removed a file',
  submitted: 'submitted for check', recalled: 'recalled it to draft', review_passed: 'passed the check', review_returned: 'returned it from check',
  approval_returned: 'returned it from approval', approved_released: 'approved and released it', superseded: 'superseded the revision',
  obsoleted: 'marked the document obsolete', reactivated: 'reactivated the document', deleted: 'deleted the document', comment: 'commented',
}
const EVENT_HEX: Record<string, string> = {
  approved_released: '#16A34A', review_passed: '#2563EB', review_returned: '#DC2626', approval_returned: '#DC2626',
  obsoleted: '#DC2626', submitted: '#7C3AED', superseded: '#a8a29e', comment: '#FF6A2A',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary,
  color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 6px 16px ${SHADOWS.glowOrange}`,
}
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }

function pill(status: string) {
  const hex = STATUS_HEX[status] || '#78716c'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

type Confirm = 'submit' | 'discard' | 'delete' | 'reactivate' | null
type Prompt = 'recall' | 'review_pass' | 'review_return' | 'approve_pass' | 'approve_return' | 'obsolete' | null

const CONFIRM_TEXT: Record<Exclude<Confirm, null>, { title: string; label: string }> = {
  submit: { title: 'Submit for check?', label: 'Submit' },
  discard: { title: 'Discard this draft revision?', label: 'Discard' },
  delete: { title: 'Delete this document?', label: 'Delete' },
  reactivate: { title: 'Reactivate this document?', label: 'Reactivate' },
}
const PROMPT_TEXT: Record<Exclude<Prompt, null>, { title: string; message: string; placeholder: string; label: string; required: boolean; danger?: boolean }> = {
  recall: { title: 'Recall to draft', message: 'The checker/approver is told no action is needed. You can then change files and resubmit.', placeholder: 'Reason (optional)', label: 'Recall', required: false },
  review_pass: { title: 'Pass the check', message: 'The revision moves to the approver.', placeholder: 'Check remarks (optional)', label: 'Pass check', required: false },
  review_return: { title: 'Return to author', message: 'The revision goes back to draft. Say exactly what needs fixing.', placeholder: 'What needs fixing…', label: 'Return', required: true, danger: true },
  approve_pass: { title: 'Approve & release', message: 'This becomes the controlled revision. Any previously released revision is superseded.', placeholder: 'Approval remarks (optional)', label: 'Approve & Release', required: false },
  approve_return: { title: 'Return to author', message: 'The revision goes back to draft. Say exactly what needs fixing.', placeholder: 'What needs fixing…', label: 'Return', required: true, danger: true },
  obsolete: { title: 'Mark document obsolete', message: 'The document is withdrawn from use. Its revisions stay on record and retrievable.', placeholder: 'Reason — e.g. replaced by DWG-2026-0042', label: 'Mark Obsolete', required: true, danger: true },
}

export default function DesignDocumentDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const id = Number(params.id)

  const [doc, setDoc] = useState<DesignDocumentDetail | null>(null)
  const [users, setUsers] = useState<DesignLookupOption[]>([])
  const [projects, setProjects] = useState<DesignLookupOption[]>([])
  const [machines, setMachines] = useState<DesignLookupOption[]>([])
  const [items, setItems] = useState<DesignLookupOption[]>([])
  const [departments, setDepartments] = useState<DesignLookupOption[]>([])
  const [selectedRevId, setSelectedRevId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState<string>(searchParams.get('notice') || '')
  const [success, setSuccess] = useState('')
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [prompt, setPrompt] = useState<Prompt>(null)

  const [editingDetails, setEditingDetails] = useState(false)
  const [details, setDetails] = useState<Record<string, string>>({})
  const [editingRevision, setEditingRevision] = useState(false)
  const [revForm, setRevForm] = useState({ change_summary: '', reviewer_id: '', approver_id: '', ecn_id: '' })
  const [newRevOpen, setNewRevOpen] = useState(false)
  const [newRev, setNewRev] = useState({ change_summary: '', reviewer_id: '', approver_id: '', ecn_id: '' })
  const [uploadRole, setUploadRole] = useState('primary')
  const [comment, setComment] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const apply = (d: DesignDocumentDetail, keepSelection = false) => {
    setDoc(d)
    if (!keepSelection || !d.revisions.some((r) => r.id === selectedRevId)) {
      setSelectedRevId((d.revisions.find((r) => ['draft', 'in_review', 'in_approval'].includes(r.status)) || d.revisions[0])?.id ?? null)
    }
  }

  useEffect(() => {
    if (!isAuthorized || !id) return
    designApi.getDocument(id)
      .then((d) => apply(d))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the document.')))
    Promise.all([designApi.lookupUsers(), designApi.lookupProjects(), designApi.lookupMachines(), designApi.lookupItems(), designApi.lookupDepartments()])
      .then(([u, p, m, i, dep]) => { setUsers(u); setProjects(p); setMachines(m); setItems(i); setDepartments(dep) })
      .catch(() => { /* pickers only — the page still works read-only */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, id])

  const can = (action: string) => !!doc?.allowed_actions.includes(action)
  const openRev = useMemo(() => doc?.revisions.find((r) => ['draft', 'in_review', 'in_approval'].includes(r.status)) || null, [doc])
  const selected: DesignDocumentRevision | null = useMemo(() => doc?.revisions.find((r) => r.id === selectedRevId) || null, [doc, selectedRevId])
  const isOpenSelected = !!selected && selected.id === openRev?.id
  const userOptions = useMemo(() => toOptions(users.map((u) => ({ id: u.id, label: u.code ? `${u.label} — ${u.code}` : u.label })), 'Not decided yet'), [users])

  if (isLoading || !isAuthorized) return null

  const act = async (fn: () => Promise<DesignDocumentDetail>, fallback: string, done: string) => {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      apply(await fn(), true)
      setSuccess(done)
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  const runConfirm = async () => {
    const which = confirm
    setConfirm(null)
    if (!doc || !which) return
    if (which === 'submit' && openRev) await act(() => designApi.submitRevision(openRev.id), 'Submitting failed.', `${doc.doc_number} ${openRev.revision_label} submitted — ${openRev.reviewer_name || 'the checker'} has been notified.`)
    if (which === 'discard' && openRev) await act(() => designApi.discardRevision(openRev.id), 'Discarding the revision failed.', `Draft ${openRev.revision_label} discarded.`)
    if (which === 'reactivate') await act(() => designApi.reactivateDocument(doc.id), 'Reactivating failed.', `${doc.doc_number} is active again.`)
    if (which === 'delete') {
      setBusy(true)
      try {
        await designApi.deleteDocument(doc.id)
        router.push('/dashboard/design/documents')
      } catch (err) {
        setError(extractErrorMessages(err, 'Deleting the document failed.'))
        setBusy(false)
      }
    }
  }

  const runPrompt = async (value: string) => {
    const which = prompt
    if (!doc || !which) return
    if (PROMPT_TEXT[which].required && !value.trim()) {
      setError(which === 'obsolete' ? 'Give a reason for marking the document obsolete.' : 'Say what needs fixing — the author sees your comment.')
      setPrompt(null)
      return
    }
    setPrompt(null)
    const rev = openRev
    if (which === 'obsolete') return act(() => designApi.obsoleteDocument(doc.id, value), 'Marking obsolete failed.', `${doc.doc_number} marked obsolete.`)
    if (!rev) return
    const ref = `${doc.doc_number} ${rev.revision_label}`
    if (which === 'recall') return act(() => designApi.recallRevision(rev.id, value), 'Recall failed.', `${ref} recalled to draft.`)
    if (which === 'review_pass') return act(() => designApi.reviewRevision(rev.id, 'pass', value), 'Passing the check failed.', `${ref} checked — sent to ${rev.approver_name || 'the approver'}.`)
    if (which === 'review_return') return act(() => designApi.reviewRevision(rev.id, 'return', value), 'Returning failed.', `${ref} returned to ${rev.created_by_name || 'the author'}.`)
    if (which === 'approve_pass') return act(() => designApi.approveRevision(rev.id, 'pass', value), 'Approval failed.', `${ref} released — it is now the controlled revision.`)
    if (which === 'approve_return') return act(() => designApi.approveRevision(rev.id, 'return', value), 'Returning failed.', `${ref} returned to ${rev.created_by_name || 'the author'}.`)
  }

  const startEditDetails = () => {
    if (!doc) return
    setDetails({
      title: doc.title, description: doc.description || '', discipline: doc.discipline,
      pm_project_id: doc.pm_project_id ? String(doc.pm_project_id) : '', erp_project_id: doc.erp_project_id ? String(doc.erp_project_id) : '',
      store_item_id: doc.store_item_id ? String(doc.store_item_id) : '', department_id: doc.department_id ? String(doc.department_id) : '',
      owner_id: doc.owner_id ? String(doc.owner_id) : '',
    })
    setEditingDetails(true)
  }
  const saveDetails = async () => {
    if (!doc) return
    const num = (v: string) => (v ? Number(v) : null)
    await act(() => designApi.updateDocument(doc.id, {
      title: details.title.trim(), description: details.description.trim() || null, discipline: details.discipline,
      pm_project_id: num(details.pm_project_id), erp_project_id: num(details.erp_project_id), store_item_id: num(details.store_item_id),
      department_id: num(details.department_id), owner_id: num(details.owner_id),
    }), 'Saving details failed.', 'Details saved.')
    setEditingDetails(false)
  }

  const startEditRevision = () => {
    if (!openRev) return
    setRevForm({
      change_summary: openRev.change_summary || '', reviewer_id: openRev.reviewer_id ? String(openRev.reviewer_id) : '',
      approver_id: openRev.approver_id ? String(openRev.approver_id) : '', ecn_id: openRev.ecn_id ? String(openRev.ecn_id) : '',
    })
    setEditingRevision(true)
  }
  const saveRevision = async () => {
    if (!openRev) return
    await act(() => designApi.updateRevision(openRev.id, {
      change_summary: revForm.change_summary, reviewer_id: revForm.reviewer_id ? Number(revForm.reviewer_id) : null,
      approver_id: revForm.approver_id ? Number(revForm.approver_id) : null, ecn_id: revForm.ecn_id ? Number(revForm.ecn_id) : null,
    }), 'Saving the revision failed.', `${openRev.revision_label} updated.`)
    setEditingRevision(false)
  }

  const createRevision = async () => {
    if (!doc) return
    if (newRev.change_summary.trim().length < 3) { setError('Describe what is changing and why (the change summary is on the revision record).'); return }
    await act(() => designApi.startRevision(doc.id, {
      change_summary: newRev.change_summary.trim(), reviewer_id: newRev.reviewer_id ? Number(newRev.reviewer_id) : null,
      approver_id: newRev.approver_id ? Number(newRev.approver_id) : null, ecn_id: newRev.ecn_id ? Number(newRev.ecn_id) : null,
    }), 'Starting the revision failed.', 'New revision started — upload its files, then submit it for check.')
    setNewRevOpen(false)
    setNewRev({ change_summary: '', reviewer_id: '', approver_id: '', ecn_id: '' })
  }

  const uploadFiles = async (list: FileList | null) => {
    if (!list || !list.length || !openRev) return
    await act(() => designApi.uploadRevisionFiles(openRev.id, Array.from(list), uploadRole), 'Upload failed.', `${list.length} file${list.length === 1 ? '' : 's'} uploaded to ${openRev.revision_label}.`)
    if (fileRef.current) fileRef.current.value = ''
  }

  const openFile = async (f: DesignRevisionFile, download: boolean) => {
    setError('')
    try {
      await openAttachmentBlob(() => designApi.getFileContent(f.id, download), download ? f.file_name : undefined)
    } catch (err) {
      setError(extractErrorMessages(err, `Couldn't open ${f.file_name}.`))
    }
  }

  const postComment = async () => {
    if (!doc || !comment.trim()) return
    await act(() => designApi.addDocumentComment(doc.id, comment.trim(), selected?.id), 'Posting the comment failed.', 'Comment added.')
    setComment('')
  }

  const selectedIsSuperseded = selected?.status === 'superseded'
  const confirmMessage = (() => {
    if (!doc || !confirm) return ''
    if (confirm === 'submit') return `${doc.doc_number} ${openRev?.revision_label} goes to ${openRev?.reviewer_name || 'the checker'} for check, then ${openRev?.approver_name || 'the approver'} for approval. Files are locked until it's released or returned.`
    if (confirm === 'discard') return `Draft ${openRev?.revision_label} and its files are removed. ${doc.released_revision_label} stays the controlled revision.`
    if (confirm === 'delete') return `${doc.doc_number} has never been released, so it will be deleted with its draft files. This can't be undone.`
    return `${doc.doc_number} becomes active again and can be revised.`
  })()

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            {doc ? `${DOC_TYPE_LABELS[doc.document_type] || doc.document_type} · ${DISCIPLINE_LABELS[doc.discipline] || doc.discipline}` : 'Design Module'}
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {doc ? <>{doc.doc_number} <span style={{ fontWeight: 500, color: TEXT.secondary }}>— {doc.title}</span> {pill(doc.display_status)}</> : 'Document'}
          </h1>
          {doc && (
            <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
              Controlled revision: <strong style={{ color: TEXT.body }}>{doc.released_revision_label || 'none yet'}</strong>
              {doc.released_at ? ` (released ${formatDate(doc.released_at)})` : ''}
              {doc.open_revision_label ? ` · ${doc.open_revision_label} ${STATUS_LABELS[doc.open_revision_status || '']?.toLowerCase() || ''}${doc.pending_with_name ? ` with ${doc.pending_with_name}` : ''}` : ''}
            </p>
          )}
        </div>
        <button onClick={() => router.push('/dashboard/design/documents')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {notice && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400E', fontSize: 13, display: 'flex', gap: 10 }}>
          <span style={{ flex: 1 }}>The document was created, but: {notice}</span>
          <button type="button" onClick={() => setNotice('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#92400E' }}>×</button>
        </div>
      )}
      {success && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          {success}
        </div>
      )}
      {doc?.status === 'obsolete' && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          <strong>Obsolete — not for use.</strong> Marked obsolete by {doc.obsoleted_by_name || '—'} on {formatDate(doc.obsoleted_at)}: {doc.obsolete_reason}
        </div>
      )}

      {doc && (
        <>
          {/* Workflow action bar */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {can('submit') && <button disabled={busy} style={primaryBtn} onClick={() => setConfirm('submit')}>Submit {openRev?.revision_label} for Check</button>}
            {can('review') && <button disabled={busy} style={primaryBtn} onClick={() => setPrompt('review_pass')}>Pass Check</button>}
            {can('review') && <button disabled={busy} style={dangerBtnStyle} onClick={() => setPrompt('review_return')}>Return to Author</button>}
            {can('approve') && <button disabled={busy} style={primaryBtn} onClick={() => setPrompt('approve_pass')}>Approve &amp; Release</button>}
            {can('approve') && <button disabled={busy} style={dangerBtnStyle} onClick={() => setPrompt('approve_return')}>Return to Author</button>}
            {can('recall') && <button disabled={busy} style={secondaryBtnStyle} onClick={() => setPrompt('recall')}>Recall to Draft</button>}
            {can('new_revision') && <button disabled={busy} style={primaryBtn} onClick={() => setNewRevOpen((v) => !v)}>+ New Revision</button>}
            {can('discard_revision') && <button disabled={busy} style={dangerBtnStyle} onClick={() => setConfirm('discard')}>Discard {openRev?.revision_label}</button>}
            {can('obsolete') && <button disabled={busy} style={dangerBtnStyle} onClick={() => setPrompt('obsolete')}>Mark Obsolete</button>}
            {can('reactivate') && <button disabled={busy} style={secondaryBtnStyle} onClick={() => setConfirm('reactivate')}>Reactivate</button>}
            {can('delete') && <button disabled={busy} style={dangerBtnStyle} onClick={() => setConfirm('delete')}>Delete Document</button>}
          </div>

          {newRevOpen && (
            <div style={sectionStyle}>
              <p style={sectionTitle}>Start revision R{(doc.revisions[0]?.revision_index ?? 0) + 1}</p>
              <div style={{ marginBottom: 12, maxWidth: 760 }}>
                <label style={labelStyle}>Change summary * — what changes and why</label>
                <textarea style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }} value={newRev.change_summary} onChange={(e) => setNewRev({ ...newRev, change_summary: e.target.value })} placeholder="e.g. Gusset plate thickened 10 → 12 mm after FEA review" />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
                  <label style={labelStyle}>Checked by</label>
                  <SearchableSelect value={newRev.reviewer_id} onChange={(v) => setNewRev({ ...newRev, reviewer_id: v })} options={userOptions} placeholder="Select checker…" />
                </div>
                <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
                  <label style={labelStyle}>Approved by</label>
                  <SearchableSelect value={newRev.approver_id} onChange={(v) => setNewRev({ ...newRev, approver_id: v })} options={userOptions} placeholder="Select approver…" />
                </div>
                <div style={{ flex: '1 1 240px', maxWidth: 340 }}>
                  <label style={labelStyle}>Under change notice</label>
                  <select style={inputStyle} value={newRev.ecn_id} onChange={(e) => setNewRev({ ...newRev, ecn_id: e.target.value })}>
                    <option value="">{doc.open_ecns.length ? 'None' : 'No approved ECN lists this document'}</option>
                    {doc.open_ecns.map((e) => <option key={e.id} value={e.id}>{e.ecn_number} — {e.title}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button disabled={busy} style={primaryBtn} onClick={createRevision}>Start Revision</button>
                <button disabled={busy} style={secondaryBtnStyle} onClick={() => setNewRevOpen(false)}>Cancel</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Left: revision panel */}
            <div style={{ flex: '2 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                  <p style={{ ...sectionTitle, margin: 0, flex: '1 1 auto' }}>Revision</p>
                  {doc.revisions.map((r) => {
                    const active = r.id === selectedRevId
                    return (
                      <button key={r.id} type="button" onClick={() => { setSelectedRevId(r.id); setEditingRevision(false) }} style={{
                        padding: '5px 12px', borderRadius: 9999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        border: `1px solid ${active ? '#FF6A2A' : BORDER.normal}`, background: active ? 'rgba(255,106,42,0.1)' : 'rgba(255,255,255,.6)',
                        color: active ? '#FF6A2A' : STATUS_HEX[r.status] || TEXT.secondary,
                      }}>
                        {r.revision_label}
                      </button>
                    )
                  })}
                </div>

                {selected && (
                  <>
                    {selectedIsSuperseded && (
                      <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 10, background: 'rgba(168,162,158,0.15)', border: '1px solid rgba(120,113,108,0.3)', color: '#57534e', fontSize: 12.5 }}>
                        <strong>Superseded — not for use.</strong> Kept for traceability. The controlled revision is {doc.released_revision_label || '—'}.
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 18, fontWeight: 700, color: TEXT.heading }}>{selected.revision_label}</span>
                      {pill(selected.status)}
                      {selected.returned_count > 0 && <span style={{ fontSize: 12, color: '#b45309' }}>returned {selected.returned_count}×</span>}
                      {selected.ecn_number && (
                        <span onClick={() => router.push(`/dashboard/design/change-notices/${selected.ecn_id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>
                          under {selected.ecn_number}
                        </span>
                      )}
                      <span style={{ flex: 1 }} />
                      {isOpenSelected && can('edit_revision') && !editingRevision && (
                        <button type="button" style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 12 }} onClick={startEditRevision}>Edit revision</button>
                      )}
                    </div>

                    {editingRevision && isOpenSelected ? (
                      <div style={{ marginBottom: 14 }}>
                        <label style={labelStyle}>Change summary</label>
                        <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical', marginBottom: 10 }} value={revForm.change_summary} onChange={(e) => setRevForm({ ...revForm, change_summary: e.target.value })} />
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                          <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
                            <label style={labelStyle}>Checked by</label>
                            <SearchableSelect value={revForm.reviewer_id} onChange={(v) => setRevForm({ ...revForm, reviewer_id: v })} options={userOptions} placeholder="Select checker…" />
                          </div>
                          <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
                            <label style={labelStyle}>Approved by</label>
                            <SearchableSelect value={revForm.approver_id} onChange={(v) => setRevForm({ ...revForm, approver_id: v })} options={userOptions} placeholder="Select approver…" />
                          </div>
                          <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
                            <label style={labelStyle}>Under change notice</label>
                            <select style={inputStyle} value={revForm.ecn_id} onChange={(e) => setRevForm({ ...revForm, ecn_id: e.target.value })}>
                              <option value="">None</option>
                              {doc.open_ecns.map((e) => <option key={e.id} value={e.id}>{e.ecn_number} — {e.title}</option>)}
                            </select>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                          <button disabled={busy} style={primaryBtn} onClick={saveRevision}>Save</button>
                          <button disabled={busy} style={secondaryBtnStyle} onClick={() => setEditingRevision(false)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
                        <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Change summary" value={selected.change_summary || '—'} /></div>
                        <InfoRow label="Prepared by" value={`${selected.created_by_name || '—'} · ${formatDate(selected.created_at)}`} />
                        <InfoRow label="Checked by" value={selected.reviewed_at ? `${selected.reviewed_by_name} · ${formatDate(selected.reviewed_at)}` : `${selected.reviewer_name || 'not named'} (pending)`} />
                        <InfoRow label="Approved by" value={selected.approved_at && selected.status !== 'draft' ? `${selected.approved_by_name} · ${formatDate(selected.approved_at)}` : `${selected.approver_name || 'not named'} (pending)`} />
                        <InfoRow label="Released" value={selected.released_at ? formatDateTime(selected.released_at) : '—'} />
                        {selected.review_comment && <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Checker remarks" value={selected.review_comment} /></div>}
                        {selected.approval_comment && <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Approver remarks" value={selected.approval_comment} /></div>}
                      </div>
                    )}

                    <p style={{ ...sectionTitle, margin: '4px 0 8px' }}>Files</p>
                    {selected.files.length === 0 ? (
                      <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 8px' }}>
                        No files on {selected.revision_label} yet.{isOpenSelected && can('manage_files') ? ' Upload the controlled PDF and the CAD source below.' : ''}
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                        {selected.files.map((f) => (
                          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.55)', flexWrap: 'wrap' }}>
                            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                              <p style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</p>
                              <p style={{ fontSize: 11.5, color: TEXT.muted, margin: 0 }}>
                                {FILE_ROLE_LABELS[f.file_role] || f.file_role} · {formatBytes(f.file_size)} · {f.uploaded_by_name || '—'} · {formatDate(f.created_at)}
                              </p>
                            </div>
                            <button type="button" style={{ ...secondaryBtnStyle, padding: '5px 12px', fontSize: 12 }} onClick={() => openFile(f, false)}>Open</button>
                            <button type="button" style={{ ...secondaryBtnStyle, padding: '5px 12px', fontSize: 12 }} onClick={() => openFile(f, true)}>Download</button>
                            {isOpenSelected && can('manage_files') && (
                              <button type="button" disabled={busy} style={{ ...dangerBtnStyle, padding: '5px 12px', fontSize: 12 }}
                                onClick={() => act(() => designApi.removeRevisionFile(selected.id, f.id), 'Removing the file failed.', `${f.file_name} removed.`)}>
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {isOpenSelected && can('manage_files') && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginTop: 6 }}>
                        <div style={{ flex: '0 1 220px', minWidth: 190 }}>
                          <label style={labelStyle}>Add as</label>
                          <select style={inputStyle} value={uploadRole} onChange={(e) => setUploadRole(e.target.value)}>
                            {Object.entries(FILE_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </div>
                        <div style={{ flex: '1 1 260px', maxWidth: 420 }}>
                          <label style={labelStyle}>{busy ? 'Uploading…' : 'Upload files'}</label>
                          <input ref={fileRef} type="file" multiple accept={DESIGN_FILE_ACCEPT} disabled={busy} style={inputStyle} onChange={(e) => uploadFiles(e.target.files)} />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div style={sectionStyle}>
                <p style={sectionTitle}>Revision history</p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                    <thead>
                      <tr>{['Rev', 'Status', 'Change summary', 'Prepared', 'Checked', 'Approved', 'Released'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {doc.revisions.map((r) => (
                        <tr key={r.id} onClick={() => setSelectedRevId(r.id)} style={{ cursor: 'pointer', background: r.id === selectedRevId ? 'rgba(255,106,42,0.05)' : undefined }}>
                          <td style={{ ...tdStyle, fontWeight: 700 }}>{r.revision_label}</td>
                          <td style={tdStyle}>{pill(r.status)}</td>
                          <td style={{ ...tdStyle, maxWidth: 280 }}>{r.change_summary || '—'}{r.ecn_number ? <span style={{ color: TEXT.muted }}> ({r.ecn_number})</span> : null}</td>
                          <td style={tdStyle}>{r.created_by_name || '—'}</td>
                          <td style={tdStyle}>{r.reviewed_at ? r.reviewed_by_name : '—'}</td>
                          <td style={tdStyle}>{r.released_at ? r.approved_by_name : '—'}</td>
                          <td style={tdStyle}>{formatDate(r.released_at)}{r.superseded_at ? <div style={{ fontSize: 11, color: TEXT.muted }}>superseded {formatDate(r.superseded_at)}</div> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Right: details + timeline */}
            <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                  <p style={{ ...sectionTitle, margin: 0, flex: 1 }}>Details</p>
                  {can('edit') && !editingDetails && (
                    <button type="button" style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 12 }} onClick={startEditDetails}>Edit</button>
                  )}
                </div>
                {editingDetails ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div><label style={labelStyle}>Title</label><input style={inputStyle} value={details.title} onChange={(e) => setDetails({ ...details, title: e.target.value })} /></div>
                    <div><label style={labelStyle}>Description</label><textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={details.description} onChange={(e) => setDetails({ ...details, description: e.target.value })} /></div>
                    <div>
                      <label style={labelStyle}>Discipline</label>
                      <select style={inputStyle} value={details.discipline} onChange={(e) => setDetails({ ...details, discipline: e.target.value })}>
                        {Object.entries(DISCIPLINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div><label style={labelStyle}>Owner</label><SearchableSelect value={details.owner_id} onChange={(v) => setDetails({ ...details, owner_id: v })} options={toOptions(users)} /></div>
                    <div><label style={labelStyle}>Project</label><SearchableSelect value={details.pm_project_id} onChange={(v) => setDetails({ ...details, pm_project_id: v })} options={toOptions(projects, 'None')} /></div>
                    <div><label style={labelStyle}>Machine</label><SearchableSelect value={details.erp_project_id} onChange={(v) => setDetails({ ...details, erp_project_id: v })} options={toOptions(machines, 'None')} /></div>
                    <div><label style={labelStyle}>Part (Store item)</label><SearchableSelect value={details.store_item_id} onChange={(v) => setDetails({ ...details, store_item_id: v })} options={toOptions(items, 'None')} /></div>
                    <div><label style={labelStyle}>Department</label><SearchableSelect value={details.department_id} onChange={(v) => setDetails({ ...details, department_id: v })} options={toOptions(departments, 'None')} /></div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button disabled={busy} style={primaryBtn} onClick={saveDetails}>Save</button>
                      <button disabled={busy} style={secondaryBtnStyle} onClick={() => setEditingDetails(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {doc.description && <InfoRow label="Description" value={doc.description} />}
                    <InfoRow label="Owner" value={doc.owner_name || '—'} />
                    <InfoRow label="Project" value={doc.pm_project_label || '—'} />
                    <InfoRow label="Machine" value={doc.erp_project_label || '—'} />
                    <InfoRow label="Part (Store item)" value={doc.store_item_label || '—'} />
                    <InfoRow label="Department" value={doc.department_name || '—'} />
                    <InfoRow label="Created" value={`${doc.created_by_name || '—'} · ${formatDate(doc.created_at)}`} />
                    {doc.open_ecns.length > 0 && (
                      <div>
                        <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }}>Approved change notices</p>
                        {doc.open_ecns.map((e) => (
                          <p key={e.id} onClick={() => router.push(`/dashboard/design/change-notices/${e.id}`)} style={{ fontSize: 13, color: '#FF6A2A', fontWeight: 600, margin: 0, cursor: 'pointer' }}>{e.ecn_number} — {e.title}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={sectionStyle}>
                <p style={sectionTitle}>Timeline</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input style={inputStyle} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={selected ? `Comment on ${selected.revision_label}…` : 'Add a comment…'}
                    onKeyDown={(e) => { if (e.key === 'Enter') postComment() }} />
                  <button type="button" disabled={busy || !comment.trim()} style={{ ...secondaryBtnStyle, whiteSpace: 'nowrap' }} onClick={postComment}>Post</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 520, overflowY: 'auto' }}>
                  {doc.events.map((e) => (
                    <div key={e.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: `1px solid ${BORDER.light}` }}>
                      <span style={{ width: 8, height: 8, borderRadius: 9999, marginTop: 6, flex: 'none', background: EVENT_HEX[e.action] || '#a8a29e' }} />
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 12.5, color: TEXT.body, margin: 0 }}>
                          <strong>{e.actor_name || 'System'}</strong> {EVENT_LABELS[e.action] || e.action.replace(/_/g, ' ')}
                          {e.revision_label ? <span style={{ color: TEXT.muted }}> · {e.revision_label}</span> : null}
                        </p>
                        {e.comment && <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '2px 0 0', whiteSpace: 'pre-wrap' }}>{e.comment}</p>}
                        <p style={{ fontSize: 11, color: TEXT.muted, margin: '2px 0 0' }}>{formatDateTime(e.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? CONFIRM_TEXT[confirm].title : ''}
        message={confirmMessage}
        confirmLabel={confirm ? CONFIRM_TEXT[confirm].label : 'OK'}
        danger={confirm === 'delete' || confirm === 'discard'}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
      <PromptDialog
        open={prompt !== null}
        title={prompt ? PROMPT_TEXT[prompt].title : ''}
        message={prompt ? PROMPT_TEXT[prompt].message : ''}
        placeholder={prompt ? PROMPT_TEXT[prompt].placeholder : ''}
        confirmLabel={prompt ? PROMPT_TEXT[prompt].label : 'OK'}
        danger={prompt ? !!PROMPT_TEXT[prompt].danger : false}
        onConfirm={runPrompt}
        onCancel={() => setPrompt(null)}
      />
    </div>
  )
}
