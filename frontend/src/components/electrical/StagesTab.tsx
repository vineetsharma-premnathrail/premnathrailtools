'use client'

import { useState } from 'react'
import { electricalApi } from '@/lib/api'
import { ElectricalJobDetail, ElectricalJobStage, ElectricalLookupOption } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import {
  inputStyle, sectionStyle, primaryBtn, smallBtn, ErrorBanner, Modal, F, rowStyle, Pill, pill,
  STAGE_STATUS_LABELS, STAGE_STATUS_HEX, PHASE_LABELS, PHASE_HEX, toOptions,
} from '@/components/electrical/shared'

const PHASE_ORDER = ['design', 'procurement', 'build', 'test_qc', 'handover'] as const

// Which job-page tab holds the evidence each gated stage needs — the
// "Go to …" shortcut under a stage's blockers.
const STAGE_TAB: Record<string, { tab: string; label: string }> = {
  requirement: { tab: 'details', label: 'Details & Requirement' },
  schematics: { tab: 'drawings', label: 'Drawings' },
  component_selection: { tab: 'bom', label: 'BOM' },
  electrical_bom: { tab: 'bom', label: 'BOM' },
  component_specification: { tab: 'bom', label: 'BOM' },
  purchase_requirement: { tab: 'bom', label: 'BOM' },
  cable_design: { tab: 'cables', label: 'Cables' },
  wiring_installation: { tab: 'cables', label: 'Cables' },
  panel_design: { tab: 'panels', label: 'Panels' },
  panel_assembly: { tab: 'panels', label: 'Panels' },
  drawing_revision: { tab: 'drawings', label: 'Drawings' },
  as_built_records: { tab: 'drawings', label: 'Drawings' },
  electrical_testing: { tab: 'tests', label: 'Tests' },
  troubleshooting: { tab: 'issues', label: 'Troubleshooting' },
  inspection_qc: { tab: 'handover', label: 'QC & Handover' },
  commissioning: { tab: 'handover', label: 'QC & Handover' },
  handover: { tab: 'handover', label: 'QC & Handover' },
  final_documentation: { tab: 'documents', label: 'Documents' },
}

type Pending = { kind: 'complete' | 'reopen'; stage: ElectricalJobStage } | null

/** The 20 RRV electrical scope stages grouped by phase, with each stage's
 * owner, plan, and the evidence still blocking its completion. */
