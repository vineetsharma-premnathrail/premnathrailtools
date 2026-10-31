'use client'

// Revisions of an R&D requirement (Requirement tab): status, who sent / reviewed it, and
// per revision "See changes" — each field BD changed against the previous revision, before
// and now side by side. The old → new values come from the requirement history, which
// already hides the sections this user may not see.

import { useEffect, useState } from 'react'
import { rndApi } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { TEXT } from '@/lib/theme'
import { Pill, DetailGroup, DetailRow } from '@/components/shared/ui'
import { REVISION_STATUS_HEX, REVISION_STATUS_LABEL, type RndRevision } from '@/types/rndIntake'

type FieldChange = { field: string; label: string; old: string | null; new: string | null }

const box = (tone: 'old' | 'new'): React.CSSProperties => ({
  padding: '8px 10px', borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflowY: 'auto', fontSize: 13,
  background: tone === 'old' ? 'rgba(220,38,38,0.06)' : 'rgba(22,163,74,0.06)',
  border: `1px solid ${tone === 'old' ? 'rgba(220,38,38,0.18)' : 'rgba(22,163,74,0.2)'}`,
})

export default function RequirementRevisionList({ source, recordId, revisions }: {
  source: 'inquiry' | 'tender'
  recordId: number
  revisions: RndRevision[]
}) {
  const [changes, setChanges] = useState<Record<string, FieldChange[]>>({})
  const [shown, setShown] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!revisions.some((r) => r.changed_fields && r.changed_fields.length > 0)) return
    rndApi.requirementHistory(source, recordId)
      .then((history) => {
        const byCode: Record<string, FieldChange[]> = {}
        for (const h of history) if (h.kind === 'revision' && h.revision_code) byCode[h.revision_code] = h.changes || []
        setChanges(byCode)
        setError('')
      })
      .catch(() => setError('The before / now values could not be loaded — open the Timeline tab to see the changes.'))
  }, [source, recordId, revisions])

  return (
    <DetailGroup title="Revisions" last>
      {[...revisions].sort((a, b) => b.revision_no - a.revision_no).map((r) => {
        const diff = changes[r.revision_code] || []
        const open = shown === r.revision_no
        return (
          <DetailRow key={r.revision_no} label={r.revision_code}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Pill label={REVISION_STATUS_LABEL[r.status]} hex={REVISION_STATUS_HEX[r.status]} />
              <span>Sent {r.submitted_at ? formatDateTime(r.submitted_at) : '—'}{r.submitted_by ? ` by ${r.submitted_by}` : ''}</span>
            </span>
            {r.reviewed_by && <div style={{ color: TEXT.muted, fontSize: 12.5 }}>{r.status === 'returned' ? 'Returned' : 'Reviewed'} by {r.reviewed_by}{r.reviewed_at ? ` · ${formatDateTime(r.reviewed_at)}` : ''}{r.review_remarks ? ` — ${r.review_remarks}` : ''}</div>}
            {r.return_reason && <div style={{ color: '#b91c1c', fontSize: 12.5 }}>Reason: {r.return_reason}</div>}
            {r.changed_fields && r.changed_fields.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', color: TEXT.muted, fontSize: 12.5 }}>
                <span>Changed from R{r.revision_no - 1}: {r.changed_fields.join(', ')}</span>
                {diff.length > 0 && (
                  <button type="button" data-tour="rnd-reqd-see-changes" onClick={() => setShown(open ? null : r.revision_no)} aria-expanded={open}
                    style={{ border: 'none', background: 'transparent', padding: 0, fontSize: 12.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {open ? 'Hide changes' : 'See changes'}
                  </button>
                )}
              </div>
            )}
            {error && r.changed_fields && r.changed_fields.length > 0 && <div style={{ color: '#b45309', fontSize: 12.5 }}>{error}</div>}
            {open && diff.map((c) => (
              <div key={c.field} style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: TEXT.muted, marginBottom: 4 }}>{c.label}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                  <div style={box('old')}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', marginBottom: 2 }}>R{r.revision_no - 1} (before)</div>
                    {c.old || '—'}
                  </div>
                  <div style={box('new')}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', marginBottom: 2 }}>R{r.revision_no} (now)</div>
                    {c.new || '—'}
                  </div>
                </div>
              </div>
            ))}
          </DetailRow>
        )
      })}
    </DetailGroup>
  )
}
