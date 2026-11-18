'use client'

// R&D ID, current revision and review state of a requirement, with Accept for
// the people who may review (R&D head, admin, or R&D › Requirements › Review).
// Accept asks for confirmation — never a browser dialog. Rules (server-enforced):
// only the latest revision, only from "Awaiting R&D review". Return to BD was
// removed (owner, 2026-10-30); older returned revisions still show their reason.

import { useState } from 'react'
import { rndApi } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT } from '@/lib/theme'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { SheetIcon } from '@/components/shared/FormSheet'
import { Pill, primaryBtnStyle } from '@/components/shared/ui'
import { REVISION_STATUS_HEX, REVISION_STATUS_LABEL, type RndIntake, type RndRevision } from '@/types/rndIntake'

const CHANGE_REASON_LABEL: Record<string, string> = {
  customer_changed: 'Customer changed requirement',
  bd_correction: 'Correction of BD\'s mistake',
  other: 'Other',
}

export default function RequirementReviewBar({ source, recordId, intake, revisions, canReview, onChanged, changes }: {
  source: 'inquiry' | 'tender'
  recordId: number
  intake: RndIntake
  revisions: RndRevision[]
  /** Old / new values of the fields BD changed in the latest send (the latest movement's `changes`), when the page has them. */
  changes?: { field: string; label: string; old: string | null; new: string | null }[]
  /** Head, admin or R&D › Requirements › Review (server: my_access.can_review). */
  canReview: boolean
  onChanged: () => void
}) {
  const [accepting, setAccepting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const latest = revisions.find((r) => r.revision_no === intake.current_revision) ?? revisions[revisions.length - 1]
  const status = intake.status
  const canAccept = canReview && status === 'submitted'
  // R1+ still awaiting review = BD changed a requirement R&D already knew: announce it.
  const newRevision = status === 'submitted' && !!latest && latest.revision_no > 0
  const hex = REVISION_STATUS_HEX[status]

  const accept = async () => {
    setAccepting(false)
    setBusy(true)
    setError('')
    try {
      await rndApi.acceptRequirement(source, recordId)
      onChanged()
    } catch (err) {
      setError(extractErrorMessages(err, `Could not accept ${intake.revision_code}. Refresh the page; if it keeps failing, check you can still review this requirement.`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-tour="rnd-reqd-review" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      padding: '12px 16px', marginBottom: 16, borderRadius: 12, background: '#fff',
      border: '1px solid rgba(15,23,42,0.08)', borderLeft: `4px solid ${hex}`, boxShadow: '0 2px 8px rgba(15,23,42,0.05)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span data-tour="rnd-reqd-rd-id" style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading }}>{intake.rd_number}</span>
          <span data-tour="rnd-reqd-revision" style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.muted }}>Revision {intake.revision_code.split('-').pop()} · {intake.revision_code}</span>
          <Pill label={REVISION_STATUS_LABEL[status]} hex={hex} />
        </div>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: TEXT.muted }}>
          {latest?.submitted_by ? <>Sent by <strong style={{ color: TEXT.body }}>{latest.submitted_by}</strong> · </> : null}
          {latest?.submitted_at ? formatDateTime(latest.submitted_at) : intake.last_received_at ? formatDateTime(intake.last_received_at) : ''}
          {latest?.reviewed_by && latest.reviewed_at ? <> · {status === 'returned' ? 'Returned' : 'Reviewed'} by <strong style={{ color: TEXT.body }}>{latest.reviewed_by}</strong> {formatDateTime(latest.reviewed_at)}</> : null}
        </p>
        {status === 'returned' && latest?.return_reason && (
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: '#b91c1c' }}><strong>Returned to BD:</strong> {latest.return_reason}</p>
        )}
        {status === 'submitted' && !canReview && (
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: TEXT.muted }}>Waiting for the R&amp;D head to accept it. Tasks, offers and the response open after it is accepted.</p>
        )}
        {revisions.length > 1 && (
          <div data-tour="rnd-reqd-revisions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {revisions.map((r) => <Pill key={r.revision_no} label={`R${r.revision_no} ${REVISION_STATUS_LABEL[r.status]}`} hex={REVISION_STATUS_HEX[r.status]} title={r.revision_code} />)}
          </div>
        )}
        {error && (
          <p style={{ margin: '8px 0 0', fontSize: 12.5, color: '#b91c1c' }}>{Array.isArray(error) ? error.join(' ') : error}</p>
        )}
      </div>
      {canAccept && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button data-tour="rnd-reqd-accept-btn" type="button" disabled={busy} onClick={() => setAccepting(true)} style={{ ...primaryBtnStyle, opacity: busy ? 0.6 : 1 }}>
            <SheetIcon name="check" size={15} />Accept
          </button>
        </div>
      )}

      {newRevision && latest && (
        <div data-tour="rnd-reqd-new-revision" style={{ flexBasis: '100%', padding: '10px 12px', borderRadius: 10, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.2)' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#1d4ed8' }}>
            BD sent {latest.revision_code}{latest.submitted_at ? <> on {formatDateTime(latest.submitted_at)}</> : null}
            {latest.change_reason ? <> · Reason: {CHANGE_REASON_LABEL[latest.change_reason] || latest.change_reason}</> : null}
          </p>
          {latest.change_note && <p style={{ margin: '4px 0 0', fontSize: 12.5, color: TEXT.body, whiteSpace: 'pre-wrap' }}>{latest.change_note}</p>}
          {latest.changed_fields && latest.changed_fields.length > 0 && (
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: TEXT.muted }}>Changed: <strong style={{ color: TEXT.body }}>{latest.changed_fields.join(', ')}</strong></p>
          )}
          {changes && changes.length > 0 && (
            <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
              {changes.map((c) => (
                <div key={c.field} style={{ fontSize: 12.5 }}>
                  <div style={{ fontWeight: 600, color: TEXT.body, marginBottom: 3 }}>{c.label}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, alignItems: 'start' }}>
                    <span style={{ color: '#991b1b', background: 'rgba(220,38,38,0.06)', borderRadius: 6, padding: '3px 8px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: TEXT.muted }}>Before </span>{c.old || '—'}
                    </span>
                    <span style={{ color: '#166534', background: 'rgba(22,163,74,0.07)', borderRadius: 6, padding: '3px 8px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: TEXT.muted }}>Now </span>{c.new || '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {status === 'submitted' && latest?.corrected_at && (
        <p data-tour="rnd-reqd-corrected" style={{ flexBasis: '100%', margin: 0, fontSize: 12, color: TEXT.muted }}>BD fixed a typo on {formatDateTime(latest.corrected_at)} before acceptance.</p>
      )}
      <ConfirmDialog
        open={accepting}
        title={`Accept ${intake.revision_code}?`}
        message="Accepting commits R&D to this requirement. BD is told, and R&D can then give tasks, upload a Technical Offer and respond to CRM."
        confirmLabel="Accept"
        danger={false}
        onConfirm={accept}
        onCancel={() => setAccepting(false)}
      />
    </div>
  )
}
