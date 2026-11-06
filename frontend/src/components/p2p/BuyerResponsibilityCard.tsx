'use client'

// Procurement › Settings › Buyer responsibility: which buyer looks after which
// Item Master categories. A requisition line goes to the buyer of its item's
// category; with no buyer on the category, to the buyer of its item type, then to
// the Default buyer (those two are set further down this page). One category has
// at most one buyer, so a category already with another buyer is shown disabled.
// Backend: GET/PUT /p2p/buyer-responsibility (the PUT replaces the whole list).

import { useEffect, useMemo, useRef, useState } from 'react'
import { apiClient } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT, GLASS, SHADOWS, CONTROL } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import AnchoredPopover from '@/components/shared/AnchoredPopover'
import { squareBtn } from '@/components/shared/MoreValuesButtons'
import { SheetIcon, SHEET, sheetBtn, sheetInput } from '@/components/shared/FormSheet'
import { pillStyle } from '@/components/shared/ui'

// ---- Payload types (kept here until the Manager moves them to types/index.ts) ----
export interface BuyerResponsibilityBuyer { user_id: number; user_name: string; category_ids: number[] }
export interface BuyerResponsibilityCategory {
  id: number; code: string; name: string; item_type: string | null; item_type_label: string | null; buyer_id: number | null
}
export interface BuyerResponsibilityPayload {
  buyers: BuyerResponsibilityBuyer[]
  categories: BuyerResponsibilityCategory[]
  unassigned_category_ids: number[]
  eligible_buyers: { id: number; name: string }[]
  can_edit: boolean
  /** Fingerprint of the saved map; sent back on save so a stale editor gets a 409 instead of overwriting. */
  version?: string
}

// Local helper until p2pApi.getBuyerResponsibility / saveBuyerResponsibility exist in lib/api.ts.
const fetchBuyerResponsibility = async (): Promise<BuyerResponsibilityPayload> => {
  const { data } = await apiClient.get('/p2p/buyer-responsibility'); return data
}
const putBuyerResponsibility = async (buyers: { user_id: number; category_ids: number[] }[], version?: string): Promise<BuyerResponsibilityPayload> => {
  const { data } = await apiClient.put('/p2p/buyer-responsibility', { buyers, version }); return data
}

interface Row { key: number; user_id: number | null; category_ids: number[] }

const WARN = '#b45309'
const catLabel = (c: BuyerResponsibilityCategory) => `${c.name} (${c.code})${c.item_type_label ? ` · ${c.item_type_label}` : ''}`
const sortIds = (ids: number[]) => [...ids].sort((a, b) => a - b)
const rowsOf = (d: BuyerResponsibilityPayload): Row[] => d.buyers.map((b, i) => ({ key: i + 1, user_id: b.user_id, category_ids: sortIds(b.category_ids) }))
const sameRows = (a: Row[], b: Row[]) =>
  a.length === b.length && a.every((r, i) => r.user_id === b[i].user_id && r.category_ids.length === b[i].category_ids.length && r.category_ids.every((c, j) => c === b[i].category_ids[j]))

