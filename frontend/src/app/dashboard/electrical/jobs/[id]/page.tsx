'use client'

import { Suspense, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { electricalApi } from '@/lib/api'
import { ElectricalJobDetail, ElectricalLookupOption, ElectricalMeta } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, smallSecondaryBtnStyle, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import ElectricalNav from '@/components/electrical/ElectricalNav'
import JobForm from '@/components/electrical/JobForm'
import StagesTab from '@/components/electrical/StagesTab'
import HandoverTab from '@/components/electrical/HandoverTab'
import BomTab from '@/components/electrical/BomTab'
import PanelsTab from '@/components/electrical/PanelsTab'
import CablesTab from '@/components/electrical/CablesTab'
import DrawingsTab from '@/components/electrical/DrawingsTab'
import TestsTab from '@/components/electrical/TestsTab'
import IssuesTab from '@/components/electrical/IssuesTab'
import DocumentsTab from '@/components/electrical/DocumentsTab'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import {
  sectionStyle, primaryBtn, dangerBtn, ErrorBanner, useLookupErrors, NoticeBanner, useJobFeatures,
  JOB_STATUS_LABELS, JOB_STATUS_HEX, PRIORITY_LABELS, PRIORITY_HEX, PHASE_LABELS, PHASE_HEX,
} from '@/components/electrical/shared'
import { useCan } from '@/lib/permissions'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import { OrderProjectChip } from '@/components/sales/OrderProjectPicker'

const WORKING = ['draft', 'in_progress', 'handed_over']
const PHASES = ['design', 'procurement', 'build', 'test_qc', 'handover'] as const
const TAB_KEYS = ['stages', 'details', 'bom', 'panels', 'cables', 'drawings', 'tests', 'issues', 'handover', 'documents'] as const
type Tab = typeof TAB_KEYS[number]
type Confirm = 'resume' | 'close' | 'delete' | null

export default function ElectricalJobDetailPage() {
  return (
    <Suspense fallback={null}>
      <JobDetailView />
    </Suspense>
  )
}

function JobDetailView() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  const { can, canDelete } = useCan()
  const { jf, sees } = useJobFeatures()
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const ref = params.id as string
  const { id: resolvedJobId, error: linkError } = useRecordId(ref)
  const jobId = resolvedJobId ?? 0
  const initialTab = searchParams.get('tab') as Tab | null

  const [job, setJob] = useState<ElectricalJobDetail | null>(null)
  const [meta, setMeta] = useState<ElectricalMeta | null>(null)
  const [users, setUsers] = useState<ElectricalLookupOption[]>([])
  const [tab, setTab] = useState<Tab>(initialTab && TAB_KEYS.includes(initialTab) ? initialTab : 'stages')
  const [error, setError] = useState<string | string[]>('')
  const [lookupErrors, addLookupError] = useLookupErrors()
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [reasonFor, setReasonFor] = useState<'hold' | 'cancel' | null>(null)

  const load = () => electricalApi.getJob(jobId)
    .then((j: ElectricalJobDetail) => { setJob(j); setError('') })
    .catch((err) => setError(extractErrorMessages(err, 'Failed to load the electrical job.')))

  useEffect(() => {
    if (!isAuthorized || !jobId) return
    electricalApi.getJob(jobId)
      .then((j: ElectricalJobDetail) => { setJob(j); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the electrical job.')))
    electricalApi.getMeta().then(setMeta).catch((err) => addLookupError(extractErrorMessages(err, "Couldn't load the electrical stage and category lists — stage and category names may show blank; refresh the page to try again.")))
    electricalApi.lookupUsers().then(setUsers).catch((err) => addLookupError(extractErrorMessages(err,
      "Couldn't load users for the stage owner pickers — the job is still usable, refresh to try again.")))
  }, [isAuthorized, jobId])

  // Sub-tabs the user's role sees (Electrical › RRV Electrical Jobs features).
  // Drawings / Tests / Troubleshooting / BOM also open through their own
  // Electrical tabs (Drawings, Testing, Troubleshooting, Purchase), as on the backend.
  const tabVisible = (t: Tab): boolean => {
    switch (t) {
      case 'details': return true
      case 'bom': return sees('bom') || can('electrical', 'purchase', 'view')
      case 'drawings': return sees('drawings') || can('electrical', 'drawings', 'view')
      case 'tests': return sees('tests') || can('electrical', 'testing', 'view')
      case 'issues': return sees('issues') || can('electrical', 'troubleshooting', 'view')
      default: return sees(t)
    }
  }
  const visibleTabs = TAB_KEYS.filter(tabVisible)
  const activeTab: Tab = tabVisible(tab) ? tab : (visibleTabs[0] ?? 'details')

  const goToTab = (t: string) => {
    if (!TAB_KEYS.includes(t as Tab) || !tabVisible(t as Tab)) return
    setTab(t as Tab)
    router.replace(`/dashboard/electrical/jobs/${ref}?tab=${t}`, { scroll: false })
  }

  const act = async (fn: () => Promise<ElectricalJobDetail>, fallback: string, success: string) => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      setJob(await fn())
      setNotice(success)
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  const runConfirm = async () => {
    const which = confirm
    setConfirm(null)
    if (which === 'resume') await act(() => electricalApi.resumeJob(jobId), 'Failed to resume the job.', 'Job resumed.')
    if (which === 'close') await act(() => electricalApi.closeJob(jobId), 'Failed to close the job.', 'Job closed. Its records are now final.')
    if (which === 'delete') {
      setBusy(true)
      try {
        await electricalApi.deleteJob(jobId)
        router.push('/dashboard/electrical/jobs')
      } catch (err) {
        setError(extractErrorMessages(err, 'Failed to delete the job.'))
        setBusy(false)
      }
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><ElectricalNav /><InvalidRecordLink message={linkError} listHref="/dashboard/electrical/jobs" listLabel="Back to jobs" /></div>)
  if (!resolvedJobId) return <div><ElectricalNav /></div>

  // Every job / tab mutation needs Jobs › Edit on the backend; Tests and
  // Troubleshooting also accept their own tab's create / edit actions, so
  // those two tabs get the open-job flag and gate their buttons themselves.
  const jobsEdit = can('electrical', 'jobs', 'edit')
  const isWorking = !!job && WORKING.includes(job.status)
  const canEdit = isWorking && jobsEdit
  // Per sub-tab: the job is open and the role holds that feature's edit (or,
  // for Documents, upload / delete — DocumentsTab refines it).
  const editFor = (feature: string) => isWorking && jf(feature, 'edit')
  const canHoldClose = jf('job_status', 'edit')
  const canCancelJob = jf('job_status', 'cancel')
  const seeRequirement = sees('requirement')
  const s = job?.summary
  const tabLabels: Record<Tab, string> = {
    stages: `Stages${job ? ` (${job.done_stages}/${job.total_stages})` : ''}`,
    details: 'Details & Requirement',
    bom: `BOM${s ? ` (${s.bom_count})` : ''}`,
    panels: `Panels${s ? ` (${s.panel_count})` : ''}`,
    cables: `Cables${s ? ` (${s.cable_count})` : ''}`,
    drawings: `Drawings${s ? ` (${s.drawing_count})` : ''}`,
    tests: `Tests${s ? ` (${s.factory_tests + s.commissioning_tests})` : ''}`,
    issues: `Troubleshooting${s && s.open_issues ? ` (${s.open_issues} open)` : ''}`,
    handover: 'QC & Handover',
    documents: `Documents${s ? ` (${s.document_count})` : ''}`,
  }
  const tabProps = job && meta ? { job, meta, canEdit, onChanged: load } : null
  const propsFor = (feature: string) => (tabProps ? { ...tabProps, canEdit: editFor(feature) } : null)
  const docProps = tabProps ? { ...tabProps, canEdit: isWorking && (jf('documents', 'create') || jf('documents', 'delete')) } : null
  const testIssueProps = tabProps ? { ...tabProps, canEdit: isWorking } : null

  return (
    <div>
      <ElectricalNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Electrical Module · RRV Electrical Job
          </p>
          <div data-tour="elec-job-header-badges" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 4px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{job?.job_number || 'Electrical Job'}</h1>
            {job && <Pill label={JOB_STATUS_LABELS[job.status] || job.status} hex={JOB_STATUS_HEX[job.status]} />}
            {job && <Pill label={`${PRIORITY_LABELS[job.priority] || job.priority} priority`} hex={PRIORITY_HEX[job.priority]} />}
            {job?.is_overdue && <Pill label="Overdue" hex="#DC2626" />}
          </div>
          {job && (
            <p style={{ fontSize: 14, color: TEXT.body, margin: '0 0 20px' }}>
              {job.title}
              <span style={{ color: TEXT.muted }}>{[job.rrv_model, job.vehicle_number, job.customer_name].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
            </p>
          )}
        </div>
        <button data-tour="elec-job-back-btn" onClick={() => router.push('/dashboard/electrical/jobs')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <ErrorBanner error={error} />
      <ErrorBanner error={lookupErrors} />
      <NoticeBanner notice={notice} />

      {job && (
        <>
          {job.status === 'on_hold' && job.hold_reason && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(147,51,234,0.08)', border: '1px solid rgba(147,51,234,0.2)', color: '#7e22ce', fontSize: 13 }}>
              On hold: {job.hold_reason}
            </div>
          )}
          {job.status === 'cancelled' && job.cancel_reason && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              Cancelled: {job.cancel_reason}
            </div>
          )}

          {(canHoldClose || canCancelJob || job.status === 'draft') && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {canHoldClose && job.status === 'handed_over' && <button data-tour="elec-job-close-btn" type="button" disabled={busy} style={primaryBtn} onClick={() => setConfirm('close')}>Close Job</button>}
            {canHoldClose && job.status === 'on_hold' && <button data-tour="elec-job-resume-btn" type="button" disabled={busy} style={primaryBtn} onClick={() => setConfirm('resume')}>Resume Job</button>}
            {canHoldClose && ['draft', 'in_progress'].includes(job.status) && <button data-tour="elec-job-hold-btn" type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => setReasonFor('hold')}>Put On Hold</button>}
            {canCancelJob && ['draft', 'in_progress', 'on_hold'].includes(job.status) && <button data-tour="elec-job-cancel-btn" type="button" disabled={busy} style={dangerBtn} onClick={() => setReasonFor('cancel')}>Cancel Job</button>}
            {job.status === 'draft' && job.done_stages === 0 && canDelete('electrical', 'jobs', job.created_by_id ?? null) && <button data-tour="elec-job-delete-btn" type="button" disabled={busy} style={dangerBtn} onClick={() => setConfirm('delete')}>Delete Draft</button>}
          </div>}

          {/* Phase tracker */}
          <div data-tour="elec-job-phase-tracker" style={{ ...sectionStyle, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>
                {job.progress_percent}% complete · {job.done_stages} of {job.total_stages} stages
              </span>
              <span style={{ fontSize: 12.5, color: TEXT.muted }}>
                {job.current_stage_label ? <>Next up: <strong style={{ color: TEXT.body }}>{job.current_stage_label}</strong></> : 'Every stage is done.'}
                {job.target_handover_date ? <> · Target handover {formatDate(job.target_handover_date)}</> : <> · Target handover not set</>}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {PHASES.map((phase) => {
                const stages = job.stages.filter((st) => st.phase === phase)
                const done = stages.filter((st) => st.status === 'completed' || st.status === 'not_applicable').length
                const pct = stages.length ? (done / stages.length) * 100 : 0
                const current = job.current_phase === phase
                return (
                  <div key={phase} style={{ flex: stages.length, minWidth: 0 }}>
                    <div style={{ height: 8, borderRadius: 4, background: 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: PHASE_HEX[phase] }} />
                    </div>
                    <div style={{ fontSize: 11, fontWeight: current ? 700 : 500, color: current ? PHASE_HEX[phase] : TEXT.muted, marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {PHASE_LABELS[phase]} {done}/{stages.length}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, borderBottom: `1px solid ${BORDER.light}`, marginBottom: 18 }}>
            {visibleTabs.map((t) => (
              <button key={t} data-tour={`elec-job-tab-${t}`} type="button" onClick={() => goToTab(t)} style={{
                padding: '10px 14px', marginBottom: -1, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                fontSize: 13, fontWeight: 600, color: activeTab === t ? '#FF6A2A' : TEXT.muted,
                borderBottom: activeTab === t ? '2px solid #FF6A2A' : '2px solid transparent',
              }}>
                {tabLabels[t]}
              </button>
            ))}
          </div>

          {activeTab === 'stages' && <StagesTab job={job} canEdit={editFor('stages')} users={users} onJob={setJob} onGoToTab={goToTab} />}

          {activeTab === 'details' && (
            editing ? (
              <JobForm
                initial={job}
                title={`Edit ${job.job_number}`}
                subtitle="Identity, planning and the Electrical Requirement — nothing is saved until you press Save Changes."
                submitLabel="Save Changes"
                onCancel={() => setEditing(false)}
                onSubmit={async (payload) => {
                  setJob(await electricalApi.updateJob(jobId, payload))
                  setEditing(false)
                  setNotice('Job details saved.')
                }}
              />
            ) : (
              // One record view (as R&D › Overview): the job's key facts on top, then
              // every detail as label–value rows in the same order as the job form.
              <DetailCard>
                <DetailSummary
                  title={job.title}
                  meta={<>
                    <span>Lead: <strong style={{ color: TEXT.heading }}>{job.lead_engineer_name || 'Not assigned'}</strong></span>
                    <span>·</span>
                    {/* Target handover is already on the progress bar above. */}
                    <span>{job.planned_start_date ? `Planned start ${formatDate(job.planned_start_date)}` : 'Start not planned'}</span>
                    {job.started_at && <><span>·</span><span>Started {formatDate(job.started_at)}</span></>}
                  </>}
                  actions={jobsEdit && !['closed', 'cancelled'].includes(job.status)
                    ? <button data-tour="elec-job-edit-btn" type="button" style={smallSecondaryBtnStyle} onClick={() => setEditing(true)}>Edit Details & Requirement</button>
                    : undefined}
                />
                <div data-tour="elec-job-details-rrv">
                  <DetailGroup title="RRV & Job">
                    {job.order_project_number && (
                      <DetailRow label="Order Project / Vehicle">
                        <OrderProjectChip opNumber={job.order_project_number} elementNo={job.order_project_element_no} label={job.order_project_element_label}
                          onClick={() => router.push(recordPath('/dashboard/projects/order-projects', job, 'order_project_id'))} />
                      </DetailRow>
                    )}
                    <DetailRow label="RRV / Machine (ERP)">{job.project_label}</DetailRow>
                    <DetailRow label="RRV Model">{job.rrv_model}</DetailRow>
                    <DetailRow label="Vehicle / Serial No.">{job.vehicle_number}</DetailRow>
                    <DetailRow label="Customer">{job.customer_name}</DetailRow>
                    <DetailRow label="Plant">{job.branch_name}</DetailRow>
                  </DetailGroup>
                </div>
                {seeRequirement && (
                  <div data-tour="elec-job-details-requirement">
                    <DetailGroup title="Electrical Requirement">
                      <DetailRow label="System Voltage">{job.system_voltage}</DetailRow>
                      <DetailRow label="Battery">{job.battery_spec}</DetailRow>
                      <DetailRow label="Alternator / Charger">{job.alternator_spec}</DetailRow>
                      <DetailRow label="Applicable Standards">{job.applicable_standards}</DetailRow>
                      <DetailRow label="Customer Spec Ref.">{job.customer_spec_ref}</DetailRow>
                      <DetailRow label="Requirement">{job.requirement_notes || <span style={{ color: TEXT.muted }}>Not written down yet.</span>}</DetailRow>
                    </DetailGroup>
                  </div>
                )}
                <DetailGroup last>
                  <DetailRow label="Remarks">{job.remarks}</DetailRow>
                </DetailGroup>
                <p style={{ fontSize: 12, color: TEXT.muted, margin: '10px 0 0' }}>
                  Created by {job.created_by_name || '—'}{job.created_at ? ` on ${formatDateTime(job.created_at)}` : ''}
                </p>
              </DetailCard>
            )
          )}

          {activeTab === 'bom' && propsFor('bom') && <BomTab {...propsFor('bom')!} />}
          {activeTab === 'panels' && propsFor('panels') && <PanelsTab {...propsFor('panels')!} />}
          {activeTab === 'cables' && propsFor('cables') && <CablesTab {...propsFor('cables')!} />}
          {activeTab === 'drawings' && propsFor('drawings') && <DrawingsTab {...propsFor('drawings')!} />}
          {testIssueProps && activeTab === 'tests' && <TestsTab {...testIssueProps} />}
          {testIssueProps && activeTab === 'issues' && <IssuesTab {...testIssueProps} />}
          {activeTab === 'handover' && <HandoverTab key={job.updated_at} job={job} canEdit={isWorking} onJob={setJob} />}
          {docProps && activeTab === 'documents' && <DocumentsTab {...docProps} />}
        </>
      )}

      <ConfirmDialog
        open={confirm === 'resume'}
        title="Resume this job?"
        message="Stage work can continue again."
        confirmLabel="Resume"
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'close'}
        title="Close this job?"
        message="Every stage is done and the RRV is handed over. Closing makes the job's records final — nothing can be changed afterwards."
        confirmLabel="Close Job"
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this draft job?"
        message={`${job?.job_number || 'This job'} and its empty stage list will be removed.`}
        confirmLabel="Delete"
        danger
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
      <PromptDialog
        open={!!reasonFor}
        title={reasonFor === 'hold' ? 'Put job on hold' : 'Cancel job'}
        message={reasonFor === 'hold' ? 'Stage work is frozen until the job is resumed. Why is it on hold?' : 'A cancelled job can\'t be reopened. Why is it being cancelled?'}
        placeholder={reasonFor === 'hold' ? 'e.g. Awaiting customer approval of the schematic' : 'e.g. Order withdrawn by customer'}
        confirmLabel={reasonFor === 'hold' ? 'Put On Hold' : 'Cancel Job'}
        danger={reasonFor === 'cancel'}
        onConfirm={async (reason) => {
          const which = reasonFor
          setReasonFor(null)
          if (!reason.trim()) { setError('A reason is required.'); return }
          if (which === 'hold') await act(() => electricalApi.holdJob(jobId, reason.trim()), 'Failed to put the job on hold.', 'Job put on hold.')
          if (which === 'cancel') await act(() => electricalApi.cancelJob(jobId, reason.trim()), 'Failed to cancel the job.', 'Job cancelled.')
        }}
        onCancel={() => setReasonFor(null)}
      />
    </div>
  )
}
