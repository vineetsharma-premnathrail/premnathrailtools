'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydMaintenancePlan, HydServiceRecord } from '@/types'
import { TEXT, DANGER, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import MaintenancePlanForm, { raiseJobHref, frequencyText, daysText, hoursText } from '@/components/hydraulic/MaintenancePlanForm'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { MAINTENANCE_TYPE_LABELS, SERVICE_TYPE_LABELS } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const DUE_LABELS: Record<string, string> = { overdue: 'Overdue', due_soon: 'Due Soon', ok: 'On Track', inactive: 'Inactive' }
const DUE_HEX: Record<string, string> = { overdue: '#DC2626', due_soon: '#F59E0B', ok: '#16A34A', inactive: '#78716c' }
const SERVICE_STATUS_LABELS: Record<string, string> = { open: 'Open', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' }
const SERVICE_STATUS_HEX: Record<string, string> = { open: '#2563EB', in_progress: '#F59E0B', completed: '#16A34A', cancelled: '#78716c' }

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const statLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }
const statValue: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }
const statSub: React.CSSProperties = { fontSize: 12, color: TEXT.secondary, margin: '2px 0 0' }
const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
}

export default function HydMaintenancePlanDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const params = useParams()
  const planId = Number(params.id)

  const [plan, setPlan] = useState<HydMaintenancePlan | null>(null)
  const [history, setHistory] = useState<HydServiceRecord[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !planId) return
    hydraulicApi.getPlan(planId)
      .then(setPlan)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load maintenance plan.')))
    hydraulicApi.listServiceRecords({ plan_id: planId })
      .then((data) => setHistory(Array.isArray(data) ? data : []))
      .catch(() => { /* Service Records tab may be restricted; the plan itself still loads */ })
  }, [isAuthorized, planId])

  const handleDelete = async () => {
    setConfirmDelete(false)
    try {
      await hydraulicApi.deletePlan(planId)
      router.push('/dashboard/hydraulic/maintenance')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete maintenance plan.'))
    }
  }

  if (isLoading || !isAuthorized) return null

  const dueHex = plan ? DUE_HEX[plan.due_status] : '#78716c'

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic · Maintenance Plan
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>{plan ? `${plan.plan_number} — ${plan.title}` : 'Maintenance Plan'}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {plan && (plan.open_service_record_id ? (
            <button type="button" style={primaryBtn} onClick={() => router.push(`/dashboard/hydraulic/service/${plan.open_service_record_id}`)}>Go to Open Job</button>
          ) : plan.is_active ? (
            <button type="button" style={primaryBtn} onClick={() => router.push(raiseJobHref(plan))}>Raise Service Job</button>
          ) : null)}
          {plan && (
            <button type="button" onClick={() => setConfirmDelete(true)} style={{ ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }}>Delete</button>
          )}
          <button onClick={() => router.push('/dashboard/hydraulic/maintenance')} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {saved && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          Maintenance plan saved.
        </div>
      )}

      {plan && (
        <>
          <div style={{ ...cardStyle, borderLeft: `4px solid ${dueHex}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${dueHex}1a`, color: dueHex, whiteSpace: 'nowrap' }}>
                  {DUE_LABELS[plan.due_status] || plan.due_status}
                </span>
                <span style={{ fontSize: 13, color: TEXT.secondary }}>
                  {MAINTENANCE_TYPE_LABELS[plan.maintenance_type] || plan.maintenance_type} · {frequencyText(plan)}
                </span>
              </div>
              <span onClick={() => router.push(`/dashboard/hydraulic/systems/${plan.system_id}`)} style={{ fontSize: 13, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>
                {plan.system_number} — {plan.system_name} →
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28 }}>
              <div style={{ minWidth: 150 }}>
                <p style={statLabel}>Next due (date)</p>
                <p style={{ ...statValue, color: plan.days_to_due != null && plan.due_status !== 'inactive' && plan.days_to_due < 0 ? '#DC2626' : TEXT.heading }}>
                  {plan.next_due_date ? formatDate(plan.next_due_date) : '—'}
                </p>
                <p style={statSub}>{plan.next_due_date ? (plan.due_status === 'inactive' ? 'plan paused' : daysText(plan.days_to_due)) : plan.frequency_days ? '' : 'no calendar trigger'}</p>
              </div>
              <div style={{ minWidth: 150 }}>
                <p style={statLabel}>Next due (hours)</p>
                <p style={statValue}>{plan.next_due_hours != null ? `${plan.next_due_hours.toLocaleString('en-IN')} h` : '—'}</p>
                <p style={statSub}>{plan.next_due_hours != null ? hoursText(plan.next_due_hours, plan.system_running_hours) : 'no running-hours trigger'}</p>
              </div>
              <div style={{ minWidth: 150 }}>
                <p style={statLabel}>System running hours</p>
                <p style={statValue}>{plan.system_running_hours != null ? `${plan.system_running_hours.toLocaleString('en-IN')} h` : '—'}</p>
                <p style={statSub}>updated when a service job records hours</p>
              </div>
              <div style={{ minWidth: 150 }}>
                <p style={statLabel}>Last done</p>
                <p style={statValue}>{plan.last_done_date ? formatDate(plan.last_done_date) : 'Never'}</p>
                <p style={statSub}>{plan.last_done_hours != null ? `at ${plan.last_done_hours.toLocaleString('en-IN')} h` : ''}</p>
              </div>
            </div>
          </div>

          <MaintenancePlanForm
            key={plan.updated_at}
            initial={plan}
            submitLabel="Save Changes"
            onSubmit={async (payload) => {
              setSaved(false)
              const updated = await hydraulicApi.updatePlan(planId, payload)
              setPlan(updated)
              setSaved(true)
            }}
          />

          <div style={{ ...cardStyle, marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Service History ({history.length})</h2>
            </div>
            {history.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No service jobs raised from this plan yet. Completing one resets the plan&apos;s last-done date and hours.</p>
            ) : history.map((r) => (
              <div key={r.id} onClick={() => router.push(`/dashboard/hydraulic/service/${r.id}`)}
                style={{ display: 'flex', gap: 12, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer', flexWrap: 'wrap', fontSize: 13, alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: TEXT.heading, minWidth: 120 }}>{r.record_number}</span>
                <span style={{ color: TEXT.secondary, minWidth: 90 }}>{formatDate(r.completed_on || r.service_date)}</span>
                <span style={{ flex: '1 1 200px', color: TEXT.body }}>
                  {SERVICE_TYPE_LABELS[r.service_type] || r.service_type}
                  {r.performed_by_name || r.external_agency ? ` · ${r.performed_by_name || r.external_agency}` : ''}
                </span>
                <span style={{ color: TEXT.secondary, minWidth: 90 }}>₹{r.total_cost.toLocaleString('en-IN')}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${SERVICE_STATUS_HEX[r.status]}1a`, color: SERVICE_STATUS_HEX[r.status], whiteSpace: 'nowrap' }}>
                  {SERVICE_STATUS_LABELS[r.status] || r.status}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete maintenance plan?"
        message={`${plan?.plan_number} will stop appearing in the due list. Service jobs already raised from it keep their history.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
