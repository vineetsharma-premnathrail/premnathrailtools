'use client'

import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { designApi } from '@/lib/api'
import { DesignBomDetail, DesignBomExplosionRow, DesignBomLine, DesignBomRevision, DesignChecklistAnswer, DesignLookupOption } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { secondaryBtnStyle, dangerBtnStyle, InfoRow, primaryBtnStyle, smallSecondaryBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, SheetIconName, SHEET, Req, Optional, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { DANGER_RED } from '@/components/design/DesignSheets'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { BOM_STATUS_LABELS, saveBlob, toOptions } from '@/components/design/designMeta'
import { useDesignFeature } from '@/components/design/useDesignFeature'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import BomLinesEditor, { BomImportButton, BomLineDraft, bomDraftsToPayload, bomLinesToDrafts, itemsFromBomLines } from '../BomLinesEditor'
import { recordHref, recordPath, useRecordId } from '@/lib/recordRef'
import OrderProjectPicker, { OrderProjectChip, OrderProjectValue } from '@/components/sales/OrderProjectPicker'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

const STATUS_HEX: Record<string, string> = {
  draft: '#78716c', in_review: '#2563EB', in_approval: '#7C3AED', released: '#16A34A', revising: '#0f766e', obsolete: '#DC2626', superseded: '#a8a29e',
}
const EVENT_LABELS: Record<string, string> = {
  bom_created: 'created the BOM', order_project_repeat: 'used as a repeat-model BOM for an order project', bom_updated: 'updated the details', bom_deleted: 'deleted the BOM', bom_obsoleted: 'marked the BOM obsolete',
  bom_reactivated: 'reactivated the BOM', bom_revision_started: 'started a new revision', bom_revision_updated: 'edited the revision',
  bom_revision_discarded: 'discarded the draft revision', bom_submitted: 'submitted for check', bom_recalled: 'recalled it to draft',
  bom_review_passed: 'passed the check', bom_review_returned: 'returned it from check', bom_approval_returned: 'returned it from approval',
  bom_released: 'released it', bom_superseded: 'superseded the revision', comment: 'commented',
}
const EVENT_HEX: Record<string, string> = {
  bom_released: '#16A34A', bom_review_passed: '#2563EB', bom_review_returned: '#DC2626', bom_approval_returned: '#DC2626',
  bom_obsoleted: '#DC2626', bom_submitted: '#7C3AED', bom_superseded: '#a8a29e', comment: '#FF6A2A',
}
const RESULT_LABELS: Record<string, string> = { ok: 'OK', not_ok: 'Not OK', na: 'N/A' }
const RESULT_HEX: Record<string, string> = { ok: '#16A34A', not_ok: '#DC2626', na: '#78716c' }

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
const sheetTh: React.CSSProperties = { textAlign: 'left', padding: '9px 10px', fontSize: 11.5, fontWeight: 600, color: SHEET.MUTED, background: SHEET.SOFT, borderBottom: `1px solid ${SHEET.LINE}` }
const sheetTd: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, color: SHEET.BODY, borderBottom: `1px solid ${SHEET.LINE}`, verticalAlign: 'top' }
const linkStyle: React.CSSProperties = { color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }
const smallLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }

function pill(status: string) {
  const hex = STATUS_HEX[status] || '#78716c'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {BOM_STATUS_LABELS[status] || status}
    </span>
  )
}

function mergeOptions(base: DesignLookupOption[], extra: DesignLookupOption[]): DesignLookupOption[] {
  const seen = new Set(base.map((o) => o.id))
  return [...base, ...extra.filter((o) => !seen.has(o.id))]
}

const OPEN_STATUSES = ['draft', 'in_review', 'in_approval']

type Confirm = 'recall' | 'discard' | 'delete' | 'reactivate' | null
type Prompt = 'approve_pass' | 'approve_return' | 'obsolete' | null

const CONFIRM_TEXT: Record<Exclude<Confirm, null>, { title: string; label: string }> = {
  recall: { title: 'Recall to draft?', label: 'Recall' },
  discard: { title: 'Discard this draft revision?', label: 'Discard' },
  delete: { title: 'Delete this BOM?', label: 'Delete' },
  reactivate: { title: 'Reactivate this BOM?', label: 'Reactivate' },
}
const PROMPT_TEXT: Record<Exclude<Prompt, null>, { title: string; message: string; field: string; placeholder: string; label: string; busy: string; required: boolean; danger?: boolean; icon: SheetIconName; requiredMessage?: string; fallback: string }> = {
  approve_pass: { title: 'Release this BOM revision', message: 'It becomes the controlled BOM. Drawing revisions on every line are frozen into it, and any previously released revision is superseded.', field: 'Release remarks', placeholder: 'Release remarks (optional)', label: 'Release', busy: 'Releasing…', required: false, icon: 'check', fallback: 'Release failed.' },
  approve_return: { title: 'Return to author', message: 'The revision goes back to draft. Say exactly what needs fixing.', field: 'What needs fixing', placeholder: 'What needs fixing…', label: 'Return', busy: 'Returning…', required: true, danger: true, icon: 'undo', requiredMessage: 'Say what needs fixing — the author sees your comment.', fallback: 'Returning failed.' },
  obsolete: { title: 'Mark BOM obsolete', message: 'The BOM is withdrawn from use. Its revisions stay on record.', field: 'Reason', placeholder: 'Reason — e.g. product discontinued, replaced by BOM-2026-0042', label: 'Mark Obsolete', busy: 'Saving…', required: true, danger: true, icon: 'alert', requiredMessage: 'Give a reason for marking the BOM obsolete.', fallback: 'Marking obsolete failed.' },
}

