'use client'

import { useEffect, useMemo, useState } from 'react'
import { hydraulicApi } from '@/lib/api'
import { HydLookupOption, HydMaintenancePlan } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import Checkbox from '@/components/Checkbox'
import { extractErrorMessages } from '@/lib/validation'
import { MAINTENANCE_TYPE_LABELS } from '@/components/hydraulic/labels'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }
const hintStyle: React.CSSProperties = { fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }

// Maintenance types that have a matching service-record type; everything
// else is raised as a preventive job.
const PLAN_TO_SERVICE_TYPE: Record<string, string> = { oil_change: 'oil_change', filter_change: 'filter_change' }

/** Link that opens a new service job prefilled from a maintenance plan. */
export function raiseJobHref(plan: Pick<HydMaintenancePlan, 'id' | 'system_id' | 'maintenance_type'>): string {
  const type = PLAN_TO_SERVICE_TYPE[plan.maintenance_type] || 'preventive'
  return `/dashboard/hydraulic/service/new?system_id=${plan.system_id}&plan_id=${plan.id}&type=${type}`
}

/** "every 90 days / 500 h" */
export function frequencyText(plan: Pick<HydMaintenancePlan, 'frequency_days' | 'frequency_hours'>): string {
  const parts: string[] = []
  if (plan.frequency_days) parts.push(`${plan.frequency_days} day${plan.frequency_days === 1 ? '' : 's'}`)
  if (plan.frequency_hours) parts.push(`${plan.frequency_hours.toLocaleString('en-IN')} h`)
  return parts.length ? `every ${parts.join(' / ')}` : '—'
}

