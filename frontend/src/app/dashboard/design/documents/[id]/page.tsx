'use client'

import Select from '@/components/shared/Select'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { designApi } from '@/lib/api'
import { DesignChecklistAnswer, DesignDocumentDetail, DesignDocumentRevision, DesignLookupOption, DesignRequest, DesignRevisionFile } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, SheetIconName, SHEET, Req, Optional, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { DANGER_RED } from '@/components/design/DesignSheets'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { secondaryBtnStyle, dangerBtnStyle, InfoRow, primaryBtnStyle, smallSecondaryBtnStyle, smallDangerBtnStyle } from '@/components/shared/ui'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { DOC_TYPE_LABELS, DISCIPLINE_LABELS, FILE_ROLE_LABELS, DESIGN_FILE_ACCEPT, SUBMISSION_STATUS_LABELS, CUSTOMER_RESPONSE_LABELS, formatBytes, toOptions } from '@/components/design/designMeta'
import { useDesignFeature } from '@/components/design/useDesignFeature'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import { recordHref, recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', in_review: 'In Review', in_approval: 'In Approval', approved: 'Approved · awaiting customer', released: 'Released', revising: 'Released · Revising',
  obsolete: 'Obsolete', superseded: 'Superseded', customer_rejected: 'Customer rejected',
}
const STATUS_HEX: Record<string, string> = {
  draft: '#78716c', in_review: '#2563EB', in_approval: '#7C3AED', approved: '#0891B2', released: '#16A34A', revising: '#0f766e', obsolete: '#DC2626', superseded: '#a8a29e',
  customer_rejected: '#B91C1C',
}
const RESPONSE_HEX: Record<string, string> = { pending: '#F59E0B', approved: '#16A34A', approved_with_comments: '#0f766e', rejected: '#DC2626' }
const SUBMISSION_HEX: Record<string, string> = { draft: '#78716c', sent: '#2563EB', closed: '#16A34A', cancelled: '#a8a29e' }
const RESULT_LABELS: Record<string, string> = { ok: 'OK', not_ok: 'Not OK', na: 'N/A' }
const RESULT_HEX: Record<string, string> = { ok: '#16A34A', not_ok: '#DC2626', na: '#78716c' }
const OPEN_STATUSES = ['draft', 'in_review', 'in_approval', 'approved']
const EVENT_LABELS: Record<string, string> = {
  created: 'created the document', details_updated: 'updated the details', revision_started: 'started a new revision',
  revision_updated: 'edited the revision', revision_discarded: 'discarded the draft revision', file_added: 'added files', file_removed: 'removed a file',
  submitted: 'submitted for check', recalled: 'recalled it to draft', review_passed: 'passed the check', review_returned: 'returned it from check',
  approval_returned: 'returned it from approval', approved_released: 'approved and released it', superseded: 'superseded the revision',
  obsoleted: 'marked the document obsolete', reactivated: 'reactivated the document', deleted: 'deleted the document', comment: 'commented',
  approved_for_customer: 'approved it — now awaiting the customer', sent_to_customer: 'sent it to the customer', customer_approved: 'recorded customer approval',
  customer_rejected: 'recorded customer rejection', document_created: 'created the document for a design request', document_released: 'released it after customer approval',
}
const EVENT_HEX: Record<string, string> = {
  approved_released: '#16A34A', review_passed: '#2563EB', review_returned: '#DC2626', approval_returned: '#DC2626',
  obsoleted: '#DC2626', submitted: '#7C3AED', superseded: '#a8a29e', comment: '#FF6A2A',
  approved_for_customer: '#0891B2', sent_to_customer: '#2563EB', customer_approved: '#16A34A', customer_rejected: '#DC2626', document_released: '#16A34A',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const primaryBtn: React.CSSProperties = primaryBtnStyle
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }

function mergeOptions(base: DesignLookupOption[], extra: DesignLookupOption[]): DesignLookupOption[] {
  const seen = new Set(base.map((o) => o.id))
  return [...base, ...extra.filter((o) => !seen.has(o.id))]
}

