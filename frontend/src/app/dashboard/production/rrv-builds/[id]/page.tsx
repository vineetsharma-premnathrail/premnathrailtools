'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { productionApi, rrvApi } from '@/lib/api'
import { ProductionLookupOption, ProductionReworkOrder, ProductionRrvBuildDetail, ProductionRrvBuildStage, ProductionRrvConsumption, ProductionWorkOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import ProductionNav from '@/components/production/ProductionNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, SheetIconName, SHEET, Req, Optional, sheetBtn, sheetHint, sheetInput, sheetLabel, SheetError } from '@/components/shared/FormSheet'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { secondaryBtnStyle, dangerBtnStyle, InfoRow } from '@/components/shared/ui'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { RRV_PRIORITY_LABELS, RRV_TEST_TYPES, toOptions } from '@/components/production/rrvMeta'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import { recordHref, recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useCan } from '@/lib/permissions'
import { OrderProjectChip } from '@/components/sales/OrderProjectPicker'

const BUILD_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress', on_hold: 'On Hold', completed: 'Completed', handed_over: 'Handed Over', cancelled: 'Cancelled' }
const BUILD_HEX: Record<string, string> = { planned: '#78716c', in_progress: '#2563EB', on_hold: '#F59E0B', completed: '#7C3AED', handed_over: '#16A34A', cancelled: '#78716c' }
const STAGE_LABELS: Record<string, string> = { not_started: 'Not Started', in_progress: 'In Progress', completed: 'Completed', not_applicable: 'N/A' }
const STAGE_HEX: Record<string, string> = { not_started: '#78716c', in_progress: '#2563EB', completed: '#16A34A', not_applicable: '#a8a29e' }
const WO_LABELS: Record<string, string> = { draft: 'Draft', released: 'Released', in_progress: 'In Progress', completed: 'Completed', closed: 'Closed', cancelled: 'Cancelled' }
const WO_HEX: Record<string, string> = { draft: '#78716c', released: '#2563EB', in_progress: '#F59E0B', completed: '#16A34A', closed: '#0f766e', cancelled: '#78716c' }
const REWORK_LABELS: Record<string, string> = { open: 'Open', in_progress: 'In Progress', done: 'Awaiting Verification', verified: 'Verified', cancelled: 'Cancelled' }
const REWORK_HEX: Record<string, string> = { open: '#DC2626', in_progress: '#F59E0B', done: '#7C3AED', verified: '#16A34A', cancelled: '#a8a29e' }
const RESULT_HEX: Record<string, string> = { pass: '#16A34A', fail: '#DC2626', pending: '#78716c' }
const PHASE_LABELS: Record<string, string> = { plan: 'Plan', build: 'Build', verify: 'Verify', close: 'Close' }
const EVENT_LABELS: Record<string, string> = {
  created: 'created the build', updated: 'updated the build', on_hold: 'put the build on hold', resumed: 'resumed the build', cancelled: 'cancelled the build',
  stage_started: 'started', stage_completed: 'completed', signoff_requested: 'sent for sign-off', stage_not_applicable: 'marked N/A', stage_reopened: 'reopened',
  work_order_linked: 'linked work order', work_order_unlinked: 'unlinked work order', final_inspection_requested: 'requested final inspection',
  test_recorded: 'recorded test', test_deleted: 'deleted test', rework_raised: 'raised rework', rework_started: 'started rework',
  rework_done: 'finished rework', rework_verified: 'verified rework', rework_rejected: 'sent rework back', rework_cancelled: 'cancelled rework',
  completed: 'completed the RRV', handed_over: 'handed the RRV over',
}

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const primaryBtn: React.CSSProperties = {
  padding: '9px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary,
  color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 6px 16px ${SHADOWS.glowOrange}`,
}
const smallBtn: React.CSSProperties = { ...secondaryBtnStyle, padding: '5px 12px', fontSize: 12 }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }

function pill(label: string, hex: string) {
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{label}</span>
}

type Tab = 'stages' | 'work_orders' | 'tests' | 'rework' | 'handover' | 'timeline'
type Prompt =
  | { kind: 'hold' | 'cancel' }
  | { kind: 'stage_na' | 'stage_reopen' | 'stage_complete'; key: string; label: string }
  | { kind: 'rework_verify' | 'rework_reject' | 'rework_cancel'; rw: ProductionReworkOrder }
  | null

export default function RrvBuildDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const router = useRouter()
  const params = useParams()
  const { id: idResolved, error: linkError } = useRecordId(params.id as string)
  const id = idResolved ?? 0

  const [b, setB] = useState<ProductionRrvBuildDetail | null>(null)
  const [users, setUsers] = useState<ProductionLookupOption[]>([])
  // Role assign-to rules (core/features/production.py) — the server enforces them on save too.
  const allowManager = useAssigneeFilter('production:rrv_builds.build_manager')
  const allowStage = useAssigneeFilter('production:rrv_builds.stages')
  const allowRework = useAssigneeFilter('production:rrv_builds.rework')
  const [machines, setMachines] = useState<ProductionLookupOption[]>([])
  const [tab, setTab] = useState<Tab>('stages')
  // Record sub-tabs / actions the role holds (core/features/production.py).
  const { can: canTab, canFeature } = useCan()
  const rf = (feature: string, action: Parameters<typeof canFeature>[3]) => canFeature('production', 'rrv_builds', feature, action)
  const seeTab: Record<Tab, boolean> = {
    stages: true, work_orders: rf('work_orders', 'view'), tests: rf('tests', 'view'),
    rework: rf('rework', 'view'), handover: rf('handover', 'view'), timeline: rf('timeline', 'view'),
  }
  const seeCosts = rf('costs', 'view')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [success, setSuccess] = useState('')
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Errors raised while a popup is open are shown inside that popup.
  const [popupError, setPopupError] = useState<string | string[]>('')
  const [testOpen, setTestOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)

  const [editing, setEditing] = useState(false)
  const [details, setDetails] = useState<Record<string, string>>({})
  const [consumption, setConsumption] = useState<ProductionRrvConsumption | null>(null)
  const [consumptionError, setConsumptionError] = useState<string | string[]>('')
  const [linkable, setLinkable] = useState<ProductionWorkOrder[]>([])
  const [linkWo, setLinkWo] = useState({ id: '', role: 'sub_assembly' })
  const [testForm, setTestForm] = useState({ test_type: 'road_trial', test_date: new Date().toISOString().slice(0, 10), result: 'pass', expected: '', observed: '', witnessed_by: '', remarks: '', rework_assignee_id: '' })
  const [reqTests, setReqTests] = useState<string[] | null>(null)
  const [reworkForm, setReworkForm] = useState({ open: false, title: '', defect_description: '', assigned_to_id: '', due_date: '' })
  const [doneForm, setDoneForm] = useState<{ id: number; corrective_action: string; root_cause: string; hours_spent: string } | null>(null)
  const [handover, setHandover] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    if (!isAuthorized || !id) return
    rrvApi.get(id).then(setB).catch((err) => setError(extractErrorMessages(err, 'Failed to load the RRV build.')))
    Promise.all([productionApi.lookupUsers(), productionApi.lookupProjects()])
      .then(([u, m]) => { setUsers(u); setMachines(m) })
      .catch(() => { /* pickers only */ })
  }, [isAuthorized, id])

  useEffect(() => {
    if (!isAuthorized || !b || tab !== 'work_orders' || !seeTab.work_orders) return
    rrvApi.getConsumption(b.id)
      .then((c) => { setConsumption(c); setConsumptionError('') })
      .catch((err) => { setConsumption(null); setConsumptionError(extractErrorMessages(err, 'Failed to load the material consumption.')) })
    productionApi.listWorkOrders({ status: 'draft,released,in_progress,completed' })
      .then((rows: ProductionWorkOrder[]) => setLinkable((Array.isArray(rows) ? rows : []).filter((w) => !w.rrv_build_id && (!b.erp_project_id || !w.erp_project_id || w.erp_project_id === b.erp_project_id))))
      .catch(() => setLinkable([]))
  }, [isAuthorized, b, tab, seeTab.work_orders])

  const can = (a: string) => !!b?.allowed_actions.includes(a)
  const reworkOptions = useMemo(() => toOptions(users.filter((u) => allowRework(u.id)), 'Unassigned'), [users, allowRework])
  // Stage picker: allowed people plus whoever holds that stage now.
  const stageOptions = (current?: number | null) => toOptions(users.filter((u) => allowStage(u.id) || u.id === current), 'Unassigned')
  const hasMain = !!b?.work_orders.some((w) => w.build_role === 'main' && w.status !== 'cancelled')

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><ProductionNav /><InvalidRecordLink message={linkError} listHref="/dashboard/production/rrv-builds" listLabel="Back to RRV builds" /></div>)
  if (!id) return <div><ProductionNav /></div>

  /** Runs an action; returns the real error message, or null on success. */
  const run = async (fn: () => Promise<ProductionRrvBuildDetail>, fallback: string, done: string): Promise<string | string[] | null> => {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      setB(await fn())
      setSuccess(done)
      return null
    } catch (err) {
      return extractErrorMessages(err, fallback)
    } finally {
      setBusy(false)
    }
  }
  /** `run` with the error shown on the page — or inside the open popup when `inPopup`. */
  const act = async (fn: () => Promise<ProductionRrvBuildDetail>, fallback: string, done: string, inPopup = false) => {
    setPopupError('')
    const msg = await run(fn, fallback, done)
    if (msg) {
      if (inPopup) setPopupError(msg)
      else setError(msg)
      return false
    }
    return true
  }

  const runPrompt = async (value: string): Promise<string | string[] | null | undefined> => {
    const p = prompt
    if (!b || !p) return
    let msg: string | string[] | null = null
    if (p.kind === 'hold') msg = await run(() => rrvApi.hold(b.id, value), 'Hold failed.', `${b.build_number} is on hold.`)
    if (p.kind === 'cancel') msg = await run(() => rrvApi.cancel(b.id, value), 'Cancel failed.', `${b.build_number} cancelled.`)
    if (p.kind === 'stage_complete') {
      // Sign-off stages go through Organization › Approval Workflows › RRV sign-off:
      // without the sign-off right the click sends it to the build manager / production managers.
      const requesting = (p.key === 'rrv_completion' || p.key === 'handover') && !can('sign_off')
      msg = await run(() => rrvApi.completeStage(b.id, p.key, value), `Completing ${p.label} failed.`,
        requesting ? `${p.label} sent for sign-off to the build manager / production managers.` : `${p.label} completed.`)
    }
    if (p.kind === 'stage_na') msg = await run(() => rrvApi.stageNotApplicable(b.id, p.key, value), 'Marking N/A failed.', `${p.label} marked N/A.`)
    if (p.kind === 'stage_reopen') msg = await run(() => rrvApi.reopenStage(b.id, p.key, value), 'Reopening failed.', `${p.label} reopened.`)
    if (p.kind === 'rework_verify') msg = await run(() => rrvApi.verifyRework(p.rw.id, value), 'Verification failed.', `${p.rw.rework_number} verified.`)
    if (p.kind === 'rework_reject') msg = await run(() => rrvApi.rejectRework(p.rw.id, value), 'Sending back failed.', `${p.rw.rework_number} sent back.`)
    if (p.kind === 'rework_cancel') msg = await run(() => rrvApi.cancelRework(p.rw.id, value), 'Cancelling failed.', `${p.rw.rework_number} cancelled.`)
    if (msg) return msg
    setPrompt(null)
  }

  const startEdit = () => {
    if (!b) return
    setDetails({
      rrv_model: b.rrv_model, customer_name: b.customer_name || '', customer_po_number: b.customer_po_number || '', customer_po_date: b.customer_po_date || '',
      order_reference: b.order_reference || '', erp_project_id: b.erp_project_id ? String(b.erp_project_id) : '', vehicle_serial_number: b.vehicle_serial_number || '',
      chassis_number: b.chassis_number || '', engine_number: b.engine_number || '', year_of_manufacture: b.year_of_manufacture || '',
      build_manager_id: b.build_manager_id ? String(b.build_manager_id) : '', priority: b.priority, planned_start_date: b.planned_start_date || '',
      target_completion_date: b.target_completion_date || '', target_handover_date: b.target_handover_date || '', remarks: b.remarks || '',
    })
    setPopupError('')
    setEditing(true)
  }
  const saveDetails = async () => {
    if (!b) return
    const blank = (v: string) => (v && v.trim() ? v.trim() : null)
    const payload: Record<string, unknown> = {
      rrv_model: details.rrv_model.trim(), customer_name: blank(details.customer_name), customer_po_number: blank(details.customer_po_number),
      customer_po_date: details.customer_po_date || null, order_reference: blank(details.order_reference),
      erp_project_id: details.erp_project_id ? Number(details.erp_project_id) : null, vehicle_serial_number: blank(details.vehicle_serial_number),
      chassis_number: blank(details.chassis_number), engine_number: blank(details.engine_number), year_of_manufacture: blank(details.year_of_manufacture),
      build_manager_id: details.build_manager_id ? Number(details.build_manager_id) : null, priority: details.priority,
      planned_start_date: details.planned_start_date || null, target_completion_date: details.target_completion_date || null,
      target_handover_date: details.target_handover_date || null, remarks: blank(details.remarks),
    }
    if (await act(() => rrvApi.update(b.id, payload), 'Saving failed.', 'Build details saved.', true)) setEditing(false)
  }

  const recordTest = async () => {
    if (!b) return
    const prevFail = b.tests.find((t) => t.test_type === testForm.test_type)
    const payload: Record<string, unknown> = {
      test_type: testForm.test_type, test_date: testForm.test_date, result: testForm.result,
      expected: testForm.expected || null, observed: testForm.observed || null, witnessed_by: testForm.witnessed_by || null, remarks: testForm.remarks || null,
      retest_of_id: prevFail && prevFail.result === 'fail' ? prevFail.id : null,
      rework_assignee_id: testForm.result === 'fail' && testForm.rework_assignee_id ? Number(testForm.rework_assignee_id) : null,
    }
    const label = RRV_TEST_TYPES[testForm.test_type]
    if (await act(() => rrvApi.recordTest(b.id, payload), 'Recording the test failed.',
      testForm.result === 'fail' ? `${label} failed — a rework order was raised automatically.` : `${label} recorded as a pass.`, true)) {
      setTestForm((f) => ({ ...f, expected: '', observed: '', remarks: '', result: 'pass', rework_assignee_id: '' }))
      setTestOpen(false)
    }
  }

  const saveRequiredTests = async () => {
    if (!b || !reqTests) return
    if (!reqTests.length) { setPopupError('Keep at least one required test.'); return }
    if (await act(() => rrvApi.update(b.id, { required_tests: reqTests }), 'Saving required tests failed.', 'Required tests updated.', true)) setReqTests(null)
  }

  const raiseRework = async () => {
    if (!b) return
    if (reworkForm.title.trim().length < 3) { setPopupError('Give the rework a short title (what needs fixing).'); return }
    if (await act(() => rrvApi.createRework(b.id, {
      title: reworkForm.title.trim(), defect_description: reworkForm.defect_description || null,
      assigned_to_id: reworkForm.assigned_to_id ? Number(reworkForm.assigned_to_id) : null, due_date: reworkForm.due_date || null,
    }), 'Raising rework failed.', 'Rework order raised.', true)) setReworkForm({ open: false, title: '', defect_description: '', assigned_to_id: '', due_date: '' })
  }

  const finishRework = async () => {
    if (!doneForm) return
    if (doneForm.corrective_action.trim().length < 3) { setPopupError('Describe the corrective action taken.'); return }
    if (await act(() => rrvApi.finishRework(doneForm.id, {
      corrective_action: doneForm.corrective_action.trim(), root_cause: doneForm.root_cause || null, hours_spent: Number(doneForm.hours_spent) || 0,
    }), 'Marking the rework done failed.', 'Rework marked done — someone else must now verify it.', true)) setDoneForm(null)
  }

  const startHandoverEdit = () => {
    if (!b) return
    setHandover({
      handover_date: b.handover_date || '', commissioning_date: b.commissioning_date || '', handed_over_to_name: b.handed_over_to_name || '',
      handed_over_to_organization: b.handed_over_to_organization || b.customer_name || '', handover_location: b.handover_location || '',
      customer_acceptance_ref: b.customer_acceptance_ref || '', warranty_months: String(b.warranty_months ?? 12), handover_remarks: b.handover_remarks || '',
    })
    setPopupError('')
  }
  const saveHandover = async () => {
    if (!b || !handover) return
    const months = Number(handover.warranty_months)
    if (!Number.isInteger(months) || months < 0 || months > 120) { setPopupError('Warranty must be a whole number of months between 0 and 120.'); return }
    const blank = (v: string) => (v && v.trim() ? v.trim() : null)
    if (await act(() => rrvApi.update(b.id, {
      handover_date: handover.handover_date || null, commissioning_date: handover.commissioning_date || null,
      handed_over_to_name: blank(handover.handed_over_to_name), handed_over_to_organization: blank(handover.handed_over_to_organization),
      handover_location: blank(handover.handover_location), customer_acceptance_ref: blank(handover.customer_acceptance_ref),
      warranty_months: months, handover_remarks: blank(handover.handover_remarks),
    }), 'Saving handover details failed.', 'Handover details saved.', true)) setHandover(null)
  }

  const downloadCertificate = async () => {
    if (!b) return
    try {
      await openAttachmentBlob(() => rrvApi.getHandoverCertificate(b.id))
    } catch (err) {
      setError(extractErrorMessages(err, 'Couldn’t open the handover certificate.'))
    }
  }

  const stageRow = (s: ProductionRrvBuildStage) => {
    const done = s.status === 'completed' || s.status === 'not_applicable'
    const signOff = s.stage_key === 'rrv_completion' || s.stage_key === 'handover'
    const canWork = can('stages')
    return (
      <div key={s.id} data-tour="production-rrv-stage-row" style={{ display: 'flex', gap: 12, padding: '12px 0', borderTop: `1px solid ${BORDER.light}`, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ width: 30, height: 30, borderRadius: 9999, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700,
          background: done ? 'rgba(22,163,74,0.12)' : 'rgba(0,0,0,0.05)', color: done ? '#16A34A' : TEXT.secondary }}>
          {done ? '✓' : s.sequence}
        </div>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading }}>{s.label}</span>
            {pill(STAGE_LABELS[s.status], STAGE_HEX[s.status])}
            <span style={{ fontSize: 11, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{PHASE_LABELS[s.phase]}</span>
            {signOff && <span style={{ fontSize: 11, color: '#7C3AED', fontWeight: 600 }}>manager sign-off</span>}
            {s.is_overdue && <span style={{ fontSize: 11, color: '#DC2626', fontWeight: 700 }}>overdue</span>}
          </div>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '3px 0 0' }}>
            {s.assignee_name ? `Assigned to ${s.assignee_name}` : 'Unassigned'}
            {s.planned_end_date ? ` · due ${formatDate(s.planned_end_date)}` : ''}
            {s.completed_at ? ` · ${s.status === 'not_applicable' ? 'marked N/A' : 'done'} by ${s.completed_by_name || '—'} on ${formatDate(s.completed_at)}` : ''}
          </p>
          {s.remarks && <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '3px 0 0' }}>{s.remarks}</p>}
          {!done && s.gate_problems.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#92400E' }}>
              {s.gate_problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          {!done && s.gate_problems.length === 0 && b?.status !== 'cancelled' && <p style={{ fontSize: 12.5, color: '#15803d', margin: '6px 0 0' }}>Ready to complete.</p>}
          {s.stage_key === 'final_inspection' && (
            <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '6px 0 0' }}>
              Quality: {b?.final_inspection_number ? `${b.final_inspection_number} — ${(b.final_inspection_status || '').replace(/_/g, ' ')}` : 'not requested yet'}
              {canWork && !done && (!b?.final_inspection_number || b.final_inspection_status === 'failed') && (
                <button data-tour="production-rrv-stage-request-inspection-btn" type="button" disabled={busy} style={{ ...smallBtn, marginLeft: 8 }}
                  onClick={() => act(() => rrvApi.requestFinalInspection(b!.id), 'Requesting the inspection failed.', 'Final inspection requested — Quality has been notified.')}>
                  {b?.final_inspection_status === 'failed' ? 'Request re-inspection' : 'Request final inspection'}
                </button>
              )}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {canWork && !done && (
            <div data-tour="production-rrv-stage-assign" style={{ width: 190 }}>
              <SearchableSelect value={s.assignee_id ? String(s.assignee_id) : ''} options={stageOptions(s.assignee_id)} placeholder="Assign…"
                onChange={(v) => act(() => rrvApi.updateStage(b!.id, s.stage_key, { assignee_id: v ? Number(v) : null }), 'Assigning failed.', `${s.label} assigned.`)} />
            </div>
          )}
          {canWork && s.status === 'not_started' && <button data-tour="production-rrv-stage-start-btn" type="button" disabled={busy} style={smallBtn} onClick={() => act(() => rrvApi.startStage(b!.id, s.stage_key), 'Starting failed.', `${s.label} started.`)}>Start</button>}
          {canWork && !done && (!signOff || can('sign_off') || can('request_sign_off')) && (
            <button data-tour="production-rrv-stage-complete-btn" type="button" disabled={busy || s.gate_problems.length > 0} title={s.gate_problems.join(' ')}
              style={{ ...primaryBtn, padding: '6px 14px', fontSize: 12, opacity: s.gate_problems.length ? 0.5 : 1, cursor: s.gate_problems.length ? 'not-allowed' : 'pointer' }}
              onClick={() => setPrompt({ kind: 'stage_complete', key: s.stage_key, label: s.label })}>
              {signOff && !can('sign_off') ? 'Request Sign-off' : 'Complete'}
            </button>
          )}
          {canWork && !done && s.na_allowed && <button data-tour="production-rrv-stage-na-btn" type="button" disabled={busy} style={smallBtn} onClick={() => setPrompt({ kind: 'stage_na', key: s.stage_key, label: s.label })}>N/A</button>}
          {done && can('sign_off') && b?.status !== 'handed_over' && <button data-tour="production-rrv-stage-reopen-btn" type="button" disabled={busy} style={smallBtn} onClick={() => setPrompt({ kind: 'stage_reopen', key: s.stage_key, label: s.label })}>Reopen</button>}
        </div>
      </div>
    )
  }

  const promptText = ((): { title: string; message: string; placeholder: string; label: string; danger: boolean; icon: SheetIconName; field: string; need?: string } => {
    if (!prompt) return { title: '', message: '', placeholder: '', label: 'OK', danger: false, icon: 'check', field: 'Remarks' }
    switch (prompt.kind) {
      case 'hold': return { title: 'Put Build on Hold', message: 'Stage work stops until it is resumed.', placeholder: 'Reason — e.g. customer changed the spec', label: 'Put on Hold', danger: true, icon: 'clock', field: 'Reason', need: 'Give a reason for putting the build on hold.' }
      case 'cancel': return { title: 'Cancel this Build', message: 'The build is kept on record as cancelled. Running work orders must be completed or cancelled first.', placeholder: 'Reason…', label: 'Cancel Build', danger: true, icon: 'x', field: 'Reason', need: 'Give a reason for cancelling the build.' }
      case 'stage_complete': return { title: `Complete ${prompt.label}`, message: prompt.key === 'rrv_completion' ? 'The vehicle is registered (or updated) in the ERP machine registry with its serial and chassis numbers.' : prompt.key === 'handover' ? 'The machine goes live in the registry with delivery, handover and warranty dates, and Service is notified.' : 'Add any remarks for the record.', placeholder: 'Remarks (optional)', label: 'Complete', danger: false, icon: 'check', field: 'Remarks' }
      case 'stage_na': return { title: `Mark ${prompt.label} N/A`, message: 'Only for vehicles where this stage genuinely doesn’t apply.', placeholder: 'Why it doesn’t apply…', label: 'Mark N/A', danger: false, icon: 'flag', field: 'Reason', need: 'Say why this stage doesn’t apply to this vehicle.' }
      case 'stage_reopen': return { title: `Reopen ${prompt.label}`, message: 'Later stages must not be done. Reopening RRV Completion moves the build back to in progress.', placeholder: 'Reason…', label: 'Reopen', danger: true, icon: 'undo', field: 'Reason', need: 'Say why the stage is being reopened.' }
      case 'rework_verify': return { title: `Verify ${prompt.rw.rework_number}`, message: 'Confirms the defect is fixed. The failed check must already have passed again.', placeholder: 'Verification remarks (optional)', label: 'Verify', danger: false, icon: 'shield', field: 'Verification remarks' }
      case 'rework_reject': return { title: `Send ${prompt.rw.rework_number} Back`, message: 'Goes back to in progress for the fitter.', placeholder: 'What is still wrong…', label: 'Send Back', danger: true, icon: 'undo', field: 'What is still wrong', need: 'Say what is still wrong — the fitter sees it.' }
      case 'rework_cancel': return { title: `Cancel ${prompt.rw.rework_number}`, message: 'Cancelling skips verification — only for rework raised by mistake.', placeholder: 'Reason…', label: 'Cancel Rework', danger: true, icon: 'x', field: 'Reason', need: 'Give a reason for cancelling the rework.' }
    }
  })()

  const pct = b && b.stages_total ? Math.round((b.stages_done / b.stages_total) * 100) : 0

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>RRV Build</p>
          <h1 data-tour="production-rrv-detail-header" style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {b ? <>{b.build_number} <span style={{ fontWeight: 500, color: TEXT.secondary }}>— {b.rrv_model}</span> {pill(BUILD_LABELS[b.status], BUILD_HEX[b.status])}</> : 'RRV Build'}
          </h1>
          {b && (
            <div data-tour="production-rrv-detail-progress" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
              <div style={{ width: 180, height: 7, borderRadius: 9999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: '#16A34A' }} />
              </div>
              <span style={{ fontSize: 12.5, color: TEXT.muted }}>{b.stages_done}/{b.stages_total} stages{b.current_stage_label && b.status !== 'handed_over' ? ` · now: ${b.current_stage_label}` : ''}</span>
            </div>
          )}
        </div>
        <button data-tour="production-rrv-detail-back-btn" onClick={() => router.push('/dashboard/production/rrv-builds')} type="button" style={secondaryBtnStyle}>← Back</button>
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
      {b?.status === 'on_hold' && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400E', fontSize: 13 }}>
          <strong>On hold:</strong> {b.hold_reason}
        </div>
      )}
      {b?.status === 'cancelled' && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          <strong>Cancelled:</strong> {b.cancel_reason}
        </div>
      )}

      {b && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {can('edit') && !editing && b.status !== 'completed' && <button data-tour="production-rrv-edit-btn" disabled={busy} style={secondaryBtnStyle} onClick={startEdit}>Edit Details</button>}
            {can('hold') && <button data-tour="production-rrv-hold-btn" disabled={busy} style={secondaryBtnStyle} onClick={() => setPrompt({ kind: 'hold' })}>Put on Hold</button>}
            {can('resume') && <button data-tour="production-rrv-resume-btn" disabled={busy} style={primaryBtn} onClick={() => act(() => rrvApi.resume(b.id), 'Resume failed.', `${b.build_number} resumed.`)}>Resume</button>}
            {can('certificate') && <button data-tour="production-rrv-certificate-btn" disabled={busy} style={primaryBtn} onClick={downloadCertificate}>Handover Certificate (PDF)</button>}
            {can('cancel') && <button data-tour="production-rrv-cancel-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setPrompt({ kind: 'cancel' })}>Cancel Build</button>}
            {can('delete') && <button data-tour="production-rrv-delete-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setConfirmDelete(true)}>Delete</button>}
          </div>

            <div data-tour="production-rrv-info" style={{ ...sectionStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              {b.order_project_number && b.order_project_id && (
                <div data-tour="production-rrv-order-project">
                  <p className="info-row-label" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Order Project</p>
                  <OrderProjectChip opNumber={b.order_project_number} elementNo={b.order_project_element_no} label={b.order_project_element_label}
                    onClick={canTab('projects', 'order_projects', 'view') ? () => router.push(recordPath('/dashboard/projects/order-projects', b, 'order_project_id')) : undefined} />
                </div>
              )}
              <InfoRow label="Customer" value={b.customer_name || '—'} />
              <InfoRow label="Customer PO" value={b.customer_po_number ? `${b.customer_po_number}${b.customer_po_date ? ` · ${formatDate(b.customer_po_date)}` : ''}` : '—'} />
              <InfoRow label="Machine / serial" value={b.machine_label || b.vehicle_serial_number || 'Registered at completion'} />
              <InfoRow label="Chassis · engine" value={`${b.chassis_number || '—'} · ${b.engine_number || '—'}`} />
              <InfoRow label="Build manager" value={b.build_manager_name || '—'} />
              <InfoRow label="Priority" value={RRV_PRIORITY_LABELS[b.priority] || b.priority} />
              <InfoRow label="Target completion" value={formatDate(b.target_completion_date)} />
              <InfoRow label="Target handover" value={`${formatDate(b.target_handover_date)}${b.is_overdue ? ' (overdue)' : ''}`} />
            </div>

          <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
            {([['stages', 'Stages'], ['work_orders', `Work Orders & Material (${b.work_orders.length})`], ['tests', `Tests (${b.tests.length})`],
              ['rework', `Rework (${b.open_rework_count} open)`], ['handover', 'Handover'], ['timeline', 'Timeline']] as [Tab, string][]).filter(([k]) => seeTab[k]).map(([k, l]) => (
              <button key={k} data-tour={`production-rrv-tab-${k.replace(/_/g, '-')}`} type="button" onClick={() => setTab(k)} style={{
                padding: '9px 14px', marginBottom: -1, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                color: tab === k ? '#FF6A2A' : '#78716c', borderBottom: tab === k ? '2px solid #FF6A2A' : '2px solid transparent',
              }}>{l}</button>
            ))}
          </div>

          {tab === 'stages' && (
            <div data-tour="production-rrv-stages" style={sectionStyle}>
              <div data-tour="production-rrv-signoff-approval">
                <ApprovalPanel entityType="production_rrv_build" entityId={b.id} title="Sign-off approval" onChanged={() => rrvApi.get(b.id).then(setB).catch(() => undefined)} />
              </div>
              <p style={sectionTitle}>Build stages</p>
              {b.stages.map(stageRow)}
            </div>
          )}

          {tab === 'work_orders' && seeTab.work_orders && (
            <>
              <div data-tour="production-rrv-wo-section" style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  <p style={{ ...sectionTitle, margin: 0, flex: 1 }}>Linked work orders</p>
                  {can('link_work_order') && !hasMain && <button data-tour="production-rrv-wo-main-btn" style={primaryBtn} onClick={() => router.push(recordHref('/dashboard/production/work-orders/new', b, 'id', { build_role: 'main' }, 'rrv_build_id'))}>+ Main Work Order</button>}
                  {can('link_work_order') && linkable.length > 0 && <button data-tour="production-rrv-wo-link-open-btn" type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => { setPopupError(''); setLinkWo({ id: '', role: 'sub_assembly' }); setLinkOpen(true) }}>Link Existing</button>}
                  {can('link_work_order') && <button data-tour="production-rrv-wo-sub-btn" style={secondaryBtnStyle} onClick={() => router.push(recordHref('/dashboard/production/work-orders/new', b, 'id', { build_role: 'sub_assembly' }, 'rrv_build_id'))}>+ Sub-Assembly Work Order</button>}
                </div>
                {b.work_orders.length === 0 ? (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No work orders yet. Raise the main (final vehicle assembly) work order first, then one per sub-assembly.</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                      <thead><tr>{['Work order', 'Role', 'Product', 'Operations', 'Material', 'Due', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                      <tbody>
                        {b.work_orders.map((w) => (
                          <tr key={w.id}>
                            <td style={{ ...tdStyle, fontWeight: 700, color: '#FF6A2A', cursor: 'pointer' }} onClick={() => router.push(recordPath('/dashboard/production/work-orders', w))}>{w.wo_number}</td>
                            <td style={tdStyle}>{w.build_role === 'main' ? 'Main assembly' : 'Sub-assembly'}</td>
                            <td style={tdStyle}>{w.product_code} — {w.product_name}</td>
                            <td style={tdStyle}>{w.operations_done} / {w.operations_total}</td>
                            <td style={{ ...tdStyle, color: w.outstanding_lines ? '#b45309' : '#15803d' }}>{w.outstanding_lines ? `${w.outstanding_lines} line(s) to issue` : 'all issued'}</td>
                            <td style={tdStyle}>{formatDate(w.planned_end_date)}</td>
                            <td style={tdStyle}>{pill(WO_LABELS[w.status] || w.status, WO_HEX[w.status] || '#78716c')}</td>
                            <td style={tdStyle}>
                              {can('link_work_order') && <button data-tour="production-rrv-wo-unlink-btn" type="button" disabled={busy} style={smallBtn} onClick={() => act(() => rrvApi.unlinkWorkOrder(b.id, w.id), 'Unlinking failed.', `${w.wo_number} unlinked.`)}>Unlink</button>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div data-tour="production-rrv-consumption" style={sectionStyle}>
                <p style={sectionTitle}>Material consumption (all linked work orders)</p>
                {!consumption ? (
                  consumptionError
                    ? <p style={{ fontSize: 13, color: '#b91c1c', margin: 0 }}>{Array.isArray(consumptionError) ? consumptionError.join(' ') : consumptionError}</p>
                    : <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
                ) : consumption.rows.length === 0 ? (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No material lines yet — they come from the linked work orders&apos; BOMs.</p>
                ) : (
                  <>
                    <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 10px' }}>
                      {consumption.lines_fully_issued} of {consumption.total_required_lines} items fully issued
                      {seeCosts && consumption.total_consumed_value != null && <> · consumed value <strong>₹{consumption.total_consumed_value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong></>}
                    </p>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                        <thead><tr>{['Item', 'Required', 'Issued', 'Returned', 'Consumed', 'Still to issue', ...(seeCosts ? ['Value (₹)'] : []), 'Work orders'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                        <tbody>
                          {consumption.rows.map((r) => (
                            <tr key={r.item_id}>
                              <td style={tdStyle}><strong>{r.item_code}</strong> {r.item_name}</td>
                              <td style={tdStyle}>{r.required_qty} {r.uom}</td>
                              <td style={tdStyle}>{r.issued_qty}</td>
                              <td style={tdStyle}>{r.returned_qty}</td>
                              <td style={{ ...tdStyle, fontWeight: 700 }}>{r.consumed_qty}</td>
                              <td style={{ ...tdStyle, color: r.outstanding_qty > 0 ? '#b45309' : TEXT.muted }}>{r.outstanding_qty}</td>
                              {seeCosts && <td style={tdStyle}>{(r.consumed_value ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>}
                              <td style={tdStyle}>{r.work_orders.join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>

              {(b.integration.electrical_jobs.length > 0 || b.integration.hydraulic_systems.length > 0) && (
                <div data-tour="production-rrv-integration" style={sectionStyle}>
                  <p style={sectionTitle}>Electrical & hydraulic (from their modules)</p>
                  {b.integration.electrical_jobs.map((j) => <p key={`e${j.id}`} style={{ fontSize: 13, margin: '0 0 4px' }}>⚡ {j.job_number} — {j.title} · <strong>{j.status.replace(/_/g, ' ')}</strong></p>)}
                  {b.integration.hydraulic_systems.map((s) => <p key={`h${s.id}`} style={{ fontSize: 13, margin: '0 0 4px' }}>🛢 {s.system_number} — {s.name} · <strong>{s.status.replace(/_/g, ' ')}</strong></p>)}
                </div>
              )}
            </>
          )}

          {tab === 'tests' && seeTab.tests && (
            <>
              <div data-tour="production-rrv-required-tests" style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                  <p style={{ ...sectionTitle, margin: 0, flex: 1 }}>Required tests</p>
                  {can('edit') && reqTests === null && b.status !== 'completed' && <button data-tour="production-rrv-required-tests-change-btn" style={smallBtn} onClick={() => { setPopupError(''); setReqTests([...b.required_tests]) }}>Change</button>}
                  {can('record_test') && <button data-tour="production-rrv-test-open-btn" type="button" disabled={busy} style={{ ...primaryBtn, padding: '6px 14px', fontSize: 12, marginLeft: 8 }} onClick={() => { setPopupError(''); setTestOpen(true) }}>+ Record Test</button>}
                </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {Object.entries(b.test_status).map(([k, v]) => (
                      <span key={k} style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 9999, background: `${RESULT_HEX[v]}14`, color: RESULT_HEX[v], border: `1px solid ${RESULT_HEX[v]}33` }}>
                        {v === 'pass' ? '✓' : v === 'fail' ? '✗' : '○'} {RRV_TEST_TYPES[k] || k}
                      </span>
                    ))}
                  </div>
              </div>

              <div data-tour="production-rrv-test-history" style={sectionStyle}>
                <p style={sectionTitle}>Test history</p>
                {b.tests.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No tests recorded yet.</p> : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                      <thead><tr>{['Date', 'Test', 'Result', 'Expected', 'Observed', 'Tested / witnessed', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                      <tbody>
                        {b.tests.map((t) => (
                          <tr key={t.id}>
                            <td style={tdStyle}>{formatDate(t.test_date)}</td>
                            <td style={tdStyle}>{t.test_label}{t.retest_of_id ? <div style={{ fontSize: 11, color: TEXT.muted }}>retest</div> : null}</td>
                            <td style={tdStyle}>{pill(t.result.toUpperCase(), RESULT_HEX[t.result])}{t.rework_number && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 3 }}>{t.rework_number}</div>}</td>
                            <td style={{ ...tdStyle, maxWidth: 200 }}>{t.expected || '—'}</td>
                            <td style={{ ...tdStyle, maxWidth: 220 }}>{t.observed || '—'}{t.remarks ? <div style={{ fontSize: 11.5, color: TEXT.muted }}>{t.remarks}</div> : null}</td>
                            <td style={tdStyle}>{t.tested_by_name || '—'}{t.witnessed_by ? <div style={{ fontSize: 11.5, color: TEXT.muted }}>{t.witnessed_by}</div> : null}</td>
                            <td style={tdStyle}>
                              {can('record_test') && rf('tests', 'delete') && !t.rework_number && (
                                <button type="button" disabled={busy} style={smallBtn} onClick={() => act(() => rrvApi.deleteTest(b.id, t.id), 'Deleting the test failed.', 'Test record deleted.')}>Delete</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'rework' && seeTab.rework && (
            <div data-tour="production-rrv-rework" style={sectionStyle}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                <p style={{ ...sectionTitle, margin: 0, flex: 1 }}>Rework orders</p>
                {can('raise_rework') && <button data-tour="production-rrv-rework-raise-btn" style={secondaryBtnStyle} onClick={() => { setPopupError(''); setReworkForm({ ...reworkForm, open: true }) }}>+ Raise Rework</button>}
              </div>
              {b.rework_orders.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No rework on this build. Failed tests and failed inspections raise rework here automatically.</p> : b.rework_orders.map((rw) => (
                <div key={rw.id} data-tour="production-rrv-rework-row" style={{ padding: '12px 0', borderTop: `1px solid ${BORDER.light}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13.5, color: TEXT.heading }}>{rw.rework_number}</strong>
                    {pill(REWORK_LABELS[rw.status], REWORK_HEX[rw.status])}
                    <span style={{ fontSize: 13, color: TEXT.body }}>{rw.title}</span>
                    {rw.is_overdue && <span style={{ fontSize: 11, color: '#DC2626', fontWeight: 700 }}>overdue</span>}
                  </div>
                  <p style={{ fontSize: 12, color: TEXT.muted, margin: '3px 0 0' }}>
                    {rw.source_label}{rw.inspection_number ? ` ${rw.inspection_number}` : ''}{rw.wo_number ? ` · ${rw.wo_number}` : ''}
                    {` · ${rw.assigned_to_name ? `assigned to ${rw.assigned_to_name}` : 'unassigned'}`}{rw.due_date ? ` · due ${formatDate(rw.due_date)}` : ''}
                  </p>
                  {rw.defect_description && <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '4px 0 0' }}>Defect: {rw.defect_description}</p>}
                  {rw.corrective_action && <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '2px 0 0' }}>Action: {rw.corrective_action}{rw.done_by_name ? ` — ${rw.done_by_name}, ${rw.hours_spent} h` : ''}</p>}
                  {rw.verification_remarks && <p style={{ fontSize: 12.5, color: rw.status === 'verified' ? '#15803d' : '#b91c1c', margin: '2px 0 0' }}>{rw.status === 'verified' ? `Verified by ${rw.verified_by_name}` : 'Sent back'}: {rw.verification_remarks}</p>}
                  {rw.cancel_reason && <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '2px 0 0' }}>Cancelled: {rw.cancel_reason}</p>}
                  {can('stages') || can('record_test') ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {rw.status === 'open' && rf('rework', 'edit') && <button disabled={busy} style={smallBtn} onClick={() => act(() => rrvApi.startRework(rw.id), 'Starting rework failed.', `${rw.rework_number} started.`)}>Start</button>}
                      {(rw.status === 'open' || rw.status === 'in_progress') && rf('rework', 'edit') && <button disabled={busy} style={smallBtn} onClick={() => { setPopupError(''); setDoneForm({ id: rw.id, corrective_action: '', root_cause: rw.root_cause || '', hours_spent: '' }) }}>Mark Done</button>}
                      {rw.status === 'done' && rf('rework', 'approve') && <button disabled={busy} style={{ ...primaryBtn, padding: '5px 12px', fontSize: 12 }} onClick={() => setPrompt({ kind: 'rework_verify', rw })}>Verify</button>}
                      {rw.status === 'done' && rf('rework', 'reject') && <button disabled={busy} style={smallBtn} onClick={() => setPrompt({ kind: 'rework_reject', rw })}>Send Back</button>}
                      {can('sign_off') && rf('rework', 'cancel') && ['open', 'in_progress', 'done'].includes(rw.status) && <button disabled={busy} style={{ ...dangerBtnStyle, padding: '5px 12px', fontSize: 12 }} onClick={() => setPrompt({ kind: 'rework_cancel', rw })}>Cancel</button>}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {tab === 'handover' && seeTab.handover && (
            <div data-tour="production-rrv-handover" style={sectionStyle}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                <p style={{ ...sectionTitle, margin: 0, flex: 1 }}>Production handover</p>
                {can('edit') && rf('handover', 'edit') && handover === null && b.status !== 'handed_over' && b.status !== 'cancelled' && <button data-tour="production-rrv-handover-edit-btn" style={smallBtn} onClick={startHandoverEdit}>Edit</button>}
              </div>
              {can('certificate') && (
                <div data-tour="production-rrv-handover-doc" style={{ marginBottom: 14 }}>
                  <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>Handover certificate — make it a Word document to add wording, photos or customer-specific notes; “Handover Certificate (PDF)” then prints that version.</p>
                  <ManagedDocumentPanel entityType="production_rrv_handover" entityId={b.id} revision={0} canModify={can('edit_certificate')} recordLabel="handover record" downloadName={`RRV-Handover-${b.build_number}`} />
                </div>
              )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
                  <InfoRow label="Handover date" value={formatDate(b.handover_date)} />
                  <InfoRow label="Commissioning date" value={formatDate(b.commissioning_date)} />
                  <InfoRow label="Handed over to" value={[b.handed_over_to_name, b.handed_over_to_organization].filter(Boolean).join(', ') || '—'} />
                  <InfoRow label="Location" value={b.handover_location || '—'} />
                  <InfoRow label="Customer acceptance ref." value={b.customer_acceptance_ref || '—'} />
                  <InfoRow label="Warranty" value={`${b.warranty_months} months from handover`} />
                  {b.handed_over_at && <InfoRow label="Signed off" value={`${b.handed_over_by_name || '—'} · ${formatDateTime(b.handed_over_at)}`} />}
                  {b.handover_remarks && <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Remarks" value={b.handover_remarks} /></div>}
                </div>
              <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '14px 0 0' }}>
                Fill these in, then complete the <strong>Production Handover</strong> stage (manager sign-off). That makes the machine active in the ERP registry
                with its delivery, handover and warranty dates, and issues the handover certificate.
              </p>
            </div>
          )}

          {tab === 'timeline' && seeTab.timeline && (
            <div data-tour="production-rrv-timeline" style={sectionStyle}>
              <p style={sectionTitle}>Timeline</p>
              {b.events.map((e) => (
                <div key={e.id} style={{ padding: '8px 0', borderTop: `1px solid ${BORDER.light}` }}>
                  <p style={{ fontSize: 12.5, color: TEXT.body, margin: 0 }}><strong>{e.actor_name || 'System'}</strong> {EVENT_LABELS[e.action] || e.action.replace(/_/g, ' ')}{e.comment ? <span style={{ color: TEXT.secondary }}> — {e.comment}</span> : null}</p>
                  <p style={{ fontSize: 11, color: TEXT.muted, margin: '2px 0 0' }}>{formatDateTime(e.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <ReasonSheet
        open={prompt !== null}
        danger={!!promptText.danger}
        icon={promptText.icon}
        title={promptText.title}
        subtitle={b ? `${b.build_number} — ${b.rrv_model}` : ''}
        label={promptText.field}
        hint={promptText.message}
        placeholder={promptText.placeholder}
        confirmLabel={promptText.label}
        requireValue={!!promptText.need}
        requiredMessage={promptText.need}
        onConfirm={(text) => (promptText.need && text.length < 3 ? promptText.need : runPrompt(text))}
        onCancel={() => setPrompt(null)}
      />

      {b && editing && (
        <FormSheet icon="edit" title="Edit Build Details" subtitle={`${b.build_number} — ${b.rrv_model}`} onClose={() => setEditing(false)} busy={busy}
          footer={<>
            <button data-tour="production-rrv-edit-cancel-btn" type="button" onClick={() => setEditing(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button data-tour="production-rrv-edit-save-btn" type="button" onClick={saveDetails} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}</button>
          </>}>
          <SheetColumns
            left={<>
              <SheetError error={popupError} />
              <SheetSection icon="truck" title="Vehicle">
                <div data-tour="production-rrv-edit-rrv-model">
                  <label style={sheetLabel}>RRV model <Req /></label>
                  <input style={sheetInput} value={details.rrv_model} onChange={(e) => setDetails({ ...details, rrv_model: e.target.value })} />
                </div>
                <div data-tour="production-rrv-edit-machine" style={{ marginTop: 14 }}>
                  <label style={sheetLabel}>Machine in ERP</label>
                  <SearchableSelect value={details.erp_project_id} onChange={(v) => setDetails({ ...details, erp_project_id: v })} options={toOptions(machines, 'None — register at completion')} />
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
                  {([['vehicle_serial_number', 'Vehicle serial no.'], ['chassis_number', 'Chassis no.'], ['engine_number', 'Engine no.'], ['year_of_manufacture', 'Year']] as [string, string][]).map(([k, l]) => (
                    <div key={k} data-tour={`production-rrv-edit-${k.replace(/_/g, '-')}`} style={{ flex: k === 'year_of_manufacture' ? '1 1 100px' : '1 1 160px' }}>
                      <label style={sheetLabel}>{l}</label>
                      <input style={sheetInput} value={details[k]} onChange={(e) => setDetails({ ...details, [k]: e.target.value })} disabled={k === 'vehicle_serial_number' && !!details.erp_project_id} />
                    </div>
                  ))}
                </div>
                {!!details.erp_project_id && <p style={sheetHint}>The serial number comes from the linked ERP machine.</p>}
              </SheetSection>
              <SheetSection icon="building" title="Customer & Order">
                <div data-tour="production-rrv-edit-customer-name">
                  <label style={sheetLabel}>Customer</label>
                  <input style={sheetInput} value={details.customer_name} onChange={(e) => setDetails({ ...details, customer_name: e.target.value })} />
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
                  <div data-tour="production-rrv-edit-customer-po-number" style={{ flex: '1 1 160px' }}>
                    <label style={sheetLabel}>Customer PO no.</label>
                    <input style={sheetInput} value={details.customer_po_number} onChange={(e) => setDetails({ ...details, customer_po_number: e.target.value })} />
                  </div>
                  <div data-tour="production-rrv-edit-po-date" style={{ flex: '1 1 150px' }}>
                    <label style={sheetLabel}>PO date</label>
                    <DateField value={details.customer_po_date} onChange={(v) => setDetails({ ...details, customer_po_date: v })} />
                  </div>
                </div>
                <div data-tour="production-rrv-edit-order-reference" style={{ marginTop: 14 }}>
                  <label style={sheetLabel}>Order / tender ref.</label>
                  <input style={sheetInput} value={details.order_reference} onChange={(e) => setDetails({ ...details, order_reference: e.target.value })} />
                </div>
              </SheetSection>
            </>}
            right={<>
              <SheetSection icon="calendar" title="Planning">
                <div data-tour="production-rrv-edit-manager">
                  <label style={sheetLabel}>Build manager</label>
                  <SearchableSelect value={details.build_manager_id} onChange={(v) => setDetails({ ...details, build_manager_id: v })} options={toOptions(users.filter((u) => allowManager(u.id) || u.id === b?.build_manager_id))} />
                </div>
                <div data-tour="production-rrv-edit-priority" style={{ marginTop: 14 }}>
                  <label style={sheetLabel}>Priority</label>
                  <select style={sheetInput} value={details.priority} onChange={(e) => setDetails({ ...details, priority: e.target.value })}>
                    {Object.entries(RRV_PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div data-tour="production-rrv-edit-start" style={{ marginTop: 14 }}><label style={sheetLabel}>Planned start</label><DateField value={details.planned_start_date} onChange={(v) => setDetails({ ...details, planned_start_date: v })} /></div>
                <div data-tour="production-rrv-edit-target-completion" style={{ marginTop: 14 }}><label style={sheetLabel}>Target completion</label><DateField value={details.target_completion_date} onChange={(v) => setDetails({ ...details, target_completion_date: v })} /></div>
                <div data-tour="production-rrv-edit-target-handover" style={{ marginTop: 14 }}><label style={sheetLabel}>Target handover</label><DateField value={details.target_handover_date} onChange={(v) => setDetails({ ...details, target_handover_date: v })} /></div>
              </SheetSection>
              <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
                <div data-tour="production-rrv-edit-remarks">
                  <textarea style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={details.remarks} onChange={(e) => setDetails({ ...details, remarks: e.target.value })} />
                </div>
              </SheetSection>
            </>}
          />
        </FormSheet>
      )}

      {b && linkOpen && (
        <FormSheet width={580} icon="link" title="Link Existing Work Order" subtitle={`${b.build_number} — ${b.rrv_model}`} onClose={() => setLinkOpen(false)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setLinkOpen(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button data-tour="production-rrv-wo-link-btn" type="button" disabled={busy || !linkWo.id} style={sheetBtn('primary', SHEET.BLUE, busy || !linkWo.id)}
              onClick={async () => { if (await act(() => rrvApi.linkWorkOrder(b.id, Number(linkWo.id), linkWo.role), 'Linking failed.', 'Work order linked.', true)) { setLinkWo({ id: '', role: 'sub_assembly' }); setLinkOpen(false) } }}>
              <SheetIcon name="link" size={16} />{busy ? 'Linking…' : 'Link'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={popupError} />
            <SheetSection icon="list" title="Work Order">
              <div data-tour="production-rrv-wo-link-select">
                <label style={sheetLabel}>Work order <Req /></label>
                <SearchableSelect value={linkWo.id} onChange={(v) => setLinkWo({ ...linkWo, id: v })} placeholder="Select work order…"
                  options={linkable.map((w) => ({ value: String(w.id), label: `${w.wo_number} — ${w.product_code || ''} ${w.product_name || ''} (${WO_LABELS[w.status] || w.status})` }))} />
                <p style={sheetHint}>Open work orders not yet on a build{b.erp_project_id ? ', for the same machine (or none)' : ''}.</p>
              </div>
              <div data-tour="production-rrv-wo-link-role" style={{ marginTop: 14 }}>
                <label style={sheetLabel}>As</label>
                <select style={sheetInput} value={linkWo.role} onChange={(e) => setLinkWo({ ...linkWo, role: e.target.value })}>
                  <option value="sub_assembly">Sub-assembly</option>
                  {!hasMain && <option value="main">Main assembly</option>}
                </select>
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {b && reqTests !== null && (
        <FormSheet width={580} icon="list" title="Required Tests" subtitle={`${b.build_number} — ${b.rrv_model}`} onClose={() => setReqTests(null)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setReqTests(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={saveRequiredTests} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={popupError} />
            <SheetSection icon="shield" title="Tests this vehicle must pass">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(RRV_TEST_TYPES).map(([k, v]) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: SHEET.BODY, cursor: 'pointer' }}>
                    <input type="checkbox" checked={reqTests.includes(k)} onChange={(e) => setReqTests((prev) => (e.target.checked ? [...(prev || []), k] : (prev || []).filter((t) => t !== k)))} />{v}
                  </label>
                ))}
              </div>
              <p style={sheetHint}>Keep at least one required test.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {b && testOpen && (
        <FormSheet tour="production-rrv-test-form" icon="shield" title="Record a Test" subtitle={`${b.build_number} — ${b.rrv_model}`} onClose={() => setTestOpen(false)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setTestOpen(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button data-tour="production-rrv-test-record-btn" type="button" onClick={recordTest} disabled={busy} style={sheetBtn('primary', testForm.result === 'fail' ? '#DC2626' : SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Record Test'}</button>
          </>}>
          <SheetColumns
            left={<>
              <SheetError error={popupError} />
              <SheetSection icon="shield" title="Test">
                <div data-tour="production-rrv-test-type">
                  <label style={sheetLabel}>Test <Req /></label>
                  <select style={sheetInput} value={testForm.test_type} onChange={(e) => setTestForm({ ...testForm, test_type: e.target.value })}>
                    {Object.entries(RRV_TEST_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
                  <div data-tour="production-rrv-test-date" style={{ flex: '1 1 150px' }}><label style={sheetLabel}>Date <Req /></label><DateField value={testForm.test_date} onChange={(v) => setTestForm({ ...testForm, test_date: v })} /></div>
                  <div data-tour="production-rrv-test-result" style={{ flex: '1 1 120px' }}>
                    <label style={sheetLabel}>Result <Req /></label>
                    <select style={sheetInput} value={testForm.result} onChange={(e) => setTestForm({ ...testForm, result: e.target.value })}>
                      <option value="pass">Pass</option><option value="fail">Fail</option>
                    </select>
                  </div>
                </div>
              </SheetSection>
              <SheetSection icon="list" title="Readings">
                <div data-tour="production-rrv-test-expected"><label style={sheetLabel}>Expected / acceptance</label><input style={sheetInput} value={testForm.expected} onChange={(e) => setTestForm({ ...testForm, expected: e.target.value })} placeholder="e.g. stop within 30 m at 25 km/h" /></div>
                <div data-tour="production-rrv-test-observed" style={{ marginTop: 14 }}><label style={sheetLabel}>Observed {testForm.result === 'fail' && <Req />}</label><input style={sheetInput} value={testForm.observed} onChange={(e) => setTestForm({ ...testForm, observed: e.target.value })} placeholder="e.g. stopped in 27 m" /></div>
              </SheetSection>
            </>}
            right={<>
              <SheetSection icon="users" title="Witness">
                <div data-tour="production-rrv-test-witness"><label style={sheetLabel}>Witnessed by</label><input style={sheetInput} value={testForm.witnessed_by} onChange={(e) => setTestForm({ ...testForm, witnessed_by: e.target.value })} placeholder="e.g. RDSO inspector, customer rep." /></div>
              </SheetSection>
              {testForm.result === 'fail' && (
                <SheetSection icon="alert" title="Rework" color="#DC2626">
                  <label style={sheetLabel}>Rework assigned to</label>
                  <SearchableSelect value={testForm.rework_assignee_id} onChange={(v) => setTestForm({ ...testForm, rework_assignee_id: v })} options={reworkOptions} />
                  <p style={{ ...sheetHint, color: '#92400E' }}>A failed test raises a rework order automatically. It can only be verified after a passing retest.</p>
                </SheetSection>
              )}
              <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
                <div data-tour="production-rrv-test-remarks"><input style={sheetInput} value={testForm.remarks} onChange={(e) => setTestForm({ ...testForm, remarks: e.target.value })} /></div>
              </SheetSection>
            </>}
          />
        </FormSheet>
      )}

      {b && reworkForm.open && (
        <FormSheet width={580} icon="tool" iconColor="#DC2626" title="Raise Rework" subtitle={`${b.build_number} — ${b.rrv_model}`} onClose={() => setReworkForm({ ...reworkForm, open: false })} busy={busy}
          footer={<>
            <button type="button" onClick={() => setReworkForm({ ...reworkForm, open: false })} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={raiseRework} disabled={busy} style={sheetBtn('primary', '#DC2626', busy)}><SheetIcon name="plus" size={16} />{busy ? 'Saving…' : 'Raise'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={popupError} />
            <SheetSection icon="alert" title="Defect" color="#DC2626">
              <label style={sheetLabel}>What needs fixing <Req /></label>
              <input style={sheetInput} value={reworkForm.title} autoFocus onChange={(e) => setReworkForm({ ...reworkForm, title: e.target.value })} placeholder="e.g. Hydraulic hose chafing near boom pivot" />
              <label style={{ ...sheetLabel, marginTop: 14 }}>Defect details <Optional /></label>
              <textarea style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={reworkForm.defect_description} onChange={(e) => setReworkForm({ ...reworkForm, defect_description: e.target.value })} />
            </SheetSection>
            <SheetSection icon="user" title="Assignment">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px' }}><label style={sheetLabel}>Assign to</label><SearchableSelect value={reworkForm.assigned_to_id} onChange={(v) => setReworkForm({ ...reworkForm, assigned_to_id: v })} options={reworkOptions} /></div>
                <div style={{ flex: '1 1 150px' }}><label style={sheetLabel}>Due</label><DateField value={reworkForm.due_date} onChange={(v) => setReworkForm({ ...reworkForm, due_date: v })} /></div>
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {b && doneForm && (
        <FormSheet width={580} icon="check" iconColor="#16A34A" title="Mark Rework Done" subtitle={`${b.rework_orders.find((r) => r.id === doneForm.id)?.rework_number || 'Rework'} · ${b.build_number}`} onClose={() => setDoneForm(null)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setDoneForm(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={finishRework} disabled={busy} style={sheetBtn('primary', '#16A34A', busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Mark Done'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={popupError} />
            <SheetSection icon="tool" title="What was done">
              <label style={sheetLabel}>Corrective action <Req /></label>
              <textarea style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} autoFocus value={doneForm.corrective_action} onChange={(e) => setDoneForm({ ...doneForm, corrective_action: e.target.value })} />
              <label style={{ ...sheetLabel, marginTop: 14 }}>Root cause <Optional /></label>
              <input style={sheetInput} value={doneForm.root_cause} onChange={(e) => setDoneForm({ ...doneForm, root_cause: e.target.value })} />
              <label style={{ ...sheetLabel, marginTop: 14 }}>Hours spent</label>
              <input style={{ ...sheetInput, maxWidth: 160 }} value={doneForm.hours_spent} inputMode="decimal" onChange={(e) => setDoneForm({ ...doneForm, hours_spent: e.target.value.replace(/[^0-9.]/g, '') })} />
              <p style={sheetHint}>Someone else must then verify the fix.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {b && handover !== null && (
        <FormSheet icon="truck" iconColor="#16A34A" title="Handover Details" subtitle={`${b.build_number} — ${b.rrv_model}`} onClose={() => setHandover(null)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setHandover(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={saveHandover} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}</button>
          </>}>
          <SheetColumns
            left={<>
              <SheetError error={popupError} />
              <SheetSection icon="calendar" title="Dates">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 150px' }}><label style={sheetLabel}>Handover date</label><DateField value={handover.handover_date} onChange={(v) => setHandover({ ...handover, handover_date: v })} /></div>
                  <div style={{ flex: '1 1 150px' }}><label style={sheetLabel}>Commissioning date</label><DateField value={handover.commissioning_date} onChange={(v) => setHandover({ ...handover, commissioning_date: v })} /></div>
                </div>
              </SheetSection>
              <SheetSection icon="users" title="Handed Over To">
                <label style={sheetLabel}>Name</label>
                <input style={sheetInput} value={handover.handed_over_to_name} onChange={(e) => setHandover({ ...handover, handed_over_to_name: e.target.value })} placeholder="e.g. Sr. DEN (Works)" />
                <label style={{ ...sheetLabel, marginTop: 14 }}>Organisation</label>
                <input style={sheetInput} value={handover.handed_over_to_organization} onChange={(e) => setHandover({ ...handover, handed_over_to_organization: e.target.value })} />
                <label style={{ ...sheetLabel, marginTop: 14 }}>Location</label>
                <input style={sheetInput} value={handover.handover_location} onChange={(e) => setHandover({ ...handover, handover_location: e.target.value })} placeholder="Depot / site" />
              </SheetSection>
            </>}
            right={<>
              <SheetSection icon="shield" title="Acceptance & Warranty">
                <label style={sheetLabel}>Customer acceptance ref.</label>
                <input style={sheetInput} value={handover.customer_acceptance_ref} onChange={(e) => setHandover({ ...handover, customer_acceptance_ref: e.target.value })} />
                <label style={{ ...sheetLabel, marginTop: 14 }}>Warranty (months)</label>
                <input style={sheetInput} value={handover.warranty_months} inputMode="numeric" onChange={(e) => setHandover({ ...handover, warranty_months: e.target.value.replace(/[^0-9]/g, '') })} />
                <p style={sheetHint}>Whole months, 0–120, counted from handover.</p>
              </SheetSection>
              <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
                <textarea style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={handover.handover_remarks} onChange={(e) => setHandover({ ...handover, handover_remarks: e.target.value })} />
              </SheetSection>
            </>}
          />
        </FormSheet>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this build?"
        message={`${b?.build_number} hasn't started and has no work orders or tests, so it will be deleted.`}
        onConfirm={async () => {
          setConfirmDelete(false)
          if (!b) return
          try { await rrvApi.remove(b.id); router.push('/dashboard/production/rrv-builds') } catch (err) { setError(extractErrorMessages(err, 'Deleting failed.')) }
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
