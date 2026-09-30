'use client'

import { useEffect, useMemo, useState } from 'react'
import { hydraulicApi } from '@/lib/api'
import { HydLookupOption, HydServiceRecord } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER, WARNING } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import { SERVICE_TYPE_LABELS } from '@/components/hydraulic/labels'

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
const rowStyle: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', padding: 12, borderRadius: 12,
  border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.45)',
}
const removeBtn: React.CSSProperties = { ...secondaryBtnStyle, padding: '9px 12px', color: DANGER.primary, borderColor: DANGER.border }

// Service types that take the system out of service while the job is open
// (backend HYD_DOWNTIME_SERVICE_TYPES).
export const DOWNTIME_SERVICE_TYPES = ['corrective', 'breakdown', 'overhaul']

interface PartRow { key: number; spare_part_id: string; quantity: string; remarks: string }
let rowKey = 0
const nextKey = () => ++rowKey

/** Local-time yyyy-mm-dd (toISOString would give yesterday before 05:30 IST). */
export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
const numStr = (n: number | null | undefined) => (n == null ? '' : String(n))

export default function ServiceRecordForm({
  initial,
  defaults,
  submitLabel,
  onSubmit,
}: {
  initial?: HydServiceRecord | null
  defaults?: { systemId?: string; planId?: string; serviceType?: string }
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [systemId, setSystemId] = useState(initial ? String(initial.system_id) : defaults?.systemId || '')
  const [planId, setPlanId] = useState(initial?.plan_id ? String(initial.plan_id) : defaults?.planId || '')
  const [serviceType, setServiceType] = useState(initial?.service_type || defaults?.serviceType || 'preventive')
  const [serviceDate, setServiceDate] = useState(initial?.service_date || todayIso())
  const [reportedProblem, setReportedProblem] = useState(initial?.reported_problem || '')
  const [rootCause, setRootCause] = useState(initial?.root_cause || '')
  const [workDone, setWorkDone] = useState(initial?.work_done || '')
  const [checklist, setChecklist] = useState(initial?.checklist || '')
  const [performedBy, setPerformedBy] = useState(initial?.performed_by_id ? String(initial.performed_by_id) : '')
  const [externalAgency, setExternalAgency] = useState(initial?.external_agency || '')
  const [runningHours, setRunningHours] = useState(numStr(initial?.running_hours))
  const [downtimeHours, setDowntimeHours] = useState(initial ? numStr(initial.downtime_hours) : '')
  const [fluidAdded, setFluidAdded] = useState(initial ? numStr(initial.fluid_added_l) : '')
  const [oilCondition, setOilCondition] = useState(initial?.oil_condition || '')
  const [labourCost, setLabourCost] = useState(initial ? numStr(initial.labour_cost) : '')
  const [otherCost, setOtherCost] = useState(initial ? numStr(initial.other_cost) : '')
  const [nextServiceDate, setNextServiceDate] = useState(initial?.next_service_date || '')
  const [remarks, setRemarks] = useState(initial?.remarks || '')
  const [parts, setParts] = useState<PartRow[]>(
    initial?.parts.map((p) => ({ key: nextKey(), spare_part_id: String(p.spare_part_id), quantity: String(p.quantity), remarks: p.remarks || '' })) || [],
  )
  const [systems, setSystems] = useState<HydLookupOption[]>([])
  const [plans, setPlans] = useState<HydLookupOption[]>([])
  const [spares, setSpares] = useState<HydLookupOption[]>([])
  const [users, setUsers] = useState<HydLookupOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!initial) hydraulicApi.lookupSystems().then(setSystems).catch((err) => setError(extractErrorMessages(err, 'Failed to load the system list.')))
    hydraulicApi.lookupSpares().then(setSpares).catch((err) => setError(extractErrorMessages(err, 'Failed to load the spare parts list.')))
    hydraulicApi.lookupUsers().then(setUsers).catch((err) => setError(extractErrorMessages(err, 'Failed to load the user list.')))
  }, [initial])

  // The plan picker only lists the chosen system's active plans; a plan that
  // isn't on the newly picked system is cleared.
  useEffect(() => {
    if (initial || !systemId) return
    let cancelled = false
    hydraulicApi.lookupPlans(Number(systemId))
      .then((rows: HydLookupOption[]) => {
        if (cancelled) return
        setPlans(rows)
        setPlanId((p) => (rows.some((r) => String(r.id) === p) ? p : ''))
      })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load maintenance plans for this system.')))
    return () => { cancelled = true }
  }, [systemId, initial])

  const changeSystem = (v: string) => {
    setSystemId(v)
    if (!v) { setPlans([]); setPlanId('') }
  }

  const spareOptions = useMemo(() => {
    const opts = spares.map((s) => ({ value: String(s.id), label: s.label }))
    // Lines saved earlier may point at a spare since marked obsolete — keep them readable.
    for (const p of initial?.parts || []) {
      if (!spares.some((s) => s.id === p.spare_part_id) && !opts.some((o) => o.value === String(p.spare_part_id))) {
        opts.push({ value: String(p.spare_part_id), label: `${p.part_code || `#${p.spare_part_id}`} — ${p.part_name || 'Spare'} (obsolete)` })
      }
    }
    return opts
  }, [spares, initial])
  const uomOf = (id: string) => spares.find((s) => String(s.id) === id)?.extra || initial?.parts.find((p) => String(p.spare_part_id) === id)?.uom || ''

  const userOptions = useMemo(() => {
    const opts = users.map((u) => ({ value: String(u.id), label: u.label }))
    if (initial?.performed_by_id && !users.some((u) => u.id === initial.performed_by_id)) {
      opts.unshift({ value: String(initial.performed_by_id), label: initial.performed_by_name || `User #${initial.performed_by_id}` })
    }
    return [{ value: '', label: '— Not recorded —' }, ...opts]
  }, [users, initial])

  const updatePart = (key: number, patch: Partial<PartRow>) => setParts((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!initial && !systemId) { setError('Pick the system this service job is for.'); return }
    if (!serviceDate) { setError('Service date is required — pick the date the job was raised or started.'); return }
    if (nextServiceDate && nextServiceDate < serviceDate) { setError('Next service date can’t be before the service date.'); return }
    const numbers: [string, string, boolean][] = [
      ['Running hours', runningHours, true], ['Downtime', downtimeHours, false], ['Fluid added', fluidAdded, false],
      ['Labour cost', labourCost, false], ['Other cost', otherCost, false],
    ]
    for (const [label, v] of numbers) {
      const n = numOrNull(v)
      if (n != null && (Number.isNaN(n) || n < 0)) { setError(`${label} must be zero or more.`); return }
    }
    const filled = parts.filter((r) => r.spare_part_id)
    if (filled.some((r) => !(Number(r.quantity) > 0))) { setError('Every spare line needs a quantity above zero — fix the quantity or remove the line.'); return }
    const ids = filled.map((r) => r.spare_part_id)
    if (new Set(ids).size !== ids.length) { setError('The same spare is listed twice — combine the quantities into one line.'); return }

    setSaving(true)
    try {
      await onSubmit({
        ...(initial ? {} : { system_id: Number(systemId), plan_id: planId ? Number(planId) : null }),
        service_type: serviceType,
        service_date: serviceDate,
        reported_problem: reportedProblem.trim() || null,
        root_cause: rootCause.trim() || null,
        work_done: workDone.trim() || null,
        checklist: checklist.trim() || null,
        performed_by_id: performedBy ? Number(performedBy) : null,
        external_agency: externalAgency.trim() || null,
        running_hours: numOrNull(runningHours),
        // Non-null columns on the backend — blank means zero, not "unset".
        downtime_hours: numOrNull(downtimeHours) ?? 0,
        fluid_added_l: numOrNull(fluidAdded) ?? 0,
        oil_condition: oilCondition.trim() || null,
        labour_cost: numOrNull(labourCost) ?? 0,
        other_cost: numOrNull(otherCost) ?? 0,
        next_service_date: nextServiceDate || null,
        remarks: remarks.trim() || null,
        parts: filled.map((r) => ({ spare_part_id: Number(r.spare_part_id), quantity: Number(r.quantity), remarks: r.remarks.trim() || null })),
      })
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save service record.'))
    } finally {
      setSaving(false)
    }
  }

  const isDowntime = DOWNTIME_SERVICE_TYPES.includes(serviceType)
  const planLabel = initial?.plan_id ? `${initial.plan_number || `#${initial.plan_id}`}${initial.plan_title ? ` — ${initial.plan_title}` : ''}` : '— Not from a plan —'

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Job</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
            <label style={labelStyle}>System *</label>
            {initial ? (
              <div style={{ ...inputStyle, background: 'rgba(0,0,0,0.03)' }}>{initial.system_number} — {initial.system_name}</div>
            ) : (
              <SearchableSelect value={systemId} onChange={changeSystem} placeholder="Search system…"
                options={systems.map((s) => ({ value: String(s.id), label: s.label }))} />
            )}
          </div>
          <div style={{ flex: '1 1 260px', maxWidth: 400 }}>
            <label style={labelStyle}>Maintenance Plan</label>
            {initial ? (
              <div style={{ ...inputStyle, background: 'rgba(0,0,0,0.03)' }}>{planLabel}</div>
            ) : (
              <SearchableSelect value={planId} onChange={setPlanId} placeholder={systemId ? 'Search plan…' : 'Pick a system first'}
                options={[{ value: '', label: '— Not from a plan —' }, ...plans.map((p) => ({ value: String(p.id), label: p.label }))]} />
            )}
          </div>
        </div>
        {!initial && (
          <p style={hintStyle}>
            System and plan can&apos;t be changed after the job is created. Completing a job raised from a plan resets that plan&apos;s next due date.
          </p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '0 1 190px', minWidth: 170 }}>
            <label style={labelStyle}>Service Type</label>
            <select style={inputStyle} value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
              {Object.entries(SERVICE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 160 }}>
            <label style={labelStyle}>Service Date *</label>
            <DateField value={serviceDate} onChange={setServiceDate} />
          </div>
          <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
            <label style={labelStyle}>Performed By</label>
            <SearchableSelect value={performedBy} onChange={setPerformedBy} placeholder="Search person…" options={userOptions} />
          </div>
          <div style={{ flex: '1 1 200px', maxWidth: 300 }}>
            <label style={labelStyle}>External Agency</label>
            <input style={inputStyle} value={externalAgency} onChange={(e) => setExternalAgency(e.target.value)} maxLength={200} placeholder="OEM service engineer, contractor…" />
          </div>
        </div>
        <p style={{ ...hintStyle, color: isDowntime ? WARNING.text : TEXT.muted, fontWeight: isDowntime ? 600 : 400 }}>
          Breakdown, corrective and overhaul jobs mark an in-service system Under Maintenance until the job is completed or cancelled.
        </p>
      </div>

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Findings &amp; Work</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 300px' }}>
            <label style={labelStyle}>Reported Problem</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={reportedProblem} onChange={(e) => setReportedProblem(e.target.value)}
              placeholder="Cylinder drifting under load, pump noisy, pressure not building…" />
          </div>
          <div style={{ flex: '1 1 300px' }}>
            <label style={labelStyle}>Root Cause</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={rootCause} onChange={(e) => setRootCause(e.target.value)}
              placeholder="Worn piston seal, clogged suction strainer…" />
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 300px' }}>
            <label style={labelStyle}>Work Done</label>
            <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={workDone} onChange={(e) => setWorkDone(e.target.value)} />
            <p style={hintStyle}>Required before the job can be completed.</p>
          </div>
          <div style={{ flex: '1 1 300px' }}>
            <label style={labelStyle}>Checklist</label>
            <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={checklist} onChange={(e) => setChecklist(e.target.value)}
              placeholder="One task per line" />
            {!initial && <p style={hintStyle}>Leave blank to copy the maintenance plan&apos;s checklist when the job is created.</p>}
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Readings &amp; Cost</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '0 1 170px', minWidth: 160 }}>
            <label style={labelStyle}>Running Hours (h)</label>
            <input style={inputStyle} type="number" min={0} step="any" value={runningHours} onChange={(e) => setRunningHours(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Downtime (h)</label>
            <input style={inputStyle} type="number" min={0} step="any" value={downtimeHours} onChange={(e) => setDowntimeHours(e.target.value)} placeholder="0" />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Fluid Added (L)</label>
            <input style={inputStyle} type="number" min={0} step="any" value={fluidAdded} onChange={(e) => setFluidAdded(e.target.value)} placeholder="0" />
          </div>
          <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <label style={labelStyle}>Oil / Air Condition</label>
            <input style={inputStyle} value={oilCondition} onChange={(e) => setOilCondition(e.target.value)} maxLength={100} placeholder="ISO 4406 19/17/14, water 200 ppm" />
          </div>
        </div>
        <p style={hintStyle}>Running hours at completion update the system&apos;s hour meter (if higher) and the plan&apos;s last-done hours.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Labour Cost (₹)</label>
            <input style={inputStyle} type="number" min={0} step="0.01" value={labourCost} onChange={(e) => setLabourCost(e.target.value)} placeholder="0" />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Other Cost (₹)</label>
            <input style={inputStyle} type="number" min={0} step="0.01" value={otherCost} onChange={(e) => setOtherCost(e.target.value)} placeholder="0" />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 160 }}>
            <label style={labelStyle}>Next Service Date</label>
            <DateField value={nextServiceDate} onChange={setNextServiceDate} />
          </div>
          <div style={{ flex: '1 1 260px' }}>
            <label style={labelStyle}>Remarks</label>
            <input style={inputStyle} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <p style={sectionTitle}>Spare Parts Used ({parts.filter((r) => r.spare_part_id).length})</p>
          <button type="button" style={secondaryBtnStyle}
            onClick={() => setParts([...parts, { key: nextKey(), spare_part_id: '', quantity: '1', remarks: '' }])}>
            + Add Spare
          </button>
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>
          Unit cost is taken from the spare (or its Store item) when saved. Spares linked to a Store item can be issued from a Store location when the job is completed.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {parts.map((r) => (
            <div key={r.key} style={rowStyle}>
              <div style={{ flex: '1 1 300px', maxWidth: 460 }}>
                <label style={labelStyle}>Spare</label>
                <SearchableSelect value={r.spare_part_id} onChange={(v) => updatePart(r.key, { spare_part_id: v })} options={spareOptions} placeholder="Search spare…" />
              </div>
              <div style={{ flex: '0 1 120px', minWidth: 100 }}>
                <label style={labelStyle}>Qty {uomOf(r.spare_part_id) && `(${uomOf(r.spare_part_id)})`}</label>
                <input style={inputStyle} type="number" min={0} step="any" value={r.quantity} onChange={(e) => updatePart(r.key, { quantity: e.target.value })} />
              </div>
              <div style={{ flex: '1 1 180px', maxWidth: 300 }}>
                <label style={labelStyle}>Remarks</label>
                <input style={inputStyle} value={r.remarks} onChange={(e) => updatePart(r.key, { remarks: e.target.value })} />
              </div>
              <button type="button" style={removeBtn} onClick={() => setParts(parts.filter((x) => x.key !== r.key))} aria-label="Remove spare">×</button>
            </div>
          ))}
          {parts.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No spares on this job yet — add the seal kits, filter elements or hoses used.</p>}
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
