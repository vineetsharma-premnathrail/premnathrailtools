'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydMaintenancePlan } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import Checkbox from '@/components/Checkbox'
import { MAINTENANCE_TYPE_LABELS } from '@/components/hydraulic/labels'
import { raiseJobHref, frequencyText, daysText, hoursText } from '@/components/hydraulic/MaintenancePlanForm'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const DUE_LABELS: Record<string, string> = { overdue: 'Overdue', due_soon: 'Due Soon', ok: 'On Track', inactive: 'Inactive' }
const DUE_HEX: Record<string, string> = { overdue: '#DC2626', due_soon: '#F59E0B', ok: '#16A34A', inactive: '#78716c' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const subStyle: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 600 }

/** Colour for a next-due value — only the trigger that is actually late/near is tinted. */
function tint(status: string): string {
  return status === 'overdue' ? '#DC2626' : status === 'due_soon' ? '#B45309' : TEXT.body
}

function NextDue({ p }: { p: HydMaintenancePlan }) {
  const inactive = p.due_status === 'inactive'
  const days = p.days_to_due
  const dateStatus = inactive || days == null ? 'ok' : days < 0 ? 'overdue' : days <= 7 ? 'due_soon' : 'ok'
  const remaining = p.next_due_hours != null && p.system_running_hours != null ? p.next_due_hours - p.system_running_hours : null
  const hourStatus = inactive || remaining == null || !p.frequency_hours ? 'ok'
    : remaining <= 0 ? 'overdue' : remaining <= p.frequency_hours * 0.1 ? 'due_soon' : 'ok'
  if (!p.next_due_date && p.next_due_hours == null) return <>—</>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {p.next_due_date && (
        <span style={{ color: tint(dateStatus), fontWeight: dateStatus === 'ok' ? 400 : 600 }}>
          {formatDate(p.next_due_date)}
          {!inactive && days != null && <span style={subStyle}>{daysText(days)}</span>}
        </span>
      )}
      {p.next_due_hours != null && (
        <span style={{ color: tint(hourStatus), fontWeight: hourStatus === 'ok' ? 400 : 600 }}>
          at {p.next_due_hours.toLocaleString('en-IN')} h
          {!inactive && remaining != null && <span style={subStyle}>{hoursText(p.next_due_hours, p.system_running_hours)}</span>}
        </span>
      )}
    </div>
  )
}

export default function HydMaintenancePlansPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()

  const [plans, setPlans] = useState<HydMaintenancePlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [systemType, setSystemType] = useState('')
  const [maintenanceType, setMaintenanceType] = useState('')
  const [dueStatus, setDueStatus] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (systemType) params.system_type = systemType
    if (maintenanceType) params.maintenance_type = maintenanceType
    if (dueStatus) params.due_status = dueStatus
    if (showInactive || dueStatus === 'inactive') params.include_inactive = true
    if (search.trim()) params.search = search.trim()
    hydraulicApi.listPlans(params)
      .then((data) => { setPlans(Array.isArray(data) ? data : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load maintenance plans.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, systemType, maintenanceType, dueStatus, showInactive, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Maintenance Plans</h1>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: '6px 0 0' }}>Recurring tasks by calendar days and/or running hours — most urgent first.</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/hydraulic/maintenance/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New Plan
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }} placeholder="Search plan no. or title…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={systemType} onChange={(e) => setSystemType(e.target.value)}>
          <option value="">Hydraulic + Pneumatic</option>
          <option value="hydraulic">Hydraulic</option>
          <option value="pneumatic">Pneumatic</option>
        </select>
        <select style={{ ...inputStyle, flex: '0 1 220px' }} value={maintenanceType} onChange={(e) => setMaintenanceType(e.target.value)}>
          <option value="">All maintenance types</option>
          {Object.entries(MAINTENANCE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 150px' }} value={dueStatus} onChange={(e) => setDueStatus(e.target.value)}>
          <option value="">Any due status</option>
          {Object.entries(DUE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.secondary, cursor: 'pointer' }}>
          <Checkbox checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1250 }}>
          <thead>
            <tr>
              {['Plan No.', 'Title', 'System', 'Type', 'Frequency', 'Last Done', 'Next Due', 'Assigned To', 'Due', 'Job', ''].map((h, i) => (
                <th key={`${h}-${i}`} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : plans.length === 0 ? (
              <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No maintenance plans match. Add oil changes, filter changes and inspections so they show up here when they fall due.</td></tr>
            ) : (
              plans.map((p) => (
                <tr key={p.id} onClick={() => router.push(`/dashboard/hydraulic/maintenance/${p.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{p.plan_number}</td>
                  <td style={cellStyle}>{p.title}</td>
                  <td style={cellStyle}>
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{p.system_number || '—'}</span>
                    {p.system_name && <span style={{ display: 'block', fontSize: 12, color: TEXT.muted }}>{p.system_name}</span>}
                  </td>
                  <td style={cellStyle}>{MAINTENANCE_TYPE_LABELS[p.maintenance_type] || p.maintenance_type}</td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{frequencyText(p)}</td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                    {p.last_done_date ? formatDate(p.last_done_date) : 'Never'}
                    {p.last_done_hours != null && <span style={{ display: 'block', fontSize: 12, color: TEXT.muted }}>at {p.last_done_hours.toLocaleString('en-IN')} h</span>}
                  </td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}><NextDue p={p} /></td>
                  <td style={cellStyle}>{p.assigned_to_name || '—'}</td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${DUE_HEX[p.due_status]}1a`, color: DUE_HEX[p.due_status], whiteSpace: 'nowrap' }}>
                      {DUE_LABELS[p.due_status] || p.due_status}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                    {p.open_service_record_id ? (
                      <span onClick={() => router.push(`/dashboard/hydraulic/service/${p.open_service_record_id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#2563EB', cursor: 'pointer' }}>Open job</span>
                    ) : p.is_active ? (
                      <span onClick={() => router.push(raiseJobHref(p))} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>Raise job</span>
                    ) : (
                      <span style={{ fontSize: 12, color: TEXT.muted }}>—</span>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(`/dashboard/hydraulic/maintenance/${p.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
