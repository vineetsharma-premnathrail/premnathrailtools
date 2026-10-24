'use client'

// Material master plant views (SAP MM01 Plant / MRP views): planning data per
// plant — reorder / safety / min / max stock, lead time, default store, MRP
// type and make/buy. A plant with no row uses the Item Master fields above.
import { useEffect, useState } from 'react'
import { itemPlantsApi, ItemPlantRow, ItemPlantsPayload } from '@/lib/mmLogisticsApi'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT } from '@/lib/theme'
import { Section, inputStyle, secondaryBtnStyle, smallSecondaryBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput } from '@/components/shared/FormSheet'
import Select from '@/components/shared/Select'

const NUM_FIELDS: { key: keyof ItemPlantRow; label: string; width: number }[] = [
  { key: 'reorder_level', label: 'Reorder level', width: 90 },
  { key: 'safety_stock', label: 'Safety stock', width: 90 },
  { key: 'minimum_stock', label: 'Min', width: 70 },
  { key: 'maximum_stock', label: 'Max', width: 70 },
  { key: 'reorder_quantity', label: 'Reorder qty', width: 85 },
  { key: 'lead_time_days', label: 'Purchase days', width: 85 },
  { key: 'inhouse_production_days', label: 'Make days', width: 80 },
]

const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 700, color: TEXT.secondary, padding: '6px 6px', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '4px 6px', verticalAlign: 'top' }
const cell: React.CSSProperties = { ...inputStyle, padding: '6px 8px', fontSize: 12.5 }

function blankRow(branchId: number): ItemPlantRow {
  return {
    branch_id: branchId, mrp_type: 'reorder_point', procurement_type: 'buy', reorder_level: null, safety_stock: null,
    minimum_stock: null, maximum_stock: null, reorder_quantity: null, lead_time_days: null, inhouse_production_days: null,
    default_location_id: null, purchasing_blocked: false, remarks: null,
  }
}

