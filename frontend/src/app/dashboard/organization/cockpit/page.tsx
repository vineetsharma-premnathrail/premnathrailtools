'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import OrganizationNav from '@/components/organization/OrganizationNav'
import { analyticsApi, Cockpit, CockpitKpi } from '@/lib/basisApi'
import { extractErrorMessages } from '@/lib/validation'
import { BORDER, BRAND, GLASS, SHADOWS, TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'

// Management cockpit (SAP SAC / BW style) — one tile per step of the core
// flow: enquiry → order intake → backlog → production WIP → QC holds →
// dispatch → billing → collections → service SLA (backend
// main/routes/analytics.py). Partners and organization:cockpit:view holders.

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18,
}

function money(v: number) {
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}
function show(k: CockpitKpi, v: number | undefined) {
  if (v === undefined || v === null) return '—'
  return k.unit === 'inr' ? money(v) : v.toLocaleString('en-IN')
}

/** 12-month single-series bar trend; hover a bar for its value. */
function Trend({ k }: { k: CockpitKpi }) {
  const [hover, setHover] = useState<number | null>(null)
  const data = k.trend || []
  const max = Math.max(1, ...data.map((d) => d.value))
  const h = 64
  const label = (m: string) => new Date(`${m}-01`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: h, borderBottom: `1px solid ${BORDER.light}` }}
        onMouseLeave={() => setHover(null)} role="img" aria-label={`${k.label}, last 12 months`}>
        {data.map((d, i) => (
          <div key={d.month} onMouseEnter={() => setHover(i)} aria-label={`${label(d.month)}: ${show(k, d.value)}`}
            style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', cursor: 'default' }}>
            <div style={{ width: '100%', height: Math.max(d.value > 0 ? 2 : 0, (d.value / max) * h), borderRadius: '4px 4px 0 0',
              background: BRAND.primary, opacity: hover === null || hover === i ? 1 : 0.45 }} />
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: TEXT.muted, marginTop: 4, minHeight: 15 }}>
        {hover !== null && data[hover] ? <><b style={{ color: TEXT.body }}>{label(data[hover].month)}</b> {show(k, data[hover].value)}</>
          : data.length ? `${label(data[0].month)} – ${label(data[data.length - 1].month)}` : ''}
      </div>
    </div>
  )
}

function Tile({ k, step }: { k: CockpitKpi; step: number }) {
  const delta = k.current !== undefined && k.previous !== undefined && k.previous !== 0
    ? Math.round(((k.current - k.previous) / Math.abs(k.previous)) * 100) : null
  return (
    <div style={{ ...cardStyle, flex: '1 1 260px', maxWidth: 380, minWidth: 240, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>{step}. {k.stage}</span>
        {k.status === 'ok' && <Link href={k.href} style={{ fontSize: 11.5, fontWeight: 600, color: BRAND.primaryActive, textDecoration: 'none' }}>Open →</Link>}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: TEXT.secondary, marginTop: 4 }}>{k.label}</div>
      {k.status === 'ok' ? (
        <>
          <div style={{ fontSize: 28, fontWeight: 800, color: TEXT.heading, margin: '4px 0 2px' }}>{show(k, k.value)}</div>
          {delta !== null && (
            <div style={{ fontSize: 12, color: TEXT.secondary }}>
              <span aria-hidden>{delta >= 0 ? '▲' : '▼'}</span> {Math.abs(delta)}% vs last month ({show(k, k.previous)})
            </div>
          )}
          {k.secondary && <div style={{ fontSize: 12, color: k.alert ? '#b45309' : TEXT.muted, marginTop: 4 }}>{k.alert ? '⚠ ' : ''}{k.secondary}</div>}
          {k.trend && k.trend.length > 0 && <Trend k={k} />}
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: TEXT.muted, marginTop: 8 }}>
          {k.status === 'restricted' ? `Hidden — ${k.message}` : k.message}
        </div>
      )}
    </div>
  )
}

export default function CockpitPage() {
  const router = useRouter()
  const { user, isLoading } = useAuth()
  const { can } = useCan()
  const allowed = !!user && (can('organization', 'cockpit', 'view') || !!(user as { is_partner?: boolean }).is_partner)
  const [data, setData] = useState<Cockpit | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (!isLoading && user && !allowed) router.push('/dashboard') }, [isLoading, user, allowed, router])
  const load = useCallback((refresh = false) => {
    setLoading(true); setError('')
    analyticsApi.cockpit(refresh).then(setData).catch((e) => setError(extractErrorMessages(e, 'Could not load the cockpit.').join(' '))).finally(() => setLoading(false))
  }, [])
  useEffect(() => { if (allowed) load() }, [allowed, load])

  if (isLoading || !allowed) return null

  return (
    <div>
      <OrganizationNav />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Management Cockpit</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
            The order-to-cash flow at a glance{data ? ` · as of ${new Date(data.as_of).toLocaleString('en-GB')} (refreshes every ${Math.round(data.cache_seconds / 60)} min)` : ''}.
          </p>
        </div>
        <button type="button" style={secondaryBtnStyle} disabled={loading} onClick={() => load(true)}>{loading ? 'Refreshing…' : 'Refresh now'}</button>
      </div>
      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        {data?.kpis.map((k, i) => <Tile key={k.key} k={k} step={i + 1} />)}
      </div>
    </div>
  )
}
