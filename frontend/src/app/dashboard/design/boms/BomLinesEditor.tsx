'use client'

import Select from '@/components/shared/Select'
import { useMemo, useState } from 'react'
import { designApi } from '@/lib/api'
import { DesignBomLine, DesignBomLineInput, DesignLookupOption } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { SHEET, SheetIcon, sheetBtn } from '@/components/shared/FormSheet'
import { toOptions } from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import ImportDialog from '@/components/shared/ImportDialog'

// Editable rows of a BOM revision — used by "New BOM" and by the draft
// revision editor on the BOM detail page. A line is either an Item Master
// item or a new-item request (name + spec) until Store creates the code.

export type BomLineDraft = {
  key: number
  position: string
  is_new: boolean
  store_item_id: string
  new_item_name: string
  new_item_spec: string
  quantity: string
  uom: string
  document_id: string
  make_buy: 'make' | 'buy'
  remarks: string
}

let seq = 0
const nextKey = () => ++seq

export function emptyBomLine(position = ''): BomLineDraft {
  return {
    key: nextKey(), position, is_new: false, store_item_id: '', new_item_name: '', new_item_spec: '',
    quantity: '1', uom: 'Nos', document_id: '', make_buy: 'buy', remarks: '',
  }
}

export function bomLinesToDrafts(lines: DesignBomLine[]): BomLineDraft[] {
  return [...lines].sort((a, b) => a.position - b.position).map((l) => ({
    key: nextKey(), position: String(l.position), is_new: !l.store_item_id,
    store_item_id: l.store_item_id ? String(l.store_item_id) : '', new_item_name: l.new_item_name || '',
    new_item_spec: l.new_item_spec || '', quantity: String(l.quantity), uom: l.uom || '',
    document_id: l.document_id ? String(l.document_id) : '', make_buy: l.make_buy, remarks: l.remarks || '',
  }))
}

/** Item options the saved lines already reference, so their labels show before any search. */
export function itemsFromBomLines(lines: DesignBomLine[]): DesignLookupOption[] {
  return lines.filter((l) => l.store_item_id).map((l) => ({
    id: l.store_item_id as number, label: `${l.item_code || '#' + l.store_item_id} — ${l.item_name || ''}`, code: l.item_code,
  }))
}

/**
 * "Import from Excel" for BOM lines: the server reads the file (Item Master by
 * item_code, drawings by number) and nothing is saved — the lines replace the
 * form's rows, the user reviews them and saves the BOM / revision as usual.
 */