function pill(status: string) {
  const hex = STATUS_HEX[status] || '#78716c'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

type Confirm = 'submit' | 'discard' | 'delete' | 'reactivate' | null
type Prompt = 'recall' | 'review_pass' | 'review_return' | 'approve_pass' | 'approve_return' | 'obsolete' | 'release' | null

const CONFIRM_TEXT: Record<Exclude<Confirm, null>, { title: string; label: string }> = {
  submit: { title: 'Submit for check?', label: 'Submit' },
  discard: { title: 'Discard this draft revision?', label: 'Discard' },
  delete: { title: 'Delete this document?', label: 'Delete' },
  reactivate: { title: 'Reactivate this document?', label: 'Reactivate' },
}
const FIX_MSG = 'Say what needs fixing — the author sees your comment.'
const PROMPT_TEXT: Record<Exclude<Prompt, null>, { title: string; message: string; field: string; placeholder: string; label: string; busy: string; required: boolean; danger?: boolean; icon: SheetIconName; requiredMessage?: string; fallback: string }> = {
  recall: { title: 'Recall to draft', message: 'The checker/approver is told no action is needed. You can then change files and resubmit.', field: 'Reason', placeholder: 'Reason (optional)', label: 'Recall', busy: 'Recalling…', required: false, icon: 'undo', fallback: 'Recall failed.' },
  review_pass: { title: 'Pass the check', message: 'The revision moves to the approver.', field: 'Check remarks', placeholder: 'Check remarks (optional)', label: 'Pass check', busy: 'Saving…', required: false, icon: 'check', fallback: 'Passing the check failed.' },
  review_return: { title: 'Return to author', message: 'The revision goes back to draft. Say exactly what needs fixing.', field: 'What needs fixing', placeholder: 'What needs fixing…', label: 'Return', busy: 'Returning…', required: true, danger: true, icon: 'undo', requiredMessage: FIX_MSG, fallback: 'Returning failed.' },
  approve_pass: { title: 'Approve & release', message: 'This becomes the controlled revision. Any previously released revision is superseded.', field: 'Approval remarks', placeholder: 'Approval remarks (optional)', label: 'Approve & Release', busy: 'Approving…', required: false, icon: 'check', fallback: 'Approval failed.' },
  approve_return: { title: 'Return to author', message: 'The revision goes back to draft. Say exactly what needs fixing.', field: 'What needs fixing', placeholder: 'What needs fixing…', label: 'Return', busy: 'Returning…', required: true, danger: true, icon: 'undo', requiredMessage: FIX_MSG, fallback: 'Returning failed.' },
  release: { title: 'Release after customer approval', message: 'The customer has approved this revision. Releasing makes it the controlled revision and supersedes the previous one.', field: 'Release remarks', placeholder: 'Release remarks (optional)', label: 'Release', busy: 'Releasing…', required: false, icon: 'check', fallback: 'Releasing failed.' },
  obsolete: { title: 'Mark document obsolete', message: 'The document is withdrawn from use. Its revisions stay on record and retrievable.', field: 'Reason', placeholder: 'Reason — e.g. replaced by DWG-2026-0042', label: 'Mark Obsolete', busy: 'Saving…', required: true, danger: true, icon: 'alert', requiredMessage: 'Give a reason for marking the document obsolete.', fallback: 'Marking obsolete failed.' },
}

export default function DesignDocumentDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const { id, error: linkError } = useRecordId(params.id as string)
  // Role-level features (Design › Drawings); buttons follow the server's allowed_actions.
  const designFeature = useDesignFeature()
  const seeFiles = designFeature('documents', 'files', 'view')
  const removeFiles = designFeature('documents', 'files', 'delete')
  const seeWhereUsed = designFeature('documents', 'where_used', 'view')
  const seeTimeline = designFeature('documents', 'timeline', 'view')

  const [doc, setDoc] = useState<DesignDocumentDetail | null>(null)
  const [users, setUsers] = useState<DesignLookupOption[]>([])
  const [projects, setProjects] = useState<DesignLookupOption[]>([])
  const [machines, setMachines] = useState<DesignLookupOption[]>([])
  const [items, setItems] = useState<DesignLookupOption[]>([])
  const [itemSearch, setItemSearch] = useState('')
  const [itemMsg, setItemMsg] = useState('')
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
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadStaged, setUploadStaged] = useState<File[]>([])
  const [comment, setComment] = useState('')
  const [customers, setCustomers] = useState<DesignLookupOption[]>([])
  const [standards, setStandards] = useState<DesignLookupOption[]>([])
  const [requests, setRequests] = useState<DesignRequest[]>([])
  const [checkOpen, setCheckOpen] = useState(false)
  const [checkAnswers, setCheckAnswers] = useState<Record<number, { result: '' | DesignChecklistAnswer['result']; remark: string }>>({})
  const [checkComment, setCheckComment] = useState('')
  const [checkError, setCheckError] = useState('')
  const [expandedRevId, setExpandedRevId] = useState<number | null>(null)

  const apply = (d: DesignDocumentDetail, keepSelection = false) => {
    setDoc(d)
    if (!keepSelection || !d.revisions.some((r) => r.id === selectedRevId)) {
      setSelectedRevId((d.revisions.find((r) => OPEN_STATUSES.includes(r.status)) || d.revisions[0])?.id ?? null)
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
    Promise.all([designApi.lookupCustomers(), designApi.lookupStandards(), designApi.listRequests({ status: 'open,accepted,in_progress,on_hold' })])
      .then(([c, st, rq]) => { setCustomers(c); setStandards(st); setRequests(rq) })
      .catch(() => { /* pickers only */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, id])

  const can = (action: string) => !!doc?.allowed_actions.includes(action)
  const openRev = useMemo(() => doc?.revisions.find((r) => OPEN_STATUSES.includes(r.status)) || null, [doc])
  const selected: DesignDocumentRevision | null = useMemo(() => doc?.revisions.find((r) => r.id === selectedRevId) || null, [doc, selectedRevId])
  const isOpenSelected = !!selected && selected.id === openRev?.id
  const userOptions = useMemo(() => toOptions(users.map((u) => ({ id: u.id, label: u.code ? `${u.label} — ${u.code}` : u.label })), 'Not decided yet'), [users])
  // Role "Assign to" rules (Role & Permissions › Design › Drawings); whoever is already named stays listed.
  const allowOwner = useAssigneeFilter('design:documents.owner')
  const allowChecker = useAssigneeFilter('design:documents.check_release')
  const checkerOptions = useMemo(() => toOptions(users.filter((u) => u.id === openRev?.reviewer_id || allowChecker(u.id))
    .map((u) => ({ id: u.id, label: u.code ? `${u.label} — ${u.code}` : u.label })), 'Not decided yet'), [users, openRev, allowChecker])
  const ownerOptions = useMemo(() => toOptions(users.filter((u) => u.id === doc?.owner_id || allowOwner(u.id))), [users, doc, allowOwner])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><DesignNav /><InvalidRecordLink message={linkError} listHref="/dashboard/design/documents" listLabel="Back to drawings" /></div>)

  const act = async (fn: () => Promise<DesignDocumentDetail>, fallback: string, done: string): Promise<boolean> => {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      apply(await fn(), true)
      setSuccess(done)
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  // While a popup is open its errors show inside it, not in the page banner.
  const popupOpen = newRevOpen || editingRevision || editingDetails || uploadOpen
  const closePopup = (close: () => void) => { if (busy) return; close(); setError('') }

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

  // Reason popup: errors throw so ReasonSheet shows them inside the popup (required-text check is done by ReasonSheet).
  const runPrompt = async (value: string) => {
    const which = prompt
    if (!doc || !which) return
    const rev = openRev
    const ref = rev ? `${doc.doc_number} ${rev.revision_label}` : doc.doc_number
    let d: DesignDocumentDetail | null = null
    let done = ''
    setSuccess('')
    if (which === 'obsolete') { d = await designApi.obsoleteDocument(doc.id, value); done = `${doc.doc_number} marked obsolete.` }
    else if (rev && which === 'release') { d = await designApi.releaseRevision(rev.id, value); done = `${ref} released — it is now the controlled revision.` }
    else if (rev && which === 'recall') { d = await designApi.recallRevision(rev.id, value); done = `${ref} recalled to draft.` }
    else if (rev && which === 'review_pass') { d = await designApi.reviewRevision(rev.id, 'pass', value); done = `${ref} checked — sent to ${rev.approver_name || 'the approver'}.` }
    else if (rev && which === 'review_return') { d = await designApi.reviewRevision(rev.id, 'return', value); done = `${ref} returned to ${rev.created_by_name || 'the author'}.` }
    else if (rev && which === 'approve_pass') { d = await designApi.approveRevision(rev.id, 'pass', value); done = `${ref} released — it is now the controlled revision.` }
    else if (rev && which === 'approve_return') { d = await designApi.approveRevision(rev.id, 'return', value); done = `${ref} returned to ${rev.created_by_name || 'the author'}.` }
    if (d) { apply(d, true); setError(''); setSuccess(done) }
    setPrompt(null)
  }

  // The item list loads only the first 200 Item Master codes — search for the rest.
  const searchItems = async () => {
    const q = itemSearch.trim()
    if (!q) return
    setItemMsg('')
    try {
      const found = await designApi.lookupItems(q)
      setItems((prev) => mergeOptions(prev, found))
      setItemMsg(found.length ? `${found.length} found — pick it in the Part list.` : `No Item Master item matches “${q}”. Check the code or name, or ask Store to create the item first.`)
    } catch (err) {
      setItemMsg(extractErrorMessages(err, 'Searching Item Master failed.').join(' '))
    }
  }

  const startEditDetails = () => {
    if (!doc) return
    // Keep the current link visible even when it's beyond the first 200 codes.
    if (doc.store_item_id) {
      const current = { id: doc.store_item_id, label: doc.store_item_label || `Item #${doc.store_item_id}` }
      setItems((prev) => mergeOptions(prev, [current]))
    }
    setItemSearch('')
    setItemMsg('')
    setDetails({
      title: doc.title, description: doc.description || '', discipline: doc.discipline,
      pm_project_id: doc.pm_project_id ? String(doc.pm_project_id) : '', erp_project_id: doc.erp_project_id ? String(doc.erp_project_id) : '',
      store_item_id: doc.store_item_id ? String(doc.store_item_id) : '', department_id: doc.department_id ? String(doc.department_id) : '',
      owner_id: doc.owner_id ? String(doc.owner_id) : '',
      customer_id: doc.customer_id ? String(doc.customer_id) : '', customer_approval_required: doc.customer_approval_required ? '1' : '',
      standard_id: doc.standard_id ? String(doc.standard_id) : '', design_request_id: doc.design_request_id ? String(doc.design_request_id) : '',
      legacy_number: doc.legacy_number || '',
    })
    setError('')
    setEditingDetails(true)
  }
  const saveDetails = async () => {
    if (!doc) return
    const num = (v: string) => (v ? Number(v) : null)
    const ok = await act(() => designApi.updateDocument(doc.id, {
      title: details.title.trim(), description: details.description.trim() || null, discipline: details.discipline,
      pm_project_id: num(details.pm_project_id), erp_project_id: num(details.erp_project_id), store_item_id: num(details.store_item_id),
      department_id: num(details.department_id), owner_id: num(details.owner_id),
      customer_id: num(details.customer_id), customer_approval_required: !!details.customer_approval_required,
      standard_id: num(details.standard_id), design_request_id: num(details.design_request_id), legacy_number: details.legacy_number.trim() || null,
    }), 'Saving details failed.', 'Details saved.')
    if (ok) setEditingDetails(false)
  }

  // Review with the checklist: every item needs an answer before a pass.
  const openChecklistReview = () => {
    if (!doc?.checklist) return
    setCheckAnswers(Object.fromEntries(doc.checklist.items.map((it) => [it.id, { result: '' as const, remark: '' }])))
    setCheckComment('')
    setCheckError('')
    setCheckOpen(true)
  }
  const submitChecklistReview = async (decision: 'pass' | 'return') => {
    if (!doc?.checklist || !openRev) return
    const items = doc.checklist.items
    const unanswered = items.filter((it) => !checkAnswers[it.id]?.result)
    if (decision === 'pass') {
      if (unanswered.length) { setCheckError(`Answer every checklist item before passing — ${unanswered.length} still unanswered (first: “${unanswered[0].text}”).`); return }
      const bad = items.filter((it) => checkAnswers[it.id]?.result === 'not_ok')
      if (bad.length) { setCheckError(`You can't pass the check with ${bad.length} item${bad.length === 1 ? '' : 's'} marked Not OK — return it to the author instead.`); return }
    }
    if (decision === 'return' && !checkComment.trim()) { setCheckError('Say what needs fixing in the comment — the author sees it.'); return }
    const answers: DesignChecklistAnswer[] = items
      .filter((it) => checkAnswers[it.id]?.result)
      .map((it) => ({ checklist_item_id: it.id, result: checkAnswers[it.id].result as DesignChecklistAnswer['result'], remark: checkAnswers[it.id].remark.trim() || null }))
    const rev = openRev
    const ref = `${doc.doc_number} ${rev.revision_label}`
    setCheckError('')
    setBusy(true)
    setSuccess('')
    try {
      apply(await designApi.reviewRevisionWithChecklist(rev.id, decision, checkComment.trim() || undefined, answers), true)
      setSuccess(decision === 'pass' ? `${ref} checked — sent to ${rev.approver_name || 'the approver'}.` : `${ref} returned to ${rev.created_by_name || 'the author'}.`)
      setCheckOpen(false)
    } catch (err) {
      // Stays open so the checker keeps their answers; the reason shows inside the popup.
      setCheckError(extractErrorMessages(err, decision === 'pass' ? 'Passing the check failed.' : 'Returning failed.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  const startEditRevision = () => {
    if (!openRev) return
    setRevForm({
      change_summary: openRev.change_summary || '', reviewer_id: openRev.reviewer_id ? String(openRev.reviewer_id) : '',
      approver_id: openRev.approver_id ? String(openRev.approver_id) : '', ecn_id: openRev.ecn_id ? String(openRev.ecn_id) : '',
    })
    setError('')
    setEditingRevision(true)
  }
  const saveRevision = async () => {
    if (!openRev) return
    const ok = await act(() => designApi.updateRevision(openRev.id, {
      change_summary: revForm.change_summary, reviewer_id: revForm.reviewer_id ? Number(revForm.reviewer_id) : null,
      approver_id: revForm.approver_id ? Number(revForm.approver_id) : null, ecn_id: revForm.ecn_id ? Number(revForm.ecn_id) : null,
    }), 'Saving the revision failed.', `${openRev.revision_label} updated.`)
    if (ok) setEditingRevision(false)
  }

  const createRevision = async () => {
    if (!doc) return
    if (newRev.change_summary.trim().length < 3) { setError('Describe what is changing and why (the change summary is on the revision record).'); return }
    const ok = await act(() => designApi.startRevision(doc.id, {
      change_summary: newRev.change_summary.trim(), reviewer_id: newRev.reviewer_id ? Number(newRev.reviewer_id) : null,
      approver_id: newRev.approver_id ? Number(newRev.approver_id) : null, ecn_id: newRev.ecn_id ? Number(newRev.ecn_id) : null,
    }), 'Starting the revision failed.', 'New revision started — upload its files, then submit it for check.')
    if (ok) {
      setNewRevOpen(false)
      setNewRev({ change_summary: '', reviewer_id: '', approver_id: '', ecn_id: '' })
    }
  }

  const openUpload = () => { setUploadStaged([]); setError(''); setUploadOpen(true) }
  const uploadFiles = async () => {
    if (!openRev) return
    if (!uploadStaged.length) { setError('Pick at least one file to upload — drag it onto the box or click to browse.'); return }
    const n = uploadStaged.length
    const ok = await act(() => designApi.uploadRevisionFiles(openRev.id, uploadStaged, uploadRole), 'Upload failed.', `${n} file${n === 1 ? '' : 's'} uploaded to ${openRev.revision_label}.`)
    if (ok) { setUploadOpen(false); setUploadStaged([]) }
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
          <h1 data-tour="design-doc-header" style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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
        <button data-tour="design-doc-back-btn" onClick={() => router.push('/dashboard/design/documents')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && !popupOpen && (
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
          <div data-tour="design-doc-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {can('submit') && <button data-tour="design-doc-submit-btn" disabled={busy} style={primaryBtn} onClick={() => setConfirm('submit')}>Submit {openRev?.revision_label} for Check</button>}
            {can('review') && doc.checklist && <button data-tour="design-doc-checklist-btn" disabled={busy} style={primaryBtn} onClick={openChecklistReview}>Check against Checklist</button>}
            {can('review') && !doc.checklist && !doc.approval_engine && <button data-tour="design-doc-pass-check-btn" disabled={busy} style={primaryBtn} onClick={() => setPrompt('review_pass')}>Pass Check</button>}
            {can('review') && !doc.checklist && !doc.approval_engine && <button data-tour="design-doc-review-return-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setPrompt('review_return')}>Return to Author</button>}
            {can('approve') && !doc.approval_engine && <button data-tour="design-doc-approve-btn" disabled={busy} style={primaryBtn} onClick={() => setPrompt('approve_pass')}>{doc.customer_approval_required ? 'Approve for Customer' : <>Approve &amp; Release</>}</button>}
            {can('release') && <button data-tour="design-doc-release-btn" disabled={busy} style={primaryBtn} onClick={() => setPrompt('release')}>Release {openRev?.revision_label}</button>}
            {can('approve') && !doc.approval_engine && <button data-tour="design-doc-approve-return-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setPrompt('approve_return')}>Return to Author</button>}
            {can('recall') && <button data-tour="design-doc-recall-btn" disabled={busy} style={secondaryBtnStyle} onClick={() => setPrompt('recall')}>Recall to Draft</button>}
            {can('new_revision') && <button data-tour="design-doc-new-rev-btn" disabled={busy} style={primaryBtn} onClick={() => { setError(''); setNewRevOpen(true) }}>+ New Revision</button>}
            {can('discard_revision') && <button data-tour="design-doc-discard-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setConfirm('discard')}>Discard {openRev?.revision_label}</button>}
            {can('obsolete') && <button data-tour="design-doc-obsolete-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setPrompt('obsolete')}>Mark Obsolete</button>}
            {can('reactivate') && <button data-tour="design-doc-reactivate-btn" disabled={busy} style={secondaryBtnStyle} onClick={() => setConfirm('reactivate')}>Reactivate</button>}
            {can('delete') && <button data-tour="design-doc-delete-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setConfirm('delete')}>Delete Document</button>}
            {can('raise_ecr') && doc.released_revision_id && (
              <button data-tour="design-doc-raise-ecr-btn" disabled={busy} style={secondaryBtnStyle} onClick={() => router.push(recordHref('/dashboard/design/change-requests/new', doc, 'id', undefined, 'document_id'))}>Raise ECR</button>
            )}
          </div>

          {!doc.viewer_only && (
            // Check → approval of revisions submitted since the move to the central
            // approval engine (stages: Organization › Approval Workflows). The
            // checker still answers the review checklist with the button above.
            <ApprovalPanel
              entityType="design_document" entityId={doc.id} title="Check & approval"
              onChanged={() => { designApi.getDocument(doc.id).then((d) => apply(d, true)).catch(() => { /* panel shows its own error */ }) }}
            />
          )}

          {doc.viewer_only && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.2)', color: '#1e40af', fontSize: 13 }}>
              You&apos;re viewing released revisions only. Drafts and revisions in check or approval are visible to the Design team. To ask for a change, raise an ECR.
            </div>
          )}
          {openRev?.status === 'approved' && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(8,145,178,0.08)', border: '1px solid rgba(8,145,178,0.25)', color: '#0e7490', fontSize: 13 }}>
              {openRev.revision_label} is approved internally and waiting on {doc.customer_name || 'the customer'}. Send it on a customer submission (Reviews &amp; Approvals); it can be released once the customer approves it.
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Left: revision panel */}
            <div style={{ flex: '2 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={sectionStyle}>
                <div data-tour="design-doc-rev-chips" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
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
                    {selected.status === 'customer_rejected' && (
                      <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 12.5 }}>
                        <strong>Rejected by the customer — frozen.</strong> Start the next revision to address their comments{doc.released_revision_label ? `; ${doc.released_revision_label} stays the controlled revision` : ''}.
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 18, fontWeight: 700, color: TEXT.heading }}>{selected.revision_label}</span>
                      {pill(selected.status)}
                      {selected.returned_count > 0 && <span style={{ fontSize: 12, color: '#b45309' }}>returned {selected.returned_count}×</span>}
                      {selected.ecn_number && (
                        <span onClick={() => router.push(recordPath('/dashboard/design/change-notices', selected, 'ecn_id'))} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>
                          under {selected.ecn_number}
                        </span>
                      )}
                      <span style={{ flex: 1 }} />
                      {isOpenSelected && can('edit_revision') && !editingRevision && (
                        <button data-tour="design-doc-edit-rev-btn" type="button" style={{ ...smallSecondaryBtnStyle }} onClick={startEditRevision}>Edit revision</button>
                      )}
                    </div>

                    {(
                      <div data-tour="design-doc-rev-info" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
                        <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Change summary" value={selected.change_summary || '—'} /></div>
                        <InfoRow label="Prepared by" value={`${selected.created_by_name || '—'} · ${formatDate(selected.created_at)}`} />
                        <InfoRow label="Checked by" value={selected.reviewed_at ? `${selected.reviewed_by_name} · ${formatDate(selected.reviewed_at)}` : `${selected.reviewer_name || 'not named'} (pending)`} />
                        <InfoRow label="Approved by" value={selected.approved_at && selected.status !== 'draft' ? `${selected.approved_by_name} · ${formatDate(selected.approved_at)}` : `${selected.approver_name || 'not named'} (pending)`} />
                        <InfoRow label="Released" value={selected.released_at ? formatDateTime(selected.released_at) : '—'} />
                        {selected.review_comment && <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Checker remarks" value={selected.review_comment} /></div>}
                        {selected.approval_comment && <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Approver remarks" value={selected.approval_comment} /></div>}
                      </div>
                    )}

                    {seeFiles && (<>
                    <p data-tour="design-doc-files" style={{ ...sectionTitle, margin: '4px 0 8px' }}>Files</p>
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
                            <button type="button" style={{ ...smallSecondaryBtnStyle }} onClick={() => openFile(f, false)}>Open</button>
                            <button type="button" style={{ ...smallSecondaryBtnStyle }} onClick={() => openFile(f, true)}>Download</button>
                            {isOpenSelected && can('manage_files') && removeFiles && (
                              <button type="button" disabled={busy} style={{ ...smallDangerBtnStyle }}
                                onClick={() => act(() => designApi.removeRevisionFile(selected.id, f.id), 'Removing the file failed.', `${f.file_name} removed.`)}>
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {isOpenSelected && can('manage_files') && (
                      <button data-tour="design-doc-upload" type="button" disabled={busy} style={{ ...smallSecondaryBtnStyle, marginTop: 6 }} onClick={openUpload}>+ Upload files</button>
                    )}
                    </>)}
                  </>
                )}
              </div>

              <div style={sectionStyle}>
                <p data-tour="design-doc-history" style={sectionTitle}>Revision history</p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                    <thead>
                      <tr>{['Rev', 'Status', 'Change summary', 'Prepared', 'Checked', 'Approved', 'Released', 'Checklist'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {doc.revisions.map((r) => {
                        const results = r.review_results || []
                        const notOk = results.filter((x) => x.result === 'not_ok').length
                        const expanded = expandedRevId === r.id
                        return (
                          <Fragment key={r.id}>
                            <tr onClick={() => setSelectedRevId(r.id)} style={{ cursor: 'pointer', background: r.id === selectedRevId ? 'rgba(255,106,42,0.05)' : undefined }}>
                              <td style={{ ...tdStyle, fontWeight: 700 }}>{r.revision_label}</td>
                              <td style={tdStyle}>{pill(r.status)}</td>
                              <td style={{ ...tdStyle, maxWidth: 280 }}>{r.change_summary || '—'}{r.ecn_number ? <span style={{ color: TEXT.muted }}> ({r.ecn_number})</span> : null}</td>
                              <td style={tdStyle}>{r.created_by_name || '—'}</td>
                              <td style={tdStyle}>{r.reviewed_at ? r.reviewed_by_name : '—'}</td>
                              <td style={tdStyle}>{r.approved_at && r.status !== 'draft' ? r.approved_by_name : '—'}</td>
                              <td style={tdStyle}>
                                {formatDate(r.released_at)}
                                {r.released_by_name && r.released_by_name !== r.approved_by_name ? <div style={{ fontSize: 11, color: TEXT.muted }}>by {r.released_by_name}</div> : null}
                                {r.superseded_at ? <div style={{ fontSize: 11, color: TEXT.muted }}>superseded {formatDate(r.superseded_at)}</div> : null}
                              </td>
                              <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                                {results.length ? (
                                  <span onClick={() => setExpandedRevId(expanded ? null : r.id)} style={{ fontSize: 12, fontWeight: 600, color: notOk ? '#DC2626' : '#FF6A2A', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                    {results.length} answer{results.length === 1 ? '' : 's'}{notOk ? ` · ${notOk} not OK` : ''} {expanded ? '▴' : '▾'}
                                  </span>
                                ) : <span style={{ color: TEXT.muted }}>—</span>}
                              </td>
                            </tr>
                            {expanded && results.length > 0 && (
                              <tr>
                                <td colSpan={8} style={{ ...tdStyle, background: 'rgba(255,255,255,.5)', padding: '8px 14px' }}>
                                  {Array.from(new Set(results.map((x) => x.cycle))).sort((a, b) => a - b).map((cycle) => {
                                    const rows = results.filter((x) => x.cycle === cycle)
                                    return (
                                      <div key={cycle} style={{ marginBottom: 8 }}>
                                        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
                                          Check {cycle}{rows[0]?.reviewer_name ? ` · ${rows[0].reviewer_name}` : ''}{rows[0]?.created_at ? ` · ${formatDate(rows[0].created_at)}` : ''}
                                        </p>
                                        {rows.map((x) => (
                                          <div key={x.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '3px 0' }}>
                                            <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: `${RESULT_HEX[x.result]}1a`, color: RESULT_HEX[x.result], whiteSpace: 'nowrap', minWidth: 44, textAlign: 'center' }}>
                                              {RESULT_LABELS[x.result] || x.result}
                                            </span>
                                            <span style={{ fontSize: 12.5, color: TEXT.body }}>
                                              {x.item_text}
                                              {x.remark ? <span style={{ color: TEXT.muted }}> — {x.remark}</span> : null}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )
                                  })}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {!doc.viewer_only && (doc.customer_approval_required || doc.submissions.length > 0) && (
                <div style={sectionStyle}>
                  <p data-tour="design-doc-submissions" style={sectionTitle}>Customer submissions</p>
                  {doc.submissions.length === 0 ? (
                    <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
                      Not sent to {doc.customer_name || 'the customer'} yet. Once a revision is approved internally, add it to a customer submission under Reviews &amp; Approvals.
                    </p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                        <thead>
                          <tr>{['Transmittal', 'Rev', 'Status', 'Sent', 'Customer response', 'Responded'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {doc.submissions.map((sb) => {
                            const rhex = RESPONSE_HEX[sb.response] || '#78716c'
                            const shex = SUBMISSION_HEX[sb.status] || '#78716c'
                            return (
                              <tr key={`${sb.submission_id}-${sb.revision_id}`} onClick={() => router.push(recordPath('/dashboard/design/reviews/submissions', sb, 'submission_id'))} style={{ cursor: 'pointer' }}>
                                <td style={{ ...tdStyle, fontWeight: 700, color: '#FF6A2A' }}>{sb.submission_number}</td>
                                <td style={tdStyle}>{sb.revision_label || '—'}</td>
                                <td style={tdStyle}>
                                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${shex}1a`, color: shex, whiteSpace: 'nowrap' }}>
                                    {SUBMISSION_STATUS_LABELS[sb.status] || sb.status}
                                  </span>
                                </td>
                                <td style={tdStyle}>{formatDate(sb.sent_date)}</td>
                                <td style={{ ...tdStyle, maxWidth: 260 }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${rhex}1a`, color: rhex, whiteSpace: 'nowrap' }}>
                                    {CUSTOMER_RESPONSE_LABELS[sb.response] || sb.response}
                                  </span>
                                  {sb.response_comment && <div style={{ fontSize: 12, color: TEXT.secondary, marginTop: 4 }}>{sb.response_comment}</div>}
                                </td>
                                <td style={tdStyle}>{formatDate(sb.response_date)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {seeWhereUsed && (<div style={sectionStyle}>
                <p data-tour="design-doc-where-used" style={sectionTitle}>Where used</p>
                {doc.where_used.length === 0 ? (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>This drawing isn&apos;t referenced on any BOM line yet.</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                      <thead>
                        <tr>{['BOM', 'Rev', 'Product', 'Qty', 'Project / Machine'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {doc.where_used.map((w) => (
                          <tr key={`${w.bom_id}-${w.revision_id}`} onClick={() => router.push(recordPath('/dashboard/design/boms', w, 'bom_id'))} style={{ cursor: 'pointer' }}>
                            <td style={tdStyle}>
                              <span style={{ fontWeight: 700, color: '#FF6A2A' }}>{w.bom_number}</span>
                              <div style={{ fontSize: 11.5, color: TEXT.muted }}>{w.bom_title}</div>
                            </td>
                            <td style={tdStyle}>{w.revision_label} <span style={{ fontSize: 11.5, color: TEXT.muted }}>({STATUS_LABELS[w.revision_status]?.toLowerCase() || w.revision_status.replace(/_/g, ' ')})</span></td>
                            <td style={tdStyle}>{w.product_item_label || '—'}</td>
                            <td style={tdStyle}>{w.quantity ?? '—'}</td>
                            <td style={tdStyle}>{[w.pm_project_label, w.erp_project_label].filter(Boolean).join(' · ') || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>)}
            </div>

            {/* Right: details + timeline */}
            <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                  <p data-tour="design-doc-details" style={{ ...sectionTitle, margin: 0, flex: 1 }}>Details</p>
                  {can('edit') && !editingDetails && (
                    <button data-tour="design-doc-details-edit-btn" type="button" style={{ ...smallSecondaryBtnStyle }} onClick={startEditDetails}>Edit</button>
                  )}
                </div>
                {(
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {doc.description && <InfoRow label="Description" value={doc.description} />}
                    <InfoRow label="Owner" value={doc.owner_name || '—'} />
                    <InfoRow label="Project" value={doc.pm_project_label || '—'} />
                    <InfoRow label="Machine" value={doc.erp_project_label || '—'} />
                    <InfoRow label="Part (Store item)" value={doc.store_item_label || '—'} />
                    <InfoRow label="Department" value={doc.department_name || '—'} />
                    <InfoRow label="Customer" value={doc.customer_name ? `${doc.customer_name}${doc.customer_approval_required ? ' · approval required' : ''}` : '—'} />
                    {!doc.customer_name && doc.customer_approval_required && <InfoRow label="Customer approval" value="Required" />}
                    <InfoRow label="Standard" value={doc.standard_label || '—'} />
                    {doc.design_request_id ? (
                      <div>
                        <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }}>Design request</p>
                        <p onClick={() => router.push(recordPath('/dashboard/design/requests', doc, 'design_request_id'))} style={{ fontSize: 13, color: '#FF6A2A', fontWeight: 600, margin: 0, cursor: 'pointer' }}>
                          {doc.request_number || `Request #${doc.design_request_id}`}
                        </p>
                      </div>
                    ) : <InfoRow label="Design request" value="—" />}
                    {doc.legacy_number && <InfoRow label="Legacy number" value={doc.legacy_number} />}
                    <InfoRow label="Created" value={`${doc.created_by_name || '—'} · ${formatDate(doc.created_at)}`} />
                    {doc.open_ecns.length > 0 && (
                      <div>
                        <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }}>Approved change notices</p>
                        {doc.open_ecns.map((e) => (
                          <p key={e.id} onClick={() => router.push(recordPath('/dashboard/design/change-notices', e))} style={{ fontSize: 13, color: '#FF6A2A', fontWeight: 600, margin: 0, cursor: 'pointer' }}>{e.ecn_number} — {e.title}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {seeTimeline && (<div style={sectionStyle}>
                <p style={sectionTitle}>Timeline</p>
                {can('comment') && (
                <div data-tour="design-doc-comment" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input style={inputStyle} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={selected ? `Comment on ${selected.revision_label}…` : 'Add a comment…'}
                    onKeyDown={(e) => { if (e.key === 'Enter') postComment() }} />
                  <button type="button" disabled={busy || !comment.trim()} style={{ ...secondaryBtnStyle, whiteSpace: 'nowrap' }} onClick={postComment}>Post</button>
                </div>
                )}
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
              </div>)}
            </div>
          </div>
        </>
      )}

      {checkOpen && doc?.checklist && openRev && (
        <FormSheet width={880} tour="design-doc-check-form" icon="shield" title={`Check ${doc.doc_number} ${openRev.revision_label}`}
          subtitle={`${doc.checklist.name} — answer every item. You can pass only when nothing is Not OK; returning needs a comment for the author.`}
          onClose={() => { if (!busy) setCheckOpen(false) }} busy={busy}
          footer={<>
            <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => setCheckOpen(false)}>Cancel</button>
            <button type="button" disabled={busy} style={sheetBtn('primary', DANGER_RED, busy)} onClick={() => submitChecklistReview('return')}><SheetIcon name="undo" size={16} />{busy ? 'Saving…' : 'Return to Author'}</button>
            <button type="button" disabled={busy} style={sheetBtn('primary', '#16a34a', busy)} onClick={() => submitChecklistReview('pass')}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Pass Check'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={checkError} />
            <SheetSection icon="list" title="Checklist">
              <div style={{ border: `1px solid ${SHEET.LINE}`, borderRadius: 12, padding: '0 14px' }}>
                {doc.checklist.items.map((it, idx) => {
                  const ans = checkAnswers[it.id] || { result: '', remark: '' }
                  return (
                    <div key={it.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderTop: idx ? `1px solid ${SHEET.LINE}` : 'none', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12.5, color: SHEET.MUTED, width: 22, flex: 'none', paddingTop: 5 }}>{idx + 1}.</span>
                      <span style={{ flex: '1 1 260px', fontSize: 13, color: SHEET.INK, paddingTop: 4 }}>{it.text}</span>
                      <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
                        {(['ok', 'not_ok', 'na'] as const).map((res) => {
                          const active = ans.result === res
                          const hex = RESULT_HEX[res]
                          return (
                            <button key={res} type="button" onClick={() => setCheckAnswers({ ...checkAnswers, [it.id]: { ...ans, result: res } })}
                              style={{ padding: '5px 10px', borderRadius: 9999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${active ? hex : SHEET.LINE}`, background: active ? `${hex}1a` : '#fff', color: active ? hex : SHEET.BODY }}>
                              {RESULT_LABELS[res]}
                            </button>
                          )
                        })}
                      </div>
                      <input style={{ ...sheetInput, flex: '1 1 180px', width: 'auto', maxWidth: 240, padding: '6px 10px', fontSize: 12.5 }} value={ans.remark}
                        onChange={(e) => setCheckAnswers({ ...checkAnswers, [it.id]: { ...ans, remark: e.target.value } })} placeholder={ans.result === 'not_ok' ? 'What is wrong…' : 'Remark (optional)'} />
                    </div>
                  )
                })}
              </div>
            </SheetSection>
            <SheetSection icon="chat" title="Check comment">
              <label style={sheetLabel}>Overall remarks <span style={{ fontWeight: 400, color: SHEET.MUTED }}>(required when returning)</span></label>
              <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={checkComment} onChange={(e) => setCheckComment(e.target.value)} placeholder="Overall remarks — required when returning to the author" />
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {doc && newRevOpen && (
        <FormSheet width={640} tour="design-doc-newrev-form" icon="history" title={`Start revision R${(doc.revisions[0]?.revision_index ?? 0) + 1}`}
          subtitle={`${doc.doc_number} — the released revision stays in use until the new one is released.`}
          onClose={() => closePopup(() => setNewRevOpen(false))} busy={busy}
          footer={<>
            <button data-tour="design-doc-newrev-cancel-btn" type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => closePopup(() => setNewRevOpen(false))}>Cancel</button>
            <button data-tour="design-doc-newrev-start-btn" type="button" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={createRevision}><SheetIcon name="plus" size={16} />{busy ? 'Saving…' : 'Start Revision'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={error} />
            <SheetSection icon="edit" title="Change">
              <div data-tour="design-doc-newrev-summary">
                <label style={sheetLabel}>Change summary <Req /> — what changes and why</label>
                <textarea style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={newRev.change_summary} onChange={(e) => setNewRev({ ...newRev, change_summary: e.target.value })} placeholder="e.g. Gusset plate thickened 10 → 12 mm after FEA review" autoFocus />
              </div>
              <div data-tour="design-doc-newrev-ecn" style={{ marginTop: 12 }}>
                <label style={sheetLabel}>Under change notice <Optional /></label>
                <Select style={sheetInput} value={newRev.ecn_id} onChange={(e) => setNewRev({ ...newRev, ecn_id: e.target.value })}>
                  <option value="">{doc.open_ecns.length ? 'None' : 'No approved ECN lists this document'}</option>
                  {doc.open_ecns.map((e) => <option key={e.id} value={e.id}>{e.ecn_number} — {e.title}</option>)}
                </Select>
              </div>
            </SheetSection>
            <SheetSection icon="users" title="Signatories" extra={<Optional />}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div data-tour="design-doc-newrev-checker" style={{ flex: '1 1 220px' }}>
                  <label style={sheetLabel}>Checked by</label>
                  <SearchableSelect value={newRev.reviewer_id} onChange={(v) => setNewRev({ ...newRev, reviewer_id: v })} options={checkerOptions} placeholder="Select checker…" />
                </div>
                <div data-tour="design-doc-newrev-approver" style={{ flex: '1 1 220px' }}>
                  <label style={sheetLabel}>Approved by</label>
                  <SearchableSelect value={newRev.approver_id} onChange={(v) => setNewRev({ ...newRev, approver_id: v })} options={userOptions} placeholder="Select approver…" />
                </div>
              </div>
              <p style={sheetHint}>Both can be set later, before you submit for check.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {doc && editingRevision && openRev && (
        <FormSheet width={640} tour="design-doc-rev-edit-form" icon="edit" title={`Edit ${openRev.revision_label}`}
          subtitle={`${doc.doc_number} — change summary, signatories and change notice can change until the revision is submitted.`}
          onClose={() => closePopup(() => setEditingRevision(false))} busy={busy}
          footer={<>
            <button data-tour="design-doc-rev-cancel-btn" type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => closePopup(() => setEditingRevision(false))}>Cancel</button>
            <button data-tour="design-doc-rev-save-btn" type="button" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={saveRevision}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={error} />
            <SheetSection icon="edit" title="Change">
              <label style={sheetLabel}>Change summary</label>
              <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={revForm.change_summary} onChange={(e) => setRevForm({ ...revForm, change_summary: e.target.value })} autoFocus />
              <div style={{ marginTop: 12 }}>
                <label style={sheetLabel}>Under change notice <Optional /></label>
                <Select style={sheetInput} value={revForm.ecn_id} onChange={(e) => setRevForm({ ...revForm, ecn_id: e.target.value })}>
                  <option value="">None</option>
                  {doc.open_ecns.map((e) => <option key={e.id} value={e.id}>{e.ecn_number} — {e.title}</option>)}
                </Select>
              </div>
            </SheetSection>
            <SheetSection icon="users" title="Signatories">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 220px' }}>
                  <label style={sheetLabel}>Checked by</label>
                  <SearchableSelect value={revForm.reviewer_id} onChange={(v) => setRevForm({ ...revForm, reviewer_id: v })} options={checkerOptions} placeholder="Select checker…" />
                </div>
                <div style={{ flex: '1 1 220px' }}>
                  <label style={sheetLabel}>Approved by</label>
                  <SearchableSelect value={revForm.approver_id} onChange={(v) => setRevForm({ ...revForm, approver_id: v })} options={userOptions} placeholder="Select approver…" />
                </div>
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {doc && uploadOpen && openRev && (
        <FormSheet width={580} tour="design-doc-upload-form" icon="upload" title={`Upload files to ${openRev.revision_label}`}
          subtitle={`${doc.doc_number} — attach the controlled print (PDF) as primary and the CAD source as native.`}
          onClose={() => closePopup(() => setUploadOpen(false))} busy={busy}
          footer={<>
            <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => closePopup(() => setUploadOpen(false))}>Cancel</button>
            <button data-tour="design-doc-upload-save-btn" type="button" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={uploadFiles}><SheetIcon name="upload" size={16} />{busy ? 'Uploading…' : 'Upload'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={error} />
            <SheetSection icon="clip" title="Files">
              <div style={{ marginBottom: 12 }}>
                <label style={sheetLabel}>Add as <Req /></label>
                <Select style={sheetInput} value={uploadRole} onChange={(e) => setUploadRole(e.target.value)}>
                  {Object.entries(FILE_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </div>
              <label style={sheetLabel}>Files <Req /></label>
              <DesignFileDrop disabled={busy} onFiles={(list) => setUploadStaged((prev) => [...prev, ...Array.from(list || []).filter((f) => !prev.some((p) => p.name.toLowerCase() === f.name.toLowerCase()))])} />
              {uploadStaged.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {uploadStaged.map((f, i) => (
                    <span key={`${f.name}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '4px 10px', borderRadius: 999, background: '#f1f5f9', color: SHEET.BODY, maxWidth: '100%' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name} · {formatBytes(f.size)}</span>
                      <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setUploadStaged((prev) => prev.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: SHEET.MUTED, display: 'inline-flex' }}><SheetIcon name="x" size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
              <p style={sheetHint}>All files picked here get the role above — upload other roles in a second go. Files can be removed until the revision is submitted.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {doc && editingDetails && (
        <FormSheet tour="design-doc-details-form" icon="edit" title="Edit document details" subtitle={`${doc.doc_number} — the type and number can't change.`}
          onClose={() => closePopup(() => setEditingDetails(false))} busy={busy}
          footer={<>
            <button data-tour="design-doc-details-cancel-btn" type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => closePopup(() => setEditingDetails(false))}>Cancel</button>
            <button data-tour="design-doc-details-save-btn" type="button" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={saveDetails}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}</button>
          </>}>
          {error && <div style={{ padding: '20px 24px 0' }}><SheetError error={error} /></div>}
          <SheetColumns
            left={<>
              <SheetSection icon="doc" title="Document">
                <div data-tour="design-doc-edit-title" style={{ marginBottom: 12 }}><label style={sheetLabel}>Title <Req /></label><input style={sheetInput} value={details.title} onChange={(e) => setDetails({ ...details, title: e.target.value })} autoFocus /></div>
                <div data-tour="design-doc-edit-description" style={{ marginBottom: 12 }}><label style={sheetLabel}>Description <Optional /></label><textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={details.description} onChange={(e) => setDetails({ ...details, description: e.target.value })} /></div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                  <div data-tour="design-doc-edit-discipline" style={{ flex: '1 1 180px' }}>
                    <label style={sheetLabel}>Discipline</label>
                    <Select style={sheetInput} value={details.discipline} onChange={(e) => setDetails({ ...details, discipline: e.target.value })}>
                      {Object.entries(DISCIPLINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </div>
                  <div data-tour="design-doc-edit-owner" style={{ flex: '1 1 200px' }}><label style={sheetLabel}>Owner</label><SearchableSelect value={details.owner_id} onChange={(v) => setDetails({ ...details, owner_id: v })} options={ownerOptions} /></div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <div data-tour="design-doc-edit-standard" style={{ flex: '1 1 200px' }}><label style={sheetLabel}>Standard <Optional /></label><SearchableSelect value={details.standard_id} onChange={(v) => setDetails({ ...details, standard_id: v })} options={toOptions(standards, 'None')} /></div>
                  <div data-tour="design-doc-edit-legacy" style={{ flex: '1 1 180px' }}><label style={sheetLabel}>Legacy drawing number <Optional /></label><input style={sheetInput} value={details.legacy_number} maxLength={100} onChange={(e) => setDetails({ ...details, legacy_number: e.target.value })} placeholder="Old number, if migrated" /></div>
                </div>
              </SheetSection>
              <SheetSection icon="building" title="Customer" extra={<Optional />}>
                <div data-tour="design-doc-edit-customer" style={{ marginBottom: 10 }}><label style={sheetLabel}>Customer</label><SearchableSelect value={details.customer_id} onChange={(v) => setDetails({ ...details, customer_id: v })} options={toOptions(customers, 'None')} /></div>
                <label data-tour="design-doc-edit-customer-approval" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SHEET.BODY, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!details.customer_approval_required} onChange={(e) => setDetails({ ...details, customer_approval_required: e.target.checked ? '1' : '' })} /> Customer approval required
                </label>
              </SheetSection>
            </>}
            right={<>
              <SheetSection icon="link" title="Associations" extra={<Optional />}>
                <div data-tour="design-doc-edit-project" style={{ marginBottom: 12 }}><label style={sheetLabel}>Project</label><SearchableSelect value={details.pm_project_id} onChange={(v) => setDetails({ ...details, pm_project_id: v })} options={toOptions(projects, 'None')} /></div>
                <div data-tour="design-doc-edit-machine" style={{ marginBottom: 12 }}><label style={sheetLabel}>Machine</label><SearchableSelect value={details.erp_project_id} onChange={(v) => setDetails({ ...details, erp_project_id: v })} options={toOptions(machines, 'None')} /></div>
                <div data-tour="design-doc-edit-item" style={{ marginBottom: 12 }}><label style={sheetLabel}>Part (Store item)</label><SearchableSelect value={details.store_item_id} onChange={(v) => setDetails({ ...details, store_item_id: v })} options={toOptions(items, 'None')} /></div>
                <div style={{ marginBottom: 12 }}>
                  <label style={sheetLabel}>Part not in the list? Search Item Master</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input style={sheetInput} value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Code, name or part no."
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchItems() } }} />
                    <button type="button" style={sheetBtn('secondary', SHEET.INK, !itemSearch.trim())} disabled={!itemSearch.trim()} onClick={searchItems}><SheetIcon name="search" size={14} />Search</button>
                  </div>
                  {itemMsg && <p style={sheetHint}>{itemMsg}</p>}
                </div>
                <div data-tour="design-doc-edit-department" style={{ marginBottom: 12 }}><label style={sheetLabel}>Department</label><SearchableSelect value={details.department_id} onChange={(v) => setDetails({ ...details, department_id: v })} options={toOptions(departments, 'None')} /></div>
                <div data-tour="design-doc-edit-request">
                  <label style={sheetLabel}>Design request</label>
                  <SearchableSelect value={details.design_request_id} onChange={(v) => setDetails({ ...details, design_request_id: v })}
                    options={[
                      { value: '', label: 'None' },
                      // keep the current link selectable even if that request is no longer open
                      ...(doc.design_request_id && !requests.some((rq) => rq.id === doc.design_request_id) ? [{ value: String(doc.design_request_id), label: doc.request_number || `Request #${doc.design_request_id}` }] : []),
                      ...requests.map((rq) => ({ value: String(rq.id), label: `${rq.request_number} — ${rq.title}` })),
                    ]} />
                </div>
              </SheetSection>
            </>}
          />
        </FormSheet>
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
      {doc && prompt && (
        <ReasonSheet
          open
          key={prompt}
          icon={PROMPT_TEXT[prompt].icon}
          iconColor={PROMPT_TEXT[prompt].danger ? DANGER_RED : prompt === 'recall' ? SHEET.BLUE : '#16a34a'}
          title={prompt === 'approve_pass' && doc.customer_approval_required ? 'Approve for customer' : PROMPT_TEXT[prompt].title}
          subtitle={prompt === 'approve_pass' && doc.customer_approval_required
            ? `${doc.doc_number} needs ${doc.customer_name || 'customer'} approval: it becomes "Approved · awaiting customer" and is released only after the customer approves it on a submission.`
            : `${prompt === 'obsolete' ? doc.doc_number : `${doc.doc_number} ${openRev?.revision_label || ''}`.trim()} — ${PROMPT_TEXT[prompt].message}`}
          label={PROMPT_TEXT[prompt].field}
          requireValue={PROMPT_TEXT[prompt].required}
          requiredMessage={PROMPT_TEXT[prompt].requiredMessage || `${PROMPT_TEXT[prompt].field} is required — fill it in to continue.`}
          placeholder={PROMPT_TEXT[prompt].placeholder}
          confirmLabel={prompt === 'approve_pass' && doc.customer_approval_required ? 'Approve for Customer' : PROMPT_TEXT[prompt].label}
          busyLabel={PROMPT_TEXT[prompt].busy}
          errorFallback={PROMPT_TEXT[prompt].fallback}
          onConfirm={runPrompt}
          onCancel={() => setPrompt(null)}
        />
      )}
    </div>
  )
}

/** Drag-and-drop / click file picker limited to the Design file types. */
function DesignFileDrop({ onFiles, disabled }: { onFiles: (list: FileList | null) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div onClick={() => !disabled && ref.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) onFiles(e.dataTransfer.files) }}
      style={{ border: `1.5px dashed ${over ? SHEET.BLUE : '#cbd5e1'}`, borderRadius: 12, padding: '18px 12px', textAlign: 'center', cursor: disabled ? 'not-allowed' : 'pointer', background: over ? '#eff6ff' : '#fff' }}>
      <SheetIcon name="upload" size={22} color={SHEET.BLUE} />
      <div style={{ fontSize: 13, color: SHEET.BODY, marginTop: 6 }}>Drag and drop files here, or <span style={{ color: SHEET.BLUE, fontWeight: 600 }}>click to browse</span></div>
      <div style={{ fontSize: 11.5, color: SHEET.MUTED, marginTop: 2 }}>PDF, DWG, DXF, STEP, IGES, SolidWorks, Inventor, Office files or images</div>
      <input ref={ref} type="file" multiple hidden accept={DESIGN_FILE_ACCEPT} onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
    </div>
  )
}
