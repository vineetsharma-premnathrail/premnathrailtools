'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { hydraulicApi } from '@/lib/api'
import { HydComponent, HydLookupOption } from '@/types'
import { SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, Req, Optional, SheetError } from '@/components/shared/FormSheet'
import HydFormShell, { HydShellProps, Cell, fieldRow } from '@/components/hydraulic/HydFormShell'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import {
  COMPONENT_CATEGORY_LABELS, MEDIA_TYPE_LABELS, CATEGORY_FIELDS, DEFAULT_CATEGORY_FIELDS, useHydCosts,
} from '@/components/hydraulic/labels'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'

// Rating fields: key → [label, unit, text?]
export const RATING_FIELDS: Record<string, [string, string, boolean?]> = {
  rated_pressure_bar: ['Rated Pressure', 'bar'],
  max_pressure_bar: ['Max / Peak Pressure', 'bar'],
  flow_rate_lpm: ['Flow', 'L/min'],
  displacement_cc: ['Displacement', 'cc/rev'],
  bore_mm: ['Bore', 'mm'],
  rod_mm: ['Rod', 'mm'],
  stroke_mm: ['Stroke', 'mm'],
  port_size: ['Port Size', '', true],
  mounting: ['Mounting', '', true],
  seal_material: ['Seal Material', '', true],
}

interface SpecRow { key: number; label: string; value: string }
let rowKey = 0
const nextKey = () => ++rowKey

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