export function BomImportButton({ disabled, hasLines, onLines }: {
  disabled?: boolean
  /** The form already has filled-in lines — the import replaces them. */
  hasLines: boolean
  onLines: (rows: BomLineDraft[], items: DesignLookupOption[], documents: DesignLookupOption[]) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" data-tour="design-bom-import" disabled={disabled} onClick={() => setOpen(true)} style={sheetBtn('secondary', SHEET.INK, disabled)}>
        <SheetIcon name="upload" size={15} />Import from Excel
      </button>
      {open && (
        <ImportDialog
          title="Import BOM lines"
          intro={<>
            One row per line: <b>item_code</b> from the Item Master and <b>quantity</b>. For a part with no code yet leave item_code blank and fill
            <b> new_item_name</b> (+ new_item_spec) — Store gets an item-code request. Optional: position, uom, drawing_no (Design document number), make_buy (make / buy), remarks.
            {hasLines && <><br /><b>The imported lines replace the lines in the form.</b></>} Nothing is saved until you save the BOM.
          </>}
          templateName="bom_lines_template.xlsx"
          getTemplate={designApi.bomLinesTemplate}
          upload={async (file) => {
            const r = await designApi.importBomLines(file)
            if (r.lines.length) {
              onLines(
                [...r.lines].sort((a, b) => a.position - b.position).map((l) => ({
                  key: nextKey(), position: String(l.position), is_new: !l.store_item_id,
                  store_item_id: l.store_item_id ? String(l.store_item_id) : '', new_item_name: l.new_item_name || '',
                  new_item_spec: l.new_item_spec || '', quantity: String(l.quantity), uom: l.uom || '',
                  document_id: l.document_id ? String(l.document_id) : '', make_buy: l.make_buy, remarks: l.remarks || '',
                })),
                r.lines.filter((l) => l.store_item_id).map((l) => ({ id: l.store_item_id as number, label: `${l.item_code} — ${l.item_name || ''}`, code: l.item_code })),
                r.lines.filter((l) => l.document_id).map((l) => ({ id: l.document_id as number, label: l.document_label || `#${l.document_id}` })),
              )
            }
            return {
              summary: r.lines.length
                ? [`${r.lines.length} line${r.lines.length === 1 ? '' : 's'} loaded into the form — review them, then save.`]
                : ['No line could be loaded — fix the rows below and import again.'],
              errors: r.errors.map((e) => ({ where: `Row ${e.row}${e.item_code ? ` (${e.item_code})` : ''}`, reason: e.reason })),
            }
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** Checks the rows and builds the API payload. Returns an error message instead when a row is incomplete. */
export function bomDraftsToPayload(rows: BomLineDraft[]): { lines: DesignBomLineInput[] } | { error: string } {
  const lines: DesignBomLineInput[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const label = `Line ${r.position || i + 1}`
    if (r.is_new) {
      if (r.new_item_name.trim().length < 2) return { error: `${label}: give the new item a name (Store creates its code from it) — or pick an existing item.` }
    } else if (!r.store_item_id) {
      return { error: `${label}: pick an item from Item Master, or tick “New item” if it doesn't exist yet.` }
    }
    const qty = Number(r.quantity)
    if (!r.quantity.trim() || !Number.isFinite(qty) || qty <= 0) return { error: `${label}: quantity must be a number greater than 0.` }
    const pos = r.position.trim() ? Number(r.position) : (i + 1) * 10
    if (!Number.isInteger(pos) || pos <= 0) return { error: `${label}: position must be a whole number (e.g. 10, 20, 30).` }
    lines.push({
      position: pos,
      store_item_id: r.is_new ? null : Number(r.store_item_id),
      new_item_name: r.is_new ? r.new_item_name.trim() : null,
      new_item_spec: r.is_new ? (r.new_item_spec.trim() || null) : null,
      quantity: qty,
      uom: r.uom.trim() || null,
      document_id: r.document_id ? Number(r.document_id) : null,
      make_buy: r.make_buy,
      remarks: r.remarks.trim() || null,
    })
  }
  const seen = new Set<number>()
  for (const l of lines) {
    if (seen.has(l.position as number)) return { error: `Position ${l.position} is used twice — every line needs its own position number.` }
    seen.add(l.position as number)
  }
  return { lines }
}

// Same look as the FormSheet kit (white inputs, slate lines, soft header row).
const cellInput: React.CSSProperties = {
  width: '100%', padding: '7px 9px', borderRadius: 8, border: `1px solid ${SHEET.LINE}`,
  background: '#fff', fontSize: 12.5, outline: 'none', color: SHEET.INK, boxSizing: 'border-box', fontFamily: 'inherit',
}
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '9px 8px', fontSize: 11.5, fontWeight: 600, color: SHEET.MUTED, background: SHEET.SOFT, borderBottom: `1px solid ${SHEET.LINE}`, whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '7px 8px', fontSize: 12.5, color: SHEET.BODY, borderBottom: `1px solid ${SHEET.LINE}`, verticalAlign: 'top' }
const miniBtn = (disabled: boolean, color: string = SHEET.INK): React.CSSProperties => ({ ...sheetBtn('secondary', SHEET.INK, disabled), padding: '4px 8px', fontSize: 12, lineHeight: 1.2, color })

export default function BomLinesEditor({
  rows,
  onChange,
  items,
  onItemsLoaded,
  documents,
  disabled = false,
}: {
  rows: BomLineDraft[]
  onChange: (rows: BomLineDraft[]) => void
  /** Item Master options known so far (initial load + search results + items already on the lines). */
  items: DesignLookupOption[]
  /** Called with extra items found by the server-side search so the parent can keep them. */
  onItemsLoaded: (found: DesignLookupOption[]) => void
  documents: DesignLookupOption[]
  disabled?: boolean
}) {
  const [itemSearch, setItemSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchMsg, setSearchMsg] = useState('')

  const itemOptions = useMemo(() => toOptions(items, 'Select item…'), [items])
  const docOptions = useMemo(() => toOptions(documents, 'No drawing'), [documents])

  const update = (key: number, patch: Partial<BomLineDraft>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const remove = (key: number) => onChange(rows.filter((r) => r.key !== key))
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= rows.length) return
    // Swap the rows and keep the position numbers in place, so the new
    // order is what gets saved (lines are stored sorted by position).
    const next = [...rows]
    const a = next[index], b = next[target]
    next[index] = { ...b, position: a.position }
    next[target] = { ...a, position: b.position }
    onChange(next)
  }
  const addRow = () => {
    const maxPos = rows.reduce((m, r) => Math.max(m, Number(r.position) || 0), 0)
    onChange([...rows, emptyBomLine(String(Math.floor(maxPos / 10) * 10 + 10))])
  }
  const renumber = () => onChange(rows.map((r, i) => ({ ...r, position: String((i + 1) * 10) })))

  const runSearch = async () => {
    const q = itemSearch.trim()
    if (!q) return
    setSearching(true)
    setSearchMsg('')
    try {
      const found = await designApi.lookupItems(q)
      onItemsLoaded(found)
      setSearchMsg(found.length ? `${found.length} item${found.length === 1 ? '' : 's'} found for “${q}” — pick them in the Item column.` : `No Item Master item matches “${q}”. Tick “New item” on the line to request one from Store.`)
    } catch (err) {
      setSearchMsg(extractErrorMessages(err, 'Searching Item Master failed.').join(' '))
    } finally {
      setSearching(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <input
          data-tour="design-bomlines-item-search"
          style={{ ...cellInput, flex: '1 1 240px', maxWidth: 340, padding: '8px 10px', fontSize: 13 }}
          placeholder="Find more Item Master items (code, name, part no.)…"
          value={itemSearch}
          disabled={disabled}
          onChange={(e) => setItemSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch() } }}
        />
        <button type="button" disabled={disabled || searching || !itemSearch.trim()} style={sheetBtn('secondary', SHEET.INK, disabled || searching || !itemSearch.trim())} onClick={runSearch}>
          <SheetIcon name="search" size={14} />{searching ? 'Searching…' : 'Search'}
        </button>
        {searchMsg && <span style={{ fontSize: 12, color: SHEET.MUTED }}>{searchMsg}</span>}
      </div>

      <div style={{ overflowX: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
          <thead>
            <tr>
              <th data-tour="design-bomlines-pos" style={{ ...thStyle, width: 70 }}>Pos.</th>
              <th data-tour="design-bomlines-item" style={{ ...thStyle, minWidth: 300 }}>Item</th>
              <th data-tour="design-bomlines-qty" style={{ ...thStyle, width: 90 }}>Qty</th>
              <th data-tour="design-bomlines-uom" style={{ ...thStyle, width: 80 }}>UOM</th>
              <th data-tour="design-bomlines-drawing" style={{ ...thStyle, minWidth: 220 }}>Drawing</th>
              <th data-tour="design-bomlines-make-buy" style={{ ...thStyle, width: 96 }}>Make / Buy</th>
              <th data-tour="design-bomlines-remarks" style={{ ...thStyle, minWidth: 160 }}>Remarks</th>
              <th style={{ ...thStyle, width: 110 }} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: SHEET.MUTED, padding: 16 }}>No lines yet — add the parts of this assembly.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={r.key}>
                <td style={tdStyle}>
                  <input style={cellInput} value={r.position} disabled={disabled} inputMode="numeric" onChange={(e) => update(r.key, { position: e.target.value.replace(/[^0-9]/g, '') })} />
                </td>
                <td style={tdStyle}>
                  {r.is_new ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input style={cellInput} value={r.new_item_name} disabled={disabled} placeholder="New item name *" onChange={(e) => update(r.key, { new_item_name: e.target.value })} />
                      <input style={cellInput} value={r.new_item_spec} disabled={disabled} placeholder="Specification (material, size, grade…)" onChange={(e) => update(r.key, { new_item_spec: e.target.value })} />
                    </div>
                  ) : (
                    <SearchableSelect value={r.store_item_id} onChange={(v) => update(r.key, { store_item_id: v })} options={itemOptions} placeholder="Select item…" disabled={disabled} />
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: r.is_new ? '#b45309' : SHEET.MUTED, marginTop: 5, cursor: disabled ? 'default' : 'pointer' }}>
                    <input type="checkbox" checked={r.is_new} disabled={disabled} onChange={(e) => update(r.key, { is_new: e.target.checked })} />
                    New item (not in Item Master yet) — Store is asked to create the code
                  </label>
                </td>
                <td style={tdStyle}>
                  <input style={cellInput} value={r.quantity} disabled={disabled} inputMode="decimal" onChange={(e) => update(r.key, { quantity: e.target.value.replace(/[^0-9.]/g, '') })} />
                </td>
                <td style={tdStyle}>
                  <input style={cellInput} value={r.uom} disabled={disabled} maxLength={20} placeholder="Nos" onChange={(e) => update(r.key, { uom: e.target.value })} />
                </td>
                <td style={tdStyle}>
                  <SearchableSelect value={r.document_id} onChange={(v) => update(r.key, { document_id: v })} options={docOptions} placeholder="No drawing" disabled={disabled} />
                </td>
                <td style={tdStyle}>
                  <Select style={cellInput} value={r.make_buy} disabled={disabled} onChange={(e) => update(r.key, { make_buy: e.target.value as 'make' | 'buy' })}>
                    <option value="buy">Buy</option>
                    <option value="make">Make</option>
                  </Select>
                </td>
                <td style={tdStyle}>
                  <input style={cellInput} value={r.remarks} disabled={disabled} onChange={(e) => update(r.key, { remarks: e.target.value })} />
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <button type="button" title="Move up" disabled={disabled || i === 0} style={miniBtn(disabled || i === 0)} onClick={() => move(i, -1)}>↑</button>{' '}
                  <button type="button" title="Move down" disabled={disabled || i === rows.length - 1} style={miniBtn(disabled || i === rows.length - 1)} onClick={() => move(i, 1)}>↓</button>{' '}
                  <button type="button" title="Remove line" disabled={disabled} aria-label="Remove line" style={miniBtn(disabled, '#dc2626')} onClick={() => remove(r.key)}><SheetIcon name="trash" size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button data-tour="design-bomlines-add-btn" type="button" disabled={disabled} style={sheetBtn('secondary', SHEET.INK, disabled)} onClick={addRow}><SheetIcon name="plus" size={14} />Add line</button>
        {rows.length > 1 && (
          <button data-tour="design-bomlines-renumber-btn" type="button" disabled={disabled} style={sheetBtn('secondary', SHEET.INK, disabled)} onClick={renumber}>Renumber 10, 20, 30…</button>
        )}
        <span style={{ fontSize: 12, color: SHEET.MUTED, alignSelf: 'center' }}>
          {rows.length} line{rows.length === 1 ? '' : 's'} · ↑/↓ moves a line (positions stay in sequence); “Renumber” resets them to 10, 20, 30…
        </span>
      </div>
    </div>
  )
}
