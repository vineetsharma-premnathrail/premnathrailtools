'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityCapa, QualityInspection, QualityNcr, QualitySupplierScorecard } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND, SUCCESS, DANGER, WARNING, INFO } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import { extractErrorMessages } from '@/lib/validation'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

function BarRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: TEXT.body, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12.5, color: TEXT.muted }}>{count} ({pct}%)</span>
      </div>
      <div style={{ height: 8, borderRadius: 6, background: 'rgba(15,23,42,0.08)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 6, transition: 'width .3s' }} />
      </div>
    </div>
  )
}

const NCR_SEVERITY_COLORS: Record<string, string> = { minor: WARNING.primary, major: BRAND.primary, critical: DANGER.primary }
const NCR_STATUS_COLORS: Record<string, string> = {
  open: WARNING.primary, under_review: INFO.primary, capa_assigned: BRAND.primary,
  closed: SUCCESS.primary, rejected: DANGER.primary, cancelled: TEXT.muted,
}
const CAPA_STATUS_COLORS: Record<string, string> = {
  open: WARNING.primary, in_progress: INFO.primary, pending_verification: BRAND.primary,
  closed: SUCCESS.primary, overdue: DANGER.primary,
}

export default function QualityReportsPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')

  const [ncrs, setNcrs] = useState<QualityNcr[]>([])
  const [inspections, setInspections] = useState<QualityInspection[]>([])
  const [capas, setCapas] = useState<QualityCapa[]>([])
  const [scorecards, setScorecards] = useState<QualitySupplierScorecard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    Promise.all([
      qualityApi.listNcrs(),
      qualityApi.listInspections(),
      qualityApi.listCapas(),
      qualityApi.listSupplierScorecards(),
    ])
      .then(([n, i, c, s]) => {
        setNcrs(Array.isArray(n) ? n : [])
        setInspections(Array.isArray(i) ? i : [])
        setCapas(Array.isArray(c) ? c : [])
        setScorecards(Array.isArray(s) ? s : [])
      })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load Quality Reports data.')))
      .finally(() => setLoading(false))
  }, [isAuthorized])

  const ncrBySeverity = useMemo(() => {
    const m: Record<string, number> = {}
    ncrs.forEach((n) => { m[n.severity] = (m[n.severity] || 0) + 1 })
    return m
  }, [ncrs])

  const ncrByStatus = useMemo(() => {
    const m: Record<string, number> = {}
    ncrs.forEach((n) => { m[n.status] = (m[n.status] || 0) + 1 })
    return m
  }, [ncrs])

  const inspectionStats = useMemo(() => {
    const passed = inspections.filter((i) => i.status === 'passed' || i.status === 'conditionally_passed').length
    const failed = inspections.filter((i) => i.status === 'failed').length
    const pending = inspections.filter((i) => i.status === 'pending' || i.status === 'in_progress').length
    const total = inspections.length
    return { passed, failed, pending, total }
  }, [inspections])

  const capaByStatus = useMemo(() => {
    const m: Record<string, number> = {}
    capas.forEach((c) => { m[c.status] = (m[c.status] || 0) + 1 })
    return m
  }, [capas])

  const supplierAverages = useMemo(() => {
    const withQuality = scorecards.filter((s) => typeof s.quality_score === 'number')
    const withDelivery = scorecards.filter((s) => typeof s.on_time_delivery_score === 'number')
    const avgQuality = withQuality.length ? withQuality.reduce((sum, s) => sum + (s.quality_score || 0), 0) / withQuality.length : null
    const avgDelivery = withDelivery.length ? withDelivery.reduce((sum, s) => sum + (s.on_time_delivery_score || 0), 0) / withDelivery.length : null
    return { avgQuality, avgDelivery, count: scorecards.length }
  }, [scorecards])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <QualityNav />

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          Quality Module
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Quality Reports</h1>
        <p style={{ fontSize: 13.5, color: TEXT.muted, margin: '4px 0 0' }}>Summary breakdowns computed from current NCR, inspection, CAPA, and supplier scorecard data.</p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {loading ? (
        <div style={sectionStyle}>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading report data…</p>
        </div>
      ) : (
        <>
          <div style={sectionStyle}>
            <p style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>NCR Summary — by Severity</p>
            {ncrs.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No NCRs recorded.</p>
            ) : (
              ['minor', 'major', 'critical'].map((sev) => (
                <BarRow key={sev} label={sev.charAt(0).toUpperCase() + sev.slice(1)} count={ncrBySeverity[sev] || 0} total={ncrs.length} color={NCR_SEVERITY_COLORS[sev]} />
              ))
            )}
          </div>

          <div style={sectionStyle}>
            <p style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>NCR Summary — by Status</p>
            {ncrs.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No NCRs recorded.</p>
            ) : (
              Object.keys(ncrByStatus).map((status) => (
                <BarRow key={status} label={status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} count={ncrByStatus[status]} total={ncrs.length} color={NCR_STATUS_COLORS[status] || TEXT.muted} />
              ))
            )}
          </div>

          <div style={sectionStyle}>
            <p style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Inspection Pass / Fail Rate</p>
            {inspectionStats.total === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No inspections recorded.</p>
            ) : (
              <>
                <BarRow label="Passed" count={inspectionStats.passed} total={inspectionStats.total} color={SUCCESS.primary} />
                <BarRow label="Failed" count={inspectionStats.failed} total={inspectionStats.total} color={DANGER.primary} />
                <BarRow label="Pending / In Progress" count={inspectionStats.pending} total={inspectionStats.total} color={WARNING.primary} />
              </>
            )}
          </div>

          <div style={sectionStyle}>
            <p style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>CAPA Status Breakdown</p>
            {capas.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No CAPAs recorded.</p>
            ) : (
              Object.keys(capaByStatus).map((status) => (
                <BarRow key={status} label={status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} count={capaByStatus[status]} total={capas.length} color={CAPA_STATUS_COLORS[status] || TEXT.muted} />
              ))
            )}
          </div>

          <div style={sectionStyle}>
            <p style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Supplier Quality Summary</p>
            {supplierAverages.count === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No supplier scorecards recorded.</p>
            ) : (
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px', minWidth: 180, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.5)', border: `1px solid ${BORDER.light}` }}>
                  <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }}>Avg Quality Score</p>
                  <p style={{ fontSize: 26, fontWeight: 700, color: TEXT.heading, margin: 0 }}>
                    {supplierAverages.avgQuality !== null ? supplierAverages.avgQuality.toFixed(1) : '—'}
                  </p>
                </div>
                <div style={{ flex: '1 1 200px', minWidth: 180, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.5)', border: `1px solid ${BORDER.light}` }}>
                  <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }}>Avg On-Time Delivery Score</p>
                  <p style={{ fontSize: 26, fontWeight: 700, color: TEXT.heading, margin: 0 }}>
                    {supplierAverages.avgDelivery !== null ? supplierAverages.avgDelivery.toFixed(1) : '—'}
                  </p>
                </div>
                <div style={{ flex: '1 1 200px', minWidth: 180, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.5)', border: `1px solid ${BORDER.light}` }}>
                  <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }}>Scorecards</p>
                  <p style={{ fontSize: 26, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{supplierAverages.count}</p>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
