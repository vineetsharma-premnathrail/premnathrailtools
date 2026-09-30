'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydCalculation, HydCalcTypeMeta } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import { keyResultText } from '@/components/hydraulic/CalcResults'
import { SYSTEM_TYPE_LABELS, SYSTEM_TYPE_HEX } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

export default function HydCalculationsPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()

  const [calcs, setCalcs] = useState<HydCalculation[]>([])
  const [types, setTypes] = useState<HydCalcTypeMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [calcType, setCalcType] = useState('')
  const [systemType, setSystemType] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    hydraulicApi.listCalcTypes()
      .then((data) => setTypes(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load calculation types.')))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (calcType) params.calc_type = calcType
    if (systemType) params.system_type = systemType
    if (search.trim()) params.search = search.trim()
    hydraulicApi.listCalculations(params)
      .then((data) => setCalcs(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load saved calculations.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, calcType, systemType, search])

  if (isLoading || !isAuthorized) return null

  const typeGroups = (['hydraulic', 'pneumatic'] as const)
    .map((m) => ({ medium: m, rows: types.filter((t) => t.system_type === m && (!systemType || systemType === m)) }))
    .filter((g) => g.rows.length)

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Calculations</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/hydraulic/calculations/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New Calculation
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }} placeholder="Search calc no. or title…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, flex: '0 1 260px' }} value={calcType} onChange={(e) => setCalcType(e.target.value)}>
          <option value="">All calculations</option>
          {typeGroups.map((g) => (
            <optgroup key={g.medium} label={SYSTEM_TYPE_LABELS[g.medium]}>
              {g.rows.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </optgroup>
          ))}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={systemType}
          onChange={(e) => {
            setSystemType(e.target.value)
            // Drop a calc-type filter that no longer fits the chosen medium.
            if (calcType && e.target.value && types.find((t) => t.key === calcType)?.system_type !== e.target.value) setCalcType('')
          }}>
          <option value="">Hydraulic + Pneumatic</option>
          <option value="hydraulic">Hydraulic</option>
          <option value="pneumatic">Pneumatic</option>
        </select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>
              {['Calc No.', 'Title', 'Calculation', 'Type', 'System', 'Key Result', 'By', 'Date', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : calcs.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No saved calculations match. Size a cylinder, pump, accumulator or receiver in the calculator and save it here for the record.</td></tr>
            ) : (
              calcs.map((c) => (
                <tr key={c.id} onClick={() => router.push(`/dashboard/hydraulic/calculations/${c.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{c.calc_number}</td>
                  <td style={cellStyle}>{c.title}</td>
                  <td style={cellStyle}>{c.calc_type_label || c.calc_type}</td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${SYSTEM_TYPE_HEX[c.system_type]}1a`, color: SYSTEM_TYPE_HEX[c.system_type], whiteSpace: 'nowrap' }}>
                      {SYSTEM_TYPE_LABELS[c.system_type] || c.system_type}
                    </span>
                  </td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{c.system_number || '—'}</td>
                  <td style={cellStyle}>{keyResultText(c.results?.results)}</td>
                  <td style={cellStyle}>{c.created_by_name || '—'}</td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{formatDate(c.created_at)}</td>
                  <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(`/dashboard/hydraulic/calculations/${c.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
