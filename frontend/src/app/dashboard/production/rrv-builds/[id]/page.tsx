'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi, rrvApi } from '@/lib/api'
import { ProductionLookupOption, ProductionReworkOrder, ProductionRrvBuildDetail, ProductionRrvBuildStage, ProductionRrvConsumption, ProductionWorkOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import ProductionNav from '@/components/production/ProductionNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { secondaryBtnStyle, dangerBtnStyle, InfoRow } from '@/components/shared/ui'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { RRV_PRIORITY_LABELS, RRV_TEST_TYPES, toOptions } from '@/components/production/rrvMeta'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'

const BUILD_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress', on_hold: 'On Hold', completed: 'Completed', handed_over: 'Handed Over', cancelled: 'Cancelled' }
const BUILD_HEX: Record<string, string> = { planned: '#78716c', in_progress: '#2563EB', on_hold: '#F59E0B', completed: '#7C3AED', handed_over: '#16A34A', cancelled: '#DC2626' }
const STAGE_LABELS: Record<string, string> = { not_started: 'Not Started', in_progress: 'In Progress', completed: 'Completed', not_applicable: 'N/A' }
const STAGE_HEX: Record<string, string> = { not_started: '#78716c', in_progress: '#2563EB', completed: '#16A34A', not_applicable: '#a8a29e' }
const WO_LABELS: Record<string, string> = { draft: 'Draft', released: 'Released', in_progress: 'In Progress', completed: 'Completed', closed: 'Closed', cancelled: 'Cancelled' }
const WO_HEX: Record<string, string> = { draft: '#78716c', released: '#2563EB', in_progress: '#F59E0B', completed: '#16A34A', closed: '#0f766e', cancelled: '#DC2626' }
const REWORK_LABELS: Record<string, string> = { open: 'Open', in_progress: 'In Progress', done: 'Awaiting Verification', verified: 'Verified', cancelled: 'Cancelled' }
const REWORK_HEX: Record<string, string> = { open: '#DC2626', in_progress: '#F59E0B', done: '#7C3AED', verified: '#16A34A', cancelled: '#a8a29e' }
const RESULT_HEX: Record<string, string> = { pass: '#16A34A', fail: '#DC2626', pending: '#78716c' }
const PHASE_LABELS: Record<string, string> = { plan: 'Plan', build: 'Build', verify: 'Verify', close: 'Close' }
const EVENT_LABELS: Record<string, string> = {
  created: 'created the build', updated: 'updated the build', on_hold: 'put the build on hold', resumed: 'resumed the build', cancelled: 'cancelled the build',
  stage_started: 'started', stage_completed: 'completed', stage_not_applicable: 'marked N/A', stage_reopened: 'reopened',
  work_order_linked: 'linked work order', work_order_unlinked: 'unlinked work order', final_inspection_requested: 'requested final inspection',
  test_recorded: 'recorded test', test_deleted: 'deleted test', rework_raised: 'raised rework', rework_started: 'started rework',
  rework_done: 'finished rework', rework_verified: 'verified rework', rework_rejected: 'sent rework back', rework_cancelled: 'cancelled rework',
  completed: 'completed the RRV', handed_over: 'handed the RRV over',
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
  const id = Number(params.id)

  const [b, setB] = useState<ProductionRrvBuildDetail | null>(null)
  const [users, setUsers] = useState<ProductionLookupOption[]>([])
  const [machines, setMachines] = useState<ProductionLookupOption[]>([])
  const [tab, setTab] = useState<Tab>('stages')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [success, setSuccess] = useState('')
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [editing, setEditing] = useState(false)
  const [details, setDetails] = useState<Record<string, string>>({})
  const [consumption, setConsumption] = useState<ProductionRrvConsumption | null>(null)
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
    if (!isAuthorized || !b || tab !== 'work_orders') return
    rrvApi.getConsumption(b.id).then(setConsumption).catch(() => setConsumption(null))
    productionApi.listWorkOrders({ status: 'draft,released,in_progress,completed' })
      .then((rows: ProductionWorkOrder[]) => setLinkable((Array.isArray(rows) ? rows : []).filter((w) => !w.rrv_build_id && (!b.erp_project_id || !w.erp_project_id || w.erp_project_id === b.erp_project_id))))
      .catch(() => setLinkable([]))
  }, [isAuthorized, b, tab])

  const can = (a: string) => !!b?.allowed_actions.includes(a)
  const userOptions = useMemo(() => toOptions(users, 'Unassigned'), [users])
  const hasMain = !!b?.work_orders.some((w) => w.build_role === 'main' && w.status !== 'cancelled')

  if (isLoading || !isAuthorized) return null

  const act = async (fn: () => Promise<ProductionRrvBuildDetail>, fallback: string, done: string) => {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      setB(await fn())
      setSuccess(done)
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  const runPrompt = async (value: string) => {
    const p = prompt
    setPrompt(null)
    if (!b || !p) return
    const need = (msg: string) => { if (!value.trim() || value.trim().length < 3) { setError(msg); return true } return false }
    if (p.kind === 'hold') { if (need('Give a reason for putting the build on hold.')) return; await act(() => rrvApi.hold(b.id, value), 'Hold failed.', `${b.build_number} is on hold.`) }
    if (p.kind === 'cancel') { if (need('Give a reason for cancelling the build.')) return; await act(() => rrvApi.cancel(b.id, value), 'Cancel failed.', `${b.build_number} cancelled.`) }
    if (p.kind === 'stage_complete') await act(() => rrvApi.completeStage(b.id, p.key, value), `Completing ${p.label} failed.`, `${p.label} completed.`)
    if (p.kind === 'stage_na') { if (need('Say why this stage doesn’t apply to this vehicle.')) return; await act(() => rrvApi.stageNotApplicable(b.id, p.key, value), 'Marking N/A failed.', `${p.label} marked N/A.`) }
    if (p.kind === 'stage_reopen') { if (need('Say why the stage is being reopened.')) return; await act(() => rrvApi.reopenStage(b.id, p.key, value), 'Reopening failed.', `${p.label} reopened.`) }
    if (p.kind === 'rework_verify') await act(() => rrvApi.verifyRework(p.rw.id, value), 'Verification failed.', `${p.rw.rework_number} verified.`)
    if (p.kind === 'rework_reject') { if (need('Say what is still wrong — the fitter sees it.')) return; await act(() => rrvApi.rejectRework(p.rw.id, value), 'Sending back failed.', `${p.rw.rework_number} sent back.`) }
    if (p.kind === 'rework_cancel') { if (need('Give a reason for cancelling the rework.')) return; await act(() => rrvApi.cancelRework(p.rw.id, value), 'Cancelling failed.', `${p.rw.rework_number} cancelled.`) }
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
    if (await act(() => rrvApi.update(b.id, payload), 'Saving failed.', 'Build details saved.')) setEditing(false)
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
      testForm.result === 'fail' ? `${label} failed — a rework order was raised automatically.` : `${label} recorded as a pass.`)) {
      setTestForm((f) => ({ ...f, expected: '', observed: '', remarks: '', result: 'pass', rework_assignee_id: '' }))
    }
  }

  const saveRequiredTests = async () => {
    if (!b || !reqTests) return
    if (!reqTests.length) { setError('Keep at least one required test.'); return }
    if (await act(() => rrvApi.update(b.id, { required_tests: reqTests }), 'Saving required tests failed.', 'Required tests updated.')) setReqTests(null)
  }

  const raiseRework = async () => {
    if (!b) return
    if (reworkForm.title.trim().length < 3) { setError('Give the rework a short title (what needs fixing).'); return }
    if (await act(() => rrvApi.createRework(b.id, {
      title: reworkForm.title.trim(), defect_description: reworkForm.defect_description || null,
      assigned_to_id: reworkForm.assigned_to_id ? Number(reworkForm.assigned_to_id) : null, due_date: reworkForm.due_date || null,
    }), 'Raising rework failed.', 'Rework order raised.')) setReworkForm({ open: false, title: '', defect_description: '', assigned_to_id: '', due_date: '' })
  }

  const finishRework = async () => {
    if (!doneForm) return
    if (doneForm.corrective_action.trim().length < 3) { setError('Describe the corrective action taken.'); return }
    if (await act(() => rrvApi.finishRework(doneForm.id, {
      corrective_action: doneForm.corrective_action.trim(), root_cause: doneForm.root_cause || null, hours_spent: Number(doneForm.hours_spent) || 0,
    }), 'Marking the rework done failed.', 'Rework marked done — someone else must now verify it.')) setDoneForm(null)
  }

  const startHandoverEdit = () => {
    if (!b) return
    setHandover({
      handover_date: b.handover_date || '', commissioning_date: b.commissioning_date || '', handed_over_to_name: b.handed_over_to_name || '',
      handed_over_to_organization: b.handed_over_to_organization || b.customer_name || '', handover_location: b.handover_location || '',
      customer_acceptance_ref: b.customer_acceptance_ref || '', warranty_months: String(b.warranty_months ?? 12), handover_remarks: b.handover_remarks || '',
    })
  }
  const saveHandover = async () => {
    if (!b || !handover) return
    const months = Number(handover.warranty_months)
    if (!Number.isInteger(months) || months < 0 || months > 120) { setError('Warranty must be a whole number of months between 0 and 120.'); return }
    const blank = (v: string) => (v && v.trim() ? v.trim() : null)
    if (await act(() => rrvApi.update(b.id, {
      handover_date: handover.handover_date || null, commissioning_date: handover.commissioning_date || null,
      handed_over_to_name: blank(handover.handed_over_to_name), handed_over_to_organization: blank(handover.handed_over_to_organization),
      handover_location: blank(handover.handover_location), customer_acceptance_ref: blank(handover.customer_acceptance_ref),
      warranty_months: months, handover_remarks: blank(handover.handover_remarks),
    }), 'Saving handover details failed.', 'Handover details saved.')) setHandover(null)
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
      <div key={s.id} style={{ display: 'flex', gap: 12, padding: '12px 0', borderTop: `1px solid ${BORDER.light}`, flexWrap: 'wrap', alignItems: 'flex-start' }}>
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
                <button type="button" disabled={busy} style={{ ...smallBtn, marginLeft: 8 }}
                  onClick={() => act(() => rrvApi.requestFinalInspection(b!.id), 'Requesting the inspection failed.', 'Final inspection requested — Quality has been notified.')}>
                  {b?.final_inspection_status === 'failed' ? 'Request re-inspection' : 'Request final inspection'}
                </button>
              )}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {canWork && !done && (
            <div style={{ width: 190 }}>
              <SearchableSelect value={s.assignee_id ? String(s.assignee_id) : ''} options={userOptions} placeholder="Assign…"
                onChange={(v) => act(() => rrvApi.updateStage(b!.id, s.stage_key, { assignee_id: v ? Number(v) : null }), 'Assigning failed.', `${s.label} assigned.`)} />
            </div>
          )}
          {canWork && s.status === 'not_started' && <button type="button" disabled={busy} style={smallBtn} onClick={() => act(() => rrvApi.startStage(b!.id, s.stage_key), 'Starting failed.', `${s.label} started.`)}>Start</button>}
          {canWork && !done && (!signOff || can('sign_off')) && (
            <button type="button" disabled={busy || s.gate_problems.length > 0} title={s.gate_problems.join(' ')}
              style={{ ...primaryBtn, padding: '6px 14px', fontSize: 12, opacity: s.gate_problems.length ? 0.5 : 1, cursor: s.gate_problems.length ? 'not-allowed' : 'pointer' }}
              onClick={() => setPrompt({ kind: 'stage_complete', key: s.stage_key, label: s.label })}>
              Complete
            </button>
          )}
          {canWork && !done && s.na_allowed && <button type="button" disabled={busy} style={smallBtn} onClick={() => setPrompt({ kind: 'stage_na', key: s.stage_key, label: s.label })}>N/A</button>}
          {done && can('sign_off') && b?.status !== 'handed_over' && <button type="button" disabled={busy} style={smallBtn} onClick={() => setPrompt({ kind: 'stage_reopen', key: s.stage_key, label: s.label })}>Reopen</button>}
        </div>
      </div>
    )
  }

  const promptText = (() => {
    if (!prompt) return { title: '', message: '', placeholder: '', label: 'OK', danger: false }
    switch (prompt.kind) {
      case 'hold': return { title: 'Put build on hold', message: 'Stage work stops until it is resumed.', placeholder: 'Reason — e.g. customer changed the spec', label: 'Put on Hold', danger: true }
      case 'cancel': return { title: 'Cancel this build', message: 'The build is kept on record as cancelled. Running work orders must be completed or cancelled first.', placeholder: 'Reason…', label: 'Cancel Build', danger: true }
      case 'stage_complete': return { title: `Complete ${prompt.label}`, message: prompt.key === 'rrv_completion' ? 'The vehicle is registered (or updated) in the ERP machine registry with its serial and chassis numbers.' : prompt.key === 'handover' ? 'The machine goes live in the registry with delivery, handover and warranty dates, and Service is notified.' : 'Add any remarks for the record.', placeholder: 'Remarks (optional)', label: 'Complete', danger: false }
      case 'stage_na': return { title: `Mark ${prompt.label} N/A`, message: 'Only for vehicles where this stage genuinely doesn’t apply.', placeholder: 'Why it doesn’t apply…', label: 'Mark N/A', danger: false }
      case 'stage_reopen': return { title: `Reopen ${prompt.label}`, message: 'Later stages must not be done. Reopening RRV Completion moves the build back to in progress.', placeholder: 'Reason…', label: 'Reopen', danger: true }
      case 'rework_verify': return { title: `Verify ${prompt.rw.rework_number}`, message: 'Confirms the defect is fixed. The failed check must already have passed again.', placeholder: 'Verification remarks (optional)', label: 'Verify', danger: false }
      case 'rework_reject': return { title: `Send ${prompt.rw.rework_number} back`, message: 'Goes back to in progress for the fitter.', placeholder: 'What is still wrong…', label: 'Send Back', danger: true }
      case 'rework_cancel': return { title: `Cancel ${prompt.rw.rework_number}`, message: 'Cancelling skips verification — only for rework raised by mistake.', placeholder: 'Reason…', label: 'Cancel Rework', danger: true }
    }
  })()

  const pct = b && b.stages_total ? Math.round((b.stages_done / b.stages_total) * 100) : 0

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>RRV Build</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {b ? <>{b.build_number} <span style={{ fontWeight: 500, color: TEXT.secondary }}>— {b.rrv_model}</span> {pill(BUILD_LABELS[b.status], BUILD_HEX[b.status])}</> : 'RRV Build'}
          </h1>
          {b && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
              <div style={{ width: 180, height: 7, borderRadius: 9999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: '#16A34A' }} />
              </div>
              <span style={{ fontSize: 12.5, color: TEXT.muted }}>{b.stages_done}/{b.stages_total} stages{b.current_stage_label && b.status !== 'handed_over' ? ` · now: ${b.current_stage_label}` : ''}</span>
            </div>
          )}
        </div>
        <button onClick={() => router.push('/dashboard/production/rrv-builds')} type="button" style={secondaryBtnStyle}>← Back</button>
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
            {can('edit') && !editing && b.status !== 'completed' && <button disabled={busy} style={secondaryBtnStyle} onClick={startEdit}>Edit Details</button>}
            {can('hold') && <button disabled={busy} style={secondaryBtnStyle} onClick={() => setPrompt({ kind: 'hold' })}>Put on Hold</button>}
            {can('resume') && <button disabled={busy} style={primaryBtn} onClick={() => act(() => rrvApi.resume(b.id), 'Resume failed.', `${b.build_number} resumed.`)}>Resume</button>}
            {can('certificate') && <button disabled={busy} style={primaryBtn} onClick={downloadCertificate}>Handover Certificate (PDF)</button>}
            {can('cancel') && <button disabled={busy} style={dangerBtnStyle} onClick={() => setPrompt({ kind: 'cancel' })}>Cancel Build</button>}
            {can('delete') && <button disabled={busy} style={dangerBtnStyle} onClick={() => setConfirmDelete(true)}>Delete</button>}
          </div>

          {editing ? (
            <div style={sectionStyle}>
              <p style={sectionTitle}>Edit build details</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {([['rrv_model', 'RRV model', 300], ['customer_name', 'Customer', 280], ['customer_po_number', 'Customer PO no.', 180], ['order_reference', 'Order / tender ref.', 200],
                  ['vehicle_serial_number', 'Vehicle serial no.', 200], ['chassis_number', 'Chassis no.', 180], ['engine_number', 'Engine no.', 180], ['year_of_manufacture', 'Year', 110]] as [string, string, number][]).map(([k, l, w]) => (
                  <div key={k} style={{ flex: `0 1 ${w}px`, minWidth: Math.min(w, 160) }}>
                    <label style={labelStyle}>{l}</label>
                    <input style={inputStyle} value={details[k]} onChange={(e) => setDetails({ ...details, [k]: e.target.value })} disabled={k === 'vehicle_serial_number' && !!details.erp_project_id} />
                  </div>
                ))}
                <div style={{ flex: '0 1 160px', minWidth: 150 }}><label style={labelStyle}>PO date</label><DateField value={details.customer_po_date} onChange={(v) => setDetails({ ...details, customer_po_date: v })} /></div>
                <div style={{ flex: '1 1 260px', maxWidth: 380 }}><label style={labelStyle}>Machine in ERP</label><SearchableSelect value={details.erp_project_id} onChange={(v) => setDetails({ ...details, erp_project_id: v })} options={toOptions(machines, 'None — register at completion')} /></div>
                <div style={{ flex: '1 1 220px', maxWidth: 300 }}><label style={labelStyle}>Build manager</label><SearchableSelect value={details.build_manager_id} onChange={(v) => setDetails({ ...details, build_manager_id: v })} options={toOptions(users)} /></div>
                <div style={{ flex: '0 1 130px', minWidth: 120 }}>
                  <label style={labelStyle}>Priority</label>
                  <select style={inputStyle} value={details.priority} onChange={(e) => setDetails({ ...details, priority: e.target.value })}>
                    {Object.entries(RRV_PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div style={{ flex: '0 1 160px', minWidth: 150 }}><label style={labelStyle}>Planned start</label><DateField value={details.planned_start_date} onChange={(v) => setDetails({ ...details, planned_start_date: v })} /></div>
                <div style={{ flex: '0 1 170px', minWidth: 160 }}><label style={labelStyle}>Target completion</label><DateField value={details.target_completion_date} onChange={(v) => setDetails({ ...details, target_completion_date: v })} /></div>
                <div style={{ flex: '0 1 170px', minWidth: 160 }}><label style={labelStyle}>Target handover</label><DateField value={details.target_handover_date} onChange={(v) => setDetails({ ...details, target_handover_date: v })} /></div>
              </div>
              <div style={{ marginTop: 12 }}><label style={labelStyle}>Remarks</label><textarea style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} value={details.remarks} onChange={(e) => setDetails({ ...details, remarks: e.target.value })} /></div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button disabled={busy} style={primaryBtn} onClick={saveDetails}>Save</button>
                <button disabled={busy} style={secondaryBtnStyle} onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ ...sectionStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <InfoRow label="Customer" value={b.customer_name || '—'} />
              <InfoRow label="Customer PO" value={b.customer_po_number ? `${b.customer_po_number}${b.customer_po_date ? ` · ${formatDate(b.customer_po_date)}` : ''}` : '—'} />
              <InfoRow label="Machine / serial" value={b.machine_label || b.vehicle_serial_number || 'Registered at completion'} />
              <InfoRow label="Chassis · engine" value={`${b.chassis_number || '—'} · ${b.engine_number || '—'}`} />
              <InfoRow label="Build manager" value={b.build_manager_name || '—'} />
              <InfoRow label="Priority" value={RRV_PRIORITY_LABELS[b.priority] || b.priority} />
              <InfoRow label="Target completion" value={formatDate(b.target_completion_date)} />
              <InfoRow label="Target handover" value={`${formatDate(b.target_handover_date)}${b.is_overdue ? ' (overdue)' : ''}`} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
            {([['stages', 'Stages'], ['work_orders', `Work Orders & Material (${b.work_orders.length})`], ['tests', `Tests (${b.tests.length})`],
              ['rework', `Rework (${b.open_rework_count} open)`], ['handover', 'Handover'], ['timeline', 'Timeline']] as [Tab, string][]).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} style={{
                padding: '9px 14px', marginBottom: -1, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                color: tab === k ? '#FF6A2A' : '#78716c', borderBottom: tab === k ? '2px solid #FF6A2A' : '2px solid transparent',
              }}>{l}</button>
            ))}
          </div>

          {tab === 'stages' && (
            <div style={sectionStyle}>
              <p style={sectionTitle}>Build stages</p>
              {b.stages.map(stageRow)}
            </div>
          )}

          {tab === 'work_orders' && (
            <>
              <div style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  <p style={{ ...sectionTitle, margin: 0, flex: 1 }}>Linked work orders</p>
                  {can('link_work_order') && !hasMain && <button style={primaryBtn} onClick={() => router.push(`/dashboard/production/work-orders/new?rrv_build_id=${b.id}&build_role=main`)}>+ Main Work Order</button>}
                  {can('link_work_order') && <button style={secondaryBtnStyle} onClick={() => router.push(`/dashboard/production/work-orders/new?rrv_build_id=${b.id}&build_role=sub_assembly`)}>+ Sub-Assembly Work Order</button>}
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
                            <td style={{ ...tdStyle, fontWeight: 700, color: '#FF6A2A', cursor: 'pointer' }} onClick={() => router.push(`/dashboard/production/work-orders/${w.id}`)}>{w.wo_number}</td>
                            <td style={tdStyle}>{w.build_role === 'main' ? 'Main assembly' : 'Sub-assembly'}</td>
                            <td style={tdStyle}>{w.product_code} — {w.product_name}</td>
                            <td style={tdStyle}>{w.operations_done} / {w.operations_total}</td>
                            <td style={{ ...tdStyle, color: w.outstanding_lines ? '#b45309' : '#15803d' }}>{w.outstanding_lines ? `${w.outstanding_lines} line(s) to issue` : 'all issued'}</td>
                            <td style={tdStyle}>{formatDate(w.planned_end_date)}</td>
                            <td style={tdStyle}>{pill(WO_LABELS[w.status] || w.status, WO_HEX[w.status] || '#78716c')}</td>
                            <td style={tdStyle}>
                              {can('link_work_order') && <button type="button" disabled={busy} style={smallBtn} onClick={() => act(() => rrvApi.unlinkWorkOrder(b.id, w.id), 'Unlinking failed.', `${w.wo_number} unlinked.`)}>Unlink</button>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {can('link_work_order') && linkable.length > 0 && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 14 }}>
                    <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
                      <label style={labelStyle}>Link an existing work order</label>
                      <SearchableSelect value={linkWo.id} onChange={(v) => setLinkWo({ ...linkWo, id: v })} placeholder="Select work order…"
                        options={linkable.map((w) => ({ value: String(w.id), label: `${w.wo_number} — ${w.product_code || ''} ${w.product_name || ''} (${WO_LABELS[w.status] || w.status})` }))} />
                    </div>
                    <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                      <label style={labelStyle}>As</label>
                      <select style={inputStyle} value={linkWo.role} onChange={(e) => setLinkWo({ ...linkWo, role: e.target.value })}>
                        <option value="sub_assembly">Sub-assembly</option>
                        {!hasMain && <option value="main">Main assembly</option>}
                      </select>
                    </div>
                    <button type="button" disabled={busy || !linkWo.id} style={primaryBtn}
                      onClick={async () => { if (await act(() => rrvApi.linkWorkOrder(b.id, Number(linkWo.id), linkWo.role), 'Linking failed.', 'Work order linked.')) setLinkWo({ id: '', role: 'sub_assembly' }) }}>
                      Link
                    </button>
                  </div>
                )}
              </div>

              <div style={sectionStyle}>
                <p style={sectionTitle}>Material consumption (all linked work orders)</p>
                {!consumption ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p> : consumption.rows.length === 0 ? (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No material lines yet — they come from the linked work orders&apos; BOMs.</p>
                ) : (
                  <>
                    <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 10px' }}>
                      {consumption.lines_fully_issued} of {consumption.total_required_lines} items fully issued · consumed value <strong>₹{consumption.total_consumed_value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>
                    </p>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                        <thead><tr>{['Item', 'Required', 'Issued', 'Returned', 'Consumed', 'Still to issue', 'Value (₹)', 'Work orders'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                        <tbody>
                          {consumption.rows.map((r) => (
                            <tr key={r.item_id}>
                              <td style={tdStyle}><strong>{r.item_code}</strong> {r.item_name}</td>
                              <td style={tdStyle}>{r.required_qty} {r.uom}</td>
                              <td style={tdStyle}>{r.issued_qty}</td>
                              <td style={tdStyle}>{r.returned_qty}</td>
                              <td style={{ ...tdStyle, fontWeight: 700 }}>{r.consumed_qty}</td>
                              <td style={{ ...tdStyle, color: r.outstanding_qty > 0 ? '#b45309' : TEXT.muted }}>{r.outstanding_qty}</td>
                              <td style={tdStyle}>{r.consumed_value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
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
                <div style={sectionStyle}>
                  <p style={sectionTitle}>Electrical & hydraulic (from their modules)</p>
                  {b.integration.electrical_jobs.map((j) => <p key={`e${j.id}`} style={{ fontSize: 13, margin: '0 0 4px' }}>⚡ {j.job_number} — {j.title} · <strong>{j.status.replace(/_/g, ' ')}</strong></p>)}
                  {b.integration.hydraulic_systems.map((s) => <p key={`h${s.id}`} style={{ fontSize: 13, margin: '0 0 4px' }}>🛢 {s.system_number} — {s.name} · <strong>{s.status.replace(/_/g, ' ')}</strong></p>)}
                </div>
              )}
            </>
          )}

          {tab === 'tests' && (
            <>
              <div style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                  <p style={{ ...sectionTitle, margin: 0, flex: 1 }}>Required tests</p>
                  {can('edit') && reqTests === null && b.status !== 'completed' && <button style={smallBtn} onClick={() => setReqTests([...b.required_tests])}>Change</button>}
                </div>
                {reqTests !== null ? (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
                      {Object.entries(RRV_TEST_TYPES).map(([k, v]) => (
                        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', flex: '0 1 300px' }}>
                          <input type="checkbox" checked={reqTests.includes(k)} onChange={(e) => setReqTests((prev) => (e.target.checked ? [...(prev || []), k] : (prev || []).filter((t) => t !== k)))} />{v}
                        </label>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button disabled={busy} style={primaryBtn} onClick={saveRequiredTests}>Save</button>
                      <button disabled={busy} style={secondaryBtnStyle} onClick={() => setReqTests(null)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {Object.entries(b.test_status).map(([k, v]) => (
                      <span key={k} style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 9999, background: `${RESULT_HEX[v]}14`, color: RESULT_HEX[v], border: `1px solid ${RESULT_HEX[v]}33` }}>
                        {v === 'pass' ? '✓' : v === 'fail' ? '✗' : '○'} {RRV_TEST_TYPES[k] || k}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {can('record_test') && (
                <div style={sectionStyle}>
                  <p style={sectionTitle}>Record a test</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: '1 1 260px', maxWidth: 340 }}>
                      <label style={labelStyle}>Test</label>
                      <select style={inputStyle} value={testForm.test_type} onChange={(e) => setTestForm({ ...testForm, test_type: e.target.value })}>
                        {Object.entries(RRV_TEST_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div style={{ flex: '0 1 160px', minWidth: 150 }}><label style={labelStyle}>Date</label><DateField value={testForm.test_date} onChange={(v) => setTestForm({ ...testForm, test_date: v })} /></div>
                    <div style={{ flex: '0 1 120px', minWidth: 110 }}>
                      <label style={labelStyle}>Result</label>
                      <select style={inputStyle} value={testForm.result} onChange={(e) => setTestForm({ ...testForm, result: e.target.value })}>
                        <option value="pass">Pass</option><option value="fail">Fail</option>
                      </select>
                    </div>
                    <div style={{ flex: '1 1 220px', maxWidth: 300 }}><label style={labelStyle}>Witnessed by</label><input style={inputStyle} value={testForm.witnessed_by} onChange={(e) => setTestForm({ ...testForm, witnessed_by: e.target.value })} placeholder="e.g. RDSO inspector, customer rep." /></div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
                    <div style={{ flex: '1 1 260px' }}><label style={labelStyle}>Expected / acceptance</label><input style={inputStyle} value={testForm.expected} onChange={(e) => setTestForm({ ...testForm, expected: e.target.value })} placeholder="e.g. stop within 30 m at 25 km/h" /></div>
                    <div style={{ flex: '1 1 260px' }}><label style={labelStyle}>Observed {testForm.result === 'fail' ? '*' : ''}</label><input style={inputStyle} value={testForm.observed} onChange={(e) => setTestForm({ ...testForm, observed: e.target.value })} placeholder="e.g. stopped in 27 m" /></div>
                  </div>
                  {testForm.result === 'fail' && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12, alignItems: 'flex-end' }}>
                      <div style={{ flex: '1 1 220px', maxWidth: 300 }}><label style={labelStyle}>Rework assigned to</label><SearchableSelect value={testForm.rework_assignee_id} onChange={(v) => setTestForm({ ...testForm, rework_assignee_id: v })} options={userOptions} /></div>
                      <p style={{ fontSize: 12.5, color: '#92400E', margin: 0, flex: '1 1 260px' }}>A failed test raises a rework order automatically. It can only be verified after a passing retest.</p>
                    </div>
                  )}
                  <div style={{ marginTop: 12 }}><label style={labelStyle}>Remarks</label><input style={inputStyle} value={testForm.remarks} onChange={(e) => setTestForm({ ...testForm, remarks: e.target.value })} /></div>
                  <button disabled={busy} style={{ ...primaryBtn, marginTop: 14 }} onClick={recordTest}>Record Test</button>
                </div>
              )}

              <div style={sectionStyle}>
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
                              {can('record_test') && !t.rework_number && (
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

          {tab === 'rework' && (
            <div style={sectionStyle}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                <p style={{ ...sectionTitle, margin: 0, flex: 1 }}>Rework orders</p>
                {can('raise_rework') && !reworkForm.open && <button style={secondaryBtnStyle} onClick={() => setReworkForm({ ...reworkForm, open: true })}>+ Raise Rework</button>}
              </div>
              {reworkForm.open && (
                <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.5)', marginBottom: 14 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: '1 1 300px' }}><label style={labelStyle}>What needs fixing *</label><input style={inputStyle} value={reworkForm.title} onChange={(e) => setReworkForm({ ...reworkForm, title: e.target.value })} placeholder="e.g. Hydraulic hose chafing near boom pivot" /></div>
                    <div style={{ flex: '1 1 220px', maxWidth: 300 }}><label style={labelStyle}>Assign to</label><SearchableSelect value={reworkForm.assigned_to_id} onChange={(v) => setReworkForm({ ...reworkForm, assigned_to_id: v })} options={userOptions} /></div>
                    <div style={{ flex: '0 1 160px', minWidth: 150 }}><label style={labelStyle}>Due</label><DateField value={reworkForm.due_date} onChange={(v) => setReworkForm({ ...reworkForm, due_date: v })} /></div>
                  </div>
                  <div style={{ marginTop: 10 }}><label style={labelStyle}>Defect details</label><textarea style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} value={reworkForm.defect_description} onChange={(e) => setReworkForm({ ...reworkForm, defect_description: e.target.value })} /></div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button disabled={busy} style={primaryBtn} onClick={raiseRework}>Raise</button>
                    <button disabled={busy} style={secondaryBtnStyle} onClick={() => setReworkForm({ ...reworkForm, open: false })}>Cancel</button>
                  </div>
                </div>
              )}
              {b.rework_orders.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No rework on this build. Failed tests and failed inspections raise rework here automatically.</p> : b.rework_orders.map((rw) => (
                <div key={rw.id} style={{ padding: '12px 0', borderTop: `1px solid ${BORDER.light}` }}>
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
                  {doneForm?.id === rw.id ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10, alignItems: 'flex-end' }}>
                      <div style={{ flex: '1 1 280px' }}><label style={labelStyle}>Corrective action *</label><input style={inputStyle} value={doneForm.corrective_action} onChange={(e) => setDoneForm({ ...doneForm, corrective_action: e.target.value })} /></div>
                      <div style={{ flex: '1 1 220px' }}><label style={labelStyle}>Root cause</label><input style={inputStyle} value={doneForm.root_cause} onChange={(e) => setDoneForm({ ...doneForm, root_cause: e.target.value })} /></div>
                      <div style={{ flex: '0 1 100px', minWidth: 90 }}><label style={labelStyle}>Hours</label><input style={inputStyle} value={doneForm.hours_spent} inputMode="decimal" onChange={(e) => setDoneForm({ ...doneForm, hours_spent: e.target.value.replace(/[^0-9.]/g, '') })} /></div>
                      <button disabled={busy} style={primaryBtn} onClick={finishRework}>Mark Done</button>
                      <button disabled={busy} style={secondaryBtnStyle} onClick={() => setDoneForm(null)}>Cancel</button>
                    </div>
                  ) : can('stages') || can('record_test') ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {rw.status === 'open' && <button disabled={busy} style={smallBtn} onClick={() => act(() => rrvApi.startRework(rw.id), 'Starting rework failed.', `${rw.rework_number} started.`)}>Start</button>}
                      {(rw.status === 'open' || rw.status === 'in_progress') && <button disabled={busy} style={smallBtn} onClick={() => setDoneForm({ id: rw.id, corrective_action: '', root_cause: rw.root_cause || '', hours_spent: '' })}>Mark Done</button>}
                      {rw.status === 'done' && <button disabled={busy} style={{ ...primaryBtn, padding: '5px 12px', fontSize: 12 }} onClick={() => setPrompt({ kind: 'rework_verify', rw })}>Verify</button>}
                      {rw.status === 'done' && <button disabled={busy} style={smallBtn} onClick={() => setPrompt({ kind: 'rework_reject', rw })}>Send Back</button>}
                      {can('sign_off') && ['open', 'in_progress', 'done'].includes(rw.status) && <button disabled={busy} style={{ ...dangerBtnStyle, padding: '5px 12px', fontSize: 12 }} onClick={() => setPrompt({ kind: 'rework_cancel', rw })}>Cancel</button>}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {tab === 'handover' && (
            <div style={sectionStyle}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                <p style={{ ...sectionTitle, margin: 0, flex: 1 }}>Production handover</p>
                {can('edit') && handover === null && b.status !== 'handed_over' && b.status !== 'cancelled' && <button style={smallBtn} onClick={startHandoverEdit}>Edit</button>}
              </div>
              {handover !== null ? (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: '0 1 170px', minWidth: 160 }}><label style={labelStyle}>Handover date</label><DateField value={handover.handover_date} onChange={(v) => setHandover({ ...handover, handover_date: v })} /></div>
                    <div style={{ flex: '0 1 170px', minWidth: 160 }}><label style={labelStyle}>Commissioning date</label><DateField value={handover.commissioning_date} onChange={(v) => setHandover({ ...handover, commissioning_date: v })} /></div>
                    <div style={{ flex: '1 1 220px', maxWidth: 300 }}><label style={labelStyle}>Handed over to (name)</label><input style={inputStyle} value={handover.handed_over_to_name} onChange={(e) => setHandover({ ...handover, handed_over_to_name: e.target.value })} placeholder="e.g. Sr. DEN (Works)" /></div>
                    <div style={{ flex: '1 1 240px', maxWidth: 320 }}><label style={labelStyle}>Organisation</label><input style={inputStyle} value={handover.handed_over_to_organization} onChange={(e) => setHandover({ ...handover, handed_over_to_organization: e.target.value })} /></div>
                    <div style={{ flex: '1 1 240px', maxWidth: 320 }}><label style={labelStyle}>Location</label><input style={inputStyle} value={handover.handover_location} onChange={(e) => setHandover({ ...handover, handover_location: e.target.value })} placeholder="Depot / site" /></div>
                    <div style={{ flex: '0 1 200px', minWidth: 170 }}><label style={labelStyle}>Customer acceptance ref.</label><input style={inputStyle} value={handover.customer_acceptance_ref} onChange={(e) => setHandover({ ...handover, customer_acceptance_ref: e.target.value })} /></div>
                    <div style={{ flex: '0 1 130px', minWidth: 120 }}><label style={labelStyle}>Warranty (months)</label><input style={inputStyle} value={handover.warranty_months} inputMode="numeric" onChange={(e) => setHandover({ ...handover, warranty_months: e.target.value.replace(/[^0-9]/g, '') })} /></div>
                  </div>
                  <div style={{ marginTop: 12 }}><label style={labelStyle}>Remarks</label><textarea style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} value={handover.handover_remarks} onChange={(e) => setHandover({ ...handover, handover_remarks: e.target.value })} /></div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button disabled={busy} style={primaryBtn} onClick={saveHandover}>Save</button>
                    <button disabled={busy} style={secondaryBtnStyle} onClick={() => setHandover(null)}>Cancel</button>
                  </div>
                </>
              ) : (
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
              )}
              <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '14px 0 0' }}>
                Fill these in, then complete the <strong>Production Handover</strong> stage (manager sign-off). That makes the machine active in the ERP registry
                with its delivery, handover and warranty dates, and issues the handover certificate.
              </p>
            </div>
          )}

          {tab === 'timeline' && (
            <div style={sectionStyle}>
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

      <PromptDialog
        open={prompt !== null}
        title={promptText.title}
        message={promptText.message}
        placeholder={promptText.placeholder}
        confirmLabel={promptText.label}
        danger={promptText.danger}
        onConfirm={runPrompt}
        onCancel={() => setPrompt(null)}
      />
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
