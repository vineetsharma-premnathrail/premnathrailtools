'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignMyTasks, DesignTaskItem } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18, flex: '1 1 440px', minWidth: 0,
}

const GROUPS: { key: keyof DesignMyTasks; title: string; hint: string; hex: string; empty: string }[] = [
  { key: 'to_review', title: 'To check', hint: 'You are the named checker', hex: '#2563EB', empty: 'No revisions are waiting for your check.' },
  { key: 'to_approve', title: 'To approve', hint: 'Checked, waiting for your release', hex: '#7C3AED', empty: 'No revisions are waiting for your approval.' },
  { key: 'returned_to_me', title: 'Returned to me', hint: 'Fix and resubmit', hex: '#DC2626', empty: 'Nothing has been returned to you.' },
  { key: 'ecns_to_approve', title: 'Change notices to decide', hint: 'You are the named approver', hex: '#F59E0B', empty: 'No change notices are waiting for your decision.' },
  { key: 'ecns_to_implement', title: 'Change notices to close out', hint: 'Approved — mark implemented once revisions are released', hex: '#0f766e', empty: 'No approved change notices of yours are open.' },
  { key: 'my_drafts', title: 'My drafts', hint: 'Not yet submitted', hex: '#78716c', empty: 'You have no draft revisions.' },
]

export default function DesignTasksPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const router = useRouter()
  const [tasks, setTasks] = useState<DesignMyTasks | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    designApi.getMyTasks()
      .then(setTasks)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load your tasks.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const open = (t: DesignTaskItem) =>
    router.push(t.kind.startsWith('ecn') ? `/dashboard/design/change-notices/${t.ecn_id}` : `/dashboard/design/documents/${t.document_id}`)

  const total = tasks ? tasks.to_review.length + tasks.to_approve.length + tasks.returned_to_me.length + tasks.ecns_to_approve.length : 0

  return (
    <div>
      <DesignNav />

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design Module</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>My Tasks</h1>
        {tasks && <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>{total ? `${total} item${total === 1 ? '' : 's'} need your action.` : 'You are all caught up.'}</p>}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {tasks && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          {GROUPS.map((g) => {
            const rows = tasks[g.key]
            return (
              <div key={g.key} style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: g.hex, margin: 0 }}>{g.title}</p>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: `${g.hex}1a`, color: g.hex }}>{rows.length}</span>
                  <span style={{ fontSize: 12, color: TEXT.muted }}>{g.hint}</span>
                </div>
                {rows.length === 0 ? (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{g.empty}</p>
                ) : (
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    {rows.map((t) => (
                      <div key={`${t.kind}-${t.revision_id ?? t.ecn_id}`} onClick={() => open(t)}
                        style={{ padding: '10px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <p style={{ flex: 1, fontSize: 13, fontWeight: 600, color: TEXT.heading, margin: 0 }}>
                            {t.kind.startsWith('ecn') ? t.ecn_number : `${t.doc_number} ${t.revision_label}`}
                            <span style={{ fontWeight: 400, color: TEXT.secondary }}> — {t.title}</span>
                          </p>
                          <span style={{ fontSize: 11.5, color: t.days_waiting >= 7 ? '#DC2626' : TEXT.muted, whiteSpace: 'nowrap', fontWeight: t.days_waiting >= 7 ? 700 : 400 }}>
                            {t.days_waiting === 0 ? 'today' : `${t.days_waiting} day${t.days_waiting === 1 ? '' : 's'}`}
                          </span>
                        </div>
                        <p style={{ fontSize: 12, color: TEXT.muted, margin: '2px 0 0' }}>
                          {t.author_name ? `by ${t.author_name}` : ''}{t.since ? ` · since ${formatDate(t.since)}` : ''}
                        </p>
                        {t.comment && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: '4px 0 0' }}>“{t.comment}”</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
