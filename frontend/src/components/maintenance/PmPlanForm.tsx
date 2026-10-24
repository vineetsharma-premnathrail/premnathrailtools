'use client'

import { useEffect, useState } from 'react'
import { maintenanceApi } from '@/lib/api'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { MaintenanceLookups, MaintenancePmPlan, MaintenanceStoreItemOption } from '@/types'
import { FormPage, SheetSection, SheetIcon, SHEET, Optional, Req, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import MaintenanceAssetPicker from '@/components/maintenance/MaintenanceAssetPicker'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'
import { PM_FREQUENCY_UNIT_LABELS, WO_TYPE_LABELS } from '@/components/maintenance/labels'
import Select from '@/components/shared/Select'

const PM_WO_TYPES = ['preventive', 'calibration', 'inspection']

const rowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 }
const removeBtn: React.CSSProperties = { border: 'none', background: 'none', color: '#DC2626', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: '0 4px' }

const str = (v: unknown) => (v == null ? '' : String(v))

type TaskRow = { key: number; description: string; expected_value: string }
type SpareRow = { key: number; store_item_id: number; item_code: string; item_name: string; uom: string; qty: string; remarks: string }

let rowKey = 0
const nextKey = () => ++rowKey

export default function PmPlanForm({
  initial,
  presetAssetId,
  submitLabel,
  onSubmit,
  title,
  subtitle,
  onBack,
  nav,
  notice,
}: {
  initial?: MaintenancePmPlan | null
  presetAssetId?: number | null
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
  title: string
  subtitle: string
  /** "← Back" pill (top-right) and the footer Cancel. */
  onBack: () => void
  /** Module sub-nav, rendered above the header. */
  nav?: React.ReactNode
  /** Banner shown at the top of the form body. */
  notice?: React.ReactNode
}) {
  const [f, setF] = useState<Record<string, string>>({
    asset_id: str(initial?.asset_id ?? presetAssetId),
    title: str(initial?.title),
    description: str(initial?.description),
    wo_type: initial?.wo_type || 'preventive',
    frequency_unit: initial?.frequency_unit || 'month',
    frequency_value: str(initial?.frequency_value ?? 1),
    schedule_basis: initial?.schedule_basis || 'fixed',
    lead_days: str(initial?.lead_days ?? 3),
    next_due_date: str(initial?.next_due_date),
    estimated_hours: str(initial?.estimated_hours),
    default_assignee_id: str(initial?.default_assignee_id),
    trigger_type: initial?.trigger_type || 'calendar',
    meter_interval: str(initial?.meter_interval),
    lead_meter: str(initial?.lead_meter),
    next_due_meter: str(initial?.next_due_meter),
  })
  const usesMeter = f.trigger_type === 'meter' || f.trigger_type === 'calendar_or_meter'
  const usesCalendar = f.trigger_type !== 'meter'
  const [requiresShutdown, setRequiresShutdown] = useState(!!initial?.requires_shutdown)
  const [isActive, setIsActive] = useState(initial ? initial.is_active : true)
  const [tasks, setTasks] = useState<TaskRow[]>(
    (initial?.tasks || []).map((t) => ({ key: nextKey(), description: t.description, expected_value: t.expected_value || '' })),
  )
  const [spares, setSpares] = useState<SpareRow[]>(
    (initial?.spares || []).map((s) => ({
      key: nextKey(), store_item_id: s.store_item_id, item_code: s.item_code || `#${s.store_item_id}`, item_name: s.item_name || '',
      uom: s.uom || '', qty: String(s.qty), remarks: s.remarks || '',
    })),
  )
  const set = (key: string) => (value: string) => setF((prev) => ({ ...prev, [key]: value }))

  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)
  // Role assign-to rule (core/features/maintenance.py) — the server enforces it on save too.
  const allowTech = useAssigneeFilter('maintenance:schedule.default_assignee')
  const [itemSearch, setItemSearch] = useState('')
  const [itemOptions, setItemOptions] = useState<MaintenanceStoreItemOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    maintenanceApi.getLookups().then(setLookups).catch((err) => setError(extractErrorMessages(err, 'Failed to load technicians.')))
  }, [])

  // New plan: pre-fill lead days from Maintenance › Settings (3 when unchanged
  // or unreadable) unless the user already typed a value.
  useEffect(() => {
    if (initial) return
    let ignore = false
    maintenanceApi.getSettings()
      .then((s) => {
        const v = s.values?.default_pm_lead_days
        if (!ignore && typeof v === 'number') setF((prev) => (prev.lead_days === '3' ? { ...prev, lead_days: String(v) } : prev))
      })
      .catch(() => { /* keep the built-in default of 3 */ })
    return () => { ignore = true }
  }, [initial])

  useEffect(() => {
    const term = itemSearch.trim()
    // Ignore responses for an older term so a slow reply can't overwrite newer results.
    let ignore = false
    const t = setTimeout(() => {
      if (!term) { setItemOptions([]); return }
      maintenanceApi.lookupStoreItems({ search: term })
        .then((data) => { if (!ignore) setItemOptions(data) })
        .catch((err) => { if (!ignore) setError(extractErrorMessages(err, `Search for Store items matching "${term}" failed — check your connection and try again.`)) })
    }, term ? 250 : 0)
    return () => { ignore = true; clearTimeout(t) }
  }, [itemSearch])

  // Editing a plan whose asset the lookup no longer returns (e.g. decommissioned) — keep its label visible.
  const assetFallback = initial ? { id: initial.asset_id, asset_code: initial.asset_code || `#${initial.asset_id}`, name: initial.asset_name || '' } : null

  const addSpare = (it: MaintenanceStoreItemOption) => {
    if (spares.some((s) => s.store_item_id === it.id)) {
      setError(`${it.item_code} is already in the kit — change its quantity instead.`)
      return
    }
    setSpares((prev) => [...prev, { key: nextKey(), store_item_id: it.id, item_code: it.item_code, item_name: it.item_name, uom: it.uom || '', qty: '1', remarks: '' }])
    setItemSearch('')
    setItemOptions([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!f.asset_id) { setError('Pick the asset this plan is for.'); return }
    if (!f.title.trim()) { setError('Give the plan a title, e.g. "Monthly lubrication & oil level check".'); return }
    if (usesCalendar && !f.next_due_date) { setError('Enter the next due date — when the first job falls due.'); return }
    const meterInterval = f.meter_interval.trim() === '' ? null : Number(f.meter_interval)
    if (usesMeter && (meterInterval == null || !(meterInterval > 0))) { setError('Enter the counter interval, e.g. every 500 running hours.'); return }
    const freq = Number(f.frequency_value)
    if (!Number.isInteger(freq) || freq < 1) { setError('Frequency must be a whole number of 1 or more.'); return }
    const lead = Number(f.lead_days)
    if (!Number.isInteger(lead) || lead < 0) { setError('Lead days must be 0 or more.'); return }
    const hrs = f.estimated_hours.trim() === '' ? null : Number(f.estimated_hours)
    if (hrs != null && (Number.isNaN(hrs) || hrs < 0)) { setError('Estimated hours must be a positive number.'); return }
    const cleanTasks = tasks.filter((t) => t.description.trim() || t.expected_value.trim())
    const blank = cleanTasks.findIndex((t) => !t.description.trim())
    if (blank >= 0) { setError(`Checklist line ${blank + 1} has an expected value but no description.`); return }
    for (const s of spares) {
      const q = Number(s.qty)
      if (!q || q <= 0) { setError(`Quantity for ${s.item_code} must be greater than 0.`); return }
    }
    const payload: Record<string, unknown> = {
      asset_id: Number(f.asset_id),
      title: f.title.trim(),
      description: f.description.trim() || null,
      wo_type: f.wo_type,
      frequency_unit: f.frequency_unit,
      frequency_value: freq,
      schedule_basis: f.schedule_basis,
      lead_days: lead,
      next_due_date: usesCalendar ? f.next_due_date : (f.next_due_date || null),
      trigger_type: f.trigger_type,
      meter_interval: usesMeter ? meterInterval : null,
      lead_meter: usesMeter && f.lead_meter.trim() ? Number(f.lead_meter) : null,
      next_due_meter: usesMeter && f.next_due_meter.trim() ? Number(f.next_due_meter) : null,
      estimated_hours: hrs,
      default_assignee_id: f.default_assignee_id ? Number(f.default_assignee_id) : null,
      requires_shutdown: requiresShutdown,
      is_active: isActive,
      tasks: cleanTasks.map((t) => ({ description: t.description.trim(), expected_value: t.expected_value.trim() || null })),
      spares: spares.map((s) => ({ store_item_id: s.store_item_id, qty: Number(s.qty), remarks: s.remarks.trim() || null })),
    }
    setSaving(true)
    try {
      await onSubmit(payload)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save the PM plan.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <FormPage tour="maint-pmf-page" icon={initial ? 'edit' : 'calendar'} title={title} subtitle={subtitle} onBack={onBack} backTour="maint-pmf-back" nav={nav}
        footer={<>
          <button type="button" onClick={onBack} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
          <button data-tour="maint-pmf-submit" type="submit" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
            <SheetIcon name={initial ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : submitLabel}
          </button>
        </>}>
      <div style={{ padding: '20px 24px' }}>
      {notice}
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <SheetSection icon="tool" title="What & Where">
        <div style={rowStyle}>
          <div data-tour="maint-pmf-asset" style={{ flex: '1 1 260px', maxWidth: 380 }}>
            <label style={sheetLabel}>Asset <Req /></label>
            <MaintenanceAssetPicker value={f.asset_id ? Number(f.asset_id) : null} onChange={(v) => set('asset_id')(v != null ? String(v) : '')}
              placeholder="Select machine…" fallbackOption={assetFallback} />
          </div>
          <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
            <label style={sheetLabel}>Title <Req /></label>
            <input data-tour="maint-pmf-title" style={sheetInput} value={f.title} onChange={(e) => set('title')(e.target.value)} placeholder="Monthly lubrication & oil level check" maxLength={255} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={sheetLabel}>Job Type</label>
            <Select data-tour="maint-pmf-type" style={sheetInput} value={f.wo_type} onChange={(e) => set('wo_type')(e.target.value)}>
              {PM_WO_TYPES.map((t) => <option key={t} value={t}>{WO_TYPE_LABELS[t] || t}</option>)}
            </Select>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={sheetLabel}>Instructions</label>
          <textarea data-tour="maint-pmf-instructions" style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={f.description} onChange={(e) => set('description')(e.target.value)}
            placeholder="Safety notes, lock-out steps, reference to the OEM manual…" />
        </div>
      </SheetSection>

      <SheetSection icon="calendar" title="Schedule">
        <div style={{ ...rowStyle, marginBottom: 12 }}>
          <div style={{ flex: '0 1 280px', minWidth: 240 }}>
            <label style={sheetLabel}>Trigger</label>
            <Select style={sheetInput} value={f.trigger_type} onChange={(e) => set('trigger_type')(e.target.value)}>
              <option value="calendar">Calendar (every N days / months)</option>
              <option value="meter">Counter (every N running hours / km)</option>
              <option value="calendar_or_meter">Calendar or counter — whichever first</option>
            </Select>
          </div>
          {usesMeter && (
            <>
              <div style={{ flex: '0 1 150px', minWidth: 130 }}>
                <label style={sheetLabel}>Counter interval <Req /></label>
                <input style={sheetInput} type="number" min={0} value={f.meter_interval} onChange={(e) => set('meter_interval')(e.target.value)} placeholder="500" />
              </div>
              <div style={{ flex: '0 1 150px', minWidth: 130 }}>
                <label style={sheetLabel}>Raise early by</label>
                <input style={sheetInput} type="number" min={0} value={f.lead_meter} onChange={(e) => set('lead_meter')(e.target.value)} placeholder="50" />
              </div>
              <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                <label style={sheetLabel}>Next due at reading</label>
                <input style={sheetInput} type="number" min={0} value={f.next_due_meter} onChange={(e) => set('next_due_meter')(e.target.value)} placeholder="current + interval" />
              </div>
            </>
          )}
        </div>
        {usesMeter && (
          <p style={sheetHint}>Counter plans run on the asset&apos;s main counter (its meter unit). Every reading entered on the asset — or captured when a job is completed — is checked; the job is raised once the counter reaches the due reading minus the early margin, and closing it restarts the counter from the reading at completion.</p>
        )}
        {usesCalendar && <div style={rowStyle}>
          <div data-tour="maint-pmf-frequency" style={{ flex: '0 1 200px', minWidth: 190 }}>
            <label style={sheetLabel}>Every <Req /></label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...sheetInput, width: 70 }} type="number" min={1} step={1} value={f.frequency_value} onChange={(e) => set('frequency_value')(e.target.value)} />
              <Select style={{ ...sheetInput, flex: 1, minWidth: 0 }} value={f.frequency_unit} onChange={(e) => set('frequency_unit')(e.target.value)}>
                {Object.entries(PM_FREQUENCY_UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
          </div>
          <div style={{ flex: '0 1 200px', minWidth: 190 }}>
            <label style={sheetLabel}>Next Due From</label>
            <Select data-tour="maint-pmf-basis" style={sheetInput} value={f.schedule_basis} onChange={(e) => set('schedule_basis')(e.target.value)}>
              <option value="fixed">Due date (fixed calendar)</option>
              <option value="floating">Last completion (floating)</option>
            </Select>
          </div>
          <div data-tour="maint-pmf-next-due" style={{ flex: '0 1 160px', minWidth: 150 }}>
            <label style={sheetLabel}>Next Due Date <Req /></label>
            <DateField value={f.next_due_date} onChange={set('next_due_date')} />
          </div>
          <div style={{ flex: '0 1 120px', minWidth: 110 }}>
            <label style={sheetLabel}>Lead Days</label>
            <input data-tour="maint-pmf-lead-days" style={sheetInput} type="number" min={0} step={1} value={f.lead_days} onChange={(e) => set('lead_days')(e.target.value)} />
          </div>
        </div>}
        {usesCalendar && <p style={sheetHint}>
          {f.schedule_basis === 'fixed'
            ? 'Fixed: the next job is due one interval after the previous DUE date, even if it was done late — the calendar stays steady (e.g. every 1st of the month).'
            : 'Floating: the next job is due one interval after the job was actually DONE — use it when the gap between services matters more than the calendar date.'}
          {' '}The work order is raised {f.lead_days || '0'} day{f.lead_days === '1' ? '' : 's'} before the due date.
        </p>}
      </SheetSection>

      <SheetSection icon="user" title="Who & How Long">
        <div style={rowStyle}>
          <div data-tour="maint-pmf-technician" style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <label style={sheetLabel}>Default Technician</label>
            <SearchableSelect value={f.default_assignee_id} onChange={set('default_assignee_id')} placeholder="Unassigned"
              options={[{ value: '', label: '— Unassigned (planner assigns) —' }, ...(lookups?.technicians || []).filter((t) => allowTech(t.id) || t.id === initial?.default_assignee_id).map((t) => ({ value: String(t.id), label: t.name }))]} />
          </div>
          <div style={{ flex: '0 1 130px', minWidth: 120 }}>
            <label style={sheetLabel}>Est. Hours</label>
            <input data-tour="maint-pmf-est-hours" style={sheetInput} type="number" min={0} step="0.5" value={f.estimated_hours} onChange={(e) => set('estimated_hours')(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8, paddingBottom: 4 }}>
            <label data-tour="maint-pmf-shutdown" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SHEET.BODY, cursor: 'pointer' }}>
              <input type="checkbox" checked={requiresShutdown} onChange={(e) => setRequiresShutdown(e.target.checked)} /> Machine must be stopped
            </label>
            <label data-tour="maint-pmf-active" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SHEET.BODY, cursor: 'pointer' }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Plan is active
            </label>
          </div>
        </div>
        <p style={sheetHint}>
          With a default technician the job is raised as Assigned and they&apos;re notified; without one it&apos;s raised as Draft for the planner to assign.
          {requiresShutdown && ' The machine (and its Production workstation) is blocked only once the technician starts the job.'}
        </p>
      </SheetSection>

      <SheetSection icon="list" title={`Checklist (${tasks.length})`}
        extra={<button data-tour="maint-pmf-add-check" type="button" style={{ ...sheetBtn('ghost'), marginLeft: 'auto' }} onClick={() => setTasks((prev) => [...prev, { key: nextKey(), description: '', expected_value: '' }])}><SheetIcon name="plus" size={14} />Add Check</button>}>
        {tasks.length === 0 ? (
          <p style={{ ...sheetHint, margin: 0 }}>No checks yet. Each line is copied into every work order and the technician marks it OK / Not OK / N/A.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tasks.map((t, idx) => (
              <div key={t.key} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: SHEET.MUTED, width: 22, textAlign: 'right' }}>{idx + 1}.</span>
                <input style={{ ...sheetInput, flex: '1 1 300px', width: 'auto' }} value={t.description} maxLength={500} placeholder="Check hydraulic oil level"
                  onChange={(e) => setTasks((prev) => prev.map((x) => (x.key === t.key ? { ...x, description: e.target.value } : x)))} />
                <input style={{ ...sheetInput, flex: '0 1 200px', width: 'auto' }} value={t.expected_value} maxLength={100} placeholder="Expected (e.g. between marks)"
                  onChange={(e) => setTasks((prev) => prev.map((x) => (x.key === t.key ? { ...x, expected_value: e.target.value } : x)))} />
                <div style={{ display: 'flex', gap: 2 }}>
                  <button type="button" title="Move up" disabled={idx === 0} style={{ ...removeBtn, color: SHEET.MUTED, fontSize: 14 }}
                    onClick={() => setTasks((prev) => { const n = [...prev]; [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]; return n })}>↑</button>
                  <button type="button" title="Remove" style={removeBtn} onClick={() => setTasks((prev) => prev.filter((x) => x.key !== t.key))}>×</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SheetSection>

      <SheetSection icon="box" title={`Spares Kit (${spares.length})`} extra={<Optional />}>
        {spares.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {spares.map((s) => (
              <div key={s.key} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 260px', fontSize: 13, color: SHEET.BODY }}><b>{s.item_code}</b> {s.item_name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input style={{ ...sheetInput, width: 90 }} type="number" min={0} step="any" value={s.qty}
                    onChange={(e) => setSpares((prev) => prev.map((x) => (x.key === s.key ? { ...x, qty: e.target.value } : x)))} />
                  <span style={{ fontSize: 12, color: SHEET.MUTED, minWidth: 32 }}>{s.uom}</span>
                </div>
                <input style={{ ...sheetInput, flex: '0 1 220px', width: 'auto' }} value={s.remarks} maxLength={255} placeholder="Remarks"
                  onChange={(e) => setSpares((prev) => prev.map((x) => (x.key === s.key ? { ...x, remarks: e.target.value } : x)))} />
                <button type="button" title="Remove" style={removeBtn} onClick={() => setSpares((prev) => prev.filter((x) => x.key !== s.key))}>×</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ maxWidth: 520 }}>
          <label style={sheetLabel}>Add a spare from Store</label>
          <input data-tour="maint-pmf-spare-search" style={sheetInput} value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search by item code, name or part number…" />
          {itemSearch.trim() && (
            <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 6, border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
              {itemOptions.length === 0 ? (
                <p style={{ fontSize: 12.5, color: SHEET.MUTED, margin: 0, padding: 10 }}>No matching Store items.</p>
              ) : itemOptions.map((it) => (
                <div key={it.id} onClick={() => addSpare(it)} style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 13, borderTop: `1px solid ${SHEET.LINE}` }}>
                  <b>{it.item_code}</b> {it.item_name}
                  {it.item_type && it.item_type !== 'spare_part' && <span style={{ color: SHEET.MUTED }}> · {it.item_type}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <p style={sheetHint}>
          The kit is copied onto each work order as planned spares at the plant&apos;s default store. Nothing is reserved or issued until the technician issues it on the job.
        </p>
      </SheetSection>

      </div>
      </FormPage>
    </form>
  )
}
