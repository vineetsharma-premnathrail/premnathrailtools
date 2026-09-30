'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydSystem } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import { SYSTEM_TYPE_LABELS, SYSTEM_TYPE_HEX, SYSTEM_STATUS_LABELS, withUnit } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_HEX: Record<string, string> = {
  design: '#78716c', under_build: '#2563EB', testing: '#7C3AED', commissioned: '#0f766e',
  in_service: '#16A34A', under_maintenance: '#F59E0B', decommissioned: '#57534e',
}

const TYPE_TABS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'hydraulic', label: 'Hydraulic' },
  { value: 'pneumatic', label: 'Pneumatic' },
]

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

export default function HydSystemsPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()

  const [systems, setSystems] = useState<HydSystem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [systemType, setSystemType] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (systemType) params.system_type = systemType
    if (statusFilter) params.status = statusFilter
    if (search.trim()) params.search = search.trim()
    hydraulicApi.listSystems(params)
      .then((data) => { setSystems(Array.isArray(data) ? data : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load systems.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, systemType, statusFilter, search])

  if (isLoading || !isAuthorized) return null

  const newHref = `/dashboard/hydraulic/systems/new${systemType ? `?type=${systemType}` : ''}`
  const filtered = Boolean(search.trim() || statusFilter)

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Systems</h1>
        </div>
        <button
          onClick={() => router.push(newHref)}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New {systemType ? SYSTEM_TYPE_LABELS[systemType] : ''} System
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'rgba(0,0,0,0.05)' }}>
          {TYPE_TABS.map((t) => {
            const active = systemType === t.value
            const hex = t.value ? SYSTEM_TYPE_HEX[t.value] : '#FF7A45'
            return (
              <button
                key={t.value || 'all'}
                type="button"
                onClick={() => setSystemType(t.value)}
                style={{
                  padding: '7px 18px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  background: active ? '#fff' : 'transparent', color: active ? hex : '#78716c',
                  boxShadow: active ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>
        <select style={{ ...inputStyle, flex: '0 1 190px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(SYSTEM_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }} placeholder="Search number, name, application or loco / machine serial…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>
              {['System No.', 'Name', 'Type', 'Application', 'Project', 'Working Pressure', 'Running Hrs', 'Open Jobs', 'Overdue PM', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : systems.length === 0 ? (
              <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                {filtered
                  ? 'No systems match these filters — clear the search or status filter.'
                  : `No ${systemType ? `${SYSTEM_TYPE_LABELS[systemType].toLowerCase()} ` : ''}systems yet. Add a system (a power pack, brake unit or actuation circuit) to hang its circuits, BOMs, tests and maintenance on.`}
              </td></tr>
            ) : (
              systems.map((s) => (
                <tr key={s.id} onClick={() => router.push(`/dashboard/hydraulic/systems/${s.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{s.system_number}</td>
                  <td style={cellStyle}>{s.name}</td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${SYSTEM_TYPE_HEX[s.system_type]}1a`, color: SYSTEM_TYPE_HEX[s.system_type], whiteSpace: 'nowrap' }}>
                      {SYSTEM_TYPE_LABELS[s.system_type] || s.system_type}
                    </span>
                  </td>
                  <td style={cellStyle}>{s.application || '—'}</td>
                  <td style={cellStyle}>{s.project_label || '—'}</td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{withUnit(s.working_pressure_bar, 'bar')}</td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{s.running_hours ? s.running_hours.toLocaleString('en-IN') : '—'}</td>
                  <td style={cellStyle}>{s.open_service_count || '—'}</td>
                  <td style={{ ...cellStyle, color: s.overdue_plan_count > 0 ? '#DC2626' : TEXT.body, fontWeight: s.overdue_plan_count > 0 ? 700 : 400 }}>
                    {s.overdue_plan_count || '—'}
                  </td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[s.status]}1a`, color: STATUS_HEX[s.status], whiteSpace: 'nowrap' }}>
                      {SYSTEM_STATUS_LABELS[s.status] || s.status}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(`/dashboard/hydraulic/systems/${s.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
