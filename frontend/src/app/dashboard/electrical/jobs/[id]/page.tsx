'use client'

import { Suspense, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { electricalApi } from '@/lib/api'
import { ElectricalJobDetail, ElectricalLookupOption, ElectricalMeta } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, InfoRow } from '@/components/shared/ui'
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
  sectionStyle, sectionTitle, primaryBtn, dangerBtn, ErrorBanner, useLookupErrors, NoticeBanner, pill, useJobFeatures,
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
            {job && <span style={pill(JOB_STATUS_HEX[job.status])}>{JOB_STATUS_LABELS[job.status] || job.status}</span>}
            {job && <span style={pill(PRIORITY_HEX[job.priority])}>{PRIORITY_LABELS[job.priority]}</span>}
            {job?.is_overdue && <span style={pill('#DC2626')}>Overdue</span>}
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

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {canHoldClose && job.status === 'handed_over' && <button data-tour="elec-job-close-btn" type="button" disabled={busy} style={primaryBtn} onClick={() => setConfirm('close')}>Close Job</button>}
            {canHoldClose && job.status === 'on_hold' && <button data-tour="elec-job-resume-btn" type="button" disabled={busy} style={primaryBtn} onClick={() => setConfirm('resume')}>Resume Job</button>}
            {canHoldClose && ['draft', 'in_progress'].includes(job.status) && <button data-tour="elec-job-hold-btn" type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => setReasonFor('hold')}>Put On Hold</button>}
            {canCancelJob && ['draft', 'in_progress', 'on_hold'].includes(job.status) && <button data-tour="elec-job-cancel-btn" type="button" disabled={busy} style={dangerBtn} onClick={() => setReasonFor('cancel')}>Cancel Job</button>}
            {job.status === 'draft' && job.done_stages === 0 && canDelete('electrical', 'jobs', job.created_by_id ?? null) && <button data-tour="elec-job-delete-btn" type="button" disabled={busy} style={dangerBtn} onClick={() => setConfirm('delete')}>Delete Draft</button>}
          </div>

          {/* Phase tracker */}
          <div data-tour="elec-job-phase-tracker" style={{ ...sectionStyle, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>
                {job.progress_percent}% complete · {job.done_stages} of {job.total_stages} stages
              </span>
              <span style={{ fontSize: 12.5, color: TEXT.muted }}>
                {job.current_stage_label ? <>Next up: <strong style={{ color: TEXT.body }}>{job.current_stage_label}</strong></> : 'Every stage is done.'}
                {job.target_handover_date && <> · Target handover {formatDate(job.target_handover_date)}</>}
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
          <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${BORDER.light}`, marginBottom: 18, overflowX: 'auto' }}>
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
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
                  <div data-tour="elec-job-details-rrv" style={{ ...sectionStyle, flex: '1 1 360px', marginBottom: 0 }}>
                    <p style={sectionTitle}>RRV & Job</p>
                    {job.order_project_number && (
                      <div style={{ marginBottom: 10 }}>
                        <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Order project</p>
                        <OrderProjectChip opNumber={job.order_project_number} elementNo={job.order_project_element_no} label={job.order_project_element_label}
                          onClick={() => router.push(recordPath('/dashboard/projects/order-projects', job, 'order_project_id'))} />
                      </div>
                    )}
                    <InfoRow label="RRV / Machine (ERP)" value={job.project_label || '—'} />
                    <InfoRow label="RRV Model" value={job.rrv_model || '—'} />
                    <InfoRow label="Vehicle / Serial No." value={job.vehicle_number || '—'} />
                    <InfoRow label="Customer" value={job.customer_name || '—'} />
                    <InfoRow label="Plant" value={job.branch_name || '—'} />
                    <InfoRow label="Lead Engineer" value={job.lead_engineer_name || '—'} />
                    <InfoRow label="Planned Start" value={job.planned_start_date ? formatDate(job.planned_start_date) : '—'} />
                    <InfoRow label="Target Handover" value={job.target_handover_date ? formatDate(job.target_handover_date) : '—'} />
                    <InfoRow label="Started" value={job.started_at ? formatDateTime(job.started_at) : '—'} />
                    <InfoRow label="Created by" value={`${job.created_by_name || '—'}${job.created_at ? ` · ${formatDateTime(job.created_at)}` : ''}`} />
                  </div>
                  {seeRequirement && <div data-tour="elec-job-details-requirement" style={{ ...sectionStyle, flex: '1 1 360px', marginBottom: 0 }}>
                    <p style={sectionTitle}>Electrical Requirement</p>
                    <InfoRow label="System Voltage" value={job.system_voltage || '—'} />
                    <InfoRow label="Battery" value={job.battery_spec || '—'} />
                    <InfoRow label="Alternator / Charger" value={job.alternator_spec || '—'} />
                    <InfoRow label="Applicable Standards" value={job.applicable_standards || '—'} />
                    <InfoRow label="Customer Spec Ref." value={job.customer_spec_ref || '—'} />
                    <p style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary, margin: '12px 0 4px' }}>Requirement</p>
                    <p style={{ fontSize: 13, color: job.requirement_notes ? TEXT.body : TEXT.muted, margin: 0, whiteSpace: 'pre-wrap' }}>{job.requirement_notes || 'Not written down yet.'}</p>
                    {job.remarks && (
                      <>
                        <p style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary, margin: '12px 0 4px' }}>Remarks</p>
                        <p style={{ fontSize: 13, color: TEXT.body, margin: 0, whiteSpace: 'pre-wrap' }}>{job.remarks}</p>
                      </>
                    )}
                  </div>}
                </div>
                {jobsEdit && !['closed', 'cancelled'].includes(job.status) && (
                  <div style={{ marginTop: 16 }}>
                    <button data-tour="elec-job-edit-btn" type="button" style={secondaryBtnStyle} onClick={() => setEditing(true)}>Edit Details & Requirement</button>
                  </div>
                )}
              </>
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
