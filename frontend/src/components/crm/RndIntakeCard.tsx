'use client'

// What BD sees about the requirement it sent to R&D, on an inquiry / tender: the R&D ID,
// the current revision and its review state. When R&D returns it, the reason is shown as
// "Returned by R&D: <reason>" with a "Re-send to R&D" button (fix the record, then send).

import { formatDateTime } from '@/lib/format'
import { Pill, primaryBtnStyle } from '@/components/shared/ui'
import { REVISION_STATUS_HEX, REVISION_STATUS_LABEL, type CrmRndRequirement } from '@/types/rndIntake'

export default function RndIntakeCard({ rnd, canResend, sending, onResend, tourId }: {
  rnd: CrmRndRequirement | null
  /** The user may send to R&D (Send Technical Requirement (TOR) to R&D › Create). */
  canResend: boolean
  sending: boolean
  onResend: () => void
  tourId: string
}) {
  if (!rnd) return null
  const hex = REVISION_STATUS_HEX[rnd.status]
  const returned = rnd.status === 'returned'
  return (
    <div data-tour={tourId} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16,
      padding: '10px 14px', borderRadius: 12, background: returned ? 'rgba(220,38,38,0.05)' : '#fff',
      border: `1px solid ${returned ? 'rgba(220,38,38,0.25)' : 'rgba(15,23,42,0.08)'}`, borderLeft: `4px solid ${hex}`,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1f1108' }}>R&amp;D ID {rnd.rd_number}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#78716c' }}>Revision {rnd.revision_code}</span>
          <Pill label={REVISION_STATUS_LABEL[rnd.status]} hex={hex} />
        </div>
        {returned && (
          <p data-tour="crm-rnd-returned" style={{ margin: '6px 0 0', fontSize: 12.5, color: '#b91c1c' }}>
            <strong>Returned by R&amp;D:</strong> {rnd.return_reason || 'No reason was given.'}
            {rnd.reviewed_by && <span style={{ color: '#78716c' }}> — {rnd.reviewed_by}{rnd.reviewed_at ? `, ${formatDateTime(rnd.reviewed_at)}` : ''}</span>}
            <span style={{ display: 'block', color: '#78716c' }}>Fix what R&amp;D asked for (Edit the record or its documents), then send it again.</span>
          </p>
        )}
        {rnd.status === 'accepted' && rnd.review_remarks && <p style={{ margin: '6px 0 0', fontSize: 12.5, color: '#57534e' }}>R&amp;D note: {rnd.review_remarks}</p>}
        {rnd.revisions.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {[...rnd.revisions].sort((a, b) => a.revision_no - b.revision_no).map((r) => (
              <Pill key={r.revision_no} label={`R${r.revision_no} ${REVISION_STATUS_LABEL[r.status]}`} hex={REVISION_STATUS_HEX[r.status]} title={r.revision_code} />
            ))}
          </div>
        )}
      </div>
      {returned && canResend && (
        <button data-tour="crm-rnd-resend-btn" type="button" disabled={sending} onClick={onResend} style={{ ...primaryBtnStyle, opacity: sending ? 0.6 : 1 }}>
          {sending ? 'Sending…' : 'Re-send to R&D'}
        </button>
      )}
    </div>
  )
}