/** "in 5 days" / "due today" / "3 days overdue" for a plan's calendar trigger. */
export function daysText(days: number | null | undefined): string {
  if (days == null) return ''
  if (days === 0) return 'due today'
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`
  return `${-days} day${days === -1 ? '' : 's'} overdue`
}

/** "120 h left" / "35 h over" for a plan's running-hours trigger. */
export function hoursText(nextDueHours: number | null | undefined, systemHours: number | null | undefined): string {
  if (nextDueHours == null || systemHours == null) return ''
  const remaining = Math.round((nextDueHours - systemHours) * 10) / 10
  return remaining > 0 ? `${remaining.toLocaleString('en-IN')} h left` : `${(-remaining).toLocaleString('en-IN')} h over`
}

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

export default function MaintenancePlanForm({
  initial,
  defaultSystemId,
  submitLabel,
  onSubmit,
}: {
  initial?: HydMaintenancePlan | null
  defaultSystemId?: string
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [title, setTitle] = useState(initial?.title || '')
  const [systemId, setSystemId] = useState(initial ? String(initial.system_id) : defaultSystemId || '')
  const [maintenanceType, setMaintenanceType] = useState(initial?.maintenance_type || 'preventive')
  const [frequencyDays, setFrequencyDays] = useState(initial?.frequency_days != null ? String(initial.frequency_days) : '')
  const [frequencyHours, setFrequencyHours] = useState(initial?.frequency_hours != null ? String(initial.frequency_hours) : '')
  const [startDate, setStartDate] = useState(initial?.start_date || '')
  const [lastDoneDate, setLastDoneDate] = useState(initial?.last_done_date || '')
  const [lastDoneHours, setLastDoneHours] = useState(initial?.last_done_hours != null ? String(initial.last_done_hours) : '')
  const [assignedTo, setAssignedTo] = useState(initial?.assigned_to_id ? String(initial.assigned_to_id) : '')
  const [checklist, setChecklist] = useState(initial?.checklist || '')
  const [isActive, setIsActive] = useState(initial?.is_active ?? true)
  const [remarks, setRemarks] = useState(initial?.remarks || '')
  const [systems, setSystems] = useState<HydLookupOption[]>([])
  const [users, setUsers] = useState<HydLookupOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!initial) hydraulicApi.lookupSystems().then(setSystems).catch((err) => setError(extractErrorMessages(err, 'Failed to load the system list.')))
    hydraulicApi.lookupUsers().then(setUsers).catch((err) => setError(extractErrorMessages(err, 'Failed to load the user list.')))
  }, [initial])

  const userOptions = useMemo(() => {
    const opts = users.map((u) => ({ value: String(u.id), label: u.extra ? `${u.label} (${u.extra})` : u.label }))
    // Keep a deactivated assignee visible instead of silently blanking the field.
    if (initial?.assigned_to_id && !users.some((u) => u.id === initial.assigned_to_id)) {
      opts.unshift({ value: String(initial.assigned_to_id), label: initial.assigned_to_name || `User #${initial.assigned_to_id}` })
    }
    return [{ value: '', label: '— Unassigned —' }, ...opts]
  }, [users, initial])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!title.trim()) { setError('Title is required — describe the task, e.g. "Replace return-line filter element".'); return }
    if (!initial && !systemId) { setError('Pick the system this maintenance plan belongs to.'); return }
    const days = numOrNull(frequencyDays)
    const hours = numOrNull(frequencyHours)
    if (days == null && hours == null) { setError('Set how often the task repeats — every N days, every N running hours, or both.'); return }
    if (days != null && (!Number.isInteger(days) || days < 1)) { setError('Frequency in days must be a whole number of 1 or more.'); return }
    if (hours != null && (Number.isNaN(hours) || hours <= 0)) { setError('Frequency in running hours must be more than zero.'); return }
    const doneHours = numOrNull(lastDoneHours)
    if (doneHours != null && (Number.isNaN(doneHours) || doneHours < 0)) { setError('Last done at (running hours) must be zero or more.'); return }

    setSaving(true)
    try {
      await onSubmit({
        ...(initial ? {} : { system_id: Number(systemId) }),
        title: title.trim(),
        maintenance_type: maintenanceType,
        frequency_days: days,
        frequency_hours: hours,
        start_date: startDate || null,
        last_done_date: lastDoneDate || null,
        last_done_hours: doneHours,
        assigned_to_id: assignedTo ? Number(assignedTo) : null,
        checklist: checklist.trim() || null,
        is_active: isActive,
        remarks: remarks.trim() || null,
      })
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save maintenance plan.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Task</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} placeholder="Replace return-line filter element" />
          </div>
          <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
            <label style={labelStyle}>System *</label>
            {initial ? (
              <div style={{ ...inputStyle, background: 'rgba(0,0,0,0.03)' }}>{initial.system_number} — {initial.system_name}</div>
            ) : (
              <SearchableSelect value={systemId} onChange={setSystemId} placeholder="Search system…"
                options={systems.map((s) => ({ value: String(s.id), label: s.label }))} />
            )}
          </div>
          <div style={{ flex: '0 1 230px', minWidth: 200 }}>
            <label style={labelStyle}>Maintenance Type</label>
            <select style={inputStyle} value={maintenanceType} onChange={(e) => setMaintenanceType(e.target.value)}>
              {Object.entries(MAINTENANCE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        {!initial && <p style={hintStyle}>The system can&apos;t be changed after the plan is created.</p>}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
            <label style={labelStyle}>Assigned To</label>
            <SearchableSelect value={assignedTo} onChange={setAssignedTo} placeholder="Search person…" options={userOptions} />
          </div>
          <div style={{ flex: '0 1 180px', minWidth: 170, display: 'flex', flexDirection: 'column' }}>
            <label style={labelStyle}>Active</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6 }}>
              <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <span style={{ fontSize: 12.5, color: TEXT.secondary }}>{isActive ? 'Tracked for due dates' : 'Paused'}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 6 }}>Schedule</p>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>
          Set at least one of the two frequencies. With both, the task falls due at whichever comes first.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '0 1 170px', minWidth: 160 }}>
            <label style={labelStyle}>Every N Days</label>
            <input style={inputStyle} type="number" min={1} step={1} value={frequencyDays} onChange={(e) => setFrequencyDays(e.target.value)} placeholder="90" />
          </div>
          <div style={{ flex: '0 1 190px', minWidth: 180 }}>
            <label style={labelStyle}>Every N Running Hours</label>
            <input style={inputStyle} type="number" min={0} step="any" value={frequencyHours} onChange={(e) => setFrequencyHours(e.target.value)} placeholder="500" />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 160 }}>
            <label style={labelStyle}>Start Date</label>
            <DateField value={startDate} onChange={setStartDate} />
          </div>
        </div>
        <p style={hintStyle}>Start date is the first due date if the task has never been done (today when left empty).</p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '0 1 170px', minWidth: 160 }}>
            <label style={labelStyle}>Last Done On</label>
            <DateField value={lastDoneDate} onChange={setLastDoneDate} />
          </div>
          <div style={{ flex: '0 1 200px', minWidth: 190 }}>
            <label style={labelStyle}>Last Done At (Running h)</label>
            <input style={inputStyle} type="number" min={0} step="any" value={lastDoneHours} onChange={(e) => setLastDoneHours(e.target.value)} />
          </div>
        </div>
        <p style={hintStyle}>
          Completing a service job raised from this plan updates these automatically.
          {!initial && ' For an hours-based plan, leaving "last done at" empty starts counting from the system’s current running hours.'}
        </p>
      </div>

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Checklist &amp; Notes</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 340px' }}>
            <label style={labelStyle}>Checklist (one task per line)</label>
            <textarea style={{ ...inputStyle, minHeight: 110, resize: 'vertical' }} value={checklist} onChange={(e) => setChecklist(e.target.value)}
              placeholder={'Drain and flush reservoir\nReplace return filter element\nCheck accumulator pre-charge\nTake oil sample for ISO 4406'} />
            <p style={hintStyle}>Copied onto each service job raised from this plan.</p>
          </div>
          <div style={{ flex: '1 1 280px' }}>
            <label style={labelStyle}>Remarks</label>
            <textarea style={{ ...inputStyle, minHeight: 110, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" disabled={saving} style={{
          padding: '12px 22px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
          background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1,
          boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
        }}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
