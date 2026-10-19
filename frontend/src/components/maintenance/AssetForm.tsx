'use client'

import { useEffect, useMemo, useState } from 'react'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAsset, MaintenanceLookups } from '@/types'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, Optional, Req, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import MaintenanceAssetPicker from '@/components/maintenance/MaintenanceAssetPicker'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'
import { ASSET_CATEGORY_LABELS, ASSET_STATUS_LABELS, CRITICALITY_LABELS } from '@/components/maintenance/labels'

const MANUAL_STATUSES = ['operational', 'standby', 'decommissioned']

const rowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 }

const str = (v: unknown) => (v == null ? '' : String(v))

export default function AssetForm({
  initial,
  submitLabel,
  onSubmit,
  title,
  subtitle,
  onBack,
  nav,
}: {
  initial?: MaintenanceAsset | null
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
  title: string
  subtitle: string
  /** "← Back" pill (top-right) and the footer Cancel. */
  onBack: () => void
  /** Module sub-nav, rendered above the header. */
  nav?: React.ReactNode
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
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    maintenanceApi.getLookups().then(setLookups).catch((err) => setError(extractErrorMessages(err, 'Failed to load plants, vendors and workstations.')))
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
      <FormPage tour="maint-af-page" icon={isEdit ? 'edit' : 'gear'} title={title} subtitle={subtitle} onBack={onBack} backTour="maint-af-back" nav={nav}
        footer={<>
          <button type="button" onClick={onBack} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
          <button data-tour="maint-af-submit" type="submit" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
            <SheetIcon name={isEdit ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : submitLabel}
          </button>
        </>}>
        <SheetColumns
          left={<>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

          <SheetSection icon="tag" title="Identification">
        <div style={rowStyle}>
          <div style={{ flex: '0 1 170px', minWidth: 140 }}>
            <label style={sheetLabel}>Asset Code</label>
            <input data-tour="maint-af-code" style={sheetInput} value={f.asset_code} onChange={(e) => set('asset_code')(e.target.value.toUpperCase())}
              placeholder={isEdit ? '' : 'Auto (EQ-0001)'} maxLength={50} />
          </div>
          <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
            <label style={sheetLabel}>Name <Req /></label>
            <input data-tour="maint-af-name" style={sheetInput} value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder="CNC Lathe — LMW LL20" maxLength={200} />
          </div>
          <div style={{ flex: '0 1 190px', minWidth: 170 }}>
            <label style={sheetLabel}>Category</label>
            <select data-tour="maint-af-category" style={sheetInput} value={f.category} onChange={(e) => set('category')(e.target.value)}>
              {Object.entries(ASSET_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={sheetLabel}>Criticality</label>
            <select data-tour="maint-af-criticality" style={sheetInput} value={f.criticality} onChange={(e) => set('criticality')(e.target.value)}>
              {Object.entries(CRITICALITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {isEdit && (
            <div data-tour="maint-af-status" style={{ flex: '0 1 180px', minWidth: 160 }}>
              <label style={sheetLabel}>Status</label>
              {statusIsSystem ? (
                <div style={{ ...sheetInput, background: SHEET.SOFT, color: SHEET.MUTED }} title="Set automatically by open work orders">
                  {ASSET_STATUS_LABELS[initial!.status] || initial!.status}
                </div>
              ) : (
                <select style={sheetInput} value={f.status} onChange={(e) => set('status')(e.target.value)}>
                  {MANUAL_STATUSES.map((s) => <option key={s} value={s}>{ASSET_STATUS_LABELS[s]}</option>)}
                </select>
              )}
            </div>
          )}
        </div>
        {!isEdit && (
          <p style={sheetHint}>
            Use the plant&apos;s existing machine number as the code if it has one. Leave it blank to auto-number.
          </p>
        )}
        {statusIsSystem && (
          <p style={sheetHint}>
            Status is set automatically while a breakdown or work order is open, and returns to Operational when it&apos;s closed.
          </p>
        )}
          </SheetSection>

          <SheetSection icon="building" title="Location">
        <div style={rowStyle}>
          <div data-tour="maint-af-plant" style={{ flex: '1 1 220px', maxWidth: 300 }}>
            <label style={sheetLabel}>Plant <Req /></label>
            <SearchableSelect value={f.branch_id} onChange={(v) => setF((p) => ({ ...p, branch_id: v, department_id: '', workstation_id: '' }))} placeholder="Select plant…"
              options={(lookups?.branches || []).map((b) => ({ value: String(b.id), label: b.name }))} />
          </div>
          {lookups?.departments && (
            <div data-tour="maint-af-department" style={{ flex: '1 1 220px', maxWidth: 300 }}>
              <label style={sheetLabel}>Department</label>
              <SearchableSelect value={f.department_id} onChange={set('department_id')} placeholder="Select department…"
                options={[{ value: '', label: '— None —' }, ...departments.map((d) => ({ value: String(d.id), label: d.name }))]} />
            </div>
          )}
          <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
            <label style={sheetLabel}>Location in Plant</label>
            <input data-tour="maint-af-location" style={sheetInput} value={f.location_text} onChange={(e) => set('location_text')(e.target.value)} placeholder="Bay 3, Line 2" maxLength={200} />
          </div>
        </div>
        <div style={{ ...rowStyle, marginTop: 14 }}>
          {lookups?.workstations && (
            <div data-tour="maint-af-workstation" style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <label style={sheetLabel}>Production Workstation</label>
              <SearchableSelect value={f.workstation_id} onChange={set('workstation_id')} placeholder="Not linked"
                options={[{ value: '', label: '— Not linked —' }, ...workstations.map((w) => ({ value: String(w.id), label: `${w.code} — ${w.name}` }))]} />
            </div>
          )}
          <div data-tour="maint-af-parent" style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <label style={sheetLabel}>Part Of (Parent Asset)</label>
            <MaintenanceAssetPicker value={f.parent_asset_id ? Number(f.parent_asset_id) : null}
              onChange={(v) => set('parent_asset_id')(v != null ? String(v) : '')}
              placeholder="None" clearLabel="— None —" excludeIds={initial?.id ? [initial.id] : undefined}
              fallbackOption={initial?.parent_asset_id ? { id: initial.parent_asset_id, asset_code: initial.parent_asset_code || `#${initial.parent_asset_id}`, name: '' } : null} />
          </div>
        </div>
        {lookups?.workstations && (
          <p style={sheetHint}>
            Linking a workstation blocks it in Production while this asset is broken down or under maintenance.
          </p>
        )}
          </SheetSection>

          <SheetSection icon="cart" title="Make & Purchase">
        <div style={rowStyle}>
          <div style={{ flex: '1 1 180px', maxWidth: 240 }}>
            <label style={sheetLabel}>Make</label>
            <input data-tour="maint-af-make" style={sheetInput} value={f.make} onChange={(e) => set('make')(e.target.value)} maxLength={100} />
          </div>
          <div style={{ flex: '1 1 180px', maxWidth: 240 }}>
            <label style={sheetLabel}>Model</label>
            <input data-tour="maint-af-model" style={sheetInput} value={f.model} onChange={(e) => set('model')(e.target.value)} maxLength={100} />
          </div>
          <div style={{ flex: '1 1 180px', maxWidth: 240 }}>
            <label style={sheetLabel}>Serial Number</label>
            <input data-tour="maint-af-serial" style={sheetInput} value={f.serial_number} onChange={(e) => set('serial_number')(e.target.value)} maxLength={100} />
          </div>
          <div style={{ flex: '0 1 110px', minWidth: 100 }}>
            <label style={sheetLabel}>Year Built</label>
            <input data-tour="maint-af-year" style={sheetInput} type="number" min={1900} value={f.year_of_manufacture} onChange={(e) => set('year_of_manufacture')(e.target.value)} />
          </div>
        </div>
        <div style={{ ...rowStyle, marginTop: 14 }}>
          <div data-tour="maint-af-supplier" style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <label style={sheetLabel}>Supplier</label>
            <SearchableSelect value={f.supplier_vendor_id} onChange={set('supplier_vendor_id')} placeholder="Select vendor…" options={vendorOptions} />
          </div>
          <div data-tour="maint-af-purchase-date" style={{ flex: '0 1 160px', minWidth: 150 }}>
            <label style={sheetLabel}>Purchase Date</label>
            <DateField value={f.purchase_date} onChange={set('purchase_date')} />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 130 }}>
            <label style={sheetLabel}>Purchase Cost (₹)</label>
            <input data-tour="maint-af-purchase-cost" style={sheetInput} type="number" min={0} step="0.01" value={f.purchase_cost} onChange={(e) => set('purchase_cost')(e.target.value)} />
          </div>
          <div data-tour="maint-af-commissioned" style={{ flex: '0 1 160px', minWidth: 150 }}>
            <label style={sheetLabel}>Commissioned On</label>
            <DateField value={f.commissioned_on} onChange={set('commissioned_on')} />
          </div>
        </div>
          </SheetSection>

          <SheetSection icon="shield" title="Warranty, AMC & Meter">
        <div style={rowStyle}>
          <div data-tour="maint-af-warranty" style={{ flex: '0 1 160px', minWidth: 150 }}>
            <label style={sheetLabel}>Warranty Expiry</label>
            <DateField value={f.warranty_expiry} onChange={set('warranty_expiry')} />
          </div>
          <div data-tour="maint-af-amc-vendor" style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <label style={sheetLabel}>AMC Vendor</label>
            <SearchableSelect value={f.amc_vendor_id} onChange={set('amc_vendor_id')} placeholder="Select vendor…" options={vendorOptions} />
          </div>
          <div data-tour="maint-af-amc-expiry" style={{ flex: '0 1 160px', minWidth: 150 }}>
            <label style={sheetLabel}>AMC Expiry</label>
            <DateField value={f.amc_expiry} onChange={set('amc_expiry')} />
          </div>
          <div style={{ flex: '0 1 130px', minWidth: 110 }}>
            <label style={sheetLabel}>Meter Unit</label>
            <input data-tour="maint-af-meter-unit" style={sheetInput} value={f.meter_unit} onChange={(e) => set('meter_unit')(e.target.value)} placeholder="hours" maxLength={20} />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 130 }}>
            <label style={sheetLabel}>Meter Reading</label>
            <input data-tour="maint-af-meter-reading" style={sheetInput} type="number" min={0} step="0.1" value={f.current_meter_reading} onChange={(e) => set('current_meter_reading')(e.target.value)} />
          </div>
          {isEdit && f.status === 'decommissioned' && (
            <div data-tour="maint-af-decommissioned" style={{ flex: '0 1 170px', minWidth: 160 }}>
              <label style={sheetLabel}>Decommissioned On</label>
              <DateField value={f.decommissioned_on} onChange={set('decommissioned_on')} />
            </div>
          )}
        </div>
          </SheetSection>
          </>}
          right={<>
          <SheetSection icon="doc" title="Notes" extra={<Optional />}>
            <label style={sheetLabel}>Description / Technical Specs</label>
            <textarea data-tour="maint-af-description" style={{ ...sheetInput, minHeight: 110, resize: 'vertical' }} value={f.description} onChange={(e) => set('description')(e.target.value)}
              placeholder="Capacity, power rating, key specs…" />
            <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks</label>
            <textarea data-tour="maint-af-remarks" style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={f.remarks} onChange={(e) => set('remarks')(e.target.value)} />
          </SheetSection>
          </>}
        />
      </FormPage>
    </form>
  )
}
