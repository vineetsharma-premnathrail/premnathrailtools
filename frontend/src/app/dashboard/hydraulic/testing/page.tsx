'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydTest } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import { TEST_TYPE_LABELS, withUnit } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress', completed: 'Completed' }
const STATUS_HEX: Record<string, string> = { planned: '#2563EB', in_progress: '#F59E0B', completed: '#16A34A' }
const RESULT_LABELS: Record<string, string> = { pending: 'Pending', pass: 'Pass', fail: 'Fail', conditional: 'Conditional' }
const RESULT_HEX: Record<string, string> = { pending: '#78716c', pass: '#16A34A', fail: '#DC2626', conditional: '#F59E0B' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const pill = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })

export default function HydTestsPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()

  const [tests, setTests] = useState<HydTest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [systemType, setSystemType] = useState('')
  const [testType, setTestType] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [resultFilter, setResultFilter] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (systemType) params.system_type = systemType
    if (testType) params.test_type = testType
    if (statusFilter) params.status = statusFilter
    if (resultFilter) params.result = resultFilter
    if (search.trim()) params.search = search.trim()
    hydraulicApi.listTests(params)
      .then((data) => setTests(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load tests.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, systemType, testType, statusFilter, resultFilter, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Testing &amp; Inspection</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/hydraulic/testing/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New Test
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }} placeholder="Search test no., title or serial no…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={systemType} onChange={(e) => setSystemType(e.target.value)}>
          <option value="">Hydraulic + Pneumatic</option>
          <option value="hydraulic">Hydraulic</option>
          <option value="pneumatic">Pneumatic</option>
        </select>
        <select style={{ ...inputStyle, flex: '0 1 220px' }} value={testType} onChange={(e) => setTestType(e.target.value)}>
          <option value="">All test types</option>
          {Object.entries(TEST_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 150px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 140px' }} value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
          <option value="">All results</option>
          {Object.entries(RESULT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>
              {['Test No.', 'Title', 'Test Type', 'Subject', 'Date', 'Test Pressure', 'Failed Readings', 'Status', 'Result', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : tests.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No tests match. Plan a pressure, proof, leak or cleanliness test against a system or component to start its test record.</td></tr>
            ) : (
              tests.map((t) => (
                <tr key={t.id} onClick={() => router.push(`/dashboard/hydraulic/testing/${t.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{t.test_number}</td>
                  <td style={cellStyle}>{t.title}</td>
                  <td style={cellStyle}>{TEST_TYPE_LABELS[t.test_type] || t.test_type}</td>
                  <td style={cellStyle}>
                    {[t.system_number, t.component_code].filter(Boolean).join(' · ') || '—'}
                    {t.component_serial && <span style={{ color: TEXT.muted }}> (S/N {t.component_serial})</span>}
                  </td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{formatDate(t.test_date)}</td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{withUnit(t.test_pressure_bar, 'bar')}</td>
                  <td style={{ ...cellStyle, fontWeight: t.failed_readings ? 700 : 400, color: t.failed_readings ? DANGER.primary : TEXT.muted }}>
                    {t.failed_readings ? t.failed_readings : '—'}
                  </td>
                  <td style={cellStyle}><span style={pill(STATUS_HEX[t.status])}>{STATUS_LABELS[t.status] || t.status}</span></td>
                  <td style={cellStyle}><span style={pill(RESULT_HEX[t.result])}>{RESULT_LABELS[t.result] || t.result}</span></td>
                  <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(`/dashboard/hydraulic/testing/${t.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