/** Searchable multi-select of categories in a portaled popover; stays open while ticking. */
function CategoryPicker({ anchorRef, categories, picked, takenBy, onToggle, onClose }: {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  categories: BuyerResponsibilityCategory[]
  picked: number[]
  takenBy: Map<number, string>
  onToggle: (id: number) => void
  onClose: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node
      if (boxRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); anchorRef.current?.focus() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [anchorRef, onClose])
  const needle = q.trim().toLowerCase()
  const list = categories.filter((c) => !needle || catLabel(c).toLowerCase().includes(needle))
  return (
    <AnchoredPopover anchorRef={anchorRef} boxRef={boxRef} minWidth={300} maxHeight={320} align="right">
      <div style={{ padding: 8, position: 'sticky', top: 0, background: '#fff', borderBottom: `1px solid ${SHEET.LINE}` }}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search category, code or item type…" aria-label="Search categories"
          style={{ ...sheetInput, fontSize: CONTROL.fontSize }} />
      </div>
      {list.length === 0 && <div style={{ padding: '12px 14px', fontSize: 13, color: SHEET.MUTED }}>{categories.length ? 'No category matches your search.' : 'There are no Item Master categories yet. Add them in Store › Item Master.'}</div>}
      {list.map((c) => {
        const other = takenBy.get(c.id)
        const on = picked.includes(c.id)
        return (
          // ui-audit-ignore-next-line custom-button — full-width list row (tick box + label) in a picker popover, not a pill button
          <button key={c.id} type="button" role="checkbox" aria-checked={on} disabled={!!other} onClick={() => onToggle(c.id)}
            title={other ? `Already with ${other}. Remove it there first.` : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: CONTROL.height, padding: '6px 12px', border: 'none', background: on ? 'rgba(37,99,235,0.07)' : 'transparent', textAlign: 'left', fontFamily: 'inherit', fontSize: 13, color: other ? SHEET.MUTED : SHEET.INK, cursor: other ? 'not-allowed' : 'pointer', opacity: other ? 0.65 : 1 }}>
            <span aria-hidden="true" style={{ flex: 'none', width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${on ? SHEET.BLUE : '#94a3b8'}`, background: on ? SHEET.BLUE : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              {on && <SheetIcon name="check" size={11} />}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>{catLabel(c)}</span>
            {other && <span style={{ flex: 'none', fontSize: 11.5, fontWeight: 600 }}>with {other}</span>}
          </button>
        )
      })}
    </AnchoredPopover>
  )
}

function BuyerRow({ row, data, rows, canEdit, onPatch, onRemove }: {
  row: Row
  data: BuyerResponsibilityPayload
  rows: Row[]
  canEdit: boolean
  onPatch: (p: Partial<Row>) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const plusRef = useRef<HTMLButtonElement>(null)
  const byId = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories])
  const nameOf = (id: number) => data.eligible_buyers.find((b) => b.id === id)?.name || data.buyers.find((b) => b.user_id === id)?.user_name || `User #${id}`
  const used = new Set(rows.filter((r) => r.key !== row.key && r.user_id != null).map((r) => r.user_id as number))
  const buyerOpts = data.eligible_buyers.filter((b) => !used.has(b.id)).map((b) => ({ value: String(b.id), label: b.name }))
  if (row.user_id != null && !buyerOpts.some((o) => o.value === String(row.user_id))) buyerOpts.push({ value: String(row.user_id), label: nameOf(row.user_id) })
  const takenBy = new Map<number, string>()
  rows.forEach((r) => { if (r.key !== row.key && r.user_id != null) r.category_ids.forEach((c) => takenBy.set(c, nameOf(r.user_id as number))) })
  const toggle = (id: number) => onPatch({ category_ids: sortIds(row.category_ids.includes(id) ? row.category_ids.filter((x) => x !== id) : [...row.category_ids, id]) })
  const chips = row.category_ids.map((id) => byId.get(id)).filter((c): c is BuyerResponsibilityCategory => !!c)
  const buyerName = row.user_id != null ? nameOf(row.user_id) : 'this buyer'
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start', padding: '10px 0', borderTop: `1px solid ${SHEET.LINE}` }}>
      <div style={{ flex: '0 1 220px', minWidth: 180 }}>
        <SearchableSelect value={row.user_id != null ? String(row.user_id) : ''} onChange={(v) => onPatch({ user_id: v ? Number(v) : null })}
          options={buyerOpts} placeholder="Select buyer" disabled={!canEdit} ariaLabel="Buyer" />
      </div>
      <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', minHeight: CONTROL.height }}>
          {chips.length === 0 && <span style={{ fontSize: 12.5, color: SHEET.MUTED }}>{row.user_id != null ? 'No categories yet. Use + to add some.' : 'Pick a buyer, then add categories.'}</span>}
          {chips.map((c) => (
            <span key={c.id} title={catLabel(c)} style={{ ...pillStyle(SHEET.BLUE), gap: 6, padding: '4px 6px 4px 10px', fontSize: 12.5, fontWeight: 600, maxWidth: '100%' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name} ({c.code})</span>
              {canEdit && (
                <button type="button" aria-label={`Remove ${c.name} from ${buyerName}`} onClick={() => toggle(c.id)}
                  style={{ border: 'none', background: 'transparent', color: SHEET.BLUE, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0, minWidth: 24, minHeight: 24 }}>×</button>
              )}
            </span>
          ))}
        </div>
        {canEdit && (
          <>
            <button ref={plusRef} type="button" aria-label={`Add categories for ${buyerName}`} title={row.user_id == null ? 'Pick a buyer first.' : 'Add categories'}
              disabled={row.user_id == null} aria-expanded={open} onClick={() => setOpen((o) => !o)} style={squareBtn(SHEET.BLUE, row.user_id == null)}>
              <SheetIcon name="plus" size={15} />
            </button>
            {open && <CategoryPicker anchorRef={plusRef} categories={data.categories} picked={row.category_ids} takenBy={takenBy} onToggle={toggle} onClose={() => setOpen(false)} />}
          </>
        )}
      </div>
      {canEdit && (
        <button type="button" aria-label={`Remove ${buyerName} from this list`} title="Remove this buyer's row" onClick={onRemove} style={squareBtn('#DC2626')}>
          <SheetIcon name="trash" size={15} />
        </button>
      )}
    </div>
  )
}

export default function BuyerResponsibilityCard() {
  const [data, setData] = useState<BuyerResponsibilityPayload | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [loadError, setLoadError] = useState('')
  const [noAccess, setNoAccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string[]>([])
  const [saved, setSaved] = useState(false)
  const nextKey = useRef(1000)

  const apply = (d: BuyerResponsibilityPayload) => { setData(d); setRows(rowsOf(d)) }
  const load = () => {
    setLoadError('')
    fetchBuyerResponsibility().then(apply).catch((err) => {
      if ((err as { response?: { status?: number } })?.response?.status === 403) { setNoAccess(true); return }
      setLoadError(extractErrorMessages(err, 'Could not load the buyer responsibility list.').join(' '))
    })
  }
  useEffect(() => { load() }, [])

  const dirty = !!data && !sameRows(rows, rowsOf(data))
  const patchRow = (key: number, p: Partial<Row>) => { setSaved(false); setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r))) }
  const unassigned = useMemo(() => {
    if (!data) return []
    const assigned = new Set(rows.flatMap((r) => (r.user_id != null ? r.category_ids : [])))
    return data.categories.filter((c) => !assigned.has(c.id))
  }, [data, rows])

  const save = async () => {
    if (rows.some((r) => r.user_id == null)) { setError(['Pick a buyer for every row, or remove the row that has none.']); return }
    setBusy(true); setError([]); setSaved(false)
    try {
      apply(await putBuyerResponsibility(rows.filter((r) => r.category_ids.length > 0).map((r) => ({ user_id: r.user_id as number, category_ids: r.category_ids })), data?.version))
      setSaved(true)
    } catch (err) { setError(extractErrorMessages(err, 'Could not save the buyer responsibility list.')) }
    finally { setBusy(false) }
  }

  if (noAccess) return null
  const canEdit = !!data?.can_edit
  const canAdd = canEdit && !!data && data.eligible_buyers.some((b) => !rows.some((r) => r.user_id === b.id))

  return (
    <div data-tour="p2p-buyer-responsibility" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Buyer responsibility</h2>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 12px' }}>
        Each Item Master category goes to one buyer. A requisition line goes to the buyer of its item&apos;s category; if the category has no buyer, to the buyer of its item type below, then to the Default buyer.
        {data && !canEdit ? ' You can view this list but not change it. Ask an admin for edit access to Procurement settings.' : ''}
      </p>
      {loadError && (
        <div role="alert" style={{ padding: '10px 12px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: 13, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>{loadError} Check your connection and try again.</span>
          <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={load}>Try again</button>
        </div>
      )}
      {error.length > 0 && (
        <div role="alert" style={{ padding: '10px 12px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: 13, marginBottom: 12 }}>
          {error.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )}
      {!data && !loadError && <p role="status" style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Loading…</p>}
      {data && (
        <>
          <div style={{ background: '#fff', border: `1px solid ${SHEET.LINE}`, borderRadius: 10, padding: '0 12px' }}>
            {rows.length === 0 && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0, padding: '12px 0' }}>No buyer has categories yet.{canEdit ? ' Use Add buyer to start.' : ''}</p>}
            {rows.map((r, i) => (
              <div key={r.key} style={i === 0 ? { marginTop: -1 } : undefined}>
                <BuyerRow row={r} data={data} rows={rows} canEdit={canEdit}
                  onPatch={(p) => patchRow(r.key, p)} onRemove={() => { setSaved(false); setRows((rs) => rs.filter((x) => x.key !== r.key)) }} />
              </div>
            ))}
          </div>

          <div data-tour="p2p-buyer-responsibility-unassigned" style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: unassigned.length ? WARN : TEXT.secondary, marginBottom: unassigned.length ? 6 : 0 }}>
              Categories without a buyer ({unassigned.length})
              {unassigned.length === 0 && <span style={{ fontWeight: 400, color: TEXT.muted }}> — every category has a buyer.</span>}
            </div>
            {unassigned.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {unassigned.map((c) => (
                  <span key={c.id} title={`${catLabel(c)} — has no buyer, so its lines go to the item-type buyer or the Default buyer.`} style={{ ...pillStyle('#d97706'), padding: '4px 10px', fontSize: 12.5, fontWeight: 600 }}>{c.name} ({c.code})</span>
                ))}
              </div>
            )}
          </div>

          {canEdit && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <button type="button" aria-label="Add buyer" title={canAdd ? 'Add a buyer' : 'Every eligible buyer is already in the list.'} disabled={!canAdd}
                onClick={() => { setSaved(false); setRows((rs) => [...rs, { key: nextKey.current++, user_id: null, category_ids: [] }]) }}
                style={{ ...squareBtn(SHEET.BLUE, !canAdd), alignSelf: 'center' }}>
                <SheetIcon name="plus" size={15} />
              </button>
              <span style={{ fontSize: 12.5, color: SHEET.MUTED }}>Add buyer</span>
              <span style={{ flex: 1 }} />
              {saved && !dirty && <span role="status" style={{ fontSize: 12.5, color: '#15803d', fontWeight: 600 }}>Saved</span>}
              <button type="button" disabled={busy || !dirty} style={sheetBtn('secondary', SHEET.INK, busy || !dirty)} onClick={() => { setError([]); setSaved(false); setRows(rowsOf(data)) }}>Cancel</button>
              <button type="button" data-tour="p2p-buyer-responsibility-save" disabled={busy || !dirty} style={sheetBtn('primary', SHEET.BLUE, busy || !dirty)} onClick={save}>
                <SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
