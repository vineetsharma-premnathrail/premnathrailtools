'use client'

import { useEffect, useState } from 'react'
import { projectsApi } from '@/lib/api'
import { PmAuditEntry } from '@/types'
import { TEXT, GLASS } from '@/lib/theme'

export default function ProjectHistoryTab({ projectId }: { projectId: number }) {
  const [entries, setEntries] = useState<PmAuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    projectsApi.getAudit(projectId)
      .then((data) => setEntries(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false))
  }, [projectId])

  if (loading) return <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
  if (entries.length === 0) return <p style={{ fontSize: 13, color: TEXT.muted }}>No history yet.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((e) => (
        <div
          key={e.id}
          style={{
            padding: '12px 16px', borderRadius: 12, background: GLASS.card, backdropFilter: GLASS.blur,
            WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`,
            boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.heading }}>{e.performed_by_name}</span>
            <span style={{ fontSize: 11.5, color: TEXT.muted }}>{e.performed_at ? new Date(e.performed_at).toLocaleString() : ''}</span>
          </div>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>
            {e.field_name
              ? `${e.action} — ${e.field_name}: ${e.old_value ?? '—'} → ${e.new_value ?? '—'}`
              : e.action}
          </p>
        </div>
      ))}
    </div>
  )
}
