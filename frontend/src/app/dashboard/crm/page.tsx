'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth, useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { CrmDashboard } from '@/types'
import CrmNav from '@/components/crm/CrmNav'

export default function CrmDashboardPage() {
  const { user } = useAuth()
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()
  const [data, setData] = useState<CrmDashboard | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAuthorized) return
    crmApi.getDashboard().then(setData).finally(() => setLoading(false))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: '0 0 4px' }}>CRM Dashboard</h1>
      <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 24px' }}>
        Welcome back, {user?.name || 'there'}. Here is the state of your business development pipeline.
      </p>

      {loading || !data ? (
        <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginBottom: 20 }}>
            <StatCard label="Organizations" value={data.total_organizations} color="#3b82f6" />
            <StatCard label="Inquiries" value={data.total_inquiries} color="#fa9b9b" />
            <StatCard label="Tenders" value={data.total_tenders} color="#8b5cf6" />
            <StatCard label="Open Follow-ups" value={data.open_followups} color="#10b981" />
            <StatCard label="Overdue Follow-ups" value={data.overdue_followups} color="#dc2626" />
            <StatCard label="Today's Activities" value={data.today_activities} color="#06b6d4" />
            <StatCard label="Pending Tenders" value={data.pending_tenders} color="#eab308" />
          </div>

          <div className="grid-3" style={{ gap: 20, marginBottom: 20 }}>
            <RecentList
              title="Recent Organizations"
              viewAllHref="/dashboard/crm/organizations"
              items={data.recent_organizations}
              renderItem={(o) => (
                <div key={o.id} onClick={() => router.push(`/dashboard/crm/organizations/${o.id}`)} style={rowStyle}>
                  <p style={rowTitle}>{o.name}</p>
                  <p style={rowSub}>{o.city || o.org_type || '—'}</p>
                </div>
              )}
            />
            <RecentList
              title="Recent Inquiries"
              viewAllHref="/dashboard/crm/inquiries"
              items={data.recent_inquiries}
              renderItem={(i) => (
                <div key={i.id} onClick={() => router.push(`/dashboard/crm/inquiries/${i.id}`)} style={rowStyle}>
                  <p style={rowTitle}>{i.universal_id}</p>
                  <p style={rowSub}>{i.status}</p>
                </div>
              )}
            />
            <RecentList
              title="Recent Tenders"
              viewAllHref="/dashboard/crm/tenders"
              items={data.recent_tenders}
              renderItem={(t) => (
                <div key={t.id} onClick={() => router.push(`/dashboard/crm/tenders/${t.id}`)} style={rowStyle}>
                  <p style={rowTitle}>{t.universal_id}</p>
                  <p style={rowSub}>{t.status}</p>
                </div>
              )}
            />
          </div>

          <div className="grid-2" style={{ gap: 20 }}>
            <RecentList
              title="Recent Activities"
              viewAllHref="/dashboard/crm/activities"
              items={data.recent_activities}
              renderItem={(a) => (
                <div key={a.id} style={rowStyle}>
                  <p style={rowTitle}>{a.activity_type || 'Activity'}</p>
                  <p style={rowSub}>{a.remarks || '—'} · {a.status}</p>
                </div>
              )}
            />
            <RecentList
              title="Recent Notes"
              viewAllHref="/dashboard/crm/notes"
              items={data.recent_notes}
              renderItem={(n) => (
                <div key={n.id} style={rowStyle}>
                  <p style={{ ...rowTitle, color: '#1f1108' }}>{n.note}</p>
                  <p style={rowSub}>{n.created_by_name || 'Unknown'}</p>
                </div>
              )}
            />
          </div>
        </>
      )}
    </div>
  )
}

const rowStyle: React.CSSProperties = { padding: '10px 14px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', marginBottom: 8 }
const rowTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#1f1108', margin: '0 0 2px' }
const rowSub: React.CSSProperties = { fontSize: 11.5, color: '#78716c', margin: 0 }

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 800, color, margin: 0 }}>{value}</p>
    </div>
  )
}

function RecentList<T>({ title, titleColor, viewAllHref, items, renderItem }: { title: string; titleColor?: string; viewAllHref: string; items: T[]; renderItem: (item: T) => React.ReactNode }) {
  return (
    <div style={{ height: '100%', boxSizing: 'border-box', borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 13.5, fontWeight: 700, color: titleColor || '#1f1108', margin: 0 }}>{title}</h2>
        <Link href={viewAllHref} style={{ fontSize: 11.5, color: '#fa9b9b', textDecoration: 'none', fontWeight: 600 }}>View all →</Link>
      </div>
      {items.length === 0 ? (
        <p style={{ fontSize: 12.5, color: '#a8a29e', margin: 0 }}>No records yet.</p>
      ) : (
        items.map(renderItem)
      )}
    </div>
  )
}