export default function StagesTab({ job, canEdit, users, onJob, onGoToTab }: {
  job: ElectricalJobDetail
  canEdit: boolean
  users: ElectricalLookupOption[]
  onJob: (job: ElectricalJobDetail) => void
  onGoToTab: (tab: string) => void
}) {
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const [naStage, setNaStage] = useState<ElectricalJobStage | null>(null)
  const [editStage, setEditStage] = useState<ElectricalJobStage | null>(null)
  const [edit, setEdit] = useState({ assignee_id: '', planned_start_date: '', planned_end_date: '', remarks: '' })
  const [completeRemarks, setCompleteRemarks] = useState('')
  const [showDone, setShowDone] = useState(true)

  const planEditable = !['closed', 'cancelled'].includes(job.status)

  const run = async (fn: () => Promise<ElectricalJobDetail>, fallback: string) => {
    setError('')
    setBusy(true)
    try {
      onJob(await fn())
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  const openEdit = (s: ElectricalJobStage) => {
    setEdit({
      assignee_id: s.assignee_id ? String(s.assignee_id) : '',
      planned_start_date: s.planned_start_date || '',
      planned_end_date: s.planned_end_date || '',
      remarks: s.remarks || '',
    })
    setEditStage(s)
  }

  const saveEdit = async () => {
    if (!editStage) return
    if (edit.planned_start_date && edit.planned_end_date && edit.planned_end_date < edit.planned_start_date) {
      setError(`'${editStage.label}' can't end before it starts — check the planned dates.`)
      return
    }
    const ok = await run(() => electricalApi.updateStage(job.id, editStage.stage_key, {
      assignee_id: edit.assignee_id ? Number(edit.assignee_id) : null,
      planned_start_date: edit.planned_start_date || null,
      planned_end_date: edit.planned_end_date || null,
      remarks: edit.remarks.trim() || null,
    }), `Failed to save '${editStage.label}'.`)
    if (ok) setEditStage(null)
  }

  const confirmPending = async () => {
    if (!pending) return
    const { kind, stage } = pending
    setPending(null)
    if (kind === 'complete') {
      await run(() => electricalApi.completeStage(job.id, stage.stage_key, completeRemarks.trim() || undefined), `Failed to complete '${stage.label}'.`)
      setCompleteRemarks('')
    } else {
      await run(() => electricalApi.reopenStage(job.id, stage.stage_key), `Failed to reopen '${stage.label}'.`)
    }
  }

  return (
    <div>
      <ErrorBanner error={error} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
          Stages can run in parallel. A stage completes once its evidence is in place — what&apos;s still missing is listed under it.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed stages
        </label>
      </div>

      {PHASE_ORDER.map((phase) => {
        const stages = job.stages.filter((s) => s.phase === phase)
        const done = stages.filter((s) => s.status === 'completed' || s.status === 'not_applicable').length
        const visible = showDone ? stages : stages.filter((s) => s.status !== 'completed' && s.status !== 'not_applicable')
        return (
          <div key={phase} style={{ ...sectionStyle, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: `1px solid ${BORDER.light}`, borderLeft: `4px solid ${PHASE_HEX[phase]}` }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading }}>{PHASE_LABELS[phase]}</span>
              <span style={pill(done === stages.length ? '#16A34A' : PHASE_HEX[phase])}>{done}/{stages.length} done</span>
            </div>
            {visible.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0, padding: '12px 18px' }}>All stages in this phase are done.</p>}
            {visible.map((s) => {
              const isDone = s.status === 'completed' || s.status === 'not_applicable'
              const blocked = !isDone && s.gate_problems.length > 0
              const shortcut = STAGE_TAB[s.stage_key]
              return (
                <div key={s.stage_key} style={{ padding: '14px 18px', borderTop: `1px solid ${BORDER.light}`, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 14, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: isDone ? '#fff' : STAGE_STATUS_HEX[s.status],
                    background: isDone ? STAGE_STATUS_HEX[s.status] : `${STAGE_STATUS_HEX[s.status]}1a`,
                  }}>
                    {s.status === 'completed' ? '✓' : s.sequence}
                  </div>
                  <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: TEXT.heading }}>{s.label}</span>
                      <Pill value={s.status} labels={STAGE_STATUS_LABELS} hex={STAGE_STATUS_HEX} />
                      {s.is_mandatory && <span style={{ fontSize: 11, color: TEXT.muted }}>Required</span>}
                      {s.is_overdue && <span style={pill('#DC2626')}>Overdue</span>}
                    </div>
                    <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 4, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                      <span>Owner: {s.assignee_name || '—'}</span>
                      <span>Plan: {s.planned_start_date ? formatDate(s.planned_start_date) : '—'} → {s.planned_end_date ? formatDate(s.planned_end_date) : '—'}</span>
                      {s.completed_at && <span>{s.status === 'not_applicable' ? 'Waived' : 'Completed'} {formatDateTime(s.completed_at)}{s.completed_by_name ? ` by ${s.completed_by_name}` : ''}</span>}
                    </div>
                    {s.remarks && <p style={{ fontSize: 12.5, color: TEXT.body, margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{s.remarks}</p>}
                    {blocked && (
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
                        {s.gate_problems.map((p, i) => <p key={i} style={{ fontSize: 12.5, color: '#92400e', margin: i ? '4px 0 0' : 0 }}>• {p}</p>)}
                        {shortcut && (
                          <button type="button" onClick={() => onGoToTab(shortcut.tab)} style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>
                            Go to {shortcut.label} →
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {canEdit && s.status === 'not_started' && (
                      <button type="button" disabled={busy} style={smallBtn} onClick={() => run(() => electricalApi.startStage(job.id, s.stage_key), `Failed to start '${s.label}'.`)}>Start</button>
                    )}
                    {canEdit && !isDone && (
                      <button type="button" disabled={busy || blocked} title={blocked ? 'Clear the items listed under this stage first' : undefined}
                        style={{ ...smallBtn, ...(blocked ? { opacity: 0.5, cursor: 'not-allowed' } : { color: '#15803d', borderColor: 'rgba(22,163,74,0.35)' }) }}
                        onClick={() => { setCompleteRemarks(''); setPending({ kind: 'complete', stage: s }) }}>
                        Complete
                      </button>
                    )}
                    {canEdit && !isDone && !s.is_mandatory && (
                      <button type="button" disabled={busy} style={smallBtn} onClick={() => setNaStage(s)}>N/A</button>
                    )}
                    {canEdit && isDone && (
                      <button type="button" disabled={busy} style={smallBtn} onClick={() => setPending({ kind: 'reopen', stage: s })}>Reopen</button>
                    )}
                    {planEditable && (
                      <button type="button" disabled={busy} style={smallBtn} onClick={() => openEdit(s)}>Plan</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}

      <Modal open={!!editStage} title={editStage ? `Plan — ${editStage.label}` : ''} onClose={() => setEditStage(null)} width={560}>
        <div style={rowStyle}>
          <F label="Owner" basis={300} grow>
            <SearchableSelect value={edit.assignee_id} onChange={(v) => setEdit((e) => ({ ...e, assignee_id: v }))} options={toOptions(users, '— Unassigned —')} placeholder="Search people" />
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Planned Start" basis={170}>
            <DateField value={edit.planned_start_date} onChange={(v) => setEdit((e) => ({ ...e, planned_start_date: v }))} />
          </F>
          <F label="Planned End" basis={170}>
            <DateField value={edit.planned_end_date} onChange={(v) => setEdit((e) => ({ ...e, planned_end_date: v }))} />
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Remarks" basis={400} grow>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={edit.remarks} onChange={(e) => setEdit((x) => ({ ...x, remarks: e.target.value }))} />
          </F>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" style={secondaryBtnStyle} onClick={() => setEditStage(null)}>Cancel</button>
          <button type="button" style={primaryBtn} disabled={busy} onClick={saveEdit}>Save</button>
        </div>
      </Modal>

      <Modal open={pending?.kind === 'complete'} title={pending ? `Complete '${pending.stage.label}'?` : ''} onClose={() => setPending(null)} width={520}>
        <p style={{ fontSize: 13, color: TEXT.body, margin: '0 0 12px' }}>
          {pending?.stage.stage_key === 'handover'
            ? 'This records the RRV electrical system as handed over to the customer. The job moves to Handed Over.'
            : 'Mark this stage as completed. It can be reopened later if something changes.'}
        </p>
        <label style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Completion note (optional)</label>
        <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical', marginBottom: 14 }} value={completeRemarks} onChange={(e) => setCompleteRemarks(e.target.value)} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" style={secondaryBtnStyle} onClick={() => setPending(null)}>Cancel</button>
          <button type="button" style={primaryBtn} disabled={busy} onClick={confirmPending}>Complete Stage</button>
        </div>
      </Modal>

      <ConfirmDialog
        open={pending?.kind === 'reopen'}
        title={pending ? `Reopen '${pending.stage.label}'?` : ''}
        message={pending?.stage.stage_key === 'handover' && job.status === 'handed_over'
          ? 'The job goes back to In Progress until the handover stage is completed again.'
          : 'The stage goes back to in progress and has to be completed again.'}
        confirmLabel="Reopen"
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />

      <PromptDialog
        open={!!naStage}
        title={naStage ? `Mark '${naStage.label}' not applicable` : ''}
        message="Say why this stage doesn't apply to this RRV — it's kept on the record."
        placeholder="e.g. Loose-wired vehicle, no separate panel"
        confirmLabel="Mark N/A"
        onConfirm={async (reason) => {
          const s = naStage
          setNaStage(null)
          if (!s) return
          if (!reason.trim()) { setError('A reason is required to mark a stage not applicable.'); return }
          await run(() => electricalApi.markStageNotApplicable(job.id, s.stage_key, reason.trim()), `Failed to mark '${s.label}' not applicable.`)
        }}
        onCancel={() => setNaStage(null)}
      />
    </div>
  )
}