export default function ItemPlantData({ itemId, canEdit }: { itemId: number; canEdit: boolean }) {
  const [data, setData] = useState<ItemPlantsPayload | null>(null)
  const [rows, setRows] = useState<ItemPlantRow[]>([])
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [addPlant, setAddPlant] = useState('')

  const load = () => itemPlantsApi.get(itemId)
    .then((d) => { setData(d); setRows(d.plants) })
    .catch((e) => setError(extractErrorMessages(e, 'Plant data could not be loaded.').join(' ')))
  useEffect(() => { if (itemId) load() }, [itemId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return error ? <Section title="Plant data" style={{ marginBottom: 20 }}><p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p></Section> : null

  const plantName = (id: number) => data.meta.plants.find((p) => p.id === id)?.name || `Plant ${id}`
  const unused = data.meta.plants.filter((p) => !rows.some((r) => r.branch_id === p.id))
  const set = (i: number, patch: Partial<ItemPlantRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const num = (v: string) => (v.trim() === '' ? null : Number(v))

  const save = async () => {
    setBusy(true); setError('')
    try {
      const d = await itemPlantsApi.save(itemId, rows)
      setData(d); setRows(d.plants); setEditing(false)
    } catch (e) {
      setError(extractErrorMessages(e, 'Plant data could not be saved.').join(' '))
    } finally { setBusy(false) }
  }

  const errorBox = error ? (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {error}
    </div>
  ) : null
  const grid = (ed: boolean) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
        <thead>
          <tr>
            <th style={th}>Plant</th><th style={th}>MRP type</th><th style={th}>Make / buy</th>
            {NUM_FIELDS.map((f) => <th key={f.key} style={th}>{f.label}</th>)}
            <th style={th}>Default store</th><th style={th}>Purch. blocked</th>{ed && <th style={th} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.branch_id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              <td style={{ ...td, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{plantName(r.branch_id)}</td>
              <td style={td}>
                {ed ? (
                  <Select style={{ ...cell, width: 130 }} value={r.mrp_type} onChange={(e) => set(i, { mrp_type: e.target.value })}>
                    {data.meta.mrp_types.map((o) => <option key={o.value} value={o.value}>{o.label.split(' — ')[0]}</option>)}
                  </Select>
                ) : <span style={{ fontSize: 13 }}>{data.meta.mrp_types.find((o) => o.value === r.mrp_type)?.label.split(' — ')[0]}</span>}
              </td>
              <td style={td}>
                {ed ? (
                  <Select style={{ ...cell, width: 120 }} value={r.procurement_type} onChange={(e) => set(i, { procurement_type: e.target.value })}>
                    {data.meta.procurement_types.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                ) : <span style={{ fontSize: 13 }}>{data.meta.procurement_types.find((o) => o.value === r.procurement_type)?.label}</span>}
              </td>
              {NUM_FIELDS.map((f) => (
                <td key={f.key} style={td}>
                  {ed ? (
                    <input type="number" min={0} step="any" style={{ ...cell, width: f.width }} value={(r[f.key] as number | null) ?? ''}
                      onChange={(e) => set(i, { [f.key]: num(e.target.value) } as Partial<ItemPlantRow>)} />
                  ) : <span style={{ fontSize: 13 }}>{(r[f.key] as number | null) ?? '—'}</span>}
                </td>
              ))}
              <td style={td}>
                {ed ? (
                  <Select style={{ ...cell, width: 150 }} value={r.default_location_id ?? ''} onChange={(e) => set(i, { default_location_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">—</option>
                    {data.meta.stores.filter((s) => !s.branch_id || s.branch_id === r.branch_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                ) : <span style={{ fontSize: 13 }}>{data.meta.stores.find((s) => s.id === r.default_location_id)?.name || '—'}</span>}
              </td>
              <td style={td}>
                {ed ? (
                  <input type="checkbox" checked={r.purchasing_blocked} onChange={(e) => set(i, { purchasing_blocked: e.target.checked })} />
                ) : <span style={{ fontSize: 13 }}>{r.purchasing_blocked ? 'Yes' : 'No'}</span>}
              </td>
              {ed && (
                <td style={td}>
                  <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} style={smallSecondaryBtnStyle}>Remove</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  const cancelEdit = () => { setRows(data.plants); setEditing(false); setError('') }

  return (
    <Section title="Plant data (MRP views)" style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '0 0 10px' }}>
        Planning per plant. Reorder runs per plant with that plant&apos;s stores&apos; stock; a plant without a row uses the
        company-wide fields above. MRP type &lsquo;MRP&rsquo; leaves the item to Production MRP.
      </p>
      {!editing && errorBox}
      {data.plants.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.secondary }}>No plant-specific data — every plant uses the Item Master fields.</p>
      ) : !editing ? grid(false) : <p style={{ fontSize: 13, color: TEXT.secondary }}>Editing in the popup…</p>}
      {canEdit && !editing && (
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button type="button" onClick={() => { setRows(data.plants); setError(''); setEditing(true) }} style={secondaryBtnStyle}>Edit plant data</button>
        </div>
      )}
      {canEdit && editing && (
        <FormSheet width={1160} icon="building" title="Edit Plant Data" subtitle="Planning per plant (MRP views) — a plant without a row uses the Item Master fields." onClose={cancelEdit} busy={busy}
          footer={<>
            <button type="button" disabled={busy} onClick={cancelEdit} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" disabled={busy} onClick={save} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save plant data'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {errorBox}
            <SheetSection icon="building" title="Plants">
              {rows.length === 0 ? <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>No plant rows — add a plant below.</p> : grid(true)}
              {unused.length > 0 && (
                <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Select style={{ ...sheetInput, width: 220 }} value={addPlant} onChange={(e) => setAddPlant(e.target.value)}>
                    <option value="">Add a plant…</option>
                    {unused.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                  <button type="button" disabled={!addPlant} onClick={() => { setRows([...rows, blankRow(Number(addPlant))]); setAddPlant('') }}
                    style={sheetBtn('secondary', SHEET.INK, !addPlant)}><SheetIcon name="plus" size={15} />Add</button>
                </div>
              )}
            </SheetSection>
          </div>
        </FormSheet>
      )}
    </Section>
  )
}
