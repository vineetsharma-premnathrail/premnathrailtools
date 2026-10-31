'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth, useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { CrmDashboard } from '@/types'
import CrmNav from '@/components/crm/CrmNav'
import { stripHtml } from '@/components/RichTextEditor'
import { extractErrorMessages } from '@/lib/validation'
import { getRecentVisits, RecentKind, RecentVisit } from '@/lib/crmShortcuts'
import { recordPath } from '@/lib/recordRef'
import { smallSecondaryBtnStyle } from '@/components/shared/ui'

export default function CrmDashboardPage() {
  const { user } = useAuth()
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()
  const [data, setData] = useState<CrmDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string[]>([])
  const [recent, setRecent] = useState<Record<RecentKind, RecentVisit[]>>({ organization: [], inquiry: [], tender: [] })

  useEffect(() => {
    if (!isAuthorized) return
    crmApi.getDashboard()
      .then(setData)
      .catch((err) => setLoadError(extractErrorMessages(err, 'Could not load the CRM dashboard. Reload the page; if it persists, check your connection and that you still have CRM access.')))
      .finally(() => setLoading(false))

    setRecent({ organization: getRecentVisits('organization'), inquiry: getRecentVisits('inquiry'), tender: getRecentVisits('tender') })
  }, [isAuthorized])

  const openRecent = (v: RecentVisit) => {
    const base = v.kind === 'organization' ? 'organizations' : v.kind === 'inquiry' ? 'inquiries' : 'tenders'
    // Visits saved before signed links existed have no ref — open the list instead.
    router.push(v.ref ? `/dashboard/crm/${base}/${v.ref}` : (v.kind === 'tender' ? '/dashboard/crm/inquiries?type=tender' : `/dashboard/crm/${base}`))
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', margin: '0 0 24px' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>CRM Dashboard</h1>
          <p style={{ fontSize: 13, color: '#57534e', margin: 0 }}>
            Welcome back, {user?.name || 'there'}. Here is the state of your business development pipeline.
          </p>
        </div>
      </div>

      {loadError.length > 0 ? (
        <div role="alert" style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>{loadError.map((m, i) => <p key={i} style={{ fontSize: 13, color: '#b91c1c', margin: i ? '4px 0 0' : 0 }}>{m}</p>)}</div>
          <button type="button" onClick={() => window.location.reload()} style={smallSecondaryBtnStyle}>Reload</button>
        </div>
      ) : loading || !data ? (
        <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gridAutoRows: '1fr', alignItems: 'stretch', gap: 14, marginBottom: 20 }}>
            <StatCard tourId="dash-stat-organizations" label="Organizations" value={data.total_organizations} color="#3b82f6" href="/dashboard/crm/organizations" />
            <StatCard tourId="dash-stat-inquiries" label="Inquiries" value={data.total_inquiries} color="#FF7A45" href="/dashboard/crm/inquiries?type=inquiry" />
            <StatCard tourId="dash-stat-tenders" label="Tenders" value={data.total_tenders} color="#8b5cf6" href="/dashboard/crm/inquiries?type=tender" />
            <StatCard tourId="dash-stat-open-followups" label="Open follow-ups" value={data.open_followups} color="#10b981" href="/dashboard/crm/followups?bucket=open" />
            <StatCard tourId="dash-stat-overdue-followups" label="Overdue follow-ups" value={data.overdue_followups} color="#dc2626" href="/dashboard/crm/followups?bucket=overdue" />
            <StatCard tourId="dash-stat-today-followups" label="Due today" value={data.today_activities} color="#06b6d4" href="/dashboard/crm/followups?bucket=today" />
            <StatCard tourId="dash-stat-pending-tenders" label="Pending tenders" value={data.pending_tenders} color="#eab308" href="/dashboard/crm/inquiries?type=tender&stat=pending" />
          </div>

          <div className="grid-3" style={{ gap: 20, marginBottom: 20 }}>
            <RecentlyViewed
              tourId="dash-recent-organizations"
              title="Recently Viewed Customer Organizations"
              viewAllHref="/dashboard/crm/organizations"
              visits={recent.organization}
              onOpen={openRecent}
              fallback={data.recent_organizations.map((o) => ({ id: o.id, title: o.name, sub: o.city || o.org_type || '—', href: recordPath('/dashboard/crm/organizations', o) }))}
            />
            <RecentlyViewed
              tourId="dash-recent-inquiries"
              title="Recently Viewed Inquiries"
              viewAllHref="/dashboard/crm/inquiries?type=inquiry"
              visits={recent.inquiry}
              onOpen={openRecent}
              fallback={data.recent_inquiries.map((i) => ({ id: i.id, title: i.universal_id, sub: i.status, href: recordPath('/dashboard/crm/inquiries', i) }))}
            />
            <RecentlyViewed
              tourId="dash-recent-tenders"
              title="Recently Viewed Tenders"
              viewAllHref="/dashboard/crm/inquiries?type=tender"
              visits={recent.tender}
              onOpen={openRecent}
              fallback={data.recent_tenders.map((t) => ({ id: t.id, title: t.universal_id, sub: t.status, href: recordPath('/dashboard/crm/tenders', t) }))}
            />
          </div>

          <div style={{ gap: 20 }}>
            <RecentList
              tourId="dash-recent-followups"
              title="Recent Follow Ups"
              items={data.recent_activities}
              renderItem={(a) => {
                const target = a.related_module === 'tender'
                  ? recordPath('/dashboard/crm/tenders', a, 'related_id')
                  : a.related_module === 'inquiry'
                    ? recordPath('/dashboard/crm/inquiries', a, 'related_id')
                    : null
                return (
                  <div key={a.id} onClick={() => target && router.push(target)} style={{ ...rowStyle, cursor: target ? 'pointer' : 'default' }}>
                    <p style={rowTitle}>{a.activity_type || 'Follow Up'}</p>
                    <p style={rowSub}>{(a.remarks ? stripHtml(a.remarks) : '') || '—'} · {a.status}</p>
                  </div>
                )
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}

const panelStyle: React.CSSProperties = { boxSizing: 'border-box', borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', padding: 16 }
const rowStyle: React.CSSProperties = { padding: '10px 14px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', marginBottom: 8 }
const rowTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#1f1108', margin: '0 0 2px' }
const rowSub: React.CSSProperties = { fontSize: 12, color: '#57534e', margin: 0 }

function StatCard({ label, value, color, href, tourId }: { label: string; value: number; color: string; href?: string; tourId?: string }) {
  const content = (
    <>
      <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: '#57534e', margin: '0 0 6px', minHeight: 30, display: 'flex', alignItems: 'flex-end' }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color, margin: 0 }}>{value}</p>
    </>
  )
  const style: React.CSSProperties = { display: 'block', padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', textDecoration: 'none', cursor: href ? 'pointer' : 'default', transition: 'transform .15s ease, box-shadow .15s ease' }

  if (!href) return <div data-tour={tourId} style={style}>{content}</div>

  return (
    <Link
      href={href}
      data-tour={tourId}
      style={style}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 16px 36px rgba(15,23,42,0.22), 0 2px 6px rgba(15,23,42,.1), inset 0 1px 0 rgba(255,255,255,.35)' }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = style.boxShadow as string }}
    >
      {content}
    </Link>
  )
}

function RecentList<T>({ title, titleColor, viewAllHref, items, renderItem, tourId }: { title: string; titleColor?: string; viewAllHref?: string; items: T[]; renderItem: (item: T) => React.ReactNode; tourId?: string }) {
  return (
    <div data-tour={tourId} style={{ height: '100%', boxSizing: 'border-box', borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 13.5, fontWeight: 600, color: titleColor || '#1f1108', margin: 0 }}>{title}</h2>
        {viewAllHref && <Link href={viewAllHref} style={{ fontSize: 12, color: '#c2410c', textDecoration: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}>View all →</Link>}
      </div>
      {items.length === 0 ? (
        <p style={{ fontSize: 12.5, color: '#57534e', margin: 0 }}>No records yet.</p>
      ) : (
        items.map(renderItem)
      )}
    </div>
  )
}

/** The last 5 records this user opened (newest first) — not removable.
 * Until they have opened any, it shows the newest records instead, and says so. */
function RecentlyViewed({ title, viewAllHref, visits, fallback, onOpen, tourId }: {
  title: string
  viewAllHref: string
  visits: RecentVisit[]
  fallback: { id: number; title: string; sub: string; href: string }[]
  onOpen: (v: RecentVisit) => void
  tourId?: string
}) {
  const router = useRouter()
  return (
    <div data-tour={tourId} style={{ ...panelStyle, height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 13.5, fontWeight: 600, color: '#1f1108', margin: 0 }}>{title}</h2>
        <Link href={viewAllHref} style={{ fontSize: 12, color: '#c2410c', textDecoration: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}>View all →</Link>
      </div>
      {visits.length > 0 ? (
        visits.slice(0, 5).map((v) => (
          <div key={v.id} onClick={() => onOpen(v)} style={{ ...rowStyle, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={rowTitle}>{v.title}</p>
              <p style={{ ...rowSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.sub || '—'} · {timeAgo(v.at)}</p>
            </div>
          </div>
        ))
      ) : fallback.length === 0 ? (
        <p style={{ fontSize: 12.5, color: '#57534e', margin: 0 }}>No records yet.</p>
      ) : (
        <>
          <p style={{ fontSize: 12, color: '#57534e', margin: '0 0 8px' }}>You haven&apos;t opened any yet — showing the newest.</p>
          {fallback.slice(0, 5).map((f) => (
            <div key={f.id} onClick={() => router.push(f.href)} style={rowStyle}>
              <p style={rowTitle}>{f.title}</p>
              <p style={rowSub}>{f.sub}</p>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function timeAgo(at: number): string {
  const mins = Math.round((Date.now() - at) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.round(hrs / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}
