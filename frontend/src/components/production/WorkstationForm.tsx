'use client'

import { useEffect, useState } from 'react'
import { productionApi } from '@/lib/api'
import { ProductionLookupOption, ProductionWorkstation } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import Select from '@/components/shared/Select'

export const WORKSTATION_TYPE_LABELS: Record<string, string> = {
  machine: 'Machine', work_center: 'Work Center', assembly_bay: 'Assembly Bay',
  test_bench: 'Test Bench', paint_booth: 'Paint Booth', other: 'Other',
}

const inputStyle = sheetInput
const labelStyle = sheetLabel

export default function WorkstationForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  cancelTour,
}: {
  initial?: ProductionWorkstation | null
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
  onCancel: () => void
  /** data-tour on the footer Cancel button. */
  cancelTour?: string
}) {
  const [code, setCode] = useState(initial?.code || '')
  const [name, setName] = useState(initial?.name || '')
  const [workstationType, setWorkstationType] = useState<string>(initial?.workstation_type || 'machine')
  const [status, setStatus] = useState<string>(initial?.status || 'active')
  const [branchId, setBranchId] = useState(initial?.branch_id ? String(initial.branch_id) : '')
  const [departmentId, setDepartmentId] = useState(initial?.department_id ? String(initial.department_id) : '')
  const [capacity, setCapacity] = useState(String(initial?.capacity_hours_per_day ?? 8))
  const [rate, setRate] = useState(String(initial?.hourly_rate ?? 0))
  const [description, setDescription] = useState(initial?.description || '')
  const [branches, setBranches] = useState<ProductionLookupOption[]>([])
  const [departments, setDepartments] = useState<ProductionLookupOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    productionApi.lookupBranches().then(setBranches).catch((err) => setError(extractErrorMessages(err, 'Failed to load plants.')))
    productionApi.lookupDepartments().then(setDepartments).catch((err) => setError(extractErrorMessages(err, 'Failed to load departments.')))
  }, [])

  const handleSubmit = async () => {
    setError('')
    if (!code.trim() || !name.trim()) {
      setError('Code and Name are required.')
      return
    }
    const cap = Number(capacity)
    if (Number.isNaN(cap) || cap < 0 || cap > 24) {
      setError('Capacity must be between 0 and 24 hours per day.')
      return
    }
    const hourly = Number(rate)
    if (Number.isNaN(hourly) || hourly < 0) {
      setError('Hourly rate must be zero or more.')
      return
    }
    setSaving(true)
    try {
      await onSubmit({
        code: code.trim(),
        name: name.trim(),
        workstation_type: workstationType,
        status,
        branch_id: branchId ? Number(branchId) : null,
        department_id: departmentId ? Number(departmentId) : null,
        capacity_hours_per_day: cap,
        hourly_rate: hourly,
        description: description.trim() || null,
      })
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save workstation.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet tour="production-ws-form" icon={initial ? 'edit' : 'tool'} title={initial ? `Edit ${initial.code}` : 'New Workstation'}
      subtitle={initial ? `${initial.name} — changes apply to routing, scheduling and costs from now on.` : 'A machine or work center that routing operations run on.'}
      onClose={onCancel} busy={saving}
      footer={<>
        <button data-tour={cancelTour} type="button" onClick={onCancel} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        <button data-tour="production-ws-form-submit-btn" type="button" onClick={handleSubmit} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
          <SheetIcon name={initial ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : submitLabel}
        </button>
      </>}>
      <SheetColumns
        left={<>
          {error && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {Array.isArray(error) ? error.join(' ') : error}
            </div>
          )}
          <SheetSection icon="tool" title="Basic Information">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div data-tour="production-ws-form-code" style={{ flex: '0 1 150px', minWidth: 130 }}>
                <label style={labelStyle}>Code <Req /></label>
                <input style={inputStyle} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WELD-01" maxLength={30} autoFocus={!initial} />
              </div>
              <div data-tour="production-ws-form-name" style={{ flex: '1 1 220px', maxWidth: 340 }}>
                <label style={labelStyle}>Name <Req /></label>
                <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Welding Bay 1" maxLength={150} />
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
              <div data-tour="production-ws-form-type" style={{ flex: '0 1 180px', minWidth: 150 }}>
                <label style={labelStyle}>Type</label>
                <Select style={inputStyle} value={workstationType} onChange={(e) => setWorkstationType(e.target.value)}>
                  {Object.entries(WORKSTATION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </div>
              <div data-tour="production-ws-form-status" style={{ flex: '0 1 190px', minWidth: 160 }}>
                <label style={labelStyle}>Status</label>
                <Select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="active">Active</option>
                  <option value="under_maintenance">Under Maintenance</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </div>
            </div>
          </SheetSection>
          <SheetSection icon="building" title="Location">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div data-tour="production-ws-form-plant" style={{ flex: '1 1 200px', maxWidth: 300 }}>
                <label style={labelStyle}>Plant</label>
                <SearchableSelect value={branchId} onChange={setBranchId} placeholder="Select plant…"
                  options={[{ value: '', label: '— None —' }, ...branches.map((b) => ({ value: String(b.id), label: b.label }))]} />
              </div>
              <div data-tour="production-ws-form-department" style={{ flex: '1 1 200px', maxWidth: 300 }}>
                <label style={labelStyle}>Department</label>
                <SearchableSelect value={departmentId} onChange={setDepartmentId} placeholder="Select department…"
                  options={[{ value: '', label: '— None —' }, ...departments.map((d) => ({ value: String(d.id), label: d.label }))]} />
              </div>
            </div>
          </SheetSection>
          <SheetSection icon="clock" title="Capacity & Cost">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div data-tour="production-ws-form-capacity" style={{ flex: '0 1 160px', minWidth: 140 }}>
                <label style={labelStyle}>Capacity (hrs/day)</label>
                <input style={inputStyle} type="number" min={0} max={24} step="0.5" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
              </div>
              <div data-tour="production-ws-form-rate" style={{ flex: '0 1 160px', minWidth: 140 }}>
                <label style={labelStyle}>Hourly Rate (₹)</label>
                <input style={inputStyle} type="number" min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
              </div>
            </div>
            <p style={sheetHint}>The hourly rate turns hours booked on this workstation into a work order&apos;s labour/machine cost.</p>
          </SheetSection>
        </>}
        right={
          <SheetSection icon="chat" title="Description" extra={<Optional />}>
            <div data-tour="production-ws-form-description">
              <textarea style={{ ...inputStyle, minHeight: 140, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Machine make/model, capabilities, tooling…" />
            </div>
          </SheetSection>
        }
      />
    </FormSheet>
  )
}
