'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { electricalApi } from '@/lib/api'
import { recordPath } from '@/lib/recordRef'
import { useCan } from '@/lib/permissions'
import { ElectricalJobDetail } from '@/types'
import { TEXT } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import { DetailRow } from '@/components/shared/ui'
import {
  inputStyle, sectionStyle, sectionTitle, primaryBtn, smallBtn, ErrorBanner, NoticeBanner, F, rowStyle, Pill,
  STAGE_STATUS_LABELS, STAGE_STATUS_HEX, INSPECTION_LABELS, INSPECTION_HEX, strOrNull,
} from '@/components/electrical/shared'

const CLOSING_STAGES = ['inspection_qc', 'commissioning', 'final_documentation', 'handover', 'as_built_records']

/** Inspection & QC (via Quality), Commissioning and RRV Electrical
 * Handover — the fields and actions those stages' gates depend on. */
export default function HandoverTab({ job, canEdit, onJob }: {
  job: ElectricalJobDetail
  canEdit: boolean
  onJob: (job: ElectricalJobDetail) => void
}) {
  const router = useRouter()
  const { user } = useAuth()
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmQc, setConfirmQc] = useState(false)
  const [commissioning, setCommissioning] = useState({
    commissioning_location: job.commissioning_location || '',
    commissioned_on: job.commissioned_on || '',
  })
  const [handover, setHandover] = useState({
    handover_to_name: job.handover_to_name || '',
    handover_to_organization: job.handover_to_organization || '',
    handover_date: job.handover_date || '',
    handover_remarks: job.handover_remarks || '',
  })

  const s = job.summary
  const canQc = !s.inspection_number || s.inspection_status === 'failed'
  // Saving these details goes through the job update (Jobs › Edit) and needs
  // the job's QC & Handover › Edit; requesting QC needs QC & Handover › Submit
  // (both default to Jobs › Edit).
  const { can, canFeature } = useCan()
  const detailsEditable = (canEdit || job.status === 'on_hold') && can('electrical', 'jobs', 'edit')
    && canFeature('electrical', 'jobs', 'handover', 'edit')
  const canRequestQc = canEdit && canFeature('electrical', 'jobs', 'handover', 'submit')

  const save = async (payload: Record<string, unknown>, fallback: string, success: string) => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      onJob(await electricalApi.updateJob(job.id, payload))
      setNotice(success)
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  const requestQc = async () => {
    setConfirmQc(false)
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const updated = await electricalApi.requestInspection(job.id)
      onJob(updated)
      setNotice(`Final inspection ${updated.summary.inspection_number} raised in Quality. The Inspection & QC stage completes once Quality passes it.`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to request the QC inspection.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <ErrorBanner error={error} />
      <NoticeBanner notice={notice} />

      <div data-tour="elec-handover-closing-stages" style={sectionStyle}>
        <p style={sectionTitle}>Closing stages</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {job.stages.filter((st) => CLOSING_STAGES.includes(st.stage_key)).map((st) => (
            <div key={st.stage_key} style={{ flex: '1 1 180px', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.heading, marginBottom: 6 }}>{st.label}</div>
              <Pill value={st.status} labels={STAGE_STATUS_LABELS} hex={STAGE_STATUS_HEX} />
              {st.gate_problems.length > 0 && <p style={{ fontSize: 11.5, color: '#92400e', margin: '6px 0 0' }}>{st.gate_problems[0]}</p>}
            </div>
          ))}
        </div>
      </div>

      <div data-tour="elec-handover-qc" style={sectionStyle}>
        <p style={sectionTitle}>Inspection & QC</p>
        {s.inspection_number ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: TEXT.heading }}>{s.inspection_number}</span>
            <Pill value={s.inspection_status} labels={INSPECTION_LABELS} hex={INSPECTION_HEX} />
            {user?.apps?.includes('quality') && job.quality_inspection_id && (
              <button data-tour="elec-handover-open-quality-btn" type="button" style={smallBtn} onClick={() => router.push(recordPath('/dashboard/quality/final-inspection', job, 'quality_inspection_id'))}>Open in Quality</button>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 12px' }}>
            No inspection yet. Requesting one raises a final inspection in the Quality module for this RRV&apos;s electrical system and notifies the Quality team.
          </p>
        )}
        {canRequestQc && canQc && (
          <button data-tour="elec-handover-request-qc-btn" type="button" disabled={busy} style={primaryBtn} onClick={() => setConfirmQc(true)}>
            {s.inspection_status === 'failed' ? 'Request Fresh QC Inspection' : 'Request QC Inspection'}
          </button>
        )}
      </div>

      <div style={sectionStyle}>
        <p style={sectionTitle}>Commissioning</p>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 12px' }}>
          {s.commissioning_tests} commissioning {s.commissioning_tests === 1 ? 'test' : 'tests'} recorded on the Tests tab. The stage also needs the commissioning date.
        </p>
        {/* Read-only viewers see the saved values as label–value rows, not greyed-out inputs. */}
        {!detailsEditable ? (
          <div>
            <div data-tour="elec-handover-comm-location"><DetailRow label="Commissioning Location">{job.commissioning_location}</DetailRow></div>
            <div data-tour="elec-handover-comm-date"><DetailRow label="Commissioned On">{job.commissioned_on ? formatDate(job.commissioned_on) : null}</DetailRow></div>
          </div>
        ) : (
          <div style={rowStyle}>
          <F tour="elec-handover-comm-location" label="Commissioning Location" basis={300} grow max={440}>
            <input style={inputStyle} disabled={!detailsEditable} value={commissioning.commissioning_location} onChange={(e) => setCommissioning((c) => ({ ...c, commissioning_location: e.target.value }))} placeholder="e.g. Customer depot, Kanpur" />
          </F>
          <F tour="elec-handover-comm-date" label="Commissioned On" basis={170}>
            {detailsEditable
              ? <DateField value={commissioning.commissioned_on} onChange={(v) => setCommissioning((c) => ({ ...c, commissioned_on: v }))} />
              : <input style={inputStyle} disabled value={commissioning.commissioned_on ? formatDate(commissioning.commissioned_on) : ''} />}
          </F>
        </div>
        )}
        {detailsEditable && (
          <button data-tour="elec-handover-comm-save" type="button" disabled={busy} style={smallBtn} onClick={() => save({
            commissioning_location: strOrNull(commissioning.commissioning_location),
            commissioned_on: commissioning.commissioned_on || null,
          }, 'Failed to save commissioning details.', 'Commissioning details saved.')}>
            Save Commissioning
          </button>
        )}
      </div>

      <div style={sectionStyle}>
        <p style={sectionTitle}>RRV Electrical Handover</p>
        {job.handed_over_at && <p style={{ fontSize: 13, color: '#15803d', margin: '0 0 12px', fontWeight: 600 }}>Handed over {formatDateTime(job.handed_over_at)}</p>}
        {!detailsEditable ? (
          <div>
            <div data-tour="elec-handover-to-name"><DetailRow label="Handed Over To">{job.handover_to_name}</DetailRow></div>
            <div data-tour="elec-handover-to-org"><DetailRow label="Organisation">{job.handover_to_organization}</DetailRow></div>
            <div data-tour="elec-handover-date"><DetailRow label="Handover Date">{job.handover_date ? formatDate(job.handover_date) : null}</DetailRow></div>
            <div data-tour="elec-handover-remarks"><DetailRow label="Handover Remarks">{job.handover_remarks}</DetailRow></div>
          </div>
        ) : (
          <>
        <div style={rowStyle}>
          <F tour="elec-handover-to-name" label="Handed Over To" basis={240} grow max={340}>
            <input style={inputStyle} disabled={!detailsEditable} value={handover.handover_to_name} onChange={(e) => setHandover((h) => ({ ...h, handover_to_name: e.target.value }))} placeholder="Person receiving the RRV" />
          </F>
          <F tour="elec-handover-to-org" label="Organisation" basis={240} grow max={360}>
            <input style={inputStyle} disabled={!detailsEditable} value={handover.handover_to_organization} onChange={(e) => setHandover((h) => ({ ...h, handover_to_organization: e.target.value }))} />
          </F>
          <F tour="elec-handover-date" label="Handover Date" basis={170}>
            {detailsEditable
              ? <DateField value={handover.handover_date} onChange={(v) => setHandover((h) => ({ ...h, handover_date: v }))} />
              : <input style={inputStyle} disabled value={handover.handover_date ? formatDate(handover.handover_date) : ''} />}
          </F>
        </div>
        <div style={rowStyle}>
          <F tour="elec-handover-remarks" label="Handover Remarks" basis={400} grow>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} disabled={!detailsEditable} value={handover.handover_remarks} onChange={(e) => setHandover((h) => ({ ...h, handover_remarks: e.target.value }))}
              placeholder="Punch points, spares handed over, training given…" />
          </F>
        </div>
          </>
        )}
        {detailsEditable && (
          <button data-tour="elec-handover-save" type="button" disabled={busy} style={smallBtn} onClick={() => save({
            handover_to_name: strOrNull(handover.handover_to_name),
            handover_to_organization: strOrNull(handover.handover_to_organization),
            handover_date: handover.handover_date || null,
            handover_remarks: strOrNull(handover.handover_remarks),
          }, 'Failed to save handover details.', 'Handover details saved. Complete the "RRV Electrical Handover" stage on the Stages tab once everything else is done.')}>
            Save Handover Details
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmQc}
        title="Request QC inspection?"
        message={`A final inspection will be raised in Quality for ${job.job_number} and the Quality team notified.`}
        confirmLabel="Request Inspection"
        onConfirm={requestQc}
        onCancel={() => setConfirmQc(false)}
      />
    </div>
  )
}
