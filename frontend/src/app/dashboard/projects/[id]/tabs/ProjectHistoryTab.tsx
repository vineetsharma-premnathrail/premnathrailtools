'use client'

import { useEffect, useState } from 'react'
import { projectsApi } from '@/lib/api'
import { PmAuditEntry } from '@/types'
import { TEXT, GLASS } from '@/lib/theme'
import { formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { ErrorBanner } from '@/components/projects/work/pmUi'

export default function ProjectHistoryTab({ projectId }: { projectId: number }) {
  const [entries, setEntries] = useState<PmAuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    setLoading(true)
    setError([])
    projectsApi.audit(projectId)
      .then((data) => setEntries(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the project history. Refresh the page; if it keeps failing, check you still have access to Project Management.')))
      .finally(() => setLoading(false))
  }, [projectId])

  if (loading) return <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
  if (error.length > 0) return <ErrorBanner error={error} />
  if (entries.length === 0) return <p style={{ fontSize: 13, color: TEXT.muted }}>No history yet.</p>

  return (
    <div data-tour="pm-hist-list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((e) => {
        const fieldLine = e.field_name ? `${e.field_name}: ${e.old_value ?? '—'} → ${e.new_value ?? '—'}` : ''
        const main = e.summary || (fieldLine ? `${e.action} — ${fieldLine}` : e.action)
        return (
          <div
            key={e.id}
            style={{
              padding: '12px 16px', borderRadius: 12, background: GLASS.card, backdropFilter: GLASS.blur,
              WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`,
              boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.heading }}>{e.performed_by}</span>
              <span style={{ fontSize: 11.5, color: TEXT.muted, whiteSpace: 'nowrap' }}>{e.performed_at ? formatDateTime(e.performed_at) : ''}</span>
            </div>
            <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0, whiteSpace: 'pre-wrap' }}>{main}</p>
            {e.summary && fieldLine && (
              <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '4px 0 0' }}>{fieldLine}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
