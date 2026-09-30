'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { hrApi } from '@/lib/api'
import { HrChecklistTask } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'

const TYPE_LABELS: Record<string, string> = { joining: 'Joining', confirmation: 'Confirmation', transfer: 'Transfer', promotion: 'Promotion', exit: 'Exit' }
const TYPE_HEX: Record<string, string> = { joining: '#16A34A', confirmation: '#0891B2', transfer: '#2563EB', promotion: '#7C3AED', exit: '#DC2626' }
const CATEGORY_LABELS: Record<string, string> = { hr: 'HR', it: 'IT', admin: 'Admin', finance: 'Finance', manager: 'Manager', store: 'Store' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18, marginBottom: 20,
}

/** Lifecycle checklist tasks assigned to the signed-in user (any user, HR or
 * not — IT, store, the new manager…). Renders nothing when there are none,
 * so it can be dropped onto any page (Approvals, My HR, Lifecycle). */
export default function MyChecklistTasks({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  const [tasks, setTasks] = useState<HrChecklistTask[]>([])
  const [error, setError] = useState<string[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => {
    hrApi.listMyChecklistTasks({ status: 'pending' })
      .then((d) => setTasks(Array.isArray(d) ? d : []))
      .catch((err) => setError(extractErrorMessages(err, 'Could not load your checklist tasks.')))
  }, [])

  useEffect(() => { load() }, [load])

  const markDone = async (t: HrChecklistTask) => {
    setBusyId(t.id)
    setError([])
    try {
      await hrApi.updateLifecycleItem(t.id, { status: 'done' })
      setTasks((prev) => prev.filter((x) => x.id !== t.id))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not mark the task done.'))
    } finally {
      setBusyId(null)
    }
  }

  if (tasks.length === 0 && error.length === 0) return null

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>
          Your onboarding / offboarding tasks <span style={{ fontSize: 12, fontWeight: 600, color: TEXT.muted }}>({tasks.length} pending)</span>
        </h3>
      </div>
      {error.length > 0 && (
        <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error.join(' ')}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: compact ? 220 : 420, overflowY: 'auto' }}>
        {tasks.map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,0.6)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 9999, background: `${TYPE_HEX[t.event_type || ''] || '#78716C'}1a`, color: TYPE_HEX[t.event_type || ''] || '#78716C' }}>
              {TYPE_LABELS[t.event_type || ''] || t.event_type}
            </span>
            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{t.title}</div>
              <div style={{ fontSize: 11.5, color: TEXT.muted }}>
                {t.subject_name} · {t.event_no} · {CATEGORY_LABELS[t.category] || t.category}
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/dashboard/hr/lifecycle/${t.event_id}`)}
              style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 9999, border: `1px solid ${BORDER.normal}`, background: '#fff', color: '#57534e', cursor: 'pointer' }}
            >
              Open
            </button>
            <button
              type="button"
              disabled={busyId === t.id}
              onClick={() => markDone(t)}
              style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 9999, border: '1px solid rgba(22,163,74,0.35)', background: 'rgba(22,163,74,0.08)', color: '#15803d', cursor: busyId === t.id ? 'wait' : 'pointer' }}
            >
              {busyId === t.id ? 'Saving…' : '✓ Mark done'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
