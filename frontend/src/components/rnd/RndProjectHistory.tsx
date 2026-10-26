'use client'

import { pillStyle } from '@/components/shared/ui'
import { useEffect, useState } from 'react'
import { rndApi } from '@/lib/api'
import { RndProjectHistoryEntry } from '@/types'
import { TEXT, GLASS } from '@/lib/theme'
import { formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'

const KIND: Record<RndProjectHistoryEntry['kind'], { text: string; hex: string }> = {
  milestone: { text: 'Milestone', hex: '#2563EB' },
  task: { text: 'Task', hex: '#7C3AED' },
  project: { text: 'Project', hex: '#78716c' },
  requirement: { text: 'Requirement', hex: '#78716c' },
}

/** R&D project › History — project edits, milestone changes and every task event, newest first (same as PM's History tab).
 *  A requirement passes its own `load` and wording; the project passes only `projectId`. */
export default function RndProjectHistory({ projectId, load, tour = 'rnd-pd-history', errorText = 'Could not load the project history. Refresh the page; if it keeps failing, check you can still open this project.' }: {
  projectId: number | string
  load?: () => Promise<RndProjectHistoryEntry[]>
  tour?: string
  errorText?: string
}) {
  const [entries, setEntries] = useState<RndProjectHistoryEntry[] | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    (load ? load() : rndApi.projectHistory(Number(projectId)))
      .then((d) => setEntries(Array.isArray(d) ? d : []))
      .catch((err) => { setEntries([]); setError(extractErrorMessages(err, errorText)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  if (error) {
    return (
      <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
        {Array.isArray(error) ? error.join(' ') : error}
      </div>
    )
  }
  if (!entries) return <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
  if (entries.length === 0) return <p style={{ fontSize: 13, color: TEXT.muted }}>No history yet.</p>

  return (
    <div data-tour={tour} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((e) => (
        <div key={e.id} style={{
          padding: '12px 16px', borderRadius: 12, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
          border: `1px solid ${GLASS.border}`, boxShadow: '0 2px 6px rgba(15,23,42,.08)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.heading }}>{e.performed_by}</span>
              <span style={pillStyle(KIND[e.kind].hex)}>{KIND[e.kind].text}</span>
            </span>
            <span style={{ fontSize: 11.5, color: TEXT.muted, whiteSpace: 'nowrap' }}>{e.performed_at ? formatDateTime(e.performed_at) : ''}</span>
          </div>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.summary}</p>
        </div>
      ))}
    </div>
  )
}
