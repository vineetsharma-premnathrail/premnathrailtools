'use client'

import AnchoredDropdown from '@/components/design/AnchoredDropdown'
import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignChangeRequestDetail, DesignChangeRequestItem, DesignLookupOption } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { secondaryBtnStyle, dangerBtnStyle, primaryBtnStyle, RowCount, Pill, pillStyle, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { DANGER_RED } from '@/components/design/DesignSheets'
import ReasonSheet from '@/components/shared/ReasonSheet'
import {
  BOM_STATUS_LABELS, DISPOSITION_LABELS, ECN_EFFECTIVITY_LABELS, ECR_SOURCE_LABELS, ECR_STATUS_LABELS, ECR_URGENCY_LABELS, toOptions,
} from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import { recordPath, useRecordId } from '@/lib/recordRef'
import { useDesignFeature } from '@/components/design/useDesignFeature'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

const STATUS_HEX: Record<string, string> = { open: '#F59E0B', impact_checked: '#7C3AED', approved: '#16A34A', rejected: '#DC2626', deferred: '#78716c', withdrawn: '#a8a29e' }
const URGENCY_HEX: Record<string, string> = { low: '#78716c', normal: '#2563EB', high: '#F59E0B', critical: '#DC2626' }
const VOTE_LABELS: Record<string, string> = { approve: 'Approve', reject: 'Reject', defer: 'Defer' }
const VOTE_HEX: Record<string, string> = { approve: '#16A34A', reject: '#DC2626', defer: '#78716c' }
const WU_STATUS_HEX: Record<string, string> = { draft: '#78716c', in_review: '#2563EB', in_approval: '#7C3AED', released: '#16A34A', superseded: '#a8a29e' }
const EVENT_LABELS: Record<string, string> = {
  ecr_raised: 'raised the change request', ecr_updated: 'edited it', ecr_impact_checked: 'recorded the impact check',
  ecr_vote: 'voted', ecr_approved: 'approved it', ecr_rejected: 'rejected it', ecr_deferred: 'deferred it',
  ecr_reopened: 'reopened it for the board', ecr_withdrawn: 'withdrew it', ecn_created_from_ecr: 'created the change notice', comment: 'commented',
}
const EVENT_HEX: Record<string, string> = {
  ecr_approved: '#16A34A', ecr_rejected: '#DC2626', ecr_deferred: '#78716c', ecr_impact_checked: '#7C3AED', ecr_vote: '#2563EB',
  ecn_created_from_ecr: '#16A34A', ecr_withdrawn: '#a8a29e', comment: '#FF6A2A',
}

// Page (read-only view + timeline comment box).
const pageInputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
// Popups.
const inputStyle = sheetInput
const labelStyle = sheetLabel
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const primaryBtn: React.CSSProperties = primaryBtnStyle
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const dropStyle: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, borderRadius: 10, border: `1px solid ${SHEET.LINE}`, background: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 280, overflowY: 'auto' }
const optionStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderTop: `1px solid ${SHEET.LINE}` }

function pill(label: string, hex: string) {
  return <Pill label={label} hex={hex} />
}

