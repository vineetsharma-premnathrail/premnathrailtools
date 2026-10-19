'use client'

// BOM & Routing detail — multi-level (indented) explosion (SAP CS11/CS12) and
// electrical / hydraulic BOM merges (CWBPP).
import { useCallback, useEffect, useState } from 'react'
import { productionEngineeringApi } from '@/lib/productionEngineeringApi'
import { ProductionBom, ProductionDisciplineSource, ProductionExplosion } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, DANGER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', position: 'sticky', top: 0, zIndex: 1 }
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const errorBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const CATEGORY_HEX: Record<string, string> = { stock: '#2563eb', non_stock: '#9333ea', text: '#78716c', document: '#0d9488' }
const CATEGORY_LABELS: Record<string, string> = { stock: 'Stock', non_stock: 'Non-stock', text: 'Text', document: 'Document' }

export function ExplosionSection({ bom, showCosts = true }: { bom: ProductionBom; showCosts?: boolean }) {
  const [qty, setQty] = useState(String(bom.base_quantity || 1))
  const [data, setData] = useState<ProductionExplosion | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    const n = Number(qty)
    if (!(n > 0)) { setError('Enter a quantity above zero to explode.'); return }
    setError('')
    setLoading(true)
    productionEngineeringApi.getExplosion(bom.id, n)
      .then(setData)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to explode the BOM.')))
      .finally(() => setLoading(false))
  }, [bom.id, qty])

  return (
    <div data-tour="production-bom-explosion" style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <p style={sectionTitle}>Multi-level Explosion (Indented BOM)</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {open && (
            <>
              <div style={{ width: 110 }}>
                <label style={labelStyle}>For qty</label>
                <input style={inputStyle} type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <button type="button" style={secondaryBtnStyle} disabled={loading} onClick={load}>{loading ? 'Exploding…' : 'Explode'}</button>
              <button type="button" style={secondaryBtnStyle} onClick={() => window.print()}>Print</button>
            </>
          )}
          <button type="button" style={secondaryBtnStyle} onClick={() => { if (!open && !data) load(); setOpen(!open) }}>{open ? 'Hide' : 'Show tree'}</button>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          {error && <div style={errorBox}>{Array.isArray(error) ? error.join(' ') : error}</div>}
          {data && (
            <>
              <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 10px' }}>
                {data.rows.length} line(s) over {data.max_level} level(s) for {data.quantity} × {data.product_code}.
                {showCosts && data.total_material_cost != null && <> Material cost from purchased (leaf) items: <b>{inr(data.total_material_cost)}</b>.</>} Sub-assemblies use their own valid Production BOM.
              </p>
              <div style={{ overflow: 'auto', maxHeight: 520 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
                  <thead><tr>{['Level', 'Item', 'Category', 'Qty / parent', 'Total qty', 'UOM', 'Make / Buy', 'Sub-BOM', ...(showCosts ? ['Ext. cost'] : [])].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.rows.length === 0 ? (
                      <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No components.</td></tr>
                    ) : data.rows.map((r) => (
                      <tr key={r.path}>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: TEXT.muted }}>{'·'.repeat(r.level - 1)} {r.level} <span style={{ fontSize: 11 }}>({r.path})</span></td>
                        <td style={{ ...tdStyle, paddingLeft: 12 + (r.level - 1) * 18, fontWeight: r.has_bom ? 700 : 500, color: TEXT.heading }}>
                          {r.item_category === 'text' ? <i>{r.line_text}</i> : `${r.item_code || ''} — ${r.item_name || ''}`}
                          {r.cycle && <span style={{ color: DANGER.primary, fontSize: 11, marginLeft: 6 }}>cycle — not exploded</span>}
                          {r.source_tag && <span style={{ color: TEXT.muted, fontSize: 11, marginLeft: 6 }}>{r.source_tag}</span>}
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: `${CATEGORY_HEX[r.item_category]}1a`, color: CATEGORY_HEX[r.item_category] }}>
                            {CATEGORY_LABELS[r.item_category] || r.item_category}
                          </span>
                        </td>
                        <td style={tdStyle}>{r.item_category === 'text' ? '—' : r.quantity_per}</td>
                        <td style={tdStyle}>{r.item_category === 'text' || r.item_category === 'document' ? '—' : r.total_quantity}</td>
                        <td style={tdStyle}>{r.uom || '—'}</td>
                        <td style={tdStyle}>{r.make_buy ? (r.make_buy === 'make' ? 'Make' : 'Buy') : '—'}</td>
                        <td style={tdStyle}>{r.bom_number || '—'}</td>
                        {showCosts && <td style={tdStyle}>{r.extended_cost ? inr(r.extended_cost) : '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function DisciplineMergeSection({ bom, canEdit, canRemove = canEdit, onChanged }: { bom: ProductionBom; canEdit: boolean; canRemove?: boolean; onChanged: (b: ProductionBom) => void }) {
  const [sources, setSources] = useState<ProductionDisciplineSource[]>([])
  const [pick, setPick] = useState('')
  const [multiplier, setMultiplier] = useState('1')
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [removeId, setRemoveId] = useState<number | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const isDraft = bom.status === 'draft'

  useEffect(() => {
    if (!isDraft || !canEdit) return
    productionEngineeringApi.listDisciplineSources()
      .then(setSources)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load electrical / hydraulic BOMs.')))
  }, [isDraft, canEdit])

  const merges = bom.discipline_merges || []
  const chosen = sources.find((x) => `${x.source_type}:${x.source_id}` === pick)

  const merge = async () => {
    if (!chosen) { setError('Pick the electrical job or hydraulic BOM to merge.'); return }
    if (!chosen.mergeable) { setError(chosen.problem || 'This BOM cannot be merged yet.'); return }
    setError('')
    setBusy(true)
    try {
      onChanged(await productionEngineeringApi.mergeDiscipline(bom.id, { source_type: chosen.source_type, source_id: chosen.source_id, multiplier: Number(multiplier) || 1 }))
      setPick('')
      setMergeOpen(false)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to merge the discipline BOM.'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const id = removeId
    setRemoveId(null)
    if (!id) return
    setBusy(true)
    try {
      onChanged(await productionEngineeringApi.removeDisciplineMerge(bom.id, id))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to remove the merged BOM.'))
    } finally {
      setBusy(false)
    }
  }

  if (!merges.length && !(isDraft && canEdit)) return null
  return (
    <div data-tour="production-bom-discipline" style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <p style={sectionTitle}>Electrical &amp; Hydraulic BOMs ({merges.length})</p>
        {isDraft && canEdit && (
          <button data-tour="production-bom-merge-open-btn" type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => { setError(''); setMergeOpen(true) }}>+ Merge BOM</button>
        )}
      </div>
      <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>
        Released discipline BOMs merged into this manufacturing BOM, so their parts are reserved, issued and planned with the rest. Lines are added per Item Master code and tagged with their source.
      </p>
      {error && !mergeOpen && <div style={errorBox}>{Array.isArray(error) ? error.join(' ') : error}</div>}
      {merges.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead><tr>{['Source', 'Items', 'Merged', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {merges.map((m) => (
                <tr key={m.id}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{m.source_label}</td>
                  <td style={tdStyle}>{m.line_count}</td>
                  <td style={tdStyle}>{m.merged_at ? `${formatDateTime(m.merged_at)} by ${m.merged_by_name || '—'}` : '—'}</td>
                  <td style={tdStyle}>
                    {isDraft && canRemove && (
                      <button type="button" disabled={busy} style={{ ...secondaryBtnStyle, padding: '6px 10px', color: DANGER.primary, borderColor: DANGER.border }} onClick={() => setRemoveId(m.id)}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mergeOpen && isDraft && canEdit && (
        <FormSheet width={580} icon="link" title="Merge Electrical / Hydraulic BOM" subtitle={`Into ${bom.bom_number} · v${bom.version}`}
          onClose={() => setMergeOpen(false)} busy={busy}
          footer={<>
            <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => setMergeOpen(false)}>Cancel</button>
            <button type="button" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={merge}><SheetIcon name="link" size={16} />{busy ? 'Merging…' : 'Merge into BOM'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {error && <div style={errorBox}>{Array.isArray(error) ? error.join(' ') : error}</div>}
            <SheetSection icon="box" title="Discipline BOM">
              <label style={sheetLabel}>Electrical job / hydraulic BOM</label>
              <SearchableSelect value={pick} onChange={setPick} placeholder="Search…"
                options={sources.map((x) => ({ value: `${x.source_type}:${x.source_id}`, label: `${x.label}${x.title ? ' — ' + x.title : ''}${x.mergeable ? '' : ' (not ready)'}` }))} />
              {chosen && !chosen.mergeable && <p style={{ fontSize: 12, color: '#b45309', margin: '8px 0 0' }}>{chosen.problem}</p>}
              <div style={{ maxWidth: 160, marginTop: 14 }}>
                <label style={sheetLabel}>Sets per unit</label>
                <input style={sheetInput} type="number" min={0} step="any" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />
              </div>
              <p style={sheetHint}>Its lines are added per Item Master code, multiplied by the sets per unit, and tagged with their source.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}
      <ConfirmDialog
        open={removeId !== null}
        title="Remove this merged BOM?"
        message="Its quantities are taken back off the components it added to. You can merge it again later."
        confirmLabel="Remove"
        danger
        onConfirm={remove}
        onCancel={() => setRemoveId(null)}
      />
    </div>
  )
}
