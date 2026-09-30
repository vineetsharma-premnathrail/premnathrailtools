'use client'

import { useEffect, useState } from 'react'
import { hydraulicApi } from '@/lib/api'
import { HydSystem, HydLookupOption } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'
import { SYSTEM_TYPE_LABELS, SYSTEM_TYPE_HEX, SYSTEM_STATUS_LABELS, flowUnit } from '@/components/hydraulic/labels'

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

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
const numStr = (v: number | null | undefined) => (v == null ? '' : String(v))

// Numeric fields held as strings while typing, parsed on submit.
type NumKey = 'working' | 'max' | 'flow' | 'reservoir' | 'power' | 'filtration' | 'tempMin' | 'tempMax' | 'hours'

export default function SystemForm({
  initial,
  defaultSystemType,
  submitLabel,
  onSubmit,
}: {
  initial?: HydSystem | null
  defaultSystemType?: 'hydraulic' | 'pneumatic'
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [name, setName] = useState(initial?.name || '')
  const [systemType, setSystemType] = useState<string>(initial?.system_type || defaultSystemType || 'hydraulic')
  const [application, setApplication] = useState(initial?.application || '')
  const [status, setStatus] = useState<string>(initial?.status || 'design')
  const [projectId, setProjectId] = useState(initial?.erp_project_id ? String(initial.erp_project_id) : '')
  const [branchId, setBranchId] = useState(initial?.branch_id ? String(initial.branch_id) : '')
  const [ownerId, setOwnerId] = useState(initial?.owner_id ? String(initial.owner_id) : '')
  const [equipmentRef, setEquipmentRef] = useState(initial?.equipment_ref || '')
  const [location, setLocation] = useState(initial?.location || '')
  const [commissionedOn, setCommissionedOn] = useState(initial?.commissioned_on || '')
  const [nums, setNums] = useState<Record<NumKey, string>>({
    working: numStr(initial?.working_pressure_bar),
    max: numStr(initial?.max_pressure_bar),
    flow: numStr(initial?.flow_rate),
    reservoir: numStr(initial?.reservoir_capacity_l),
    power: numStr(initial?.prime_mover_kw),
    filtration: numStr(initial?.filtration_micron),
    tempMin: numStr(initial?.operating_temp_min_c),
    tempMax: numStr(initial?.operating_temp_max_c),
    hours: initial ? String(initial.running_hours ?? 0) : '0',
  })
  const [fluidMedium, setFluidMedium] = useState(initial?.fluid_medium || '')
  const [cleanliness, setCleanliness] = useState(initial?.cleanliness_target || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [remarks, setRemarks] = useState(initial?.remarks || '')

  const [projects, setProjects] = useState<HydLookupOption[]>([])
  const [branches, setBranches] = useState<HydLookupOption[]>([])
  const [users, setUsers] = useState<HydLookupOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    hydraulicApi.lookupProjects().then(setProjects).catch((err) => setError(extractErrorMessages(err, 'Failed to load ERP projects for the Project picker.')))
    hydraulicApi.lookupBranches().then(setBranches).catch((err) => setError(extractErrorMessages(err, 'Failed to load plants for the Plant picker.')))
    hydraulicApi.lookupUsers().then(setUsers).catch((err) => setError(extractErrorMessages(err, 'Failed to load users for the Owner picker.')))
  }, [])

  const pneumatic = systemType === 'pneumatic'
  const setNum = (k: NumKey, v: string) => setNums((prev) => ({ ...prev, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('System name is required — e.g. "WDG4 brake actuation unit".'); return }

    const checks: [NumKey, string, boolean][] = [
      ['working', 'Working pressure', false], ['max', 'Max pressure', false], ['flow', 'Flow rate', false],
      ['reservoir', pneumatic ? 'Air receiver volume' : 'Reservoir volume', false], ['power', 'Motor / compressor power', false],
      ['filtration', 'Filtration rating', false], ['tempMin', 'Min operating temperature', true],
      ['tempMax', 'Max operating temperature', true], ['hours', 'Running hours', false],
    ]
    const parsed = {} as Record<NumKey, number | null>
    for (const [k, label, allowNegative] of checks) {
      const n = numOrNull(nums[k])
      if (n != null && Number.isNaN(n)) { setError(`${label} must be a number — clear the field or enter a numeric value.`); return }
      if (n != null && !allowNegative && n < 0) { setError(`${label} can't be negative — enter zero or more.`); return }
      parsed[k] = n
    }
    if (parsed.working != null && parsed.max != null && parsed.working > parsed.max) {
      setError(`Working pressure (${parsed.working} bar) can't be higher than the maximum pressure (${parsed.max} bar). Check both values.`)
      return
    }
    if (parsed.tempMin != null && parsed.tempMax != null && parsed.tempMin > parsed.tempMax) {
      setError('Minimum operating temperature is higher than the maximum — swap or correct them.')
      return
    }

    setSaving(true)
    try {
      await onSubmit({
        ...(initial ? {} : { system_type: systemType }),
        name: name.trim(),
        application: application.trim() || null,
        status,
        erp_project_id: projectId ? Number(projectId) : null,
        branch_id: branchId ? Number(branchId) : null,
        owner_id: ownerId ? Number(ownerId) : null,
        equipment_ref: equipmentRef.trim() || null,
        location: location.trim() || null,
        commissioned_on: commissionedOn || null,
        running_hours: parsed.hours ?? 0,
        working_pressure_bar: parsed.working,
        max_pressure_bar: parsed.max,
        flow_rate: parsed.flow,
        reservoir_capacity_l: parsed.reservoir,
        prime_mover_kw: parsed.power,
        fluid_medium: fluidMedium.trim() || null,
        filtration_micron: parsed.filtration,
        cleanliness_target: cleanliness.trim() || null,
        operating_temp_min_c: parsed.tempMin,
        operating_temp_max_c: parsed.tempMax,
        description: description.trim() || null,
        remarks: remarks.trim() || null,
      })
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save system.'))
    } finally {
      setSaving(false)
    }
  }

  const numInput = (k: NumKey, label: string, opts: { width?: number; allowNegative?: boolean; placeholder?: string } = {}) => (
    <div style={{ flex: `0 1 ${opts.width || 150}px`, minWidth: (opts.width || 150) - 10 }}>
      <label style={labelStyle}>{label}</label>
      <input style={inputStyle} type="number" min={opts.allowNegative ? undefined : 0} step="any" value={nums[k]}
        placeholder={opts.placeholder} onChange={(e) => setNum(k, e.target.value)} />
    </div>
  )

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>System</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Type *</label>
            {initial ? (
              <div style={{ ...inputStyle, background: 'rgba(0,0,0,0.03)', color: SYSTEM_TYPE_HEX[initial.system_type], fontWeight: 600 }}>
                {SYSTEM_TYPE_LABELS[initial.system_type] || initial.system_type}
              </div>
            ) : (
              <select style={inputStyle} value={systemType} onChange={(e) => setSystemType(e.target.value)}>
                {Object.entries(SYSTEM_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            )}
          </div>
          <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
            <label style={labelStyle}>Name *</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} maxLength={200}
              placeholder={pneumatic ? 'Coach door pneumatic unit' : 'Tamping unit hydraulic power pack'} />
          </div>
          <div style={{ flex: '1 1 200px', maxWidth: 300 }}>
            <label style={labelStyle}>Application</label>
            <input style={inputStyle} value={application} onChange={(e) => setApplication(e.target.value)} maxLength={200}
              placeholder={pneumatic ? 'Brake / door actuation' : 'Lifting, clamping, steering…'} />
          </div>
          <div style={{ flex: '0 1 180px', minWidth: 170 }}>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(SYSTEM_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        {!initial && <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }}>The system number is generated from the type, and the type can&apos;t be changed later.</p>}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
            <label style={labelStyle}>ERP Project</label>
            <SearchableSelect value={projectId} onChange={setProjectId} placeholder="Search project…"
              options={[{ value: '', label: '— No project —' }, ...projects.map((p) => ({ value: String(p.id), label: p.label }))]} />
          </div>
          <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
            <label style={labelStyle}>Plant</label>
            <SearchableSelect value={branchId} onChange={setBranchId} placeholder="Search plant…"
              options={[{ value: '', label: '— No plant —' }, ...branches.map((b) => ({ value: String(b.id), label: b.label }))]} />
          </div>
          <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
            <label style={labelStyle}>Owner</label>
            <SearchableSelect value={ownerId} onChange={setOwnerId} placeholder="Search user…"
              options={[{ value: '', label: '— Unassigned —' }, ...users.map((u) => ({ value: String(u.id), label: u.label }))]} />
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
            <label style={labelStyle}>Loco / Machine Serial</label>
            <input style={inputStyle} value={equipmentRef} onChange={(e) => setEquipmentRef(e.target.value)} maxLength={150} placeholder="Equipment reference" />
          </div>
          <div style={{ flex: '1 1 200px', maxWidth: 300 }}>
            <label style={labelStyle}>Location</label>
            <input style={inputStyle} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder="Bay / shed / site" />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 160 }}>
            <label style={labelStyle}>Commissioned On</label>
            <DateField value={commissionedOn} onChange={setCommissionedOn} />
          </div>
          {numInput('hours', 'Running Hours', { width: 140 })}
        </div>
      </div>

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Design Parameters — {SYSTEM_TYPE_LABELS[systemType] || systemType}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {numInput('working', 'Working Pressure (bar)', { width: 170 })}
          {numInput('max', 'Max Pressure (bar)', { width: 160 })}
          {numInput('flow', `Flow Rate (${flowUnit(systemType)})`, { width: 160 })}
          {numInput('reservoir', pneumatic ? 'Air Receiver Volume (L)' : 'Reservoir Volume (L)', { width: 190 })}
          {numInput('power', 'Motor / Compressor Power (kW)', { width: 220 })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
            <label style={labelStyle}>Fluid / Medium</label>
            <input style={inputStyle} value={fluidMedium} onChange={(e) => setFluidMedium(e.target.value)} maxLength={150}
              placeholder={pneumatic ? 'Compressed air' : 'ISO VG 46 mineral oil'} />
          </div>
          {numInput('filtration', 'Filtration (micron)', { width: 150 })}
          <div style={{ flex: '0 1 190px', minWidth: 180 }}>
            <label style={labelStyle}>Cleanliness Target</label>
            <input style={inputStyle} value={cleanliness} onChange={(e) => setCleanliness(e.target.value)} maxLength={30}
              placeholder={pneumatic ? '1.4.1 (ISO 8573-1)' : '18/16/13 (ISO 4406)'} />
          </div>
          {numInput('tempMin', 'Min Temp (°C)', { width: 120, allowNegative: true })}
          {numInput('tempMax', 'Max Temp (°C)', { width: 120, allowNegative: true })}
        </div>
      </div>

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Notes</p>
        <div>
          <label style={labelStyle}>Description</label>
          <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
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