function formatInr(v?: number | null): string {
  if (v === null || v === undefined) return '—'
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

type Panel = 'edit' | 'impact' | 'create_ecn' | null
type Prompt = 'vote_approve' | 'vote_reject' | 'vote_defer' | 'decide_approved' | 'decide_rejected' | 'decide_deferred' | 'withdraw' | null
type ItemRow = { kind: 'document' | 'bom'; id: number; label: string; note: string }

const PROMPT_TEXT: Record<Exclude<Prompt, null>, { title: string; message: string; placeholder: string; label: string; required: boolean; danger: boolean }> = {
  vote_approve: { title: 'Vote to approve', message: 'Your vote is recorded on the change board. You can change it until the head decides.', placeholder: 'Comment (optional)', label: 'Vote Approve', required: false, danger: false },
  vote_reject: { title: 'Vote to reject', message: 'Say why — the board and the person who raised it see your comment.', placeholder: 'Why reject…', label: 'Vote Reject', required: true, danger: true },
  vote_defer: { title: 'Vote to defer', message: 'Say why it should wait and until when.', placeholder: 'Why defer…', label: 'Vote Defer', required: true, danger: false },
  decide_approved: { title: 'Approve the change request', message: 'The ECR is approved — next, create the ECN with its effectivity and stock/WIP disposition.', placeholder: 'Decision remarks (optional)', label: 'Approve ECR', required: false, danger: false },
  decide_rejected: { title: 'Reject the change request', message: 'This is final — the person who raised it sees your reason.', placeholder: 'Reason…', label: 'Reject ECR', required: true, danger: true },
  decide_deferred: { title: 'Defer the change request', message: 'Deferred ECRs can be reopened for the board later.', placeholder: 'Reason and when to revisit…', label: 'Defer ECR', required: true, danger: false },
  withdraw: { title: 'Withdraw the change request', message: 'The ECR is closed as withdrawn and stays on record.', placeholder: 'Reason…', label: 'Withdraw', required: true, danger: true },
}
const PROMPT_FALLBACK: Record<Exclude<Prompt, null>, string> = {
  vote_approve: 'Voting failed.', vote_reject: 'Voting failed.', vote_defer: 'Voting failed.',
  decide_approved: 'Approving failed.', decide_rejected: 'Rejecting failed.', decide_deferred: 'Deferring failed.', withdraw: 'Withdrawing failed.',
}

export default function ChangeRequestDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('design')
  const router = useRouter()
  const params = useParams()
  const { id, error: linkError } = useRecordId(params.id as string)
  // Role-level features (Design › Changes); buttons follow the server's allowed_actions.
  const designFeature = useDesignFeature()
  const seeCost = designFeature('change_notices', 'cost_impact', 'view')
  const seeBoard = designFeature('change_notices', 'ecr_vote', 'view')
  const canApproveEcr = designFeature('change_notices', 'ecr_decision', 'approve')
  const canRejectEcr = designFeature('change_notices', 'ecr_decision', 'reject')

  const [ecr, setEcr] = useState<DesignChangeRequestDetail | null>(null)
  const [users, setUsers] = useState<DesignLookupOption[]>([])
  const [projects, setProjects] = useState<DesignLookupOption[]>([])
  const [machines, setMachines] = useState<DesignLookupOption[]>([])
  const [drawings, setDrawings] = useState<DesignLookupOption[]>([])
  const [bomOptions, setBomOptions] = useState<DesignLookupOption[]>([])
  const [qualityRecords, setQualityRecords] = useState<DesignLookupOption[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [panelError, setPanelError] = useState<string | string[]>('')
  const [success, setSuccess] = useState('')
  const [panel, setPanel] = useState<Panel>(null)
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [confirmReopen, setConfirmReopen] = useState(false)
  const [comment, setComment] = useState('')

  // Edit form
  const [form, setForm] = useState({ title: '', source: '', quality_id: '', source_reference: '', urgency: '', reason: '', proposed_change: '', pm_project_id: '', erp_project_id: '' })
  const [items, setItems] = useState<ItemRow[]>([])
  const [docSearch, setDocSearch] = useState('')
  const [bomSearch, setBomSearch] = useState('')
  // Impact form
  const [impact, setImpact] = useState({ summary: '', stock: '', open_orders: '', cost: '', delivery_days: '' })
  const [boardIds, setBoardIds] = useState<number[]>([])
  const [boardTouched, setBoardTouched] = useState(false)
  const [boardSearch, setBoardSearch] = useState('')
  // ECN form
  const [ecnForm, setEcnForm] = useState({
    target_date: '', effectivity_type: 'immediate', effectivity_date: '', effectivity_serial: '', effectivity_note: '',
    stock_disposition: 'not_applicable', wip_disposition: 'not_applicable', disposition_note: '',
  })

  useEffect(() => {
    if (!isAuthorized || !id) return
    designApi.getChangeRequest(id)
      .then(setEcr)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the change request.')))
    Promise.all([designApi.lookupUsers(), designApi.lookupProjects(), designApi.lookupMachines()])
      .then(([u, p, m]) => { setUsers(u); setProjects(p); setMachines(m) })
      .catch(() => { /* pickers only — the page still works read-only */ })
  }, [isAuthorized, id])

  // Edit-only pickers.
  useEffect(() => {
    if (panel !== 'edit') return
    Promise.all([designApi.lookupReleasedDocuments(), designApi.lookupBoms(true)])
      .then(([d, b]) => { setDrawings(d); setBomOptions(b) })
      .catch((err) => setPanelError(extractErrorMessages(err, 'Failed to load released drawings and BOMs.')))
  }, [panel])
  useEffect(() => {
    if (panel !== 'edit' || (form.source !== 'ncr' && form.source !== 'capa')) return
    designApi.lookupQualityRecords(form.source as 'ncr' | 'capa')
      .then(setQualityRecords)
      .catch((err) => setPanelError(extractErrorMessages(err, `Failed to load ${form.source.toUpperCase()} records from Quality.`)))
  }, [panel, form.source])

  const userName = useMemo(() => {
    const m: Record<number, string> = {}
    for (const u of users) m[u.id] = u.label
    for (const b of ecr?.board_members || []) if (b.name) m[b.user_id] = b.name
    return m
  }, [users, ecr])
  const boardMatches = useMemo(() => {
    const q = boardSearch.trim().toLowerCase()
    if (!q) return []
    return users.filter((u) => !boardIds.includes(u.id) && (u.label.toLowerCase().includes(q) || (u.code || '').toLowerCase().includes(q))).slice(0, 8)
  }, [boardSearch, users, boardIds])
  const docMatches = useMemo(() => {
    const q = docSearch.trim().toLowerCase()
    if (!q) return []
    return drawings.filter((d) => !items.some((r) => r.kind === 'document' && r.id === d.id) && d.label.toLowerCase().includes(q)).slice(0, 8)
  }, [docSearch, drawings, items])
  const bomMatches = useMemo(() => {
    const q = bomSearch.trim().toLowerCase()
    if (!q) return []
    return bomOptions.filter((b) => !items.some((r) => r.kind === 'bom' && r.id === b.id) && b.label.toLowerCase().includes(q)).slice(0, 8)
  }, [bomSearch, bomOptions, items])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><DesignNav /><InvalidRecordLink message={linkError} listHref="/dashboard/design/change-notices" listLabel="Back to changes" /></div>)

  const can = (a: string) => !!ecr?.allowed_actions.includes(a)

  const act = async (fn: () => Promise<DesignChangeRequestDetail>, fallback: string, done: string) => {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      setEcr(await fn())
      setSuccess(done)
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  // Same as act() but for a popup: the error is shown inside the popup.
  const panelAct = async (fn: () => Promise<DesignChangeRequestDetail>, fallback: string, done: string) => {
    setBusy(true)
    setPanelError('')
    setError('')
    setSuccess('')
    try {
      setEcr(await fn())
      setSuccess(done)
      return true
    } catch (err) {
      setPanelError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  const openPanel = (p: Panel) => {
    if (!ecr) return
    setError('')
    setPanelError('')
    if (p === panel) { setPanel(null); return }
    if (p === 'edit') {
      setForm({
        title: ecr.title, source: ecr.source,
        quality_id: ecr.source === 'ncr' && ecr.quality_ncr_id ? String(ecr.quality_ncr_id) : ecr.source === 'capa' && ecr.quality_capa_id ? String(ecr.quality_capa_id) : '',
        source_reference: ecr.source_reference || '', urgency: ecr.urgency, reason: ecr.reason, proposed_change: ecr.proposed_change,
        pm_project_id: ecr.pm_project_id ? String(ecr.pm_project_id) : '', erp_project_id: ecr.erp_project_id ? String(ecr.erp_project_id) : '',
      })
      setItems(ecr.items.map((i) => ({
        kind: i.bom_id ? 'bom' : 'document', id: (i.bom_id || i.document_id) as number,
        label: `${i.number || ''}${i.released_revision_label ? ` ${i.released_revision_label}` : ''} — ${i.title || ''}`, note: i.note || '',
      })))
      setDocSearch('')
      setBomSearch('')
    }
    if (p === 'impact') {
      setImpact({
        summary: ecr.impact_summary || '', stock: ecr.impact_stock || '', open_orders: ecr.impact_open_orders || '',
        cost: ecr.impact_cost != null ? String(ecr.impact_cost) : '', delivery_days: ecr.impact_delivery_days != null ? String(ecr.impact_delivery_days) : '',
      })
      const current = ecr.board_member_ids || []
      setBoardIds(current)
      setBoardTouched(false)
      setBoardSearch('')
      if (current.length === 0) {
        // First impact check: the board defaults to the Settings change board.
        designApi.getSettings().then((s) => setBoardIds(s.change_board_member_ids || [])).catch(() => { /* backend applies the default anyway */ })
      }
    }
    if (p === 'create_ecn') {
      setEcnForm({
        target_date: '', effectivity_type: 'immediate', effectivity_date: '', effectivity_serial: '', effectivity_note: '',
        stock_disposition: 'not_applicable', wip_disposition: 'not_applicable', disposition_note: '',
      })
    }
    setPanel(p)
  }

  const saveEdit = async () => {
    if (!ecr) return
    if (form.title.trim().length < 3) { setPanelError('Give the change request a title (at least 3 characters).'); return }
    if (form.reason.trim().length < 3 || form.proposed_change.trim().length < 3) { setPanelError('The reason and the proposed change both need at least 3 characters.'); return }
    if (items.length === 0) { setPanelError('Keep at least one released drawing or BOM on the change request.'); return }
    const ok = await panelAct(() => designApi.updateChangeRequest(ecr.id, {
      title: form.title.trim(), source: form.source, urgency: form.urgency,
      quality_ncr_id: form.source === 'ncr' && form.quality_id ? Number(form.quality_id) : null,
      quality_capa_id: form.source === 'capa' && form.quality_id ? Number(form.quality_id) : null,
      source_reference: form.source_reference.trim() || null,
      reason: form.reason.trim(), proposed_change: form.proposed_change.trim(),
      pm_project_id: form.pm_project_id ? Number(form.pm_project_id) : null,
      erp_project_id: form.erp_project_id ? Number(form.erp_project_id) : null,
      items: items.map((r) => ({ document_id: r.kind === 'document' ? r.id : null, bom_id: r.kind === 'bom' ? r.id : null, note: r.note.trim() || null })),
    }), 'Saving the change request failed.', 'Change request saved.')
    if (ok) setPanel(null)
  }

  const saveImpact = async () => {
    if (!ecr) return
    if (impact.summary.trim().length < 3) { setPanelError('Summarise the impact — which drawings/BOMs change and what it means for production.'); return }
    const cost = impact.cost.trim() ? Number(impact.cost) : null
    const days = impact.delivery_days.trim() ? Number(impact.delivery_days) : null
    if (cost !== null && Number.isNaN(cost)) { setPanelError('Cost impact must be a number in rupees, e.g. 25000.'); return }
    if (days !== null && (Number.isNaN(days) || !Number.isInteger(days))) { setPanelError('Delivery impact must be a whole number of days, e.g. 7.'); return }
    const sendBoard = boardTouched || (ecr.board_member_ids || []).length > 0 || boardIds.length > 0
    const ok = await panelAct(() => designApi.recordEcrImpact(ecr.id, {
      impact_summary: impact.summary.trim(), impact_stock: impact.stock.trim() || null, impact_open_orders: impact.open_orders.trim() || null,
      impact_cost: cost, impact_delivery_days: days,
      board_member_ids: sendBoard ? boardIds : null,
    }), 'Recording the impact failed.', 'Impact recorded — the change board has been asked to vote.')
    if (ok) setPanel(null)
  }

  const createEcn = async () => {
    if (!ecr) return
    if (ecnForm.effectivity_type === 'date' && !ecnForm.effectivity_date) { setPanelError('Effectivity is "From a date" — pick the date the change takes effect.'); return }
    if (ecnForm.effectivity_type === 'serial' && !ecnForm.effectivity_serial.trim()) { setPanelError('Effectivity is "From a serial number" — enter the first serial number it applies to.'); return }
    setBusy(true)
    setPanelError('')
    try {
      const res = await designApi.createEcnFromEcr(ecr.id, {
        target_date: ecnForm.target_date || null,
        effectivity_type: ecnForm.effectivity_type,
        effectivity_date: ecnForm.effectivity_type === 'date' ? ecnForm.effectivity_date || null : null,
        effectivity_serial: ecnForm.effectivity_type === 'serial' ? ecnForm.effectivity_serial.trim() || null : null,
        effectivity_note: ecnForm.effectivity_note.trim() || null,
        stock_disposition: ecnForm.stock_disposition, wip_disposition: ecnForm.wip_disposition,
        disposition_note: ecnForm.disposition_note.trim() || null,
      })
      router.push(recordPath('/dashboard/design/change-notices', res))
    } catch (err) {
      setPanelError(extractErrorMessages(err, 'Creating the ECN failed.'))
      setBusy(false)
    }
  }

  // Vote / decide / withdraw popup — throws on failure so ReasonSheet shows
  // the error inside the popup; it closes only on success.
  const runPrompt = async (value: string) => {
    const which = prompt
    if (!ecr || !which) return
    const v = value.trim()
    setError('')
    setSuccess('')
    let res: DesignChangeRequestDetail | null = null
    let done = ''
    if (which === 'vote_approve') { res = await designApi.voteEcr(ecr.id, 'approve', v || undefined); done = 'Your vote (approve) is recorded.' }
    if (which === 'vote_reject') { res = await designApi.voteEcr(ecr.id, 'reject', v); done = 'Your vote (reject) is recorded.' }
    if (which === 'vote_defer') { res = await designApi.voteEcr(ecr.id, 'defer', v); done = 'Your vote (defer) is recorded.' }
    if (which === 'decide_approved') { res = await designApi.decideEcr(ecr.id, 'approved', v || undefined); done = `${ecr.ecr_number} approved — create the ECN next.` }
    if (which === 'decide_rejected') { res = await designApi.decideEcr(ecr.id, 'rejected', v); done = `${ecr.ecr_number} rejected.` }
    if (which === 'decide_deferred') { res = await designApi.decideEcr(ecr.id, 'deferred', v); done = `${ecr.ecr_number} deferred.` }
    if (which === 'withdraw') { res = await designApi.withdrawEcr(ecr.id, v); done = `${ecr.ecr_number} withdrawn.` }
    if (res) setEcr(res)
    setSuccess(done)
    setPrompt(null)
  }

  const runReopen = async () => {
    setConfirmReopen(false)
    if (!ecr) return
    await act(() => designApi.reopenEcr(ecr.id), 'Reopening failed.', `${ecr.ecr_number} is back with the change board.`)
  }

  const postComment = async () => {
    if (!ecr || !comment.trim()) return
    if (await act(() => designApi.commentEcr(ecr.id, comment.trim()), 'Posting the comment failed.', 'Comment added.')) setComment('')
  }

  const itemHref = (i: DesignChangeRequestItem) => (i.bom_id ? recordPath('/dashboard/design/boms', i, 'bom_id') : recordPath('/dashboard/design/documents', i, 'document_id'))
  const myVote = ecr?.votes.find((v) => v.user_id === user?.id)

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Engineering Change Request</p>
          <h1 data-tour="design-ecr-header" style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>
            {ecr ? ecr.ecr_number : 'Change Request'}
          </h1>
        </div>
        <button data-tour="design-ecr-back-btn" onClick={() => router.push('/dashboard/design/change-notices')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {success && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          {success}
        </div>
      )}

      {ecr && (
        <>
          {/* What is being asked and why: summary on top, then the request's details. */}
          <DetailCard tour="design-ecr-request">
            <DetailSummary
              title={ecr.title}
              meta={<>
                {pill(ECR_STATUS_LABELS[ecr.status] || ecr.status, STATUS_HEX[ecr.status] || '#78716c')}
                {pill(`${ECR_URGENCY_LABELS[ecr.urgency] || ecr.urgency} urgency`, URGENCY_HEX[ecr.urgency] || '#78716c')}
                <span>· Raised by <strong style={{ color: TEXT.heading }}>{ecr.raised_by_name || '—'}</strong> on {formatDate(ecr.created_at)}</span>
                {['open', 'impact_checked'].includes(ecr.status) && <span>· Open {ecr.days_open} day{ecr.days_open === 1 ? '' : 's'}</span>}
              </>}
            />
            <DetailGroup title="Request">
              <DetailRow label="Reason">{ecr.reason}</DetailRow>
              <DetailRow label="Proposed change">{ecr.proposed_change}</DetailRow>
            </DetailGroup>
            <div data-tour="design-ecr-details">
              <DetailGroup title="Where it came from">
                <DetailRow label="Source">{ECR_SOURCE_LABELS[ecr.source] || ecr.source}</DetailRow>
                {ecr.ncr_number && <DetailRow label="NCR">{ecr.ncr_number}</DetailRow>}
                {ecr.capa_number && <DetailRow label="CAPA">{ecr.capa_number}</DetailRow>}
                <DetailRow label="Source reference">{ecr.source_reference}</DetailRow>
              </DetailGroup>
              <DetailGroup title="Linked to" last>
                <DetailRow label="Project">{ecr.pm_project_label}</DetailRow>
                <DetailRow label="Machine">{ecr.erp_project_label}</DetailRow>
                {ecr.ecn_id && (
                  <DetailRow label="Change notice">
                    <span onClick={() => router.push(recordPath('/dashboard/design/change-notices', ecr, 'ecn_id'))} style={{ color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>{ecr.ecn_number}</span>
                  </DetailRow>
                )}
              </DetailGroup>
            </div>
          </DetailCard>

          <div data-tour="design-ecr-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {can('impact') && <button data-tour="design-ecr-impact-btn" disabled={busy} style={primaryBtn} onClick={() => openPanel('impact')}>{ecr.status === 'open' ? 'Record Impact' : 'Update Impact'}</button>}
            {can('vote') && <button data-tour="design-ecr-vote-approve-btn" disabled={busy} style={primaryBtn} onClick={() => setPrompt('vote_approve')}>Vote Approve</button>}
            {can('vote') && <button data-tour="design-ecr-vote-reject-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setPrompt('vote_reject')}>Vote Reject</button>}
            {can('vote') && <button data-tour="design-ecr-vote-defer-btn" disabled={busy} style={secondaryBtnStyle} onClick={() => setPrompt('vote_defer')}>Vote Defer</button>}
            {can('decide') && canApproveEcr && <button data-tour="design-ecr-approve-btn" disabled={busy} style={primaryBtn} onClick={() => setPrompt('decide_approved')}>Approve ECR</button>}
            {can('decide') && canRejectEcr && <button data-tour="design-ecr-reject-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setPrompt('decide_rejected')}>Reject ECR</button>}
            {can('decide') && canRejectEcr && <button data-tour="design-ecr-defer-btn" disabled={busy} style={secondaryBtnStyle} onClick={() => setPrompt('decide_deferred')}>Defer ECR</button>}
            {can('create_ecn') && <button data-tour="design-ecr-create-ecn-btn" disabled={busy} style={primaryBtn} onClick={() => openPanel('create_ecn')}>Create ECN</button>}
            {can('reopen') && <button data-tour="design-ecr-reopen-btn" disabled={busy} style={secondaryBtnStyle} onClick={() => setConfirmReopen(true)}>Reopen for Board</button>}
            {can('edit') && <button data-tour="design-ecr-edit-btn" disabled={busy} style={secondaryBtnStyle} onClick={() => openPanel('edit')}>Edit</button>}
            {can('withdraw') && <button data-tour="design-ecr-withdraw-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setPrompt('withdraw')}>Withdraw</button>}
          </div>

          {ecr.ecn_id && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
              Approved and carried out under{' '}
              <span onClick={() => router.push(recordPath('/dashboard/design/change-notices', ecr, 'ecn_id'))} style={{ fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>{ecr.ecn_number}</span>.
            </div>
          )}
          {ecr.status === 'open' && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400E', fontSize: 13 }}>
              Waiting for Design to check the impact (where used, stock, open orders, cost, delivery) and send it to the change board.
            </div>
          )}
          {ecr.status === 'impact_checked' && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.2)', color: '#5b21b6', fontSize: 13 }}>
              With the change board — {ecr.votes_cast} of {ecr.votes_needed} vote{ecr.votes_needed === 1 ? '' : 's'} cast.
              {myVote ? ` Your vote: ${VOTE_LABELS[myVote.vote] || myVote.vote} (you can change it until the decision).` : ''}
              {ecr.votes_cast >= ecr.votes_needed ? ' Every member has voted — the Design head can decide.' : ''}
            </div>
          )}
          {ecr.status === 'approved' && !ecr.ecn_id && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.2)', color: '#1e40af', fontSize: 13 }}>
              Approved — the Design head now creates the ECN with its effectivity and stock / WIP disposition.
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '2 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div data-tour="design-ecr-items" style={sectionStyle}>
                <p style={sectionTitle}>Affected items &amp; where used</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {ecr.items.map((i) => (
                    <div key={i.id} style={{ padding: 12, borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.55)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: i.bom_id ? '#7C3AED' : '#2563EB' }}>{i.bom_id ? 'BOM' : 'Drawing'}</span>
                        <span onClick={() => router.push(itemHref(i))} style={{ fontSize: 13.5, fontWeight: 700, color: '#FF6A2A', cursor: 'pointer' }}>{i.number || '—'}</span>
                        <span style={{ fontSize: 13, color: TEXT.body }}>{i.title}</span>
                        {i.released_revision_label && <span style={{ fontSize: 12, color: TEXT.muted }}>released {i.released_revision_label}</span>}
                      </div>
                      {i.note && <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{i.note}</p>}
                      {i.where_used.length === 0 ? (
                        <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>Not used in any BOM.</p>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                            <thead>
                              <tr>{['Used in BOM', 'Revision', 'Qty', 'Project / Machine'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={i.where_used.length} />}</th>)}</tr>
                            </thead>
                            <tbody>
                              {i.where_used.map((w) => (
                                <tr key={`${w.bom_id}-${w.revision_id}`} onClick={() => router.push(recordPath('/dashboard/design/boms', w, 'bom_id'))} style={{ cursor: 'pointer' }}>
                                  <td style={tdStyle}><strong>{w.bom_number}</strong><div style={{ color: TEXT.muted }}>{w.bom_title}{w.product_item_label ? ` · ${w.product_item_label}` : ''}</div></td>
                                  <td style={tdStyle}><strong style={{ marginRight: 6 }}>{w.revision_label}</strong>{pill(BOM_STATUS_LABELS[w.revision_status] || w.revision_status, WU_STATUS_HEX[w.revision_status] || '#78716c')}</td>
                                  <td style={tdStyle}>{w.quantity ?? '—'}</td>
                                  <td style={tdStyle}>{[w.pm_project_label, w.erp_project_label].filter(Boolean).join(' · ') || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                  {ecr.items.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No affected items listed.</p>}
                </div>
              </div>

              <div data-tour="design-ecr-impact" style={sectionStyle}>
                <p style={sectionTitle}>Impact</p>
                {ecr.impact_checked_at ? (
                  <DetailGroup last>
                    <DetailRow label="Summary">{ecr.impact_summary}</DetailRow>
                    <DetailRow label="Stock affected">{ecr.impact_stock}</DetailRow>
                    <DetailRow label="Open orders affected">{ecr.impact_open_orders}</DetailRow>
                    {seeCost && <DetailRow label="Cost impact">{formatInr(ecr.impact_cost)}</DetailRow>}
                    <DetailRow label="Delivery impact">{ecr.impact_delivery_days != null ? `${ecr.impact_delivery_days} day${ecr.impact_delivery_days === 1 ? '' : 's'}` : null}</DetailRow>
                    <DetailRow label="Checked by">{`${ecr.impact_checked_by_name || '—'} · ${formatDateTime(ecr.impact_checked_at)}`}</DetailRow>
                  </DetailGroup>
                ) : (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Not checked yet — the Design team records the impact before the change board votes.</p>
                )}
              </div>

              <div data-tour="design-ecr-board" style={sectionStyle}>
                <p style={sectionTitle}>Change board</p>
                {!seeBoard ? (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Your role doesn&apos;t include the change board view (Design › Changes › Change board vote).</p>
                ) : ecr.board_members.length === 0 ? (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>The board is set when the impact is recorded.</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: ecr.votes.length ? 14 : 0 }}>
                    {ecr.board_members.map((b) => (
                      <div key={b.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.55)' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{b.name || userName[b.user_id] || `User #${b.user_id}`}</span>
                        {b.vote ? pill(VOTE_LABELS[b.vote] || b.vote, VOTE_HEX[b.vote] || '#78716c') : <span style={{ fontSize: 12, color: TEXT.muted }}>not voted</span>}
                      </div>
                    ))}
                  </div>
                )}
                {ecr.votes.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
                      <thead>
                        <tr>{['Member', 'Vote', 'Comment', 'When'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={ecr.votes.length} />}</th>)}</tr>
                      </thead>
                      <tbody>
                        {ecr.votes.map((v) => (
                          <tr key={v.id}>
                            <td style={tdStyle}>{v.user_name || userName[v.user_id] || `User #${v.user_id}`}</td>
                            <td style={tdStyle}>{pill(VOTE_LABELS[v.vote] || v.vote, VOTE_HEX[v.vote] || '#78716c')}</td>
                            <td style={{ ...tdStyle, maxWidth: 320, whiteSpace: 'pre-wrap' }}>{v.comment || '—'}</td>
                            <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDateTime(v.updated_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {ecr.decided_at && (
                  <div style={{ marginTop: 14 }}>
                    <DetailRow label={`Decision — ${ECR_STATUS_LABELS[ecr.status] || ecr.status}`}>{`${ecr.decided_by_name || '—'} · ${formatDate(ecr.decided_at)}${ecr.decision_comment ? ` — ${ecr.decision_comment}` : ''}`}</DetailRow>
                  </div>
                )}
              </div>
            </div>

            <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div data-tour="design-ecr-timeline" style={sectionStyle}>
                <p style={sectionTitle}>Timeline</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input style={pageInputStyle} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…" onKeyDown={(e) => { if (e.key === 'Enter') postComment() }} />
                  <button type="button" disabled={busy || !comment.trim()} style={{ ...secondaryBtnStyle, whiteSpace: 'nowrap' }} onClick={postComment}>Post</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 520, overflowY: 'auto' }}>
                  {ecr.events.map((e) => (
                    <div key={e.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: `1px solid ${BORDER.light}` }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, flex: 'none', background: EVENT_HEX[e.action] || '#a8a29e' }} />
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 12.5, color: TEXT.body, margin: 0 }}>
                          <strong>{e.actor_name || 'System'}</strong> {EVENT_LABELS[e.action] || e.action.replace(/_/g, ' ')}
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
        open={confirmReopen}
        title="Reopen for the change board?"
        message={`${ecr?.ecr_number || 'The ECR'} goes back to the change board for a new decision.`}
        confirmLabel="Reopen"
        onConfirm={runReopen}
        onCancel={() => setConfirmReopen(false)}
      />
      {ecr && prompt && (
        <ReasonSheet
          open
          key={prompt}
          icon={prompt.endsWith('approve') || prompt === 'decide_approved' ? 'check' : prompt.endsWith('defer') || prompt === 'decide_deferred' ? 'clock' : 'x'}
          iconColor={PROMPT_TEXT[prompt].danger ? DANGER_RED : prompt.endsWith('approve') || prompt === 'decide_approved' ? '#16a34a' : SHEET.BLUE}
          title={PROMPT_TEXT[prompt].title}
          subtitle={`${ecr.ecr_number} — ${ecr.title}`}
          label="Comment"
          requireValue={PROMPT_TEXT[prompt].required}
          requiredMessage={prompt === 'withdraw' ? 'Give a reason for withdrawing the change request.' : 'A comment is required for this — say why, the board and the person who raised it see it.'}
          placeholder={PROMPT_TEXT[prompt].placeholder}
          hint={PROMPT_TEXT[prompt].message}
          confirmLabel={PROMPT_TEXT[prompt].label}
          errorFallback={PROMPT_FALLBACK[prompt]}
          onConfirm={runPrompt}
          onCancel={() => setPrompt(null)}
        />
      )}

      {ecr && panel === 'create_ecn' && (
        <FormSheet tour="design-ecr-ecnpanel" width={720} icon="doc" iconColor="#16a34a" title="Create change notice" subtitle={`From ${ecr.ecr_number} — ${ecr.title}`}
          onClose={() => setPanel(null)} busy={busy}
          footer={<>
            <button type="button" data-tour="design-ecr-ecn-cancel-btn" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => setPanel(null)}>Cancel</button>
            <button type="button" data-tour="design-ecr-ecn-save-btn" disabled={busy} style={sheetBtn('primary', '#16a34a', busy)} onClick={createEcn}>
              <SheetIcon name="plus" size={16} />{busy ? 'Creating…' : 'Create ECN'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={panelError} />
            <p style={{ ...sheetHint, margin: '0 0 16px' }}>
              The ECN is created already approved (the board decided), listing every affected drawing and BOM — owners can raise revisions under it straight away.
            </p>
            <SheetSection icon="calendar" title="Effectivity">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div data-tour="design-ecr-ecn-target-date" style={{ flex: '0 1 170px', minWidth: 160 }}>
                  <label style={labelStyle}>Target date</label>
                  <DateField value={ecnForm.target_date} onChange={(v) => setEcnForm({ ...ecnForm, target_date: v })} />
                </div>
                <div data-tour="design-ecr-ecn-effectivity" style={{ flex: '0 1 250px', minWidth: 220 }}>
                  <label style={labelStyle}>Change takes effect</label>
                  <Select style={inputStyle} value={ecnForm.effectivity_type} onChange={(e) => setEcnForm({ ...ecnForm, effectivity_type: e.target.value })}>
                    {Object.entries(ECN_EFFECTIVITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </div>
                {ecnForm.effectivity_type === 'date' && (
                  <div style={{ flex: '0 1 170px', minWidth: 160 }}>
                    <label style={labelStyle}>Effective from <Req /></label>
                    <DateField value={ecnForm.effectivity_date} onChange={(v) => setEcnForm({ ...ecnForm, effectivity_date: v })} />
                  </div>
                )}
                {ecnForm.effectivity_type === 'serial' && (
                  <div style={{ flex: '0 1 200px', minWidth: 170 }}>
                    <label style={labelStyle}>From serial no. <Req /></label>
                    <input style={inputStyle} value={ecnForm.effectivity_serial} onChange={(e) => setEcnForm({ ...ecnForm, effectivity_serial: e.target.value })} maxLength={100} />
                  </div>
                )}
              </div>
              <div data-tour="design-ecr-ecn-effectivity-note" style={{ marginTop: 12 }}>
                <label style={labelStyle}>Effectivity note</label>
                <input style={inputStyle} value={ecnForm.effectivity_note} onChange={(e) => setEcnForm({ ...ecnForm, effectivity_note: e.target.value })}
                  placeholder={ecnForm.effectivity_type === 'project' ? 'Applies to the ECR\'s Project / Machine' : 'e.g. dispatched units not retrofitted'} />
              </div>
            </SheetSection>
            <SheetSection icon="box" title="Stock & WIP disposition">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div data-tour="design-ecr-ecn-stock" style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={labelStyle}>Stock on hand</label>
                  <Select style={inputStyle} value={ecnForm.stock_disposition} onChange={(e) => setEcnForm({ ...ecnForm, stock_disposition: e.target.value })}>
                    {Object.entries(DISPOSITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </div>
                <div data-tour="design-ecr-ecn-wip" style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={labelStyle}>Work in progress</label>
                  <Select style={inputStyle} value={ecnForm.wip_disposition} onChange={(e) => setEcnForm({ ...ecnForm, wip_disposition: e.target.value })}>
                    {Object.entries(DISPOSITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </div>
              </div>
              <div data-tour="design-ecr-ecn-disposition-note" style={{ marginTop: 12 }}>
                <label style={labelStyle}>Disposition note</label>
                <input style={inputStyle} value={ecnForm.disposition_note} onChange={(e) => setEcnForm({ ...ecnForm, disposition_note: e.target.value })} placeholder="e.g. rework the 12 brackets in stock" />
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {ecr && panel === 'impact' && (
        <FormSheet tour="design-ecr-impactpanel" icon="search" iconColor="#7c3aed" title={ecr.status === 'open' ? 'Record impact' : 'Update impact'} subtitle={`${ecr.ecr_number} — ${ecr.title}`}
          onClose={() => setPanel(null)} busy={busy}
          footer={<>
            <button type="button" data-tour="design-ecr-impact-cancel-btn" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => setPanel(null)}>Cancel</button>
            <button type="button" data-tour="design-ecr-impact-save-btn" disabled={busy} style={sheetBtn('primary', '#7c3aed', busy)} onClick={saveImpact}>
              <SheetIcon name="send" size={16} />{busy ? 'Saving…' : 'Save Impact & Send to Board'}
            </button>
          </>}>
          <SheetColumns
            left={<>
              <SheetError error={panelError} />
              <p style={{ ...sheetHint, margin: '0 0 16px' }}>
                Use the where-used tables on the page to see every BOM and project the change touches. Saving sends the ECR to the change board{ecr.status === 'impact_checked' ? ' (votes from anyone removed from the board are dropped)' : ''}.
              </p>
              <SheetSection icon="alert" title="Impact">
                <div data-tour="design-ecr-impact-summary">
                  <label style={labelStyle}>Impact summary <Req /></label>
                  <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={impact.summary} onChange={(e) => setImpact({ ...impact, summary: e.target.value })} maxLength={8000} autoFocus />
                </div>
                <div data-tour="design-ecr-impact-stock" style={{ marginTop: 14 }}>
                  <label style={labelStyle}>Stock affected</label>
                  <textarea style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} value={impact.stock} onChange={(e) => setImpact({ ...impact, stock: e.target.value })} maxLength={8000} placeholder="e.g. 12 brackets in store, 4 in paint shop" />
                </div>
                <div data-tour="design-ecr-impact-orders" style={{ marginTop: 14 }}>
                  <label style={labelStyle}>Open orders affected</label>
                  <textarea style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} value={impact.open_orders} onChange={(e) => setImpact({ ...impact, open_orders: e.target.value })} maxLength={8000} placeholder="e.g. PO-2026-0412 (plates), 3 machines in production" />
                </div>
              </SheetSection>
              <SheetSection icon="rupee" title="Cost & delivery" extra={<Optional />}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {seeCost && (
                  <div data-tour="design-ecr-impact-cost" style={{ flex: '0 1 170px', minWidth: 140 }}>
                    <label style={labelStyle}>Cost impact (₹)</label>
                    <input style={inputStyle} inputMode="decimal" value={impact.cost} onChange={(e) => setImpact({ ...impact, cost: e.target.value })} placeholder="e.g. 25000" />
                  </div>
                  )}
                  <div data-tour="design-ecr-impact-days" style={{ flex: '0 1 170px', minWidth: 140 }}>
                    <label style={labelStyle}>Delivery impact (days)</label>
                    <input style={inputStyle} inputMode="numeric" value={impact.delivery_days} onChange={(e) => setImpact({ ...impact, delivery_days: e.target.value })} placeholder="e.g. 7" />
                  </div>
                </div>
              </SheetSection>
            </>}
            right={
              <SheetSection icon="users" title="Change board — who votes">
                <div data-tour="design-ecr-impact-board">
                  {boardIds.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {boardIds.map((uid) => (
                        <span key={uid} style={{ ...pillStyle('#1d4ed8'), gap: 6, padding: '4px 10px', fontSize: 12 }}>
                          {userName[uid] || `User #${uid}`}
                          <button type="button" onClick={() => { setBoardIds((prev) => prev.filter((x) => x !== uid)); setBoardTouched(true) }} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'inherit', display: 'inline-flex' }} aria-label="Remove member"><SheetIcon name="x" size={12} /></button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ position: 'relative' }}>
                    <input style={inputStyle} value={boardSearch} onChange={(e) => setBoardSearch(e.target.value)} placeholder="Search people to add to the board…" />
                    {boardMatches.length > 0 && (
                      <AnchoredDropdown style={dropStyle}>
                        {boardMatches.map((u) => (
                          <div key={u.id} onClick={() => { setBoardIds((prev) => [...prev, u.id]); setBoardTouched(true); setBoardSearch('') }} style={optionStyle}>
                            {u.label}{u.code ? <span style={{ color: SHEET.MUTED }}> · {u.code}</span> : null}
                          </div>
                        ))}
                      </AnchoredDropdown>
                    )}
                  </div>
                  <p style={sheetHint}>
                    {boardIds.length === 0 ? 'No board members picked — the change board from Design Settings is used.' : 'Each member is asked to vote approve / reject / defer; the Design head then decides.'}
                  </p>
                </div>
              </SheetSection>
            }
          />
        </FormSheet>
      )}

      {ecr && panel === 'edit' && (
        <FormSheet tour="design-ecr-editpanel" icon="edit" title="Edit change request" subtitle={`${ecr.ecr_number} — ${ecr.title}`}
          onClose={() => setPanel(null)} busy={busy}
          footer={<>
            <button type="button" data-tour="design-ecr-edit-cancel-btn" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => setPanel(null)}>Cancel</button>
            <button type="button" data-tour="design-ecr-edit-save-btn" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={saveEdit}>
              <SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}
            </button>
          </>}>
          <SheetColumns
            left={<>
              <SheetError error={panelError} />
              <SheetSection icon="edit" title="Request">
                <label style={labelStyle}>Title <Req /></label>
                <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={255} autoFocus />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
                  <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
                    <label style={labelStyle}>Source</label>
                    <Select style={inputStyle} value={form.source} onChange={(e) => { setForm({ ...form, source: e.target.value, quality_id: '' }); setQualityRecords([]) }}>
                      {Object.entries(ECR_SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </div>
                  <div style={{ flex: '0 1 140px', minWidth: 120 }}>
                    <label style={labelStyle}>Urgency</label>
                    <Select style={inputStyle} value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}>
                      {Object.entries(ECR_URGENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </div>
                </div>
                <label style={{ ...labelStyle, marginTop: 14 }}>Reason <Req /></label>
                <textarea style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} maxLength={8000} />
                <label style={{ ...labelStyle, marginTop: 14 }}>Proposed change <Req /></label>
                <textarea style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} value={form.proposed_change} onChange={(e) => setForm({ ...form, proposed_change: e.target.value })} maxLength={8000} />
              </SheetSection>
              <SheetSection icon="list" title="Affected drawings & BOMs" extra={<Req />}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ position: 'relative', flex: '1 1 200px' }}>
                    <label style={labelStyle}>Add a released drawing</label>
                    <input style={inputStyle} value={docSearch} onChange={(e) => setDocSearch(e.target.value)} placeholder="Search drawings…" />
                    {docMatches.length > 0 && (
                      <AnchoredDropdown style={dropStyle}>
                        {docMatches.map((d) => (
                          <div key={d.id} onClick={() => { setItems((prev) => [...prev, { kind: 'document', id: d.id, label: d.label, note: '' }]); setDocSearch('') }} style={optionStyle}>{d.label}</div>
                        ))}
                      </AnchoredDropdown>
                    )}
                  </div>
                  <div style={{ position: 'relative', flex: '1 1 200px' }}>
                    <label style={labelStyle}>Add a released BOM</label>
                    <input style={inputStyle} value={bomSearch} onChange={(e) => setBomSearch(e.target.value)} placeholder="Search BOMs…" />
                    {bomMatches.length > 0 && (
                      <AnchoredDropdown style={dropStyle}>
                        {bomMatches.map((b) => (
                          <div key={b.id} onClick={() => { setItems((prev) => [...prev, { kind: 'bom', id: b.id, label: b.label, note: '' }]); setBomSearch('') }} style={optionStyle}>{b.label}</div>
                        ))}
                      </AnchoredDropdown>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  {items.map((r, idx) => (
                    <div key={`${r.kind}-${r.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', borderRadius: 10, border: `1px solid ${SHEET.LINE}`, background: SHEET.SOFT }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: r.kind === 'bom' ? '#7C3AED' : '#2563EB' }}>{r.kind === 'bom' ? 'BOM' : 'Drawing'}</span>
                      <span style={{ flex: '1 1 200px', minWidth: 0, fontSize: 13, fontWeight: 600, color: SHEET.INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                      <button type="button" onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                        style={{ border: 'none', background: 'transparent', color: '#DC2626', cursor: 'pointer', display: 'inline-flex', padding: 4 }} aria-label="Remove item"><SheetIcon name="trash" size={16} /></button>
                      <input style={{ ...inputStyle, flex: '1 1 100%', padding: '7px 10px', fontSize: 13 }} value={r.note}
                        onChange={(e) => setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, note: e.target.value } : p)))} placeholder="What should change here (optional)" />
                    </div>
                  ))}
                  {items.length === 0 && <p style={sheetHint}>Keep at least one released drawing or BOM on the change request.</p>}
                </div>
              </SheetSection>
            </>}
            right={<>
              <SheetSection icon="flag" title="Source details" extra={<Optional />}>
                {(form.source === 'ncr' || form.source === 'capa') && (
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>{form.source === 'ncr' ? 'NCR' : 'CAPA'}</label>
                    <SearchableSelect value={form.quality_id} onChange={(v) => setForm({ ...form, quality_id: v })} options={toOptions(qualityRecords, 'Not linked')} placeholder={`Select ${form.source.toUpperCase()}…`} />
                  </div>
                )}
                <label style={labelStyle}>Source reference</label>
                <input style={inputStyle} value={form.source_reference} onChange={(e) => setForm({ ...form, source_reference: e.target.value })} maxLength={255} />
              </SheetSection>
              <SheetSection icon="link" title="Associations" extra={<Optional />}>
                <label style={labelStyle}>Project</label>
                <SearchableSelect value={form.pm_project_id} onChange={(v) => setForm({ ...form, pm_project_id: v })} options={toOptions(projects, 'None')} placeholder="Select project…" />
                <label style={{ ...labelStyle, marginTop: 14 }}>Machine</label>
                <SearchableSelect value={form.erp_project_id} onChange={(v) => setForm({ ...form, erp_project_id: v })} options={toOptions(machines, 'None')} placeholder="Select machine…" />
              </SheetSection>
            </>}
          />
        </FormSheet>
      )}
    </div>
  )
}
