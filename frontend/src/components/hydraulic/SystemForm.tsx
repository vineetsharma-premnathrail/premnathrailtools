'use client'

import { useEffect, useState } from 'react'
import { hydraulicApi } from '@/lib/api'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { HydSystem, HydLookupOption } from '@/types'
import { SheetColumns, SheetSection, SHEET, sheetInput, sheetLabel, sheetHint, Req, Optional, SheetError } from '@/components/shared/FormSheet'
import HydFormShell, { HydShellProps, Cell, fieldRow } from '@/components/hydraulic/HydFormShell'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import OrderProjectPicker, { OrderProjectValue } from '@/components/sales/OrderProjectPicker'
import { SYSTEM_TYPE_LABELS, SYSTEM_TYPE_HEX, SYSTEM_STATUS_LABELS, flowUnit } from '@/components/hydraulic/labels'


const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
const numStr = (v: number | null | undefined) => (v == null ? '' : String(v))

// Numeric fields held as strings while typing, parsed on submit.
type NumKey = 'working' | 'max' | 'flow' | 'reservoir' | 'power' | 'filtration' | 'tempMin' | 'tempMax'

export default function SystemForm({
  initial,
  defaultSystemType,
  submitLabel,
  onSubmit,
  mode, title: shellTitle, subtitle, nav, onBack, onCancel,
}: HydShellProps & {
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
  const [orderProject, setOrderProject] = useState<OrderProjectValue | null>(
    initial?.order_project_id ? { projectId: initial.order_project_id, elementId: initial.order_project_element_id ?? null } : null)
  const [ownerId, setOwnerId] = useState(initial?.owner_id ? String(initial.owner_id) : '')
  const [equipmentRef, setEquipmentRef] = useState(initial?.equipment_ref || '')
  const [nums, setNums] = useState<Record<NumKey, string>>({
    working: numStr(initial?.working_pressure_bar),
    max: numStr(initial?.max_pressure_bar),
    flow: numStr(initial?.flow_rate),
    reservoir: numStr(initial?.reservoir_capacity_l),
    power: numStr(initial?.prime_mover_kw),
    filtration: numStr(initial?.filtration_micron),
    tempMin: numStr(initial?.operating_temp_min_c),
    tempMax: numStr(initial?.operating_temp_max_c),
  })
  const [fluidMedium, setFluidMedium] = useState(initial?.fluid_medium || '')
  const [cleanliness, setCleanliness] = useState(initial?.cleanliness_target || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [remarks, setRemarks] = useState(initial?.remarks || '')

  const [projects, setProjects] = useState<HydLookupOption[]>([])
  const [branches, setBranches] = useState<HydLookupOption[]>([])
  const [users, setUsers] = useState<HydLookupOption[]>([])
  // Role "Assign to" rule (Role & Permissions › Hydraulic & Pneumatic › Systems › System owner); the current owner stays listed.
  const allowOwner = useAssigneeFilter('hydraulic:systems.owner')
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    hydraulicApi.lookupProjects().then(setProjects).catch((err) => setError(extractErrorMessages(err, 'Failed to load ERP projects for the Project picker.')))
    hydraulicApi.lookupBranches().then(setBranches).catch((err) => setError(extractErrorMessages(err, 'Failed to load plants for the Plant picker.')))
    hydraulicApi.lookupUsers().then(setUsers).catch((err) => setError(extractErrorMessages(err, 'Failed to load users for the Owner picker.')))
  }, [])

  const pneumatic = systemType === 'pneumatic'
  const setNum = (k: NumKey, v: string) => setNums((prev) => ({ ...prev, [k]: v }))

  const handleSubmit = async () => {
    setError('')
    if (!name.trim()) { setError('System name is required — e.g. "WDG4 brake actuation unit".'); return }

    const checks: [NumKey, string, boolean][] = [
      ['working', 'Working pressure', false], ['max', 'Max pressure', false], ['flow', 'Flow rate', false],
      ['reservoir', pneumatic ? 'Air receiver volume' : 'Reservoir volume', false], ['power', 'Motor / compressor power', false],
      ['filtration', 'Filtration rating', false], ['tempMin', 'Min operating temperature', true],
      ['tempMax', 'Max operating temperature', true],
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
        order_project_id: orderProject?.projectId ?? null,
        order_project_element_id: orderProject?.elementId ?? null,
        branch_id: branchId ? Number(branchId) : null,
        owner_id: ownerId ? Number(ownerId) : null,
        equipment_ref: equipmentRef.trim() || null,
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
    <div data-tour={`hyd-sys-num-${k}`} style={{ flex: `0 1 ${opts.width || 150}px`, minWidth: (opts.width || 150) - 10 }}>
      <label style={sheetLabel}>{label}</label>
      <input style={sheetInput} type="number" min={opts.allowNegative ? undefined : 0} step="any" value={nums[k]}
        placeholder={opts.placeholder} onChange={(e) => setNum(k, e.target.value)} />
    </div>
  )

  return (
    <HydFormShell
      mode={mode} title={shellTitle} subtitle={subtitle} nav={nav} onBack={onBack} onCancel={onCancel}
      icon={initial ? 'edit' : 'gear'} busy={saving} submitLabel={submitLabel} submitIcon={initial ? 'check' : 'plus'}
      onSubmit={handleSubmit} tour="hyd-sys-form" backTour="hyd-sys-back-btn" submitTour="hyd-sys-save-btn"
    >
      <SheetColumns
        left={<>
          <SheetError error={error} />
          <SheetSection icon="gear" title="System">
            <div style={{ ...fieldRow, marginBottom: 0 }}>
              <Cell tour="hyd-sys-type" basis={140}>
                <label style={sheetLabel}>Type <Req /></label>
                {initial ? (
                  <div style={{ ...sheetInput, background: SHEET.SOFT, color: SYSTEM_TYPE_HEX[initial.system_type], fontWeight: 600 }}>
                    {SYSTEM_TYPE_LABELS[initial.system_type] || initial.system_type}
                  </div>
                ) : (
                  <select style={sheetInput} value={systemType} onChange={(e) => setSystemType(e.target.value)}>
                    {Object.entries(SYSTEM_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                )}
              </Cell>
              <Cell basis={240} grow max={380}>
                <label style={sheetLabel}>Name <Req /></label>
                <input data-tour="hyd-sys-name" style={sheetInput} value={name} onChange={(e) => setName(e.target.value)} maxLength={200}
                  placeholder={pneumatic ? 'Coach door pneumatic unit' : 'Tamping unit hydraulic power pack'} />
              </Cell>
            </div>
            {!initial && <p style={sheetHint}>The system number is generated from the type, and the type can&apos;t be changed later.</p>}
            <div style={{ ...fieldRow, marginTop: 12, marginBottom: 0 }}>
              <Cell basis={200} grow max={300}>
                <label style={sheetLabel}>Application</label>
                <input data-tour="hyd-sys-application" style={sheetInput} value={application} onChange={(e) => setApplication(e.target.value)} maxLength={200}
                  placeholder={pneumatic ? 'Brake / door actuation' : 'Lifting, clamping, steering…'} />
              </Cell>
              <Cell basis={170}>
                <label style={sheetLabel}>Status</label>
                <select data-tour="hyd-sys-status" style={sheetInput} value={status} onChange={(e) => setStatus(e.target.value)}>
                  {Object.entries(SYSTEM_STATUS_LABELS)
                    // 'Under Maintenance' is retired (plan rule R5) — shown only on a record already in that status.
                    .filter(([k]) => k !== 'under_maintenance' || initial?.status === 'under_maintenance')
                    .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Cell>
            </div>
          </SheetSection>

          <SheetSection icon="building" title="Project & Ownership">
            <div style={fieldRow}>
              <Cell tour="hyd-sys-order-project" basis={320} grow>
                <label style={sheetLabel}>Order Project / Vehicle <Optional /></label>
                <OrderProjectPicker value={orderProject} requireElement={false} onChange={(v) => setOrderProject(v)} />
              </Cell>
            </div>
            <div style={fieldRow}>
              <Cell tour="hyd-sys-project" basis={240} grow max={380}>
                <label style={sheetLabel}>ERP Project</label>
                <SearchableSelect value={projectId} onChange={setProjectId} placeholder="Search project…"
                  options={[{ value: '', label: '— No project —' }, ...projects.map((p) => ({ value: String(p.id), label: p.label }))]} />
              </Cell>
              <Cell basis={200} grow max={280}>
                <label style={sheetLabel}>Loco / Machine Serial</label>
                <input data-tour="hyd-sys-equipment-ref" style={sheetInput} value={equipmentRef} onChange={(e) => setEquipmentRef(e.target.value)} maxLength={150} placeholder="Equipment reference" />
              </Cell>
              {/* Location, Commissioned On and Running Hours are retired (plan rule R5 — no monitoring of RRV systems). */}
            </div>
            <div style={{ ...fieldRow, marginBottom: 0 }}>
              <Cell tour="hyd-sys-plant" basis={200} grow max={280}>
                <label style={sheetLabel}>Plant</label>
                <SearchableSelect value={branchId} onChange={setBranchId} placeholder="Search plant…"
                  options={[{ value: '', label: '— No plant —' }, ...branches.map((b) => ({ value: String(b.id), label: b.label }))]} />
              </Cell>
              <Cell tour="hyd-sys-owner" basis={200} grow max={280}>
                <label style={sheetLabel}>Owner</label>
                <SearchableSelect value={ownerId} onChange={setOwnerId} placeholder="Search user…"
                  options={[{ value: '', label: '— Unassigned —' }, ...users.filter((u) => u.id === initial?.owner_id || allowOwner(u.id)).map((u) => ({ value: String(u.id), label: u.label }))]} />
              </Cell>
            </div>
          </SheetSection>

          <SheetSection icon="tool" title={`Design Parameters — ${SYSTEM_TYPE_LABELS[systemType] || systemType}`}>
            <div style={fieldRow}>
              {numInput('working', 'Working Pressure (bar)', { width: 160 })}
              {numInput('max', 'Max Pressure (bar)', { width: 150 })}
              {numInput('flow', `Flow Rate (${flowUnit(systemType)})`, { width: 150 })}
            </div>
            <div style={fieldRow}>
              {numInput('reservoir', pneumatic ? 'Air Receiver Volume (L)' : 'Reservoir Volume (L)', { width: 190 })}
              {numInput('power', 'Motor / Compressor Power (kW)', { width: 220 })}
            </div>
            <div style={fieldRow}>
              <Cell basis={200} grow max={280}>
                <label style={sheetLabel}>Fluid / Medium</label>
                <input data-tour="hyd-sys-fluid" style={sheetInput} value={fluidMedium} onChange={(e) => setFluidMedium(e.target.value)} maxLength={150}
                  placeholder={pneumatic ? 'Compressed air' : 'ISO VG 46 mineral oil'} />
              </Cell>
              {numInput('filtration', 'Filtration (micron)', { width: 150 })}
              <Cell basis={180}>
                <label style={sheetLabel}>Cleanliness Target</label>
                <input data-tour="hyd-sys-cleanliness" style={sheetInput} value={cleanliness} onChange={(e) => setCleanliness(e.target.value)} maxLength={30}
                  placeholder={pneumatic ? '1.4.1 (ISO 8573-1)' : '18/16/13 (ISO 4406)'} />
              </Cell>
            </div>
            <div style={{ ...fieldRow, marginBottom: 0 }}>
              {numInput('tempMin', 'Min Temp (°C)', { width: 120, allowNegative: true })}
              {numInput('tempMax', 'Max Temp (°C)', { width: 120, allowNegative: true })}
            </div>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="list" title="Description" extra={<Optional />}>
            <textarea data-tour="hyd-sys-description" style={{ ...sheetInput, minHeight: 100, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
          </SheetSection>
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea data-tour="hyd-sys-remarks" style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} aria-label="Remarks" />
          </SheetSection>
        </>}
      />
    </HydFormShell>
  )
}