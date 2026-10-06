'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityDashboardKpis } from '@/types'
import { TEXT, GLASS, SHADOWS, DANGER, WARNING } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import { extractErrorMessages } from '@/lib/validation'

type KpiTone = 'bad' | 'warn' | 'neutral'

const KPI_CARDS: { key: keyof QualityDashboardKpis; label: string; tone: KpiTone; href?: string; pct?: boolean }[] = [
  { key: 'lots_waiting', label: 'Lots waiting', tone: 'neutral', href: '/dashboard/quality/my-inspections' },
  { key: 'lots_overdue', label: 'Lots waiting too long', tone: 'bad', href: '/dashboard/quality/lots' },
  { key: 'open_ncrs', label: 'Open NCRs', tone: 'warn', href: '/dashboard/quality/ncr' },
  { key: 'critical_ncrs', label: 'Critical NCRs', tone: 'bad', href: '/dashboard/quality/ncr' },
  { key: 'major_ncrs', label: 'Major NCRs', tone: 'warn', href: '/dashboard/quality/ncr' },
  { key: 'minor_ncrs', label: 'Minor NCRs', tone: 'neutral', href: '/dashboard/quality/ncr' },
  { key: 'ncrs_awaiting_approval', label: 'Dispositions awaiting approval', tone: 'warn', href: '/dashboard/quality/ncr' },
  { key: 'month_rejection_rate', label: 'Rejection rate (this month)', tone: 'neutral', pct: true },
  { key: 'open_capas', label: 'Open CAPAs', tone: 'warn', href: '/dashboard/quality/capa' },
  { key: 'overdue_capas', label: 'Overdue CAPAs', tone: 'bad', href: '/dashboard/quality/capa' },
  { key: 'open_complaints', label: 'Open Complaints', tone: 'warn', href: '/dashboard/quality/complaints' },
  { key: 'gate_inspections_pending', label: 'In-process gates pending', tone: 'neutral', href: '/dashboard/quality/in-process-inspection' },
  { key: 'open_first_articles', label: 'First articles open', tone: 'warn', href: '/dashboard/quality/first-articles' },
  { key: 'inspection_calls_next_7_days', label: 'Inspection calls (7 days)', tone: 'neutral', href: '/dashboard/quality/inspection-calls' },
]

function cardTone(tone: KpiTone) {
  if (tone === 'bad') return { background: `${DANGER.primary}14`, border: `1px solid ${DANGER.primary}33`, valueColor: DANGER.primary }
  if (tone === 'warn') return { background: `${WARNING.primary}14`, border: `1px solid ${WARNING.primary}33`, valueColor: WARNING.hover }
  return { background: GLASS.card, border: `1px solid ${GLASS.border}`, valueColor: TEXT.heading }
}

export default function QualityDashboardPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('quality')
  const router = useRouter()

  const [kpis, setKpis] = useState<QualityDashboardKpis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    qualityApi.getDashboard()
      .then((data) => setKpis(data?.kpis || null))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load Quality dashboard.')))
      .finally(() => setLoading(false))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <QualityNav />

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          Quality Module
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Quality</h1>
        <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>{user?.department ? `${user.department} — ` : ''}Inspection lots, NCRs and their dispositions, CAPA, complaints and supplier quality.</p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
        {KPI_CARDS.map((c) => {
          const tone = cardTone(c.tone)
          const value = kpis ? kpis[c.key] : null
          return (
            <div
              key={c.key}
              onClick={() => c.href && router.push(c.href)}
              style={{
                cursor: c.href ? 'pointer' : 'default',
                borderRadius: 18, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
                boxShadow: SHADOWS.glass(), padding: 18, background: tone.background, border: tone.border,
              }}
            >
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }}>
                {c.label}
              </p>
              <p style={{ fontSize: 28, fontWeight: 700, color: tone.valueColor, margin: 0 }}>
                {loading ? '…' : value === null || value === undefined ? '—' : c.pct ? `${value}%` : value}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