export default function DesignBomDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('design')
  const router = useRouter()
  const params = useParams()
  const { id, error: linkError } = useRecordId(params.id as string)
  // Role-level features (Design › BOMs); buttons follow the server's allowed_actions.
  const designFeature = useDesignFeature()
  const seeExplosion = designFeature('boms', 'explosion', 'view')
  const seeWhereUsed = designFeature('boms', 'where_used', 'view')
  const seeTimeline = designFeature('boms', 'timeline', 'view')

  const [bom, setBom] = useState<DesignBomDetail | null>(null)
  const [users, setUsers] = useState<DesignLookupOption[]>([])
  const [projects, setProjects] = useState<DesignLookupOption[]>([])
  const [machines, setMachines] = useState<DesignLookupOption[]>([])
  const [items, setItems] = useState<DesignLookupOption[]>([])
  const [documents, setDocuments] = useState<DesignLookupOption[]>([])
  const [requests, setRequests] = useState<DesignLookupOption[]>([])
  const [selectedRevId, setSelectedRevId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [success, setSuccess] = useState('')
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [prompt, setPrompt] = useState<Prompt>(null)

  const [editingHeader, setEditingHeader] = useState(false)
  const [header, setHeader] = useState<Record<string, string>>({})
  const [headerOp, setHeaderOp] = useState<OrderProjectValue | null>(null)
  const [newRevOpen, setNewRevOpen] = useState(false)
  const [newRev, setNewRev] = useState({ change_summary: '', reviewer_id: '', approver_id: '', ecn_id: '' })
  const [editingRevision, setEditingRevision] = useState(false)
  const [revForm, setRevForm] = useState({ change_summary: '', reviewer_id: '', approver_id: '', ecn_id: '' })
  const [revRows, setRevRows] = useState<BomLineDraft[]>([])
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submitForm, setSubmitForm] = useState({ reviewer_id: '', approver_id: '', comment: '' })
  const [reviewOpen, setReviewOpen] = useState(false)
  const [answers, setAnswers] = useState<Record<number, { result: '' | 'ok' | 'not_ok' | 'na'; remark: string }>>({})
  const [reviewComment, setReviewComment] = useState('')
  const [explosion, setExplosion] = useState<DesignBomExplosionRow[] | null>(null)
  const [explosionOpen, setExplosionOpen] = useState(false)
  const [comment, setComment] = useState('')

  const apply = (d: DesignBomDetail, keepSelection = false) => {
    setBom(d)
    if (!keepSelection || !d.revisions.some((r) => r.id === selectedRevId)) {
      setSelectedRevId((d.revisions.find((r) => OPEN_STATUSES.includes(r.status)) || d.revisions.find((r) => r.status === 'released') || d.revisions[0])?.id ?? null)
    }
    setExplosion(null)
    setExplosionOpen(false)
    setItems((prev) => mergeOptions(prev, d.revisions.flatMap((r) => itemsFromBomLines(r.lines))))
  }

  useEffect(() => {
    if (!isAuthorized || !id) return
    designApi.getBom(id)
      .then((d) => apply(d))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the BOM.')))
    Promise.all([designApi.lookupUsers(), designApi.lookupProjects(), designApi.lookupMachines(), designApi.lookupItems(), designApi.lookupDocuments()])
      .then(([u, p, m, i, d]) => { setUsers(u); setProjects(p); setMachines(m); setItems((prev) => mergeOptions(i, prev)); setDocuments(d) })
      .catch(() => { /* pickers only — the page still works read-only */ })
    designApi.listRequests()
      .then((r) => setRequests(r.map((q) => ({ id: q.id, label: `${q.request_number} — ${q.title}` }))))
      .catch(() => { /* no Requests tab — the request picker stays empty */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, id])

  const can = (action: string) => !!bom?.allowed_actions.includes(action)
  const openRev = useMemo(() => bom?.revisions.find((r) => OPEN_STATUSES.includes(r.status)) || null, [bom])
  const selected: DesignBomRevision | null = useMemo(() => bom?.revisions.find((r) => r.id === selectedRevId) || null, [bom, selectedRevId])
  const isOpenSelected = !!selected && selected.id === openRev?.id
  const userOptions = useMemo(() => toOptions(users.map((u) => ({ id: u.id, label: u.code ? `${u.label} — ${u.code}` : u.label })), 'Not decided yet'), [users])
  // Role "Assign to" rules (Role & Permissions › Design › BOMs); whoever is already named stays listed.
  const allowOwner = useAssigneeFilter('design:boms.owner')
  const allowChecker = useAssigneeFilter('design:boms.check_release')
  const checkerOptions = useMemo(() => toOptions(users.filter((u) => u.id === openRev?.reviewer_id || allowChecker(u.id))
    .map((u) => ({ id: u.id, label: u.code ? `${u.label} — ${u.code}` : u.label })), 'Not decided yet'), [users, openRev, allowChecker])
  const ownerOptions = useMemo(() => toOptions(users.filter((u) => u.id === bom?.owner_id || allowOwner(u.id))), [users, bom, allowOwner])
  const sortedLines = useMemo(() => [...(selected?.lines || [])].sort((a, b) => a.position - b.position), [selected])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><DesignNav /><InvalidRecordLink message={linkError} listHref="/dashboard/design/boms" listLabel="Back to BOMs" /></div>)

  const act = async (fn: () => Promise<DesignBomDetail>, fallback: string, done: string): Promise<boolean> => {
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

  const popupOpen = newRevOpen || submitOpen || reviewOpen || editingHeader || editingRevision

  const ref = (rev: DesignBomRevision | null) => `${bom?.bom_number} ${rev?.revision_label || ''}`.trim()

  const runConfirm = async () => {
    const which = confirm
    setConfirm(null)
    if (!bom || !which) return
    if (which === 'recall' && openRev) await act(() => designApi.recallBomRevision(openRev.id), 'Recall failed.', `${ref(openRev)} recalled to draft.`)
    if (which === 'discard' && openRev) await act(() => designApi.discardBomRevision(openRev.id), 'Discarding the revision failed.', `Draft ${openRev.revision_label} discarded.`)
    if (which === 'reactivate') await act(() => designApi.reactivateBom(bom.id), 'Reactivating failed.', `${bom.bom_number} is active again.`)
    if (which === 'delete') {
      setBusy(true)
      try {
        await designApi.deleteBom(bom.id)
        router.push('/dashboard/design/boms')
      } catch (err) {
        setError(extractErrorMessages(err, 'Deleting the BOM failed.'))
        setBusy(false)
      }
    }
  }

  // Reason popup (release / return / obsolete): errors throw so ReasonSheet shows them inside the popup.
  const runPrompt = async (value: string) => {
    const which = prompt
    if (!bom || !which) return
    const rev = openRev
    let done = ''
    let d: DesignBomDetail | null = null
    setSuccess('')
    if (which === 'obsolete') { d = await designApi.obsoleteBom(bom.id, value); done = `${bom.bom_number} marked obsolete.` }
    else if (rev && which === 'approve_pass') { d = await designApi.approveBomRevision(rev.id, 'pass', value); done = `${ref(rev)} released — it is now the controlled BOM.` }
    else if (rev && which === 'approve_return') { d = await designApi.approveBomRevision(rev.id, 'return', value); done = `${ref(rev)} returned to ${rev.created_by_name || 'the author'}.` }
    if (d) { apply(d, true); setError(''); setSuccess(done) }
    setPrompt(null)
  }

  const closePopup = (close: () => void) => { if (busy) return; close(); setError('') }

  const startEditHeader = () => {
    if (!bom) return
    setHeader({
      title: bom.title, description: bom.description || '', document_id: bom.document_id ? String(bom.document_id) : '',
      pm_project_id: bom.pm_project_id ? String(bom.pm_project_id) : '', erp_project_id: bom.erp_project_id ? String(bom.erp_project_id) : '',
      design_request_id: bom.design_request_id ? String(bom.design_request_id) : '', owner_id: bom.owner_id ? String(bom.owner_id) : '',
    })
    setHeaderOp(bom.order_project_id ? { projectId: bom.order_project_id, elementId: bom.order_project_element_id ?? null } : null)
    setError('')
    if (bom.design_request_id && bom.request_number) setRequests((prev) => mergeOptions(prev, [{ id: bom.design_request_id as number, label: bom.request_number as string }]))
    setEditingHeader(true)
  }
  const saveHeader = async () => {
    if (!bom) return
    if ((header.title || '').trim().length < 2) { setError('The title needs at least 2 characters.'); return }
    const num = (v: string) => (v ? Number(v) : null)
    const ok = await act(() => designApi.updateBom(bom.id, {
      title: header.title.trim(), description: header.description.trim() || null, document_id: num(header.document_id),
      pm_project_id: num(header.pm_project_id), erp_project_id: num(header.erp_project_id),
      design_request_id: num(header.design_request_id), owner_id: num(header.owner_id),
      order_project_id: headerOp?.projectId ?? null, order_project_element_id: headerOp?.elementId ?? null,
    }), 'Saving details failed.', 'Details saved.')
    if (ok) setEditingHeader(false)
  }

  const createRevision = async () => {
    if (!bom) return
    if (newRev.change_summary.trim().length < 3) { setError('Describe what is changing and why (the change summary is on the revision record).'); return }
    if (newRev.reviewer_id && newRev.reviewer_id === newRev.approver_id) { setError('The checker and the approver must be two different people.'); return }
    const ok = await act(() => designApi.startBomRevision(bom.id, {
      change_summary: newRev.change_summary.trim(), reviewer_id: newRev.reviewer_id ? Number(newRev.reviewer_id) : null,
      approver_id: newRev.approver_id ? Number(newRev.approver_id) : null, ecn_id: newRev.ecn_id ? Number(newRev.ecn_id) : null,
    }), 'Starting the revision failed.', 'New revision started with the released lines — edit them, then submit for check.')
    if (ok) {
      setNewRevOpen(false)
      setNewRev({ change_summary: '', reviewer_id: '', approver_id: '', ecn_id: '' })
    }
  }

  const startEditRevision = () => {
    if (!openRev) return
    setSelectedRevId(openRev.id)
    setRevForm({
      change_summary: openRev.change_summary || '', reviewer_id: openRev.reviewer_id ? String(openRev.reviewer_id) : '',
      approver_id: openRev.approver_id ? String(openRev.approver_id) : '', ecn_id: openRev.ecn_id ? String(openRev.ecn_id) : '',
    })
    setRevRows(bomLinesToDrafts(openRev.lines))
    setError('')
    setEditingRevision(true)
  }
  const saveRevision = async () => {
    if (!openRev) return
    if (revForm.reviewer_id && revForm.reviewer_id === revForm.approver_id) { setError('The checker and the approver must be two different people.'); return }
    const built = bomDraftsToPayload(revRows)
    if ('error' in built) { setError(built.error); return }
    const ok = await act(() => designApi.updateBomRevision(openRev.id, {
      change_summary: revForm.change_summary, reviewer_id: revForm.reviewer_id ? Number(revForm.reviewer_id) : null,
      approver_id: revForm.approver_id ? Number(revForm.approver_id) : null, ecn_id: revForm.ecn_id ? Number(revForm.ecn_id) : null,
      lines: built.lines,
    }), 'Saving the revision failed.', `${openRev.revision_label} saved.`)
    if (ok) setEditingRevision(false)
  }

  const openSubmit = () => {
    if (!openRev) return
    setError('')
    setSubmitForm({ reviewer_id: openRev.reviewer_id ? String(openRev.reviewer_id) : '', approver_id: openRev.approver_id ? String(openRev.approver_id) : '', comment: '' })
    setSubmitOpen(true)
  }
  const runSubmit = async () => {
    if (!openRev) return
    if (!submitForm.reviewer_id || !submitForm.approver_id) { setError('Name both a checker and an approver before submitting.'); return }
    if (submitForm.reviewer_id === submitForm.approver_id) { setError('The checker and the approver must be two different people.'); return }
    const checker = users.find((u) => String(u.id) === submitForm.reviewer_id)?.label
    const ok = await act(() => designApi.submitBomRevision(openRev.id, {
      reviewer_id: Number(submitForm.reviewer_id), approver_id: Number(submitForm.approver_id), comment: submitForm.comment.trim() || null,
    }), 'Submitting failed.', `${ref(openRev)} submitted — ${checker || 'the checker'} has been notified.`)
    if (ok) setSubmitOpen(false)
  }

  const openReview = () => {
    setError('')
    setAnswers({})
    setReviewComment('')
    setReviewOpen(true)
  }
  const runReview = async (decision: 'pass' | 'return') => {
    if (!openRev || !bom) return
    const checklist = bom.checklist
    const list: DesignChecklistAnswer[] = []
    if (checklist) {
      for (const item of checklist.items) {
        const a = answers[item.id]
        if (!a || !a.result) { setError(`Answer every checklist item (OK / Not OK / N/A) — “${item.text}” is not answered.`); return }
        list.push({ checklist_item_id: item.id, result: a.result, remark: a.remark.trim() || null })
      }
      if (decision === 'pass' && list.some((a) => a.result === 'not_ok')) {
        setError('A check with any “Not OK” item can\'t pass — return it to the author with what needs fixing.')
        return
      }
    }
    if (decision === 'return' && !reviewComment.trim()) { setError('Say what needs fixing — the author sees your comment.'); return }
    const ok = await act(() => designApi.reviewBomRevision(openRev.id, decision, reviewComment.trim() || undefined, list),
      decision === 'pass' ? 'Passing the check failed.' : 'Returning failed.',
      decision === 'pass' ? `${ref(openRev)} checked — sent to ${openRev.approver_name || 'the approver'} for release.` : `${ref(openRev)} returned to ${openRev.created_by_name || 'the author'}.`)
    if (ok) setReviewOpen(false)
  }

  const exportCsv = async () => {
    if (!bom) return
    setError('')
    try {
      const blob = await designApi.exportBom(bom.id, selected?.id)
      saveBlob(blob, `${bom.bom_number}_${selected?.revision_label || 'BOM'}.csv`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Exporting the BOM failed.'))
    }
  }

  const toggleExplosion = async () => {
    if (!bom) return
    if (explosionOpen) { setExplosionOpen(false); return }
    setExplosionOpen(true)
    if (explosion) return
    try {
      setExplosion(await designApi.explodeBom(bom.id, selected?.id))
    } catch (err) {
      setError(extractErrorMessages(err, 'Loading the multi-level explosion failed.'))
      setExplosionOpen(false)
    }
  }

  const postComment = async () => {
    if (!bom || !comment.trim()) return
    const ok = await act(() => designApi.commentBom(bom.id, comment.trim()), 'Posting the comment failed.', 'Comment added.')
    if (ok) setComment('')
  }

  const drawingRev = (line: DesignBomLine, rev: DesignBomRevision) =>
    ['released', 'superseded'].includes(rev.status) ? (line.document_revision_label || line.current_drawing_revision) : line.current_drawing_revision

  const confirmMessage = (() => {
    if (!bom || !confirm) return ''
    if (confirm === 'recall') return `${ref(openRev)} comes back to draft. ${openRev?.reviewer_name || 'The checker'} / ${openRev?.approver_name || 'the approver'} no longer need to act.`
    if (confirm === 'discard') return `Draft ${openRev?.revision_label} and its lines are removed.${bom.released_revision_label ? ` ${bom.released_revision_label} stays the controlled BOM.` : ''}`
    if (confirm === 'delete') return `${bom.bom_number} has never been released, so it will be deleted with its draft lines. This can't be undone.`
    return `${bom.bom_number} becomes active again and can be revised.`
  })()

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            {bom ? `Bill of Materials · ${bom.product_item_code || ''}${bom.product_item_name ? ` — ${bom.product_item_name}` : ''}` : 'Design Module'}
          </p>
          <h1 data-tour="design-bom-header" style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {bom ? <>{bom.bom_number} <span style={{ fontWeight: 500, color: TEXT.secondary }}>— {bom.title}</span> {pill(bom.display_status)}</> : 'BOM'}
          </h1>
          {bom && (
            <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
              Controlled revision: <strong style={{ color: TEXT.body }}>{bom.released_revision_label || 'none yet'}</strong>
              {bom.released_at ? ` (released ${formatDate(bom.released_at)})` : ''}
              {bom.open_revision_label ? ` · ${bom.open_revision_label} ${(BOM_STATUS_LABELS[bom.open_revision_status || ''] || '').toLowerCase()}${bom.pending_with_name ? ` with ${bom.pending_with_name}` : ''}` : ''}
            </p>
          )}
        </div>
        <button data-tour="design-bom-back-btn" onClick={() => router.push('/dashboard/design/boms')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && !popupOpen && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {success && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          {success}
        </div>
      )}
      {bom?.viewer_only && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.2)', color: '#1e40af', fontSize: 13 }}>
          You see the released BOM only (view access). To ask for a change, raise an Engineering Change Request.
        </div>
      )}
      {bom?.status === 'obsolete' && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          <strong>Obsolete — not for use.</strong> {bom.obsolete_reason}
        </div>
      )}

      {bom && (
        <>
          {/* Workflow action bar */}
          <div data-tour="design-bom-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {can('submit') && openRev?.status === 'draft' && <button data-tour="design-bom-submit-btn" disabled={busy} style={primaryBtn} onClick={openSubmit}>Submit {openRev.revision_label} for Check</button>}
            {can('review') && <button data-tour="design-bom-check-btn" disabled={busy} style={primaryBtn} onClick={openReview}>Check {openRev?.revision_label}</button>}
            {can('approve') && !bom.approval_engine && <button data-tour="design-bom-release-btn" disabled={busy} style={primaryBtn} onClick={() => { setError(''); setPrompt('approve_pass') }}>Release {openRev?.revision_label}</button>}
            {can('approve') && !bom.approval_engine && <button data-tour="design-bom-approve-return-btn" disabled={busy} style={dangerBtnStyle} onClick={() => { setError(''); setPrompt('approve_return') }}>Return to Author</button>}
            {can('recall') && <button data-tour="design-bom-recall-btn" disabled={busy} style={secondaryBtnStyle} onClick={() => setConfirm('recall')}>Recall to Draft</button>}
            {can('new_revision') && <button data-tour="design-bom-new-rev-btn" disabled={busy} style={primaryBtn} onClick={() => { setError(''); setNewRevOpen(true) }}>+ New Revision</button>}
            {can('discard_revision') && <button data-tour="design-bom-discard-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setConfirm('discard')}>Discard {openRev?.revision_label}</button>}
            {can('export') && <button data-tour="design-bom-export-btn" disabled={busy} style={secondaryBtnStyle} onClick={exportCsv}>Export {selected?.revision_label || ''} (CSV)</button>}
            {can('raise_ecr') && bom.released_revision_id && (
              <button data-tour="design-bom-raise-ecr-btn" disabled={busy} style={secondaryBtnStyle} onClick={() => router.push(recordHref('/dashboard/design/change-requests/new', bom, 'id', undefined, 'bom_id'))}>Raise Change Request</button>
            )}
            {can('obsolete') && <button data-tour="design-bom-obsolete-btn" disabled={busy} style={dangerBtnStyle} onClick={() => { setError(''); setPrompt('obsolete') }}>Mark Obsolete</button>}
            {can('reactivate') && <button data-tour="design-bom-reactivate-btn" disabled={busy} style={secondaryBtnStyle} onClick={() => setConfirm('reactivate')}>Reactivate</button>}
            {can('delete') && <button data-tour="design-bom-delete-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setConfirm('delete')}>Delete BOM</button>}
          </div>

          {!bom.viewer_only && (
            // Check → release of revisions submitted since the move to the central
            // approval engine. The checker still uses "Check" above (review checklist).
            <ApprovalPanel
              entityType="design_bom" entityId={bom.id} title="Check & release approval"
              onChanged={() => { designApi.getBom(bom.id).then((d) => apply(d, true)).catch(() => { /* panel shows its own error */ }) }}
            />
          )}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Left: revision + lines */}
            <div style={{ flex: '2 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={sectionStyle}>
                <div data-tour="design-bom-rev-chips" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                  <p style={{ ...sectionTitle, margin: 0, flex: '1 1 auto' }}>Revision</p>
                  {bom.revisions.map((r) => {
                    const active = r.id === selectedRevId
                    return (
                      <button key={r.id} type="button" onClick={() => { setSelectedRevId(r.id); setEditingRevision(false); setExplosion(null); setExplosionOpen(false) }} style={{
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
                    {selected.status === 'superseded' && (
                      <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 10, background: 'rgba(168,162,158,0.15)', border: '1px solid rgba(120,113,108,0.3)', color: '#57534e', fontSize: 12.5 }}>
                        <strong>Superseded — not for use.</strong> Kept for traceability. The controlled revision is {bom.released_revision_label || '—'}.
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
                      {isOpenSelected && can('edit_revision') && openRev?.status === 'draft' && !editingRevision && (
                        <button data-tour="design-bom-edit-rev-btn" type="button" style={{ ...smallSecondaryBtnStyle }} onClick={startEditRevision}>Edit revision &amp; lines</button>
                      )}
                    </div>

                    {editingRevision && isOpenSelected ? (
                      <div data-tour="design-bom-rev-edit-form" style={{ marginBottom: 6, background: '#fff', border: `1px solid ${SHEET.LINE}`, borderRadius: 14, padding: '18px 20px 6px' }}>
                        <SheetError error={error} />
                        <SheetSection icon="edit" title={`Edit ${openRev?.revision_label || 'revision'}`}>
                          <label style={sheetLabel}>Change summary</label>
                          <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={revForm.change_summary} onChange={(e) => setRevForm({ ...revForm, change_summary: e.target.value })} />
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
                            <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
                              <label style={sheetLabel}>Checked by</label>
                              <SearchableSelect value={revForm.reviewer_id} onChange={(v) => setRevForm({ ...revForm, reviewer_id: v })} options={checkerOptions} placeholder="Select checker…" />
                            </div>
                            <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
                              <label style={sheetLabel}>Approved by</label>
                              <SearchableSelect value={revForm.approver_id} onChange={(v) => setRevForm({ ...revForm, approver_id: v })} options={userOptions} placeholder="Select approver…" />
                            </div>
                            <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
                              <label style={sheetLabel}>Under change notice</label>
                              <Select style={sheetInput} value={revForm.ecn_id} onChange={(e) => setRevForm({ ...revForm, ecn_id: e.target.value })}>
                                <option value="">None</option>
                                {bom.open_ecns.map((e) => <option key={e.id} value={e.id}>{e.ecn_number} — {e.title}</option>)}
                              </Select>
                            </div>
                          </div>
                        </SheetSection>
                        <SheetSection icon="list" title="Lines"
                          extra={<div style={{ marginLeft: 'auto' }}><BomImportButton disabled={busy} hasLines={revRows.length > 0}
                            onLines={(imported, itemOpts, docOpts) => {
                              setItems((prev) => mergeOptions(prev, itemOpts))
                              setDocuments((prev) => mergeOptions(prev, docOpts))
                              setRevRows(imported)
                            }} /></div>}>
                          <BomLinesEditor
                            rows={revRows}
                            onChange={setRevRows}
                            items={items}
                            onItemsLoaded={(found) => setItems((prev) => mergeOptions(prev, found))}
                            documents={documents}
                            disabled={busy}
                          />
                        </SheetSection>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 0', borderTop: `1px solid ${SHEET.LINE}` }}>
                          <button data-tour="design-bom-rev-cancel-btn" type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => closePopup(() => setEditingRevision(false))}>Cancel</button>
                          <button data-tour="design-bom-rev-save-btn" type="button" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={saveRevision}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : `Save ${openRev?.revision_label || ''}`}</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div data-tour="design-bom-rev-info" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
                          <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Change summary" value={selected.change_summary || '—'} /></div>
                          <InfoRow label="Prepared by" value={`${selected.created_by_name || '—'} · ${formatDate(selected.created_at)}`} />
                          <InfoRow label="Checked by" value={selected.reviewed_at ? `${selected.reviewed_by_name} · ${formatDate(selected.reviewed_at)}` : `${selected.reviewer_name || 'not named'} (pending)`} />
                          <InfoRow label="Released by" value={selected.released_at ? `${selected.approved_by_name} · ${formatDate(selected.approved_at)}` : `${selected.approver_name || 'not named'} (pending)`} />
                          <InfoRow label="Released" value={selected.released_at ? formatDateTime(selected.released_at) : '—'} />
                          {selected.review_comment && <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Checker remarks" value={selected.review_comment} /></div>}
                          {selected.approval_comment && <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Approver remarks" value={selected.approval_comment} /></div>}
                        </div>

                        <p data-tour="design-bom-lines" style={{ ...sectionTitle, margin: '4px 0 8px' }}>Lines · {sortedLines.length}</p>
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                            <thead>
                              <tr>{['Pos.', 'Item', 'Qty', 'UOM', 'Drawing', 'Make / Buy', 'Approved makes', 'Sub-assembly', 'Remarks'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                            </thead>
                            <tbody>
                              {sortedLines.length === 0 ? (
                                <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No lines on {selected.revision_label}.</td></tr>
                              ) : sortedLines.map((l) => (
                                <tr key={l.id}>
                                  <td style={{ ...tdStyle, fontWeight: 700 }}>{l.position}</td>
                                  <td style={{ ...tdStyle, maxWidth: 320 }}>
                                    {l.store_item_id ? (
                                      <><strong>{l.item_code}</strong> — {l.item_name}{l.item_status && l.item_status !== 'active' ? <span style={{ color: '#b45309' }}> ({l.item_status})</span> : null}</>
                                    ) : (
                                      <span style={{ color: '#b45309' }}>
                                        <strong>New item: {l.new_item_name}</strong>
                                        {l.new_item_spec && <span style={{ display: 'block', fontSize: 11.5 }}>{l.new_item_spec}</span>}
                                        <span style={{ display: 'block', fontSize: 11.5 }}>Waiting for Store to create the item code{l.new_item_requested_at ? ` (asked ${formatDate(l.new_item_requested_at)})` : ''}</span>
                                      </span>
                                    )}
                                    {l.release_blocker && <span style={{ display: 'block', fontSize: 11.5, color: '#DC2626', fontWeight: 600, marginTop: 3 }}>⚠ {l.release_blocker}</span>}
                                  </td>
                                  <td style={tdStyle}>{l.quantity}</td>
                                  <td style={tdStyle}>{l.uom || '—'}</td>
                                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                                    {l.document_id ? (
                                      <><span style={linkStyle} onClick={() => router.push(recordPath('/dashboard/design/documents', l, 'document_id'))}>{l.doc_number}</span> {drawingRev(l, selected) || <span style={{ color: TEXT.muted }}>not released</span>}</>
                                    ) : '—'}
                                  </td>
                                  <td style={tdStyle}>{l.make_buy === 'make' ? 'Make' : 'Buy'}</td>
                                  <td style={{ ...tdStyle, maxWidth: 180 }}>{l.approved_makes.length ? l.approved_makes.join(', ') : '—'}</td>
                                  <td style={tdStyle}>
                                    {l.sub_bom_id ? <span style={linkStyle} onClick={() => router.push(recordPath('/dashboard/design/boms', l, 'sub_bom_id'))}>{l.sub_bom_number}</span> : '—'}
                                  </td>
                                  <td style={{ ...tdStyle, maxWidth: 200 }}>{l.remarks || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {isOpenSelected && sortedLines.some((l) => l.release_blocker) && (
                          <p style={{ fontSize: 12, color: '#b91c1c', margin: '8px 0 0' }}>
                            {sortedLines.filter((l) => l.release_blocker).length} line(s) block release — fix them before the approver can release {selected.revision_label}.
                          </p>
                        )}

                        {selected.review_results && selected.review_results.length > 0 && (
                          <div style={{ marginTop: 14 }}>
                            <p style={{ ...sectionTitle, margin: '0 0 8px' }}>Check results</p>
                            {selected.review_results.map((r) => (
                              <p key={r.id} style={{ fontSize: 12.5, color: TEXT.body, margin: '0 0 3px' }}>
                                <span style={{ fontWeight: 700, color: RESULT_HEX[r.result] }}>{RESULT_LABELS[r.result]}</span> — {r.item_text}
                                {r.remark ? <span style={{ color: TEXT.secondary }}> · {r.remark}</span> : null}
                                <span style={{ color: TEXT.muted }}> (cycle {r.cycle + 1}{r.reviewer_name ? `, ${r.reviewer_name}` : ''})</span>
                              </p>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>

              {/* Multi-level explosion */}
              {seeExplosion && (<div style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <p style={{ ...sectionTitle, margin: 0, flex: 1 }}>Multi-level explosion{selected ? ` · ${selected.revision_label}` : ''}</p>
                  <button data-tour="design-bom-explosion-btn" type="button" style={{ ...smallSecondaryBtnStyle }} onClick={toggleExplosion}>{explosionOpen ? 'Hide' : 'Show'}</button>
                </div>
                {explosionOpen && (
                  <div style={{ overflowX: 'auto', marginTop: 12 }}>
                    {!explosion ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p> : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
                        <thead>
                          <tr>{['Level', 'Item', 'Qty / assy', 'Total qty', 'UOM', 'Make / Buy', 'Drawing', 'Sub-BOM'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {explosion.length === 0 ? (
                            <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No lines.</td></tr>
                          ) : explosion.map((r, i) => (
                            <tr key={`${r.path}-${i}`}>
                              <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: TEXT.muted }}>{r.level} <span style={{ fontSize: 11 }}>· {r.path}</span></td>
                              <td style={{ ...tdStyle, paddingLeft: 10 + Math.max(0, r.level - 1) * 22 }}>
                                {r.item_code ? <><strong>{r.item_code}</strong> — {r.item_name}</> : <span style={{ color: '#b45309' }}>New item: {r.new_item_name}</span>}
                              </td>
                              <td style={tdStyle}>{r.quantity}</td>
                              <td style={{ ...tdStyle, fontWeight: 700 }}>{r.total_quantity}</td>
                              <td style={tdStyle}>{r.uom || '—'}</td>
                              <td style={tdStyle}>{r.make_buy === 'make' ? 'Make' : 'Buy'}</td>
                              <td style={tdStyle}>{r.doc_number ? `${r.doc_number} ${r.drawing_revision || ''}` : '—'}</td>
                              <td style={tdStyle}>{r.bom_id ? <span style={linkStyle} onClick={() => router.push(recordPath('/dashboard/design/boms', r, 'bom_id'))}>{r.bom_number}</span> : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>)}

              <div style={sectionStyle}>
                <p data-tour="design-bom-history" style={sectionTitle}>Revision history</p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                    <thead>
                      <tr>{['Rev', 'Status', 'Change summary', 'Lines', 'Prepared', 'Checked', 'Released'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {bom.revisions.map((r) => (
                        <tr key={r.id} onClick={() => { setSelectedRevId(r.id); setEditingRevision(false); setExplosion(null); setExplosionOpen(false) }} style={{ cursor: 'pointer', background: r.id === selectedRevId ? 'rgba(255,106,42,0.05)' : undefined }}>
                          <td style={{ ...tdStyle, fontWeight: 700 }}>{r.revision_label}</td>
                          <td style={tdStyle}>{pill(r.status)}</td>
                          <td style={{ ...tdStyle, maxWidth: 280 }}>{r.change_summary || '—'}{r.ecn_number ? <span style={{ color: TEXT.muted }}> ({r.ecn_number})</span> : null}</td>
                          <td style={tdStyle}>{r.line_count}</td>
                          <td style={tdStyle}>{r.created_by_name || '—'}</td>
                          <td style={tdStyle}>{r.reviewed_at ? r.reviewed_by_name : '—'}</td>
                          <td style={tdStyle}>{r.released_at ? `${r.approved_by_name || ''} · ${formatDate(r.released_at)}` : '—'}{r.superseded_at ? <div style={{ fontSize: 11, color: TEXT.muted }}>superseded {formatDate(r.superseded_at)}</div> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Right: details, where used, timeline */}
            <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                  <p data-tour="design-bom-details" style={{ ...sectionTitle, margin: 0, flex: 1 }}>Details</p>
                  {can('edit') && !editingHeader && (
                    <button data-tour="design-bom-details-edit-btn" type="button" style={{ ...smallSecondaryBtnStyle }} onClick={startEditHeader}>Edit</button>
                  )}
                </div>
                {(
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <InfoRow label="Product item" value={`${bom.product_item_code || '—'}${bom.product_item_name ? ` — ${bom.product_item_name}` : ''}`} />
                    {bom.description && <InfoRow label="Description" value={bom.description} />}
                    <div>
                      <p style={smallLabel}>GA / assembly drawing</p>
                      {bom.document_id ? <p onClick={() => router.push(recordPath('/dashboard/design/documents', bom, 'document_id'))} style={{ ...linkStyle, fontSize: 13, margin: 0 }}>{bom.doc_number}</p> : <p style={{ fontSize: 13, color: TEXT.body, margin: 0 }}>—</p>}
                    </div>
                    <InfoRow label="Owner" value={bom.owner_name || '—'} />
                    {bom.order_project_number && (
                      <div>
                        <p style={smallLabel}>Order project</p>
                        <OrderProjectChip opNumber={bom.order_project_number} elementNo={bom.order_project_element_no} label={bom.order_project_element_label}
                          onClick={() => router.push(recordPath('/dashboard/projects/order-projects', bom, 'order_project_id'))} />
                      </div>
                    )}
                    <InfoRow label="Project" value={bom.pm_project_label || '—'} />
                    <InfoRow label="Machine" value={bom.erp_project_label || '—'} />
                    <div>
                      <p style={smallLabel}>Design request</p>
                      {bom.design_request_id ? <p onClick={() => router.push(recordPath('/dashboard/design/requests', bom, 'design_request_id'))} style={{ ...linkStyle, fontSize: 13, margin: 0 }}>{bom.request_number || `#${bom.design_request_id}`}</p> : <p style={{ fontSize: 13, color: TEXT.body, margin: 0 }}>—</p>}
                    </div>
                    <InfoRow label="Created" value={formatDate(bom.created_at)} />
                    {bom.open_ecns.length > 0 && (
                      <div>
                        <p style={smallLabel}>Open change notices</p>
                        {bom.open_ecns.map((e) => (
                          <p key={e.id} onClick={() => router.push(recordPath('/dashboard/design/change-notices', e))} style={{ fontSize: 13, color: '#FF6A2A', fontWeight: 600, margin: 0, cursor: 'pointer' }}>{e.ecn_number} — {e.title}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {seeWhereUsed && (<div style={sectionStyle}>
                <p data-tour="design-bom-where-used" style={sectionTitle}>Where used</p>
                {bom.where_used.length === 0 ? (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{bom.product_item_code || 'This product'} isn&apos;t a line on any other BOM.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {bom.where_used.map((w) => (
                      <div key={`${w.bom_id}-${w.revision_id}`} style={{ fontSize: 12.5, color: TEXT.body }}>
                        <span style={linkStyle} onClick={() => router.push(recordPath('/dashboard/design/boms', w, 'bom_id'))}>{w.bom_number}</span> {w.revision_label}
                        <span style={{ color: TEXT.muted }}> ({BOM_STATUS_LABELS[w.revision_status] || w.revision_status}) · qty {w.quantity ?? '—'}</span>
                        <div style={{ fontSize: 11.5, color: TEXT.muted }}>{w.bom_title}{w.pm_project_label || w.erp_project_label ? ` · ${w.pm_project_label || w.erp_project_label}` : ''}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>)}

              {seeTimeline && (<div style={sectionStyle}>
                <p style={sectionTitle}>Timeline</p>
                {can('comment') && (
                  <div data-tour="design-bom-comment" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <input style={inputStyle} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…"
                      onKeyDown={(e) => { if (e.key === 'Enter') postComment() }} />
                    <button type="button" disabled={busy || !comment.trim()} style={{ ...secondaryBtnStyle, whiteSpace: 'nowrap' }} onClick={postComment}>Post</button>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 520, overflowY: 'auto' }}>
                  {bom.events.map((e) => (
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

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? CONFIRM_TEXT[confirm].title : ''}
        message={confirmMessage}
        confirmLabel={confirm ? CONFIRM_TEXT[confirm].label : 'OK'}
        danger={confirm === 'delete' || confirm === 'discard'}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
      {bom && newRevOpen && (
        <FormSheet width={640} tour="design-bom-newrev-form" icon="history" title={`Start revision R${Math.max(...bom.revisions.map((r) => r.revision_index), -1) + 1}`}
          subtitle={`${bom.bom_number} — the new draft starts with the released lines; change them in “Edit revision”.`}
          onClose={() => closePopup(() => setNewRevOpen(false))} busy={busy}
          footer={<>
            <button data-tour="design-bom-newrev-cancel-btn" type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => closePopup(() => setNewRevOpen(false))}>Cancel</button>
            <button data-tour="design-bom-newrev-start-btn" type="button" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={createRevision}><SheetIcon name="plus" size={16} />{busy ? 'Saving…' : 'Start Revision'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={error} />
            <SheetSection icon="edit" title="Change">
              <div data-tour="design-bom-newrev-summary">
                <label style={sheetLabel}>Change summary <Req /> — what changes and why</label>
                <textarea style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={newRev.change_summary} onChange={(e) => setNewRev({ ...newRev, change_summary: e.target.value })} placeholder="e.g. Fastener changed M12 → M16 per ECN-2026-0007" autoFocus />
              </div>
              <div data-tour="design-bom-newrev-ecn" style={{ marginTop: 12 }}>
                <label style={sheetLabel}>Under change notice <Optional /></label>
                <Select style={sheetInput} value={newRev.ecn_id} onChange={(e) => setNewRev({ ...newRev, ecn_id: e.target.value })}>
                  <option value="">{bom.open_ecns.length ? 'None' : 'No open ECN lists this BOM'}</option>
                  {bom.open_ecns.map((e) => <option key={e.id} value={e.id}>{e.ecn_number} — {e.title}</option>)}
                </Select>
              </div>
            </SheetSection>
            <SheetSection icon="users" title="Signatories" extra={<Optional />}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div data-tour="design-bom-newrev-checker" style={{ flex: '1 1 220px' }}>
                  <label style={sheetLabel}>Checked by</label>
                  <SearchableSelect value={newRev.reviewer_id} onChange={(v) => setNewRev({ ...newRev, reviewer_id: v })} options={checkerOptions} placeholder="Select checker…" />
                </div>
                <div data-tour="design-bom-newrev-approver" style={{ flex: '1 1 220px' }}>
                  <label style={sheetLabel}>Approved by</label>
                  <SearchableSelect value={newRev.approver_id} onChange={(v) => setNewRev({ ...newRev, approver_id: v })} options={userOptions} placeholder="Select approver…" />
                </div>
              </div>
              <p style={sheetHint}>Both can be set later, before you submit for check.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {bom && submitOpen && openRev && (
        <FormSheet width={580} tour="design-bom-submit-form" icon="send" title={`Submit ${openRev.revision_label} for check`}
          subtitle={`${bom.bom_number} — the checker reviews the lines, then the approver releases it.`}
          onClose={() => closePopup(() => setSubmitOpen(false))} busy={busy}
          footer={<>
            <button data-tour="design-bom-submit-cancel-btn" type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => closePopup(() => setSubmitOpen(false))}>Cancel</button>
            <button data-tour="design-bom-submit-confirm-btn" type="button" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={runSubmit}><SheetIcon name="send" size={16} />{busy ? 'Submitting…' : 'Submit for Check'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={error} />
            <SheetSection icon="users" title="Signatories">
              <div data-tour="design-bom-submit-checker" style={{ marginBottom: 12 }}>
                <label style={sheetLabel}>Checked by <Req /></label>
                <SearchableSelect value={submitForm.reviewer_id} onChange={(v) => setSubmitForm({ ...submitForm, reviewer_id: v })} options={checkerOptions.filter((o) => o.value !== String(user?.id))} placeholder="Select checker…" />
              </div>
              <div data-tour="design-bom-submit-approver">
                <label style={sheetLabel}>Approved (released) by <Req /></label>
                <SearchableSelect value={submitForm.approver_id} onChange={(v) => setSubmitForm({ ...submitForm, approver_id: v })} options={userOptions.filter((o) => o.value !== String(user?.id))} placeholder="Select approver…" />
              </div>
            </SheetSection>
            <SheetSection icon="chat" title="Note" extra={<Optional />}>
              <div data-tour="design-bom-submit-note">
                <label style={sheetLabel}>Note to the checker</label>
                <input style={sheetInput} value={submitForm.comment} onChange={(e) => setSubmitForm({ ...submitForm, comment: e.target.value })} placeholder="Optional" />
              </div>
              <p style={sheetHint}>Lines are locked until it&apos;s released or returned.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {bom && reviewOpen && openRev && (
        <FormSheet width={880} tour="design-bom-check-form" icon="shield" title={`Check ${ref(openRev)}`}
          subtitle={bom.checklist ? `Checklist “${bom.checklist.name}” — answer every item. Any “Not OK” means the revision must be returned.` : 'No BOM checklist is set up in the Library — check the lines and record your remarks.'}
          onClose={() => closePopup(() => setReviewOpen(false))} busy={busy}
          footer={<>
            <button data-tour="design-bom-check-cancel-btn" type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => closePopup(() => setReviewOpen(false))}>Cancel</button>
            <button data-tour="design-bom-check-return-btn" type="button" disabled={busy} style={sheetBtn('primary', DANGER_RED, busy)} onClick={() => runReview('return')}><SheetIcon name="undo" size={16} />{busy ? 'Saving…' : 'Return to Author'}</button>
            <button data-tour="design-bom-check-pass-btn" type="button" disabled={busy} style={sheetBtn('primary', '#16a34a', busy)} onClick={() => runReview('pass')}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Pass Check'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={error} />
            {bom.checklist && (
              <SheetSection icon="list" title="Checklist">
                <div style={{ overflowX: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                    <thead><tr>{['#', 'Check', 'Result', 'Remark'].map((h) => <th key={h} style={sheetTh}>{h}</th>)}</tr></thead>
                    <tbody>
                      {[...bom.checklist.items].sort((a, b) => a.sort_order - b.sort_order).map((item, idx) => {
                        const a = answers[item.id] || { result: '', remark: '' }
                        return (
                          <tr key={item.id}>
                            <td style={{ ...sheetTd, width: 32 }}>{idx + 1}</td>
                            <td style={sheetTd}>{item.text}</td>
                            <td style={{ ...sheetTd, whiteSpace: 'nowrap' }}>
                              {(['ok', 'not_ok', 'na'] as const).map((res) => {
                                const active = a.result === res
                                return (
                                  <button key={res} type="button" onClick={() => setAnswers({ ...answers, [item.id]: { ...a, result: res } })} style={{
                                    padding: '4px 10px', marginRight: 4, borderRadius: 9999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                                    border: `1px solid ${active ? RESULT_HEX[res] : SHEET.LINE}`, background: active ? `${RESULT_HEX[res]}1a` : '#fff',
                                    color: active ? RESULT_HEX[res] : SHEET.BODY,
                                  }}>{RESULT_LABELS[res]}</button>
                                )
                              })}
                            </td>
                            <td style={{ ...sheetTd, minWidth: 200 }}>
                              <input style={{ ...sheetInput, padding: '6px 9px', fontSize: 12.5 }} value={a.remark} placeholder="Optional"
                                onChange={(e) => setAnswers({ ...answers, [item.id]: { ...a, remark: e.target.value } })} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </SheetSection>
            )}
            <SheetSection icon="chat" title="Remarks">
              <div data-tour="design-bom-check-remarks">
                <label style={sheetLabel}>Check remarks <span style={{ fontWeight: 400, color: SHEET.MUTED }}>(required when returning)</span></label>
                <textarea style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} placeholder="What you checked / what needs fixing…" />
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {bom && editingHeader && (
        <FormSheet width={640} tour="design-bom-header-form" icon="edit" title="Edit BOM details" subtitle={`${bom.bom_number} — the product item can't change; a different product needs its own BOM.`}
          onClose={() => closePopup(() => setEditingHeader(false))} busy={busy}
          footer={<>
            <button data-tour="design-bom-header-cancel-btn" type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => closePopup(() => setEditingHeader(false))}>Cancel</button>
            <button data-tour="design-bom-header-save-btn" type="button" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={saveHeader}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={error} />
            <SheetSection icon="doc" title="Basic Information">
              <label style={sheetLabel}>Title <Req /></label>
              <input style={sheetInput} value={header.title} onChange={(e) => setHeader({ ...header, title: e.target.value })} autoFocus />
              <label style={{ ...sheetLabel, marginTop: 12 }}>Description <Optional /></label>
              <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={header.description} onChange={(e) => setHeader({ ...header, description: e.target.value })} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
                <div style={{ flex: '1 1 240px' }}><label style={sheetLabel}>GA / assembly drawing</label><SearchableSelect value={header.document_id} onChange={(v) => setHeader({ ...header, document_id: v })} options={toOptions(documents, 'None')} /></div>
                <div style={{ flex: '1 1 200px' }}><label style={sheetLabel}>Owner</label><SearchableSelect value={header.owner_id} onChange={(v) => setHeader({ ...header, owner_id: v })} options={ownerOptions} /></div>
              </div>
            </SheetSection>
            <SheetSection icon="link" title="Links" extra={<Optional />}>
              <div style={{ marginBottom: 12 }}><label style={sheetLabel}>Order project</label><OrderProjectPicker value={headerOp} requireElement={false} onChange={(v) => setHeaderOp(v)} /></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 240px' }}><label style={sheetLabel}>Project</label><SearchableSelect value={header.pm_project_id} onChange={(v) => setHeader({ ...header, pm_project_id: v })} options={toOptions(projects, 'None')} /></div>
                <div style={{ flex: '1 1 240px' }}><label style={sheetLabel}>Machine</label><SearchableSelect value={header.erp_project_id} onChange={(v) => setHeader({ ...header, erp_project_id: v })} options={toOptions(machines, 'None')} /></div>
              </div>
              <div style={{ marginTop: 12 }}><label style={sheetLabel}>Design request</label><SearchableSelect value={header.design_request_id} onChange={(v) => setHeader({ ...header, design_request_id: v })} options={toOptions(requests, 'None')} /></div>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {bom && prompt && (
        <ReasonSheet
          open
          key={prompt}
          icon={PROMPT_TEXT[prompt].icon}
          iconColor={PROMPT_TEXT[prompt].danger ? DANGER_RED : '#16a34a'}
          title={PROMPT_TEXT[prompt].title}
          subtitle={`${prompt === 'obsolete' ? bom.bom_number : ref(openRev)} — ${PROMPT_TEXT[prompt].message}`}
          label={PROMPT_TEXT[prompt].field}
          requireValue={PROMPT_TEXT[prompt].required}
          requiredMessage={PROMPT_TEXT[prompt].requiredMessage || `${PROMPT_TEXT[prompt].field} is required — fill it in to continue.`}
          placeholder={PROMPT_TEXT[prompt].placeholder}
          confirmLabel={PROMPT_TEXT[prompt].label}
          busyLabel={PROMPT_TEXT[prompt].busy}
          errorFallback={PROMPT_TEXT[prompt].fallback}
          onConfirm={runPrompt}
          onCancel={() => setPrompt(null)}
        />
      )}
    </div>
  )
}
