'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { CrmActivity } from '@/types'
import CrmNav from '@/components/crm/CrmNav'
import { secondaryBtnStyle } from '@/components/crm/ui'
import { stripHtml } from '@/components/RichTextEditor'
import { formatDate } from '@/lib/format'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'

type Bucket = 'open' | 'overdue' | 'today'

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'open', label: 'Open Follow-ups' },
  { key: 'overdue', label: 'Overdue Follow-ups' },
  { key: 'today', label: "Today's Follow-ups" },
]

const panelStyle: React.CSSProperties = {
  borderRadius: 18,
  background: GLASS.card,
  backdropFilter: GLASS.blur,
  WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`,
  boxShadow: SHADOWS.glass(),
  overflow: 'auto',
  maxHeight: 'calc(100vh - 320px)',
}

export default function FollowUpsPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()
  const searchParams = useSearchParams()
  const bucket: Bucket = (['open', 'overdue', 'today'] as Bucket[]).includes(searchParams.get('bucket') as Bucket)
    ? (searchParams.get('bucket') as Bucket)
    : 'open'

  const [activities, setActivities] = useState<CrmActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    setError('')
    const params = bucket === 'overdue' ? { overdue: true } : bucket === 'today' ? { due_today: true } : { status: 'Open' }
    crmApi.listActivities(params)
      .then(setActivities)
      .catch(() => setError('Failed to load follow-ups.'))
      .finally(() => setLoading(false))
  }, [isAuthorized, bucket])

  const rows = useMemo(
    () => [...activities].sort((a, b) => (a.next_followup || '').localeCompare(b.next_followup || '')),
    [activities]
  )

  const openRow = (a: CrmActivity) => {
    if (a.related_module === 'inquiry' && a.related_id) router.push(`/dashboard/crm/inquiries?id=${a.related_id}&type=inquiry`)
    else if (a.related_module === 'tender' && a.related_id) router.push(`/dashboard/crm/inquiries?id=${a.related_id}&type=tender`)
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Follow-ups</h1>
          <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>{rows.length} record{rows.length === 1 ? '' : 's'} found</p>
        </div>
        <button type="button" onClick={() => router.push('/dashboard/crm')} style={secondaryBtnStyle}>← Back</button>
      </div>

      <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'rgba(0,0,0,0.05)', marginBottom: 16 }}>
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            onClick={() => router.push(`/dashboard/crm/followups?bucket=${b.key}`)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
              background: bucket === b.key ? '#fff' : 'transparent',
              color: bucket === b.key ? '#FF7A45' : '#78716c',
              boxShadow: bucket === b.key ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {b.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ ...panelStyle, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['Type', 'Related', 'Organization', 'Due Date', 'Assigned To', 'Remarks', 'Status'].map((label) => (
                <th key={label} style={{ textAlign: 'left', padding: '7px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No follow-ups found.</td></tr>}
            {!loading && rows.map((a) => {
              const clickable = !!(a.related_id && (a.related_module === 'inquiry' || a.related_module === 'tender'))
              return (
                <tr key={a.id} onClick={() => openRow(a)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: clickable ? 'pointer' : 'default' }}>
                  <td style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, color: '#1f1108', whiteSpace: 'nowrap' }}>{a.activity_type || 'Follow Up'}</td>
                  <td style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, color: clickable ? '#FF7A45' : '#a8a29e', whiteSpace: 'nowrap' }}>{a.related_label || '—'}</td>
                  <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#1f1108', whiteSpace: 'nowrap' }}>{a.org_name || '—'}</td>
                  <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{a.next_followup ? formatDate(a.next_followup) : '—'}</td>
                  <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{a.assigned_to || '—'}</td>
                  <td style={{ padding: '7px 16px', fontSize: 12.5, color: '#57534e', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.remarks ? stripHtml(a.remarks) : ''}>
                    {a.remarks ? stripHtml(a.remarks) : '—'}
                  </td>
                  <td style={{ padding: '7px 16px', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: a.status === 'Open' ? 'rgba(16,185,129,0.12)' : 'rgba(120,113,108,0.12)', color: a.status === 'Open' ? '#10b981' : '#78716c' }}>
                      {a.status}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
