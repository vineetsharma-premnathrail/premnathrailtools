'use client'

// Racks / shelves / bins of each store and the stock sitting in them — one
// page (tab 'bins'; the old Bin Stock page redirects here). A bin belongs to
// exactly one store — the backend refuses a parent, a putaway or a pick across
// stores — so this page always works one store at a time. Rack → Shelf → Bin;
// a bin may also sit directly in a rack or in a small store with no racks.
// Bin quantities come from the stock ledger rows that carry a bin (GRN
// putaway, issue, transfer, adjustment) plus bin moves (SAP LS26 / LT10);
// "Unassigned" is what is in the store but in no bin.

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi, storeBinStockApi } from '@/lib/api'
import { StoreLocation } from '@/types'
import { TEXT, GLASS, SHADOWS, SUCCESS } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle, RowCount, Pill } from '@/components/shared/ui'
import { formatDate } from '@/lib/format'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import Select from '@/components/shared/Select'

type BinType = 'rack' | 'shelf' | 'bin'
type Bin = { id: number; location_id: number; parent_id: number | null; bin_type: BinType; code: string; name?: string | null; is_active: boolean }
type Move = { id: number; move_number: string; item_code?: string; item_name?: string; uom?: string; from_bin_code?: string | null; to_bin_code?: string | null; quantity: number; move_date?: string; remarks?: string | null; created_by_name?: string | null }
type StockRow = { item_id: number; item_code?: string; item_name?: string; uom?: string; location_id: number; location_name?: string; bin_id: number | null; bin_code?: string | null; bin_name?: string | null; quantity: number }

const TYPE_LABEL: Record<BinType, string> = { rack: 'Rack', shelf: 'Shelf', bin: 'Bin' }
const TYPE_HEX: Record<BinType, string> = { rack: '#7c3aed', shelf: '#0891b2', bin: '#FF6A2A' }
// Which level may hold which — mirrors the backend rule.
const PARENT_TYPES: Record<BinType, BinType[]> = { rack: [], shelf: ['rack'], bin: ['rack', 'shelf'] }
const CODE_HINT: Record<BinType, string> = { rack: 'R1', shelf: 'R1-S2', bin: 'R1-S2-B3' }
const UNASSIGNED = 0 // expand key for the "in the store, no bin" row

const th: React.CSSProperties = {
  position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 14px', fontSize: 11,
  fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap',
}
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.secondary, borderTop: '1px solid rgba(0,0,0,0.05)' }
const fmtQty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 })
const linkStyle: React.CSSProperties = { color: '#c2410c', fontWeight: 600, cursor: 'pointer', fontSize: 12.5 }

