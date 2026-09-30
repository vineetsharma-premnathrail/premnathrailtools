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
  sectionStyle, sectionTitle, primaryBtn, dangerBtn, ErrorBanner, NoticeBanner, pill,
  JOB_STATUS_LABELS, JOB_STATUS_HEX, PRIORITY_LABELS, PRIORITY_HEX, PHASE_LABELS, PHASE_HEX,
} from '@/components/electrical/shared'

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
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const jobId = Number(params.id)
  const initialTab = searchParams.get('tab') as Tab | null

  const [job, setJob] = useState<ElectricalJobDetail | null>(null)
  const [meta, setMeta] = useState<ElectricalMeta | null>(null)
  const [users, setUsers] = useState<ElectricalLookupOption[]>([])
  const [tab, setTab] = useState<Tab>(initialTab && TAB_KEYS.includes(initialTab) ? initialTab : 'stages')
  const [error, setError] = useState<string | string[]>('')
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
    electricalApi.getMeta().then(setMeta).catch((err) => setError(extractErrorMessages(err, 'Failed to load electrical stage and category lists.')))
    electricalApi.lookupUsers().then(setUsers).catch(() => setUsers([]))
  }, [isAuthorized, jobId])

  const goToTab = (t: string) => {
    if (!TAB_KEYS.includes(t as Tab)) return
    setTab(t as Tab)
    router.replace(`/dashboard/electrical/jobs/${jobId}?tab=${t}`, { scroll: false })
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

  const canEdit = !!job && WORKING.includes(job.status)
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

  return (
    <div>
      <ElectricalNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Electrical Module · RRV Electrical Job
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 4px', flexWrap: 'wrap' }}>
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
        <button onClick={() => router.push('/dashboard/electrical/jobs')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <ErrorBanner error={error} />
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
            {job.status === 'handed_over' && <button type="button" disabled={busy} style={primaryBtn} onClick={() => setConfirm('close')}>Close Job</button>}
            {job.status === 'on_hold' && <button type="button" disabled={busy} style={primaryBtn} onClick={() => setConfirm('resume')}>Resume Job</button>}
            {['draft', 'in_progress'].includes(job.status) && <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => setReasonFor('hold')}>Put On Hold</button>}
            {['draft', 'in_progress', 'on_hold'].includes(job.status) && <button type="button" disabled={busy} style={dangerBtn} onClick={() => setReasonFor('cancel')}>Cancel Job</button>}
            {job.status === 'draft' && job.done_stages === 0 && <button type="button" disabled={busy} style={dangerBtn} onClick={() => setConfirm('delete')}>Delete Draft</button>}
          </div>

          {/* Phase tracker */}
          <div style={{ ...sectionStyle, padding: 16 }}>
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
            {TAB_KEYS.map((t) => (
              <button key={t} type="button" onClick={() => goToTab(t)} style={{
                padding: '10px 14px', marginBottom: -1, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                fontSize: 13, fontWeight: 600, color: tab === t ? '#FF6A2A' : TEXT.muted,
                borderBottom: tab === t ? '2px solid #FF6A2A' : '2px solid transparent',
              }}>
                {tabLabels[t]}
              </button>
            ))}
          </div>

          {tab === 'stages' && <StagesTab job={job} canEdit={canEdit} users={users} onJob={setJob} onGoToTab={goToTab} />}

          {tab === 'details' && (
            editing ? (
              <JobForm
                initial={job}
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
                  <div style={{ ...sectionStyle, flex: '1 1 360px', marginBottom: 0 }}>
                    <p style={sectionTitle}>RRV & Job</p>
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
                  <div style={{ ...sectionStyle, flex: '1 1 360px', marginBottom: 0 }}>
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
                  </div>
                </div>
                {!['closed', 'cancelled'].includes(job.status) && (
                  <div style={{ marginTop: 16 }}>
                    <button type="button" style={secondaryBtnStyle} onClick={() => setEditing(true)}>Edit Details & Requirement</button>
                  </div>
                )}
              </>
            )
          )}

          {tabProps && tab === 'bom' && <BomTab {...tabProps} />}
          {tabProps && tab === 'panels' && <PanelsTab {...tabProps} />}
          {tabProps && tab === 'cables' && <CablesTab {...tabProps} />}
          {tabProps && tab === 'drawings' && <DrawingsTab {...tabProps} />}
          {tabProps && tab === 'tests' && <TestsTab {...tabProps} />}
          {tabProps && tab === 'issues' && <IssuesTab {...tabProps} />}
          {tab === 'handover' && <HandoverTab key={job.updated_at} job={job} canEdit={canEdit} onJob={setJob} />}
          {tabProps && tab === 'documents' && <DocumentsTab {...tabProps} />}
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
