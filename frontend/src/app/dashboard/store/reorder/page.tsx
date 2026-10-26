'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { reorderApi, storeApi } from '@/lib/api'
import { StoreReorderRow } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, DANGER } from '@/lib/theme'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'
import { primaryBtnStyle, RowCount, inputStyle as sharedInputStyle } from '@/components/shared/ui'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const inputStyle: React.CSSProperties = { ...sharedInputStyle, width: 'auto', background: 'rgba(255,255,255,.7)' }
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}`, whiteSpace: 'nowrap' }
const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }))
const thNum: React.CSSProperties = { ...th, textAlign: 'right' }
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const NUM_COLS = new Set(['Available', 'On order', 'Projected', 'Reorder level', 'Min / Max', 'Lead time', 'Order qty'])
// One row per item per plant (material master plant views); row_key = item-plant.
type PlantRow = StoreReorderRow & { row_key?: string; plant_name?: string | null; planning_source?: string }
const rk = (r: StoreReorderRow) => (r as PlantRow).row_key || String(r.item_id)

// Reorder point: items whose projected stock (available + already on order)
// is at / below their reorder level. Tick the ones to buy → one PR.
export default function StoreReorderPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()
  const canRaisePr = !!user?.apps?.includes('p2p')
  const [rows, setRows] = useState<StoreReorderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([])
  const [category, setCategory] = useState('')
  const [dueOnly, setDueOnly] = useState(true)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    storeApi.listCategories().then(setCategories).catch(() => setCategories([]))
  }, [isAuthorized])
  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    reorderApi.list({ category: category || undefined, due_only: dueOnly })
      .then((r: StoreReorderRow[]) => {
        setRows(r)
        setQty(Object.fromEntries(r.filter((x) => x.suggested_qty).map((x) => [rk(x), String(x.suggested_qty)])))
        setPicked([])
      })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the reorder list.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, category, dueOnly])

  const raisePr = () => {
    const chosen = rows.filter((r) => picked.includes(rk(r)))
    const bad = chosen.find((r) => !(Number(qty[rk(r)]) > 0))
    if (bad) { setError(`${bad.item_code} ${bad.item_name}: enter the quantity to order.`); return }
    try {
      sessionStorage.setItem('p2p_new_prefill', JSON.stringify({
        items: chosen.map((r) => ({ store_item_id: r.item_id, make: r.make || '', quantity: Number(qty[rk(r)]) })),
        remarks: `Reorder — ${chosen.length} item(s) at or below reorder level: ${chosen.map((r) => r.item_code).join(', ')}.`,
      }))
    } catch {
      setError('Your browser blocked session storage, so the requisition form can\'t be pre-filled. Allow site storage and try again.')
      return
    }
    router.push('/dashboard/p2p/new?prefill=session')
  }

  if (isLoading || !isAuthorized) return null
  const due = rows.filter((r) => r.due)

  return (
    <div>
      <StoreNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Store & Inventory</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Reorder</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0, maxWidth: 760 }}>
            Items whose projected stock — available plus what is already on order (open requisitions and POs) — is at or below their reorder level.
            Levels come from the item's plant data (per plant, that plant's stores) or, without plant data, from the Item Master.
          </p>
        </div>
        {canRaisePr && (
          <button data-tour="store-reorder-raise-pr" type="button" disabled={!picked.length} onClick={raisePr}
            style={{ ...primaryBtnStyle, cursor: picked.length ? 'pointer' : 'not-allowed', opacity: picked.length ? 1 : 0.5 }}>
            Raise PR for {picked.length || ''} selected
          </button>
        )}
      </div>
      <MessageDialog open={!!error} variant="error" title="Reorder" message={error} onClose={() => setError('')} />

      <div data-tour="store-reorder-filters" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <Select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </Select>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: TEXT.body }}>
          <input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} /> Only items due for reorder
        </label>
        <span style={{ fontSize: 12.5, color: TEXT.muted }}>{due.length.toLocaleString('en-IN')} due for reorder</span>
      </div>

      <div data-tour="store-reorder-table" style={{ ...sectionStyle, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead><tr>
            {['', 'Item', 'Plant', 'Available', 'On order', 'Projected', 'Reorder level', 'Min / Max', 'Lead time', 'Order qty'].map((h, hi) => <th key={h} style={NUM_COLS.has(h) ? thNum : th}>{h}{hi === 1 && <RowCount count={rows.length} />}</th>)}
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ ...td, color: TEXT.muted, textAlign: 'center', padding: 24 }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} style={{ ...td, color: TEXT.muted, textAlign: 'center', padding: 24, whiteSpace: 'normal' }}>{dueOnly ? 'Nothing is due for reorder — every item is above its reorder level.' : 'No items have a reorder level or minimum stock set yet — set them on the item (Planning / plant data).'}</td></tr>
            ) : rows.map((r) => (
              <tr key={rk(r)}>
                <td style={td}>
                  {r.due && canRaisePr && (
                    <input type="checkbox" checked={picked.includes(rk(r))}
                      onChange={(e) => setPicked((p) => (e.target.checked ? [...p, rk(r)] : p.filter((x) => x !== rk(r))))} />
                  )}
                </td>
                <td style={{ ...td, whiteSpace: 'normal' }}><strong>{r.item_code}</strong> — {r.item_name}{r.uom ? ` (${r.uom})` : ''}</td>
                <td style={td}>{(r as PlantRow).plant_name || 'All plants'}</td>
                <td style={tdNum}>{fmt(r.available)}{r.reserved ? <span style={{ color: TEXT.muted, fontSize: 11.5 }}> ({fmt(r.reserved)} reserved)</span> : null}</td>
                <td style={tdNum} title={r.on_order_docs.join(', ')}>{fmt(r.on_order)}{r.on_order_docs.length ? <span style={{ color: TEXT.muted, fontSize: 11.5 }}> · {r.on_order_docs.length} doc{r.on_order_docs.length === 1 ? '' : 's'}</span> : null}</td>
                <td style={{ ...tdNum, fontWeight: 700, color: r.due ? DANGER.text : TEXT.body }}>{fmt(r.projected)}</td>
                <td style={tdNum}>{fmt(r.reorder_level)}</td>
                <td style={tdNum}>{fmt(r.minimum_stock)} / {fmt(r.maximum_stock)}</td>
                <td style={tdNum}>{r.lead_time_days != null ? `${r.lead_time_days} day${r.lead_time_days === 1 ? '' : 's'}` : '—'}</td>
                <td style={tdNum}>
                  {r.due ? (
                    <input type="number" min={0} step="any" value={qty[rk(r)] ?? ''} style={{ ...inputStyle, width: 110, textAlign: 'right' }}
                      onChange={(e) => setQty((q) => ({ ...q, [rk(r)]: e.target.value }))} />
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