export default function StoreBinsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { can, canDelete, canFeature } = useCan()
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [locationId, setLocationId] = useState('')
  const [bins, setBins] = useState<Bin[]>([])
  const [stock, setStock] = useState<StockRow[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')

  const [form, setForm] = useState<{ id?: number; bin_type: BinType; parent_id: string; code: string; name: string } | null>(null)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Bin | null>(null)

  const [typeFilter, setTypeFilter] = useState<'' | BinType>('')
  const [moves, setMoves] = useState<Move[]>([])
  const [movesError, setMovesError] = useState('')
  // Put away = from Unassigned into a bin; Move = from the row's bin to another.
  const [moveSheet, setMoveSheet] = useState<{ mode: 'putaway' | 'move'; sources: StockRow[]; to: Bin | null } | null>(null)
  const [srcKey, setSrcKey] = useState('')
  const [toBin, setToBin] = useState('')
  const [moveQty, setMoveQty] = useState('')
  const [moveRemarks, setMoveRemarks] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState<string[]>([])

  useEffect(() => {
    if (!isAuthorized) return
    storeApi.listLocations().then((l: StoreLocation[]) => {
      const active = l.filter((x) => x.is_active !== false)
      setLocations(active)
      if (active.length === 1) { setLoading(true); setLocationId(String(active[0].id)) }
    }).catch((err) => setError(extractErrorMessages(err, 'Could not load the stores.')))
  }, [isAuthorized])

  const load = async () => {
    if (!locationId) return
    try {
      const [b, rows]: [Bin[], StockRow[]] = await Promise.all([
        storeApi.listBins(Number(locationId)),
        // A failed stock read must not hide the bin list — the bins stay manageable.
        storeBinStockApi.list({ location_id: locationId }).catch((err: unknown) => {
          setError(extractErrorMessages(err, 'Could not load the stock in the bins — the bin list is shown without it.'))
          return []
        }),
      ])
      setBins(b)
      setStock(rows.filter((r) => r.quantity !== 0))
      storeBinStockApi.moves({ location_id: locationId })
        .then((m: Move[]) => { setMoves(m); setMovesError('') })
        .catch((err: unknown) => { setMoves([]); setMovesError(([] as string[]).concat(extractErrorMessages(err, 'Could not load the bin moves.')).join(' ')) })
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not load the bins of this store.'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, locationId])

  const byId = useMemo(() => new Map(bins.map((b) => [b.id, b])), [bins])

  // Stock per bin (UNASSIGNED = in the store, no bin), narrowed by the item search.
  const q = search.trim().toLowerCase()
  const stockByBin = useMemo(() => {
    const m = new Map<number, StockRow[]>()
    for (const r of stock) {
      if (q && !`${r.item_code} ${r.item_name}`.toLowerCase().includes(q)) continue
      const k = r.bin_id ?? UNASSIGNED
      m.set(k, [...(m.get(k) || []), r])
    }
    return m
  }, [stock, q])

  // Depth-first: each rack, then its shelves, then their bins. While searching,
  // only bins holding a matching item (and the racks/shelves above them) show.
  const tree = useMemo(() => {
    let visible = bins.filter((b) => (showInactive || b.is_active) && (!typeFilter || b.bin_type === typeFilter))
    if (q) {
      const keep = new Set<number>()
      for (const id of stockByBin.keys()) {
        let cur = byId.get(id)
        while (cur && !keep.has(cur.id)) { keep.add(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined }
      }
      visible = visible.filter((b) => keep.has(b.id))
    }
    const ids = new Set(visible.map((b) => b.id))
    const kids = new Map<number | null, Bin[]>()
    for (const b of visible) {
      const p = b.parent_id && ids.has(b.parent_id) ? b.parent_id : null
      kids.set(p, [...(kids.get(p) || []), b])
    }
    const order: BinType[] = ['rack', 'shelf', 'bin']
    const out: { bin: Bin; depth: number }[] = []
    const walk = (parent: number | null, depth: number) => {
      const list = (kids.get(parent) || []).sort((a, b) => order.indexOf(a.bin_type) - order.indexOf(b.bin_type) || a.code.localeCompare(b.code, undefined, { numeric: true }))
      for (const b of list) { out.push({ bin: b, depth }); walk(b.id, depth + 1) }
    }
    walk(null, 0)
    return out
  }, [bins, showInactive, typeFilter, q, stockByBin, byId])

  const counts = useMemo(() => ({
    rack: bins.filter((b) => b.is_active && b.bin_type === 'rack').length,
    shelf: bins.filter((b) => b.is_active && b.bin_type === 'shelf').length,
    bin: bins.filter((b) => b.is_active && b.bin_type === 'bin').length,
  }), [bins])

  const isOpen = (k: number) => !!q || expanded.has(k)
  const toggle = (k: number) => setExpanded((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const openAdd = (bin_type: BinType, parent?: Bin) => {
    setFormErrors([])
    setForm({ bin_type, parent_id: parent ? String(parent.id) : '', code: parent ? `${parent.code}-` : '', name: '' })
  }
  const openEdit = (b: Bin) => {
    setFormErrors([])
    setForm({ id: b.id, bin_type: b.bin_type, parent_id: b.parent_id ? String(b.parent_id) : '', code: b.code, name: b.name || '' })
  }

  const parentOptions = form
    ? bins.filter((b) => b.is_active && b.id !== form.id && PARENT_TYPES[form.bin_type].includes(b.bin_type))
    : []

  const save = async () => {
    if (!form) return
    const problems: string[] = []
    if (!form.code.trim()) problems.push(`Code is required — e.g. ${CODE_HINT[form.bin_type]}.`)
    if (form.bin_type === 'shelf' && !form.parent_id) problems.push('A shelf must sit in a rack — pick the rack.')
    if (problems.length) { setFormErrors(problems); return }
    setSaving(true)
    setFormErrors([])
    const payload = { bin_type: form.bin_type, parent_id: form.parent_id ? Number(form.parent_id) : null, code: form.code.trim(), name: form.name.trim() || null }
    try {
      if (form.id) await storeApi.updateBin(form.id, payload)
      else await storeApi.createBin({ ...payload, location_id: Number(locationId) })
      setForm(null)
      load()
    } catch (err) {
      setFormErrors(extractErrorMessages(err, `Could not save the ${TYPE_LABEL[form.bin_type].toLowerCase()}.`))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (b: Bin) => {
    try {
      await storeApi.updateBin(b.id, { is_active: !b.is_active })
      load()
    } catch (err) {
      setError(extractErrorMessages(err, `Could not ${b.is_active ? 'deactivate' : 'reactivate'} '${b.code}'.`))
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    const b = deleteTarget
    setDeleteTarget(null)
    try {
      await storeApi.deleteBin(b.id)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, `Could not delete '${b.code}'.`))
    }
  }

  const rowKey = (r: StockRow) => `${r.item_id}-${r.bin_id ?? 'u'}`
  const openMove = (mode: 'putaway' | 'move', sources: StockRow[], to: Bin | null) => {
    const live = sources.filter((r) => r.quantity > 0)
    const first = live.length === 1 ? live[0] : null
    setMoveSheet({ mode, sources: live, to }); setMoveError([])
    setSrcKey(first ? rowKey(first) : ''); setMoveQty(first ? String(first.quantity) : '')
    setToBin(to ? String(to.id) : ''); setMoveRemarks('')
  }
  const moveFor = moveSheet?.sources.find((r) => rowKey(r) === srcKey) || null
  const doMove = async () => {
    if (!moveFor) { setMoveError([moveSheet?.mode === 'putaway' ? 'Pick the item to put away.' : 'Pick the item to move.']); return }
    if (moveSheet?.mode === 'putaway' && !toBin) { setMoveError(['Pick the bin to put the item into.']); return }
    if (!(Number(moveQty) > 0)) { setMoveError(['Enter the quantity to move — more than 0.']); return }
    if (Number(moveQty) > moveFor.quantity) { setMoveError([`Only ${moveFor.quantity} ${moveFor.uom || ''} is in ${moveFor.bin_code || 'Unassigned'} — enter that much or less.`]); return }
    if ((toBin || null) === (moveFor.bin_id ? String(moveFor.bin_id) : null)) { setMoveError(['Pick a different destination bin.']); return }
    setMoving(true)
    setMoveError([])
    try {
      const m = await storeBinStockApi.move({
        item_id: moveFor.item_id, location_id: moveFor.location_id, from_bin_id: moveFor.bin_id, to_bin_id: toBin ? Number(toBin) : null,
        quantity: Number(moveQty), remarks: moveRemarks.trim() || undefined,
      })
      setNotice(`${m.move_number}: ${m.quantity} ${m.uom || ''} moved ${m.from_bin_code || 'Unassigned'} → ${m.to_bin_code || 'Unassigned'}.`)
      setMoveSheet(null)
      load()
    } catch (err) {
      setMoveError(extractErrorMessages(err, 'Could not move the stock between bins.'))
    } finally {
      setMoving(false)
    }
  }

  const exportExcel = async () => {
    try {
      const blob = await storeBinStockApi.export({ location_id: locationId || undefined })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'stock_by_bin.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not export the stock by bin.'))
    }
  }

  if (isLoading || !isAuthorized) return null
  const canCreate = can('store', 'bins', 'create')
  const canEdit = can('store', 'bins', 'edit')
  const canDel = canDelete('store', 'bins', null)
  const canMove = canFeature('store', 'transfers', 'bin_moves', 'create')
  const store = locations.find((l) => String(l.id) === locationId)
  const unassigned = stockByBin.get(UNASSIGNED) || []
  // Put away offers everything unassigned, not just what the search matched.
  const unassignedAll = stock.filter((r) => r.bin_id === null && r.quantity > 0)

  // Items held in one bin — shown under its row when expanded.
  const stockRows = (rows: StockRow[], depth: number) => (
    <tr>
      <td colSpan={6} style={{ ...td, padding: `4px 14px 12px ${36 + depth * 22}px`, background: 'rgba(255,106,42,0.03)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.item_id}-${r.bin_id}`}>
                <td style={{ padding: '6px 0', fontSize: 12.5, color: TEXT.body, fontWeight: 600 }}>{r.item_code} — {r.item_name}</td>
                <td style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 700, color: r.quantity < 0 ? '#b91c1c' : TEXT.body, whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtQty(r.quantity)} {r.uom || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  )
  const holdingCell = (k: number, rows: StockRow[], isBin: boolean) => (
    rows.length
      ? <span onClick={() => toggle(k)} style={linkStyle}>{isOpen(k) ? '▾' : '▸'} {rows.length} item{rows.length > 1 ? 's' : ''}</span>
      : isBin ? 'Empty' : '—'
  )

  return (
    <div>
      <StoreNav />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Store &amp; Inventory</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Bins</h1>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '4px 0 0', maxWidth: 640 }}>
            Racks, shelves and bins inside each store, and what each bin holds. Every bin belongs to one store only — put away on
            the GRN, pick on the issue / transfer, move between bins here.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {locationId && can('store', 'stock', 'export') && <button type="button" onClick={exportExcel} style={secondaryBtnStyle}>Export Excel</button>}
            {canCreate && (
              // One Add — the dialog's Type picks rack / shelf / bin. Starts on Rack while the store has none.
              <button type="button"
                onClick={() => (locationId ? openAdd(counts.rack ? 'bin' : 'rack') : setError('Pick the store first (the "— Pick a store —" list below) — racks and bins belong to one store.'))}
                style={primaryBtnStyle}>+ Add</button>
            )}
          </div>
          {canCreate && !locationId && <span style={{ fontSize: 12, color: TEXT.muted }}>Pick a store below to add its racks and bins.</span>}
        </div>
      </div>

      <MessageDialog open={!!error && (Array.isArray(error) ? error.length > 0 : true)} variant="error" title="Bins" message={error} onClose={() => setError('')} />
      <MessageDialog open={!!notice} variant="success" title="Moved" message={notice} onClose={() => setNotice('')} />
      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete ${deleteTarget ? TYPE_LABEL[deleteTarget.bin_type].toLowerCase() : ''} '${deleteTarget?.code}'?`}
        message="Only a bin that never held stock can be deleted. One that was used can be deactivated instead, once it is empty."
        onCancel={() => setDeleteTarget(null)}
        onConfirm={doDelete}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Select style={{ ...inputStyle, flex: '0 1 260px', width: 'auto' }} value={locationId} onChange={(e) => { setBins([]); setStock([]); setExpanded(new Set()); setLoading(!!e.target.value); setLocationId(e.target.value) }}>
          <option value="">— Pick a store —</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}{l.code ? ` (${l.code})` : ''}</option>)}
        </Select>
        {locationId && (
          <>
            <Select style={{ ...inputStyle, flex: '0 1 180px', width: 'auto' }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as '' | BinType)}>
              <option value="">Racks, shelves &amp; bins</option>
              <option value="rack">Racks only</option>
              <option value="shelf">Shelves only</option>
              <option value="bin">Bins only</option>
            </Select>
            <input style={{ ...inputStyle, flex: '0 1 260px', width: 'auto' }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find an item — code or name" />
            <span style={{ fontSize: 12.5, color: TEXT.muted }}>{counts.rack} racks · {counts.shelf} shelves · {counts.bin} bins</span>
            <label style={{ fontSize: 12.5, color: TEXT.secondary, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
            </label>
          </>
        )}
      </div>

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead><tr>{['Code', 'Type', 'Name / Description', 'Holding', 'Status', ''].map((h, hi) => <th key={h} style={th}>{h}{hi === 0 && <RowCount count={locationId ? tree.length : 0} />}</th>)}</tr></thead>
          <tbody>
            {!locationId && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', padding: 24 }}>Pick a store to see its bins and what they hold.</td></tr>}
            {locationId && loading && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', padding: 24 }}>Loading…</td></tr>}
            {locationId && !loading && unassigned.length > 0 && (
              <>
                <tr>
                  <td style={{ ...td, fontWeight: 700, color: TEXT.body }}>Unassigned</td>
                  <td style={td}><Pill label="No bin" hex="#d97706" /></td>
                  <td style={td}>In the store but not put away in any bin</td>
                  <td style={td}>{holdingCell(UNASSIGNED, unassigned, true)}</td>
                  <td style={td} />
                  <td style={{ ...td, textAlign: 'right' }}>
                    {canMove && <span onClick={() => openMove('putaway', unassignedAll, null)} style={linkStyle}>Put away</span>}
                  </td>
                </tr>
                {isOpen(UNASSIGNED) && stockRows(unassigned, 0)}
              </>
            )}
            {locationId && !loading && tree.length === 0 && (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', padding: 24 }}>
                {q
                  ? `No bin in ${store?.name || 'this store'} holds an item matching '${search.trim()}'.`
                  : <>No bins in {store?.name || 'this store'} yet.{canCreate ? ' Use + Add: start with a rack, add shelves to it, then bins — or add bins directly for a small store.' : ''}</>}
              </td></tr>
            )}
            {locationId && !loading && tree.map(({ bin: b, depth }) => {
              const rows = stockByBin.get(b.id) || []
              return (
                <Fragment key={b.id}>
                  <tr style={{ opacity: b.is_active ? 1 : 0.55 }}>
                    <td style={{ ...td, fontWeight: 700, color: TEXT.body, paddingLeft: 14 + depth * 22 }}>
                      {depth > 0 && <span style={{ color: TEXT.muted, marginRight: 6 }}>└</span>}{b.code}
                    </td>
                    <td style={td}>
                      <Pill label={TYPE_LABEL[b.bin_type]} hex={TYPE_HEX[b.bin_type]} />
                    </td>
                    <td style={td}>{b.name || '—'}</td>
                    <td style={td}>{holdingCell(b.id, rows, b.bin_type === 'bin')}</td>
                    <td style={td}>
                      <Pill label={b.is_active ? 'Active' : 'Inactive'} hex={b.is_active ? SUCCESS.hover : TEXT.muted} />
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', gap: 14 }}>
                        {canMove && b.is_active && unassignedAll.length > 0 && <span onClick={() => openMove('putaway', unassignedAll, b)} style={linkStyle}>Put away</span>}
                        {canMove && rows.some((r) => r.quantity > 0) && <span onClick={() => openMove('move', rows, null)} style={linkStyle}>Move</span>}
                        {canCreate && b.is_active && b.bin_type === 'rack' && <span onClick={() => openAdd('shelf', b)} style={linkStyle}>+ Shelf</span>}
                        {canCreate && b.is_active && b.bin_type !== 'bin' && <span onClick={() => openAdd('bin', b)} style={linkStyle}>+ Bin</span>}
                        {canEdit && <span onClick={() => openEdit(b)} style={linkStyle}>Edit</span>}
                        {canEdit && <span onClick={() => toggleActive(b)} style={{ ...linkStyle, color: TEXT.secondary }}>{b.is_active ? 'Deactivate' : 'Reactivate'}</span>}
                        {canDel && <span onClick={() => setDeleteTarget(b)} style={{ ...linkStyle, color: '#b91c1c' }}>Delete</span>}
                      </span>
                    </td>
                  </tr>
                  {rows.length > 0 && isOpen(b.id) && stockRows(rows, depth)}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {locationId && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '24px 0 10px' }}>Moves &amp; Put-aways</h2>
          <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 420 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead><tr>{['Move No.', 'Date', 'Type', 'Item', 'Quantity', 'From → To', 'By', 'Remarks'].map((h, hi) => <th key={h} style={h === 'Quantity' ? { ...th, textAlign: 'right' } : th}>{h}{hi === 0 && <RowCount count={moves.length} />}</th>)}</tr></thead>
              <tbody>
                {movesError && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', padding: 20, color: '#b91c1c' }}>{movesError}</td></tr>}
                {!movesError && moves.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', padding: 20 }}>No bin moves or put-aways in {store?.name || 'this store'} yet.</td></tr>}
                {moves.map((m) => {
                  const putaway = !m.from_bin_code
                  return (
                    <tr key={m.id}>
                      <td style={{ ...td, fontWeight: 700, color: TEXT.body, whiteSpace: 'nowrap' }}>{m.move_number}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{m.move_date ? formatDate(m.move_date) : '—'}</td>
                      <td style={td}>
                        <Pill label={putaway ? 'Put away' : m.to_bin_code ? 'Move' : 'Taken out'} hex={putaway ? SUCCESS.hover : '#0891b2'} />
                      </td>
                      <td style={{ ...td, color: TEXT.body, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${m.item_code || ''} — ${m.item_name || ''}`}>{m.item_code || '—'} — {m.item_name || '—'}</td>
                      <td style={{ ...td, fontWeight: 700, color: TEXT.body, whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtQty(m.quantity)} {m.uom || ''}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{m.from_bin_code || 'Unassigned'} → {m.to_bin_code || 'Unassigned'}</td>
                      <td style={td}>{m.created_by_name || '—'}</td>
                      <td style={td}>{m.remarks || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {form && (
        <FormSheet width={580} icon={form.id ? 'edit' : 'box'} title={`${form.id ? 'Edit' : 'Add'} ${TYPE_LABEL[form.bin_type]}`}
          subtitle={`Store: ${store?.name || '—'} — a bin belongs to this store only.`} onClose={() => setForm(null)} busy={saving}
          footer={<>
            <button type="button" onClick={() => setForm(null)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="button" onClick={save} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {formErrors.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {formErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <SheetSection icon="box" title="Position">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '0 1 140px', minWidth: 120 }}>
                  <label style={sheetLabel}>Type <Req /></label>
                  <Select style={sheetInput} value={form.bin_type} onChange={(e) => {
                    const t = e.target.value as BinType
                    const keep = form.parent_id && PARENT_TYPES[t].includes(byId.get(Number(form.parent_id))?.bin_type as BinType)
                    setForm({ ...form, bin_type: t, parent_id: keep ? form.parent_id : '' })
                  }}>
                    {(['rack', 'shelf', 'bin'] as BinType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                  </Select>
                </div>
                {form.bin_type !== 'rack' && (
                  <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
                    <label style={sheetLabel}>{form.bin_type === 'shelf' ? <>In rack <Req /></> : <>In rack / shelf <Optional /></>}</label>
                    <Select style={sheetInput} value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
                      <option value="">{form.bin_type === 'shelf' ? '— pick a rack —' : '— none (directly in the store) —'}</option>
                      {parentOptions.map((p) => <option key={p.id} value={p.id}>{TYPE_LABEL[p.bin_type]} {p.code}{p.name ? ` — ${p.name}` : ''}</option>)}
                    </Select>
                  </div>
                )}
              </div>
            </SheetSection>
            <SheetSection icon="tag" title="Identification">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '0 1 170px', minWidth: 140 }}>
                  <label style={sheetLabel}>Code <Req /></label>
                  <input style={sheetInput} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder={CODE_HINT[form.bin_type]} autoFocus />
                </div>
                <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
                  <label style={sheetLabel}>Name / Description <Optional /></label>
                  <input style={sheetInput} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Fasteners, top shelf…" />
                </div>
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {moveSheet && (
        <FormSheet width={580} icon="right" title={moveSheet.mode === 'putaway' ? `Put away${moveSheet.to ? ` into ${moveSheet.to.code}` : ' into a bin'}` : `Move from ${moveSheet.sources[0]?.bin_code || 'bin'}`}
          subtitle={`${store?.name || ''} · ${moveFor ? `${moveFor.item_code} — ${moveFor.item_name} · ${moveFor.quantity} ${moveFor.uom || ''} in ${moveFor.bin_code || 'Unassigned'}` : 'pick the item below'}`}
          onClose={() => setMoveSheet(null)} busy={moving}
          footer={<>
            <button type="button" onClick={() => setMoveSheet(null)} disabled={moving} style={sheetBtn('secondary', SHEET.INK, moving)}>Cancel</button>
            <button type="button" disabled={moving} onClick={doMove} style={sheetBtn('primary', SHEET.BLUE, moving)}><SheetIcon name="right" size={16} />{moving ? 'Moving…' : 'Move'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {moveError.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {moveError.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <SheetSection icon="box" title="Item">
              <label style={sheetLabel}>{moveSheet.mode === 'putaway' ? 'Unassigned item' : 'Item in this bin'} <Req /></label>
              <Select style={sheetInput} value={srcKey} autoFocus onChange={(e) => {
                setSrcKey(e.target.value)
                const r = moveSheet.sources.find((x) => rowKey(x) === e.target.value)
                setMoveQty(r ? String(r.quantity) : '')
              }}>
                <option value="">— pick the item —</option>
                {moveSheet.sources.map((r) => <option key={rowKey(r)} value={rowKey(r)}>{r.item_code} — {r.item_name} ({r.quantity} {r.uom || ''})</option>)}
              </Select>
            </SheetSection>
            <SheetSection icon="right" title="Destination">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px' }}>
                  <label style={sheetLabel}>To bin {moveSheet.mode === 'putaway' && <Req />}</label>
                  <Select style={sheetInput} value={toBin} onChange={(e) => setToBin(e.target.value)} disabled={!!moveSheet.to}>
                    <option value="">{moveSheet.mode === 'move' ? 'Unassigned (take out of the bin)' : '— pick a bin —'}</option>
                    {bins.filter((b) => b.is_active && b.id !== moveFor?.bin_id).map((b) => <option key={b.id} value={b.id}>{TYPE_LABEL[b.bin_type]} {b.code}{b.name ? ` — ${b.name}` : ''}</option>)}
                  </Select>
                </div>
                <div style={{ flex: '0 1 130px', minWidth: 110 }}>
                  <label style={sheetLabel}>Quantity <Req /></label>
                  <input type="number" min={0} step="any" style={sheetInput} value={moveQty} onChange={(e) => setMoveQty(e.target.value)} />
                </div>
              </div>
              <p style={sheetHint}>Moves stock inside {store?.name || 'this store'} only — bins of other stores can&apos;t be picked.</p>
            </SheetSection>
            <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
              <input style={sheetInput} value={moveRemarks} onChange={(e) => setMoveRemarks(e.target.value)} placeholder="Why it is moved (re-slotting, rack repair…)" />
            </SheetSection>
          </div>
        </FormSheet>
      )}
    </div>
  )
}
