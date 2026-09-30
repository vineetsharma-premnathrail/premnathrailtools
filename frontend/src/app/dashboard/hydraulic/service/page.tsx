'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydServiceRecord } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import DateField from '@/components/erp/DateField'
import { SERVICE_TYPE_LABELS } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { open: 'Open', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { open: '#2563EB', in_progress: '#F59E0B', completed: '#16A34A', cancelled: '#78716c' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

export default function HydServiceRecordsPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()

  const [records, setRecords] = useState<HydServiceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [serviceType, setServiceType] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const dateRangeError = !!dateFrom && !!dateTo && dateFrom > dateTo

  useEffect(() => {
    if (!isAuthorized) return
    if (dateRangeError) return
    const params: Record<string, unknown> = {}
    if (serviceType) params.service_type = serviceType
    if (statusFilter) params.status = statusFilter
    if (dateFrom) params.date_from = dateFrom
    if (dateTo) params.date_to = dateTo
    if (search.trim()) params.search = search.trim()
    hydraulicApi.listServiceRecords(params)
      .then((data) => { setRecords(Array.isArray(data) ? data : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load service records.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, serviceType, statusFilter, dateFrom, dateTo, search, dateRangeError])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Service Records</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/hydraulic/service/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New Service Job
        </button>
      </div>

      {dateRangeError && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          The &quot;From&quot; date is after the &quot;To&quot; date — swap them or clear one to see records.
        </div>
      )}
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }} placeholder="Search record no., problem, work done or agency…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, flex: '0 1 180px' }} value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
          <option value="">All service types</option>
          {Object.entries(SERVICE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 150px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary }}>From</span>
          <div style={{ width: 150 }}><DateField value={dateFrom} onChange={setDateFrom} /></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary }}>To</span>
          <div style={{ width: 150 }}><DateField value={dateTo} onChange={setDateTo} /></div>
        </div>
        {(dateFrom || dateTo) && (
          <span onClick={() => { setDateFrom(''); setDateTo('') }} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>Clear dates</span>
        )}
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1150 }}>
          <thead>
            <tr>
              {['Record No.', 'Date', 'System', 'Type', 'Plan', 'Performed By / Agency', 'Downtime h', 'Total Cost', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No service records match. Raise a job for a breakdown, or from a due maintenance plan.</td></tr>
            ) : (
              records.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/dashboard/hydraulic/service/${r.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{r.record_number}</td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{formatDate(r.service_date)}</td>
                  <td style={cellStyle}>
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.system_number || '—'}</span>
                    {r.system_name && <span style={{ display: 'block', fontSize: 12, color: TEXT.muted }}>{r.system_name}</span>}
                  </td>
                  <td style={cellStyle}>{SERVICE_TYPE_LABELS[r.service_type] || r.service_type}</td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{r.plan_number || '—'}</td>
                  <td style={cellStyle}>{[r.performed_by_name, r.external_agency].filter(Boolean).join(' / ') || '—'}</td>
                  <td style={cellStyle}>{r.downtime_hours ? r.downtime_hours.toLocaleString('en-IN') : '—'}</td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>₹{r.total_cost.toLocaleString('en-IN')}</td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[r.status]}1a`, color: STATUS_HEX[r.status], whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[r.status] || r.status}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(`/dashboard/hydraulic/service/${r.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
