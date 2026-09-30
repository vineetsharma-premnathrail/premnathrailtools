'use client'

import { useEffect, useState } from 'react'
import { productionApi } from '@/lib/api'
import { ProductionLookupOption, ProductionWorkstation } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'

export const WORKSTATION_TYPE_LABELS: Record<string, string> = {
  machine: 'Machine', work_center: 'Work Center', assembly_bay: 'Assembly Bay',
  test_bench: 'Test Bench', paint_booth: 'Paint Booth', other: 'Other',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function WorkstationForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: ProductionWorkstation | null
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
    <form onSubmit={handleSubmit}>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '0 1 150px', minWidth: 130 }}>
            <label style={labelStyle}>Code *</label>
            <input style={inputStyle} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WELD-01" maxLength={30} />
          </div>
          <div style={{ flex: '1 1 240px', maxWidth: 340 }}>
            <label style={labelStyle}>Name *</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Welding Bay 1" maxLength={150} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Type</label>
            <select style={inputStyle} value={workstationType} onChange={(e) => setWorkstationType(e.target.value)}>
              {Object.entries(WORKSTATION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 180px', minWidth: 160 }}>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="under_maintenance">Under Maintenance</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
            <label style={labelStyle}>Plant</label>
            <SearchableSelect value={branchId} onChange={setBranchId} placeholder="Select plant…"
              options={[{ value: '', label: '— None —' }, ...branches.map((b) => ({ value: String(b.id), label: b.label }))]} />
          </div>
          <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
            <label style={labelStyle}>Department</label>
            <SearchableSelect value={departmentId} onChange={setDepartmentId} placeholder="Select department…"
              options={[{ value: '', label: '— None —' }, ...departments.map((d) => ({ value: String(d.id), label: d.label }))]} />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Capacity (hrs/day)</label>
            <input style={inputStyle} type="number" min={0} max={24} step="0.5" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Hourly Rate (₹)</label>
            <input style={inputStyle} type="number" min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Description</label>
          <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Machine make/model, capabilities, tooling…" />
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '10px 0 0' }}>
          The hourly rate turns hours booked on this workstation into a work order&apos;s labour/machine cost.
        </p>
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
