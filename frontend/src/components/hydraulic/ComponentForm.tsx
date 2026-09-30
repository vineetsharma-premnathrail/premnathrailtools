'use client'

import { useEffect, useState } from 'react'
import { hydraulicApi } from '@/lib/api'
import { HydComponent, HydLookupOption } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import {
  COMPONENT_CATEGORY_LABELS, MEDIA_TYPE_LABELS, CATEGORY_FIELDS, DEFAULT_CATEGORY_FIELDS,
} from '@/components/hydraulic/labels'

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
const removeBtn: React.CSSProperties = { ...secondaryBtnStyle, padding: '9px 12px', color: DANGER.primary, borderColor: DANGER.border }

// Rating fields: key → [label, unit, text?]
const RATING_FIELDS: Record<string, [string, string, boolean?]> = {
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
}: {
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
  const [unitCost, setUnitCost] = useState(String(initial?.unit_cost ?? 0))
  const [datasheetUrl, setDatasheetUrl] = useState(initial?.datasheet_url || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [specs, setSpecs] = useState<SpecRow[]>(initial?.specifications.map((s) => ({ key: nextKey(), ...s })) || [])
  const [storeItems, setStoreItems] = useState<HydLookupOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    hydraulicApi.lookupStoreItems().then(setStoreItems).catch((err) => setError(extractErrorMessages(err, 'Failed to load Store items.')))
  }, [])

  const visibleRatings = CATEGORY_FIELDS[category] || DEFAULT_CATEGORY_FIELDS

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save component.'))
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
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Identity</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '0 1 230px', minWidth: 200 }}>
            <label style={labelStyle}>Category *</label>
            {initial ? (
              <div style={{ ...inputStyle, background: 'rgba(0,0,0,0.03)' }}>{COMPONENT_CATEGORY_LABELS[initial.category] || initial.category}</div>
            ) : (
              <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(COMPONENT_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            )}
          </div>
          <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
            <label style={labelStyle}>Name *</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Gear pump 28 cc/rev" maxLength={200} />
          </div>
          <div style={{ flex: '0 1 140px', minWidth: 130 }}>
            <label style={labelStyle}>Medium</label>
            <select style={inputStyle} value={systemType} onChange={(e) => setSystemType(e.target.value)}>
              {Object.entries(MEDIA_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 130px', minWidth: 120 }}>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="obsolete">Obsolete</option>
            </select>
          </div>
        </div>
        {!initial && <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }}>The code is generated from the category (e.g. PMP-0001) and the category can&apos;t be changed later.</p>}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
            <label style={labelStyle}>Manufacturer</label>
            <input style={inputStyle} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="Bosch Rexroth, Parker, Festo…" />
          </div>
          <div style={{ flex: '1 1 180px', maxWidth: 240 }}>
            <label style={labelStyle}>Model Number</label>
            <input style={inputStyle} value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 180px', maxWidth: 240 }}>
            <label style={labelStyle}>Part / Order Number</label>
            <input style={inputStyle} value={partNumber} onChange={(e) => setPartNumber(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 300px', maxWidth: 440 }}>
            <label style={labelStyle}>Linked Store Item</label>
            <SearchableSelect value={storeItemId} onChange={setStoreItemId} placeholder="Search Store item…"
              options={[{ value: '', label: '— Not stocked in Store —' }, ...storeItems.map((i) => ({ value: String(i.id), label: i.label }))]} />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Unit Cost (₹)</label>
            <input style={inputStyle} type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }}>Unit cost drives BOM cost roll-ups.</p>
      </div>

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Ratings — {COMPONENT_CATEGORY_LABELS[category]}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {visibleRatings.map((k) => {
            const [label, unit, isText] = RATING_FIELDS[k]
            return (
              <div key={k} style={isText ? { flex: '1 1 160px', maxWidth: 220 } : { flex: '0 1 150px', minWidth: 140 }}>
                <label style={labelStyle}>{label}{unit ? ` (${unit})` : ''}</label>
                <input
                  style={inputStyle}
                  type={isText ? 'text' : 'number'}
                  min={isText ? undefined : 0}
                  step={isText ? undefined : 'any'}
                  value={ratings[k]}
                  placeholder={k === 'port_size' ? 'G 1/2, SAE 16…' : undefined}
                  onChange={(e) => setRatings({ ...ratings, [k]: e.target.value })}
                />
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
            <label style={labelStyle}>Medium / Fluid</label>
            <input style={inputStyle} value={media} onChange={(e) => setMedia(e.target.value)} placeholder="Mineral oil HLP 46, compressed air…" />
          </div>
          <div style={{ flex: '0 1 120px', minWidth: 110 }}>
            <label style={labelStyle}>Min Temp (°C)</label>
            <input style={inputStyle} type="number" step="any" value={tempMin} onChange={(e) => setTempMin(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 120px', minWidth: 110 }}>
            <label style={labelStyle}>Max Temp (°C)</label>
            <input style={inputStyle} type="number" step="any" value={tempMax} onChange={(e) => setTempMax(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 120px', minWidth: 110 }}>
            <label style={labelStyle}>Weight (kg)</label>
            <input style={inputStyle} type="number" min={0} step="any" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <p style={sectionTitle}>Other Specifications ({specs.length})</p>
          <button type="button" style={secondaryBtnStyle} onClick={() => setSpecs([...specs, { key: nextKey(), label: '', value: '' }])}>+ Add Spec</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {specs.map((s) => (
            <div key={s.key} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input style={{ ...inputStyle, flex: '1 1 180px', maxWidth: 260 }} value={s.label} placeholder="Filtration ratio"
                onChange={(e) => setSpecs(specs.map((x) => (x.key === s.key ? { ...x, label: e.target.value } : x)))} />
              <input style={{ ...inputStyle, flex: '1 1 220px', maxWidth: 340 }} value={s.value} placeholder="β10 ≥ 200"
                onChange={(e) => setSpecs(specs.map((x) => (x.key === s.key ? { ...x, value: e.target.value } : x)))} />
              <button type="button" style={removeBtn} onClick={() => setSpecs(specs.filter((x) => x.key !== s.key))} aria-label="Remove specification">×</button>
            </div>
          ))}
          {specs.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Anything not covered above — solenoid voltage, spool type, filtration ratio, cracking pressure…</p>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 300px', maxWidth: 520 }}>
            <label style={labelStyle}>Datasheet Link</label>
            <input style={inputStyle} value={datasheetUrl} onChange={(e) => setDatasheetUrl(e.target.value)} placeholder="https://…" />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Description</label>
          <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
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