export default function ComponentForm({
  initial,
  submitLabel,
  onSubmit,
  mode, title: shellTitle, subtitle, nav, onBack, onCancel,
}: HydShellProps & {
  initial?: HydComponent | null
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [name, setName] = useState(initial?.name || '')
  const [category, setCategory] = useState(initial?.category || 'pump')
  const [systemType, setSystemType] = useState<string>(initial?.system_type || 'hydraulic')
  const [status, setStatus] = useState<string>(initial?.status || 'active')
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer || '')
  const [modelNumber, setModelNumber] = useState(initial?.model_number || '')
  const [partNumber, setPartNumber] = useState(initial?.part_number || '')
  const [storeItemId, setStoreItemId] = useState(initial?.store_item_id ? String(initial.store_item_id) : '')
  const [ratings, setRatings] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const k of Object.keys(RATING_FIELDS)) {
      const v = initial ? (initial as unknown as Record<string, unknown>)[k] : null
      out[k] = v == null ? '' : String(v)
    }
    return out
  })
  const [media, setMedia] = useState(initial?.media || '')
  const [tempMin, setTempMin] = useState(initial?.temp_min_c != null ? String(initial.temp_min_c) : '')
  const [tempMax, setTempMax] = useState(initial?.temp_max_c != null ? String(initial.temp_max_c) : '')
  const [weight, setWeight] = useState(initial?.weight_kg != null ? String(initial.weight_kg) : '')
  // Without Hydraulic › BOM › Prices & costs the cost is hidden; the backend ignores it then.
  const seeCosts = useHydCosts()
  const [unitCost, setUnitCost] = useState(String(initial?.unit_cost ?? 0))
  const [datasheetUrl, setDatasheetUrl] = useState(initial?.datasheet_url || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [specs, setSpecs] = useState<SpecRow[]>(initial?.specifications.map((s) => ({ key: nextKey(), ...s })) || [])
  const [storeItems, setStoreItems] = useState<HydLookupOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  const draft = useFormDraft(initial ? null : 'hyd-component-new',
    { name, category, systemType, status, manufacturer, modelNumber, partNumber, storeItemId, ratings, media, tempMin, tempMax, weight, unitCost, datasheetUrl, description, specs },
    (d) => {
      setName(d.name ?? ''); setCategory(d.category || 'pump'); setSystemType(d.systemType || 'hydraulic'); setStatus(d.status || 'active')
      setManufacturer(d.manufacturer ?? ''); setModelNumber(d.modelNumber ?? ''); setPartNumber(d.partNumber ?? ''); setStoreItemId(d.storeItemId ?? '')
      setRatings((prev) => ({ ...prev, ...(d.ratings || {}) })); setMedia(d.media ?? '')
      setTempMin(d.tempMin ?? ''); setTempMax(d.tempMax ?? ''); setWeight(d.weight ?? ''); setUnitCost(d.unitCost ?? '0')
      setDatasheetUrl(d.datasheetUrl ?? ''); setDescription(d.description ?? '')
      setSpecs((d.specs || []).map((s) => ({ ...s, key: nextKey() })))
    })

  useEffect(() => {
    hydraulicApi.lookupStoreItems().then(setStoreItems).catch((err) => setError(extractErrorMessages(err, 'Failed to load Store items.')))
  }, [])

  const visibleRatings = CATEGORY_FIELDS[category] || DEFAULT_CATEGORY_FIELDS

  const handleSubmit = async () => {
    setError('')
    if (!name.trim()) { setError('Component name is required.'); return }
    const numbers: Record<string, number | null> = {}
    for (const k of visibleRatings) {
      const [label, , isText] = RATING_FIELDS[k]
      if (isText) continue
      const n = numOrNull(ratings[k])
      if (n != null && (Number.isNaN(n) || n < 0)) { setError(`${label} must be a positive number.`); return }
      numbers[k] = n
    }
    if (numbers.bore_mm && numbers.rod_mm && numbers.rod_mm >= numbers.bore_mm) { setError('Rod diameter must be smaller than the bore.'); return }
    const cost = Number(unitCost)
    if (Number.isNaN(cost) || cost < 0) { setError('Unit cost must be zero or more.'); return }
    if (specs.some((s) => !s.label.trim() && s.value.trim())) { setError('Every extra specification needs a label — remove empty rows.'); return }

    // Ratings the category doesn't use are cleared, so switching the view
    // never leaves stale hidden values behind.
    const ratingPayload: Record<string, unknown> = {}
    for (const k of Object.keys(RATING_FIELDS)) {
      if (!visibleRatings.includes(k)) { ratingPayload[k] = null; continue }
      ratingPayload[k] = RATING_FIELDS[k][2] ? (ratings[k].trim() || null) : numbers[k]
    }
    setSaving(true)
    try {
      await onSubmit({
        ...(initial ? {} : { category }),
        name: name.trim(),
        system_type: systemType,
        status,
        manufacturer: manufacturer.trim() || null,
        model_number: modelNumber.trim() || null,
        part_number: partNumber.trim() || null,
        store_item_id: storeItemId ? Number(storeItemId) : null,
        ...ratingPayload,
        media: media.trim() || null,
        temp_min_c: numOrNull(tempMin),
        temp_max_c: numOrNull(tempMax),
        weight_kg: numOrNull(weight),
        unit_cost: cost,
        datasheet_url: datasheetUrl.trim() || null,
        description: description.trim() || null,
        specifications: specs.filter((s) => s.label.trim()).map((s) => ({ label: s.label.trim(), value: s.value.trim() })),
      })
      draft.clear()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save component.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <HydFormShell
      mode={mode} title={shellTitle} subtitle={subtitle} nav={nav} onBack={onBack} onCancel={onCancel}
      icon={initial ? 'edit' : 'gear'} busy={saving} submitLabel={submitLabel} submitIcon={initial ? 'check' : 'plus'}
      onSubmit={handleSubmit} tour="hyd-comp-form" backTour="hyd-comp-back-btn" submitTour="hyd-comp-save-btn"
    >
      <SheetColumns
        left={<>
          <SheetError error={error} />
          <DraftBanner draft={draft} />
          <SheetSection icon="tag" title="Identity">
            <div style={{ ...fieldRow, marginBottom: 0 }}>
              <Cell tour="hyd-comp-category" basis={200}>
                <label style={sheetLabel}>Category <Req /></label>
                {initial ? (
                  <div style={{ ...sheetInput, background: SHEET.SOFT }}>{COMPONENT_CATEGORY_LABELS[initial.category] || initial.category}</div>
                ) : (
                  <Select style={sheetInput} value={category} onChange={(e) => setCategory(e.target.value)}>
                    {Object.entries(COMPONENT_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                )}
              </Cell>
              <Cell basis={240} grow max={380}>
                <label style={sheetLabel}>Name <Req /></label>
                <input data-tour="hyd-comp-name" style={sheetInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="Gear pump 28 cc/rev" maxLength={200} />
              </Cell>
              <Cell basis={130}>
                <label style={sheetLabel}>Medium</label>
                <Select data-tour="hyd-comp-medium" style={sheetInput} value={systemType} onChange={(e) => setSystemType(e.target.value)}>
                  {Object.entries(MEDIA_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Cell>
              <Cell basis={120}>
                <label style={sheetLabel}>Status</label>
                <Select data-tour="hyd-comp-status" style={sheetInput} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="active">Active</option>
                  <option value="obsolete">Obsolete</option>
                </Select>
              </Cell>
            </div>
            {!initial && <p style={sheetHint}>The code is generated from the category (e.g. PMP-0001) and the category can&apos;t be changed later.</p>}
          </SheetSection>

          <SheetSection icon="building" title="Make & Stock">
            <div style={fieldRow}>
              <Cell basis={200} grow max={280}>
                <label style={sheetLabel}>Manufacturer</label>
                <input data-tour="hyd-comp-manufacturer" style={sheetInput} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="Bosch Rexroth, Parker, Festo…" />
              </Cell>
              <Cell basis={160} grow max={240}>
                <label style={sheetLabel}>Model Number</label>
                <input data-tour="hyd-comp-model" style={sheetInput} value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} />
              </Cell>
              <Cell basis={160} grow max={240}>
                <label style={sheetLabel}>Part / Order Number</label>
                <input data-tour="hyd-comp-part-number" style={sheetInput} value={partNumber} onChange={(e) => setPartNumber(e.target.value)} />
              </Cell>
            </div>
            <div style={{ ...fieldRow, marginBottom: 0 }}>
              <Cell tour="hyd-comp-store-item" basis={260} grow max={440}>
                <label style={sheetLabel}>Linked Store Item</label>
                <SearchableSelect value={storeItemId} onChange={setStoreItemId} placeholder="Search Store item…"
                  options={[{ value: '', label: '— Not stocked in Store —' }, ...storeItems.map((i) => ({ value: String(i.id), label: i.label }))]} />
              </Cell>
              {seeCosts && <Cell basis={140}>
                <label style={sheetLabel}>Unit Cost (₹)</label>
                <input data-tour="hyd-comp-unit-cost" style={sheetInput} type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
              </Cell>}
            </div>
            {seeCosts && <p style={sheetHint}>Unit cost drives BOM cost roll-ups.</p>}
          </SheetSection>

          <SheetSection icon="gear" title={`Ratings — ${COMPONENT_CATEGORY_LABELS[category] || category}`}>
            <div data-tour="hyd-comp-ratings" style={fieldRow}>
              {visibleRatings.map((k) => {
                const [label, unit, isText] = RATING_FIELDS[k]
                return (
                  <Cell key={k} basis={isText ? 160 : 140} grow={!!isText} max={isText ? 220 : undefined}>
                    <label style={sheetLabel}>{label}{unit ? ` (${unit})` : ''}</label>
                    <input
                      style={sheetInput}
                      type={isText ? 'text' : 'number'}
                      min={isText ? undefined : 0}
                      step={isText ? undefined : 'any'}
                      value={ratings[k]}
                      placeholder={k === 'port_size' ? 'G 1/2, SAE 16…' : undefined}
                      onChange={(e) => setRatings({ ...ratings, [k]: e.target.value })}
                    />
                  </Cell>
                )
              })}
            </div>
            <div style={{ ...fieldRow, marginBottom: 0 }}>
              <Cell basis={200} grow max={280}>
                <label style={sheetLabel}>Medium / Fluid</label>
                <input data-tour="hyd-comp-media" style={sheetInput} value={media} onChange={(e) => setMedia(e.target.value)} placeholder="Mineral oil HLP 46, compressed air…" />
              </Cell>
              <Cell basis={110}>
                <label style={sheetLabel}>Min Temp (°C)</label>
                <input data-tour="hyd-comp-temp-min" style={sheetInput} type="number" step="any" value={tempMin} onChange={(e) => setTempMin(e.target.value)} />
              </Cell>
              <Cell basis={110}>
                <label style={sheetLabel}>Max Temp (°C)</label>
                <input data-tour="hyd-comp-temp-max" style={sheetInput} type="number" step="any" value={tempMax} onChange={(e) => setTempMax(e.target.value)} />
              </Cell>
              <Cell basis={110}>
                <label style={sheetLabel}>Weight (kg)</label>
                <input data-tour="hyd-comp-weight" style={sheetInput} type="number" min={0} step="any" value={weight} onChange={(e) => setWeight(e.target.value)} />
              </Cell>
            </div>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="list" title={`Other Specifications (${specs.length})`} extra={<Optional />}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {specs.map((s) => (
                <div key={s.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input style={{ ...sheetInput, flex: '1 1 0' }} value={s.label} placeholder="Filtration ratio" aria-label="Specification label"
                    onChange={(e) => setSpecs(specs.map((x) => (x.key === s.key ? { ...x, label: e.target.value } : x)))} />
                  <input style={{ ...sheetInput, flex: '1 1 0' }} value={s.value} placeholder="β10 ≥ 200" aria-label="Specification value"
                    onChange={(e) => setSpecs(specs.map((x) => (x.key === s.key ? { ...x, value: e.target.value } : x)))} />
                  <button type="button" style={sheetBtn('ghost', '#b91c1c')} onClick={() => setSpecs(specs.filter((x) => x.key !== s.key))} aria-label="Remove specification"><SheetIcon name="trash" size={15} /></button>
                </div>
              ))}
              {specs.length === 0 && <p style={{ ...sheetHint, margin: 0 }}>Anything not covered on the left — solenoid voltage, spool type, filtration ratio, cracking pressure…</p>}
            </div>
            <button data-tour="hyd-comp-add-spec-btn" type="button" style={{ ...sheetBtn('ghost'), marginTop: 6 }} onClick={() => setSpecs([...specs, { key: nextKey(), label: '', value: '' }])}>
              <SheetIcon name="plus" size={14} />Add Spec
            </button>
          </SheetSection>
          <SheetSection icon="link" title="Datasheet Link" extra={<Optional />}>
            <input data-tour="hyd-comp-datasheet" style={sheetInput} value={datasheetUrl} onChange={(e) => setDatasheetUrl(e.target.value)} placeholder="https://…" aria-label="Datasheet link" />
          </SheetSection>
          <SheetSection icon="chat" title="Description" extra={<Optional />}>
            <textarea data-tour="hyd-comp-description" style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
          </SheetSection>
        </>}
      />
    </HydFormShell>
  )
}