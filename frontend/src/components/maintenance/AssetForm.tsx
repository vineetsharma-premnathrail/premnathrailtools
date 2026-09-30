'use client'

import { useEffect, useMemo, useState } from 'react'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAsset, MaintenanceAssetOption, MaintenanceLookups } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'
import { ASSET_CATEGORY_LABELS, ASSET_STATUS_LABELS, CRITICALITY_LABELS } from '@/components/maintenance/labels'

const MANUAL_STATUSES = ['operational', 'standby', 'decommissioned']

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const rowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 }

const str = (v: unknown) => (v == null ? '' : String(v))

export default function AssetForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: MaintenanceAsset | null
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  const isEdit = !!initial
  const [f, setF] = useState<Record<string, string>>({
    asset_code: str(initial?.asset_code),
    name: str(initial?.name),
    category: initial?.category || 'production_machine',
    criticality: initial?.criticality || 'B',
    status: initial?.status || 'operational',
    branch_id: str(initial?.branch_id),
    department_id: str(initial?.department_id),
    location_text: str(initial?.location_text),
    workstation_id: str(initial?.workstation_id),
    parent_asset_id: str(initial?.parent_asset_id),
    make: str(initial?.make),
    model: str(initial?.model),
    serial_number: str(initial?.serial_number),
    year_of_manufacture: str(initial?.year_of_manufacture),
    supplier_vendor_id: str(initial?.supplier_vendor_id),
    purchase_date: str(initial?.purchase_date),
    purchase_cost: str(initial?.purchase_cost),
    warranty_expiry: str(initial?.warranty_expiry),
    amc_vendor_id: str(initial?.amc_vendor_id),
    amc_expiry: str(initial?.amc_expiry),
    meter_unit: str(initial?.meter_unit),
    current_meter_reading: str(initial?.current_meter_reading),
    commissioned_on: str(initial?.commissioned_on),
    decommissioned_on: str(initial?.decommissioned_on),
    description: str(initial?.description),
    remarks: str(initial?.remarks),
  })
  const set = (key: string) => (value: string) => setF((prev) => ({ ...prev, [key]: value }))
  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)
  const [parents, setParents] = useState<MaintenanceAssetOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    maintenanceApi.getLookups().then(setLookups).catch((err) => setError(extractErrorMessages(err, 'Failed to load plants, vendors and workstations.')))
    maintenanceApi.lookupAssets().then(setParents).catch(() => { /* parent picker is optional */ })
  }, [])

  // System-managed statuses (breakdown / under maintenance) aren't editable
  // here — the form shows them read-only instead of offering them.
  const statusIsSystem = isEdit && !MANUAL_STATUSES.includes(initial!.status)

  const departments = useMemo(
    () => (lookups?.departments || []).filter((d) => !f.branch_id || !d.branch_id || String(d.branch_id) === f.branch_id),
    [lookups, f.branch_id],
  )
  const workstations = useMemo(
    () => (lookups?.workstations || []).filter((w) =>
      (!f.branch_id || !w.branch_id || String(w.branch_id) === f.branch_id)
      && (!w.linked_asset_id || w.linked_asset_id === initial?.id)),
    [lookups, f.branch_id, initial?.id],
  )
  const vendorOptions = [{ value: '', label: '— None —' }, ...(lookups?.vendors || []).map((v) => ({ value: String(v.id), label: v.name }))]

  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!f.name.trim()) { setError('Asset name is required.'); return }
    if (!f.branch_id) { setError('Pick the plant this asset is at.'); return }
    for (const [key, label] of [['purchase_cost', 'Purchase cost'], ['current_meter_reading', 'Meter reading'], ['year_of_manufacture', 'Year of manufacture']] as const) {
      const n = num(f[key])
      if (n != null && (Number.isNaN(n) || n < 0)) { setError(`${label} must be a positive number.`); return }
    }
    const year = num(f.year_of_manufacture)
    if (year != null && (year < 1900 || year > new Date().getFullYear() + 1)) {
      setError(`Year of manufacture ${year} doesn't look right — enter a 4-digit year.`)
      return
    }
    const payload: Record<string, unknown> = {
      asset_code: f.asset_code.trim() || null,
      name: f.name.trim(),
      category: f.category,
      criticality: f.criticality,
      branch_id: Number(f.branch_id),
      department_id: f.department_id ? Number(f.department_id) : null,
      location_text: f.location_text.trim() || null,
      workstation_id: f.workstation_id ? Number(f.workstation_id) : null,
      parent_asset_id: f.parent_asset_id ? Number(f.parent_asset_id) : null,
      make: f.make.trim() || null,
      model: f.model.trim() || null,
      serial_number: f.serial_number.trim() || null,
      year_of_manufacture: year,
      supplier_vendor_id: f.supplier_vendor_id ? Number(f.supplier_vendor_id) : null,
      purchase_date: f.purchase_date || null,
      purchase_cost: num(f.purchase_cost),
      warranty_expiry: f.warranty_expiry || null,
      amc_vendor_id: f.amc_vendor_id ? Number(f.amc_vendor_id) : null,
      amc_expiry: f.amc_expiry || null,
      meter_unit: f.meter_unit.trim() || null,
      current_meter_reading: num(f.current_meter_reading),
      commissioned_on: f.commissioned_on || null,
      description: f.description.trim() || null,
      remarks: f.remarks.trim() || null,
    }
    if (isEdit) {
      if (!payload.asset_code) delete payload.asset_code
      if (!statusIsSystem) payload.status = f.status
      payload.decommissioned_on = f.decommissioned_on || null
    }
    setSaving(true)
    try {
      await onSubmit(payload)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save asset.'))
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
        <p style={sectionTitle}>Identification</p>
        <div style={rowStyle}>
          <div style={{ flex: '0 1 170px', minWidth: 140 }}>
            <label style={labelStyle}>Asset Code</label>
            <input style={inputStyle} value={f.asset_code} onChange={(e) => set('asset_code')(e.target.value.toUpperCase())}
              placeholder={isEdit ? '' : 'Auto (EQ-0001)'} maxLength={50} />
          </div>
          <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
            <label style={labelStyle}>Name *</label>
            <input style={inputStyle} value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder="CNC Lathe — LMW LL20" maxLength={200} />
          </div>
          <div style={{ flex: '0 1 190px', minWidth: 170 }}>
            <label style={labelStyle}>Category</label>
            <select style={inputStyle} value={f.category} onChange={(e) => set('category')(e.target.value)}>
              {Object.entries(ASSET_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Criticality</label>
            <select style={inputStyle} value={f.criticality} onChange={(e) => set('criticality')(e.target.value)}>
              {Object.entries(CRITICALITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {isEdit && (
            <div style={{ flex: '0 1 180px', minWidth: 160 }}>
              <label style={labelStyle}>Status</label>
              {statusIsSystem ? (
                <div style={{ ...inputStyle, background: 'rgba(0,0,0,0.03)', color: TEXT.secondary }} title="Set automatically by open work orders">
                  {ASSET_STATUS_LABELS[initial!.status] || initial!.status}
                </div>
              ) : (
                <select style={inputStyle} value={f.status} onChange={(e) => set('status')(e.target.value)}>
                  {MANUAL_STATUSES.map((s) => <option key={s} value={s}>{ASSET_STATUS_LABELS[s]}</option>)}
                </select>
              )}
            </div>
          )}
        </div>
        {!isEdit && (
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '10px 0 0' }}>
            Use the plant&apos;s existing machine number as the code if it has one. Leave it blank to auto-number.
          </p>
        )}
        {statusIsSystem && (
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '10px 0 0' }}>
            Status is set automatically while a breakdown or work order is open, and returns to Operational when it&apos;s closed.
          </p>
        )}
      </div>

      <div style={sectionStyle}>
        <p style={sectionTitle}>Location</p>
        <div style={rowStyle}>
          <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
            <label style={labelStyle}>Plant *</label>
            <SearchableSelect value={f.branch_id} onChange={(v) => setF((p) => ({ ...p, branch_id: v, department_id: '', workstation_id: '' }))} placeholder="Select plant…"
              options={(lookups?.branches || []).map((b) => ({ value: String(b.id), label: b.name }))} />
          </div>
          {lookups?.departments && (
            <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
              <label style={labelStyle}>Department</label>
              <SearchableSelect value={f.department_id} onChange={set('department_id')} placeholder="Select department…"
                options={[{ value: '', label: '— None —' }, ...departments.map((d) => ({ value: String(d.id), label: d.name }))]} />
            </div>
          )}
          <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
            <label style={labelStyle}>Location in Plant</label>
            <input style={inputStyle} value={f.location_text} onChange={(e) => set('location_text')(e.target.value)} placeholder="Bay 3, Line 2" maxLength={200} />
          </div>
        </div>
        <div style={{ ...rowStyle, marginTop: 14 }}>
          {lookups?.workstations && (
            <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <label style={labelStyle}>Production Workstation</label>
              <SearchableSelect value={f.workstation_id} onChange={set('workstation_id')} placeholder="Not linked"
                options={[{ value: '', label: '— Not linked —' }, ...workstations.map((w) => ({ value: String(w.id), label: `${w.code} — ${w.name}` }))]} />
            </div>
          )}
          <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <label style={labelStyle}>Part Of (Parent Asset)</label>
            <SearchableSelect value={f.parent_asset_id} onChange={set('parent_asset_id')} placeholder="None"
              options={[{ value: '', label: '— None —' }, ...parents.filter((p) => p.id !== initial?.id).map((p) => ({ value: String(p.id), label: `${p.asset_code} — ${p.name}` }))]} />
          </div>
        </div>
        {lookups?.workstations && (
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '10px 0 0' }}>
            Linking a workstation blocks it in Production while this asset is broken down or under maintenance.
          </p>
        )}
      </div>

      <div style={sectionStyle}>
        <p style={sectionTitle}>Make &amp; Purchase</p>
        <div style={rowStyle}>
          <div style={{ flex: '1 1 180px', maxWidth: 240 }}>
            <label style={labelStyle}>Make</label>
            <input style={inputStyle} value={f.make} onChange={(e) => set('make')(e.target.value)} maxLength={100} />
          </div>
          <div style={{ flex: '1 1 180px', maxWidth: 240 }}>
            <label style={labelStyle}>Model</label>
            <input style={inputStyle} value={f.model} onChange={(e) => set('model')(e.target.value)} maxLength={100} />
          </div>
          <div style={{ flex: '1 1 180px', maxWidth: 240 }}>
            <label style={labelStyle}>Serial Number</label>
            <input style={inputStyle} value={f.serial_number} onChange={(e) => set('serial_number')(e.target.value)} maxLength={100} />
          </div>
          <div style={{ flex: '0 1 110px', minWidth: 100 }}>
            <label style={labelStyle}>Year Built</label>
            <input style={inputStyle} type="number" min={1900} value={f.year_of_manufacture} onChange={(e) => set('year_of_manufacture')(e.target.value)} />
          </div>
        </div>
        <div style={{ ...rowStyle, marginTop: 14 }}>
          <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <label style={labelStyle}>Supplier</label>
            <SearchableSelect value={f.supplier_vendor_id} onChange={set('supplier_vendor_id')} placeholder="Select vendor…" options={vendorOptions} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 150 }}>
            <label style={labelStyle}>Purchase Date</label>
            <DateField value={f.purchase_date} onChange={set('purchase_date')} />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 130 }}>
            <label style={labelStyle}>Purchase Cost (₹)</label>
            <input style={inputStyle} type="number" min={0} step="0.01" value={f.purchase_cost} onChange={(e) => set('purchase_cost')(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 150 }}>
            <label style={labelStyle}>Commissioned On</label>
            <DateField value={f.commissioned_on} onChange={set('commissioned_on')} />
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <p style={sectionTitle}>Warranty, AMC &amp; Meter</p>
        <div style={rowStyle}>
          <div style={{ flex: '0 1 160px', minWidth: 150 }}>
            <label style={labelStyle}>Warranty Expiry</label>
            <DateField value={f.warranty_expiry} onChange={set('warranty_expiry')} />
          </div>
          <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <label style={labelStyle}>AMC Vendor</label>
            <SearchableSelect value={f.amc_vendor_id} onChange={set('amc_vendor_id')} placeholder="Select vendor…" options={vendorOptions} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 150 }}>
            <label style={labelStyle}>AMC Expiry</label>
            <DateField value={f.amc_expiry} onChange={set('amc_expiry')} />
          </div>
          <div style={{ flex: '0 1 130px', minWidth: 110 }}>
            <label style={labelStyle}>Meter Unit</label>
            <input style={inputStyle} value={f.meter_unit} onChange={(e) => set('meter_unit')(e.target.value)} placeholder="hours" maxLength={20} />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 130 }}>
            <label style={labelStyle}>Meter Reading</label>
            <input style={inputStyle} type="number" min={0} step="0.1" value={f.current_meter_reading} onChange={(e) => set('current_meter_reading')(e.target.value)} />
          </div>
          {isEdit && f.status === 'decommissioned' && (
            <div style={{ flex: '0 1 170px', minWidth: 160 }}>
              <label style={labelStyle}>Decommissioned On</label>
              <DateField value={f.decommissioned_on} onChange={set('decommissioned_on')} />
            </div>
          )}
        </div>
      </div>

      <div style={sectionStyle}>
        <p style={sectionTitle}>Notes</p>
        <label style={labelStyle}>Description / Technical Specs</label>
        <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={f.description} onChange={(e) => set('description')(e.target.value)}
          placeholder="Capacity, power rating, key specs…" />
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={f.remarks} onChange={(e) => set('remarks')(e.target.value)} />
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
