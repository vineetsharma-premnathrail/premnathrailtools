'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenancePmPlan } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, dangerBtnStyle, InfoRow } from '@/components/shared/ui'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { PM_DUE_STATE_LABELS, PM_SCHEDULE_BASIS_LABELS, WO_STATUS_LABELS, WO_TYPE_LABELS } from '@/components/maintenance/labels'
import { useCan } from '@/lib/permissions'

const DUE_HEX: Record<string, string> = { overdue: '#DC2626', due_soon: '#F59E0B', scheduled: '#2563EB', inactive: '#78716c' }
const WO_STATUS_HEX: Record<string, string> = { draft: '#78716c', assigned: '#2563EB', in_progress: '#F59E0B', on_hold: '#9333EA', completed: '#16A34A', closed: '#0f766e', cancelled: '#78716c' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

function Pill({ hex, label }: { hex: string; label: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{label}</span>
  )
}

export default function PmPlanDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const { can, canDelete } = useCan()
  const router = useRouter()
  const params = useParams()
  const ref = params.id as string
  const { id: resolvedId, error: linkError } = useRecordId(ref)
  const id = resolvedId ?? 0
  const [plan, setPlan] = useState<MaintenancePmPlan | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'' | 'delete' | 'generate' | 'toggle'>('')

  useEffect(() => {
    if (!isAuthorized || !id) return
    maintenanceApi.getPmPlan(id).then(setPlan).catch((err) => setError(extractErrorMessages(err, 'Failed to load the PM plan.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, id])

  const run = async (kind: 'delete' | 'generate' | 'toggle') => {
    if (!plan) return
    setConfirm('')
    setError('')
    setNotice('')
    setBusy(true)
    try {
      if (kind === 'delete') {
        await maintenanceApi.deletePmPlan(id)
        router.push('/dashboard/maintenance/schedule')
        return
      }
      if (kind === 'generate') {
        const updated = await maintenanceApi.generatePmNow(id)
        setPlan(updated)
        setNotice(updated.open_work_order_number ? `${updated.open_work_order_number} raised for the ${formatDate(updated.next_due_date)} due date.` : 'Work order raised.')
      } else {
        const updated = await maintenanceApi.updatePmPlan(id, { is_active: !plan.is_active })
        setPlan(updated)
        setNotice(updated.is_active ? `${updated.plan_code} is active again — the scheduler will raise its jobs.` : `${updated.plan_code} deactivated — no new jobs will be raised.`)
      }
    } catch (err) {
      setError(extractErrorMessages(err, 'The action failed.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><MaintenanceNav /><InvalidRecordLink message={linkError} listHref="/dashboard/maintenance/schedule" listLabel="Back to PM schedule" /></div>)
  if (!id) return <div><MaintenanceNav /></div>

  const dueState = plan?.due_state || 'scheduled'

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Preventive Maintenance Plan
          </p>
          <h1 data-tour="maint-pmd-status" style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {plan ? `${plan.plan_code} — ${plan.title}` : 'PM Plan'}
            {plan && <Pill hex={DUE_HEX[dueState] || '#78716c'} label={PM_DUE_STATE_LABELS[dueState] || dueState} />}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {plan && can('maintenance', 'schedule', 'create') && plan.is_active && !plan.open_work_order_id && (
            <button data-tour="maint-pmd-generate-btn" type="button" disabled={busy} onClick={() => setConfirm('generate')} style={{
              padding: '9px 18px', borderRadius: 12, border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
              background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600, opacity: busy ? 0.7 : 1,
            }}>Generate Now</button>
          )}
          {plan && can('maintenance', 'schedule', 'edit') && <button data-tour="maint-pmd-edit-btn" type="button" onClick={() => router.push(`/dashboard/maintenance/schedule/${ref}/edit`)} style={secondaryBtnStyle}>Edit</button>}
          {plan && can('maintenance', 'schedule', 'edit') && <button data-tour="maint-pmd-toggle-btn" type="button" disabled={busy} onClick={() => setConfirm('toggle')} style={secondaryBtnStyle}>{plan.is_active ? 'Deactivate' : 'Activate'}</button>}
          {plan && canDelete('maintenance', 'schedule', (plan as { created_by_id?: number | null } | null)?.created_by_id ?? null) && <button data-tour="maint-pmd-delete-btn" type="button" disabled={busy} onClick={() => setConfirm('delete')} style={dangerBtnStyle}>Delete</button>}
          <button data-tour="maint-pmd-back" type="button" onClick={() => router.push('/dashboard/maintenance/schedule')} style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {notice && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          {notice}
        </div>
      )}

      {!plan && !error && loading && (
        <div style={{ ...sectionStyle, fontSize: 13, color: TEXT.muted }}>Loading PM plan…</div>
      )}

      {plan && plan.open_work_order_id && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.2)', color: '#1d4ed8', fontSize: 13 }}>
          Current job:{' '}
          <span onClick={() => router.push(recordPath('/dashboard/maintenance/work-orders', plan, 'open_work_order_id'))} style={{ fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
            {plan.open_work_order_number}
          </span>{' '}
          ({WO_STATUS_LABELS[plan.open_work_order_status || ''] || plan.open_work_order_status}). The next one is raised after it&apos;s closed.
        </div>
      )}

      {plan && (
        <>
          <div data-tour="maint-pmd-plan" style={sectionStyle}>
            <p style={sectionTitle}>Plan</p>
            <div style={gridStyle}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Asset</p>
                <span onClick={() => router.push(recordPath('/dashboard/maintenance/assets', plan, 'asset_id'))} style={{ fontSize: 13.5, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>
                  {plan.asset_code} — {plan.asset_name}
                </span>
              </div>
              <InfoRow label="Plant" value={plan.branch_name || '—'} />
              <InfoRow label="Job Type" value={WO_TYPE_LABELS[plan.wo_type] || plan.wo_type} />
              <InfoRow label="Frequency" value={plan.frequency_label || `${plan.frequency_value} ${plan.frequency_unit}`} />
              <InfoRow label="Next Due From" value={PM_SCHEDULE_BASIS_LABELS[plan.schedule_basis] || plan.schedule_basis} />
              <InfoRow label="Next Due" value={plan.trigger_type === 'meter' ? 'By counter' : formatDate(plan.next_due_date)} />
              {plan.next_due_meter != null && <InfoRow label="Due at counter" value={`${plan.next_due_meter} ${plan.meter_unit || ''} (now ${plan.current_meter_reading ?? '—'}${plan.last_done_meter != null ? `, last done ${plan.last_done_meter}` : ''})`} />}
              <InfoRow label="Raised" value={`${plan.lead_days} day${plan.lead_days === 1 ? '' : 's'} before due`} />
              <InfoRow label="Last Done" value={plan.last_done_date ? `${formatDate(plan.last_done_date)}${plan.last_work_order_number ? ` (${plan.last_work_order_number})` : ''}` : 'Never'} />
              <InfoRow label="Default Technician" value={plan.default_assignee_name || 'Unassigned'} />
              <InfoRow label="Est. Hours" value={plan.estimated_hours != null ? String(plan.estimated_hours) : '—'} />
              <InfoRow label="Machine Stop" value={plan.requires_shutdown ? 'Yes — blocked while the job runs' : 'No'} />
              <InfoRow label="Status" value={plan.is_active ? 'Active' : 'Inactive'} />
            </div>
            {plan.description && (
              <div style={{ marginTop: 16 }}>
                <InfoRow label="Instructions" value={plan.description} />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div data-tour="maint-pmd-checklist" style={{ ...sectionStyle, flex: '1 1 420px', padding: 0, overflow: 'auto' }}>
              <p style={{ ...sectionTitle, padding: '16px 20px 0' }}>Checklist ({plan.tasks.length})</p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['#', 'Check', 'Expected'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {plan.tasks.length === 0 ? (
                    <tr><td colSpan={3} style={{ ...cellStyle, textAlign: 'center', color: TEXT.muted }}>No checklist — add checks via Edit.</td></tr>
                  ) : plan.tasks.map((t, i) => (
                    <tr key={t.id}>
                      <td style={{ ...cellStyle, width: 36, color: TEXT.muted }}>{i + 1}</td>
                      <td style={cellStyle}>{t.description}</td>
                      <td style={cellStyle}>{t.expected_value || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div data-tour="maint-pmd-spares" style={{ ...sectionStyle, flex: '1 1 340px', padding: 0, overflow: 'auto' }}>
              <p style={{ ...sectionTitle, padding: '16px 20px 0' }}>Spares Kit ({plan.spares.length})</p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Item', 'Qty', 'Remarks'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {plan.spares.length === 0 ? (
                    <tr><td colSpan={3} style={{ ...cellStyle, textAlign: 'center', color: TEXT.muted }}>No spares kit.</td></tr>
                  ) : plan.spares.map((s) => (
                    <tr key={s.id}>
                      <td style={cellStyle}><b>{s.item_code}</b> {s.item_name}</td>
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{s.qty} {s.uom || ''}</td>
                      <td style={cellStyle}>{s.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div data-tour="maint-pmd-wos" style={{ ...sectionStyle, padding: 0, overflow: 'auto' }}>
            <p style={{ ...sectionTitle, padding: '16px 20px 0' }}>Work Orders From This Plan</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead><tr>{['Number', 'Due', 'Technician', 'Done', 'On Time', 'Status'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {plan.recent_work_orders.length === 0 ? (
                  <tr><td colSpan={6} style={{ ...cellStyle, textAlign: 'center', color: TEXT.muted }}>
                    None yet. The first job is raised {plan.lead_days} day{plan.lead_days === 1 ? '' : 's'} before {formatDate(plan.next_due_date)}, or now with Generate Now.
                  </td></tr>
                ) : plan.recent_work_orders.map((w) => (
                  <tr key={w.id} onClick={() => router.push(recordPath('/dashboard/maintenance/work-orders', w))} style={{ cursor: 'pointer' }}>
                    <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading }}>{w.wo_number}</td>
                    <td style={cellStyle}>{formatDate(w.pm_due_date)}</td>
                    <td style={cellStyle}>{w.assigned_to_name || '—'}</td>
                    <td style={cellStyle}>{formatDate(w.actual_end)}</td>
                    <td style={cellStyle}>
                      {w.on_time == null ? '—' : w.on_time ? <span style={{ color: '#16A34A', fontWeight: 600 }}>Yes</span> : <span style={{ color: '#DC2626', fontWeight: 600 }}>Late</span>}
                    </td>
                    <td style={cellStyle}><Pill hex={WO_STATUS_HEX[w.status] || '#78716c'} label={WO_STATUS_LABELS[w.status] || w.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete PM plan?"
        message={plan ? `${plan.plan_code} will be removed and no more jobs raised from it. Work orders already generated stay on record.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={() => run('delete')}
        onCancel={() => setConfirm('')}
      />
      <ConfirmDialog
        open={confirm === 'generate'}
        title="Raise the work order now?"
        message={plan ? `A work order for the ${formatDate(plan.next_due_date)} due date will be raised now${plan.default_assignee_name ? ` and assigned to ${plan.default_assignee_name}` : ' as a draft for you to assign'}.` : ''}
        confirmLabel="Generate"
        onConfirm={() => run('generate')}
        onCancel={() => setConfirm('')}
      />
      <ConfirmDialog
        open={confirm === 'toggle'}
        title={plan?.is_active ? 'Deactivate PM plan?' : 'Activate PM plan?'}
        message={plan ? (plan.is_active
          ? `The scheduler stops raising jobs for ${plan.plan_code}. Any job already open stays open.`
          : `The scheduler will raise ${plan.plan_code}'s next job (due ${formatDate(plan.next_due_date)}). Check the due date first if the plan was off for a while.`) : ''}
        confirmLabel={plan?.is_active ? 'Deactivate' : 'Activate'}
        onConfirm={() => run('toggle')}
        onCancel={() => setConfirm('')}
      />
    </div>
  )
}
