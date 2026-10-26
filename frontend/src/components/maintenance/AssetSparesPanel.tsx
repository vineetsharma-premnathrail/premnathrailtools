'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAssetSpare, MaintenanceStoreItemOption } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, primaryBtnStyle, RowCount, Pill } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

/** Draft line while editing — item details kept for display. */
interface DraftLine {
  store_item_id: number
  item_code: string
  item_name: string
  uom?: string | null
  qty: string
  is_critical: boolean
  remarks: string
}

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', whiteSpace: 'nowrap', textTransform: 'uppercase', color: TEXT.muted }
const tdStyle: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'middle' }

const fmtQty = (q: number | null | undefined) => (q == null ? '—' : `${Math.round(q * 1000) / 1000}`)

function toDraft(l: MaintenanceAssetSpare): DraftLine {
  return {
    store_item_id: l.store_item_id, item_code: l.item_code || `#${l.store_item_id}`, item_name: l.item_name || '',
    uom: l.uom, qty: String(l.qty_per_replacement), is_critical: l.is_critical, remarks: l.remarks || '',
  }
}

/**
 * Asset bill of spares — which Store items this asset consumes, how many per
 * replacement, and which are critical (keep minimum stock). Stock shown is
 * read live from the Store; nothing is stocked here.
 */
export default function AssetSparesPanel({ assetId, canEdit }: { assetId: number; canEdit: boolean }) {
  const router = useRouter()
  const [lines, setLines] = useState<MaintenanceAssetSpare[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<DraftLine[]>([])
  const [saving, setSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [itemSearch, setItemSearch] = useState('')
  const [itemOptions, setItemOptions] = useState<MaintenanceStoreItemOption[]>([])

  useEffect(() => {
    if (!assetId) return
    setLoading(true)
    maintenanceApi.getAssetSpares(assetId)
      .then((data) => { setLines(Array.isArray(data) ? data : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the bill of spares.')))
      .finally(() => setLoading(false))
  }, [assetId])

  // Store item search (spare parts first) while the picker has text.
  useEffect(() => {
    if (!editing || !itemSearch.trim()) { setItemOptions([]); return }
    const t = setTimeout(() => {
      maintenanceApi.lookupStoreItems({ search: itemSearch.trim() })
        .then(setItemOptions)
        .catch((err) => setError(extractErrorMessages(err, 'Failed to search Store items.')))
    }, 250)
    return () => clearTimeout(t)
  }, [editing, itemSearch])

  const startEdit = () => {
    setDraft(lines.map(toDraft))
    setItemSearch('')
    setError('')
    setEditing(true)
  }

  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(lines.map(toDraft))

  const cancelEdit = () => {
    if (dirty) { setConfirmDiscard(true); return }
    setEditing(false)
    setError('')
  }

  const addItem = (it: MaintenanceStoreItemOption) => {
    if (draft.some((d) => d.store_item_id === it.id)) {
      setError(`'${it.item_name}' (${it.item_code}) is already on this bill of spares — change its quantity instead.`)
      return
    }
    setError('')
    setDraft([...draft, { store_item_id: it.id, item_code: it.item_code, item_name: it.item_name, uom: it.uom, qty: '1', is_critical: false, remarks: '' }])
    setItemSearch('')
  }

  const patch = (idx: number, p: Partial<DraftLine>) => setDraft(draft.map((d, i) => (i === idx ? { ...d, ...p } : d)))

  const save = async () => {
    for (const d of draft) {
      const q = Number(d.qty)
      if (!d.qty.trim() || !Number.isFinite(q) || q <= 0) {
        setError(`Quantity per replacement for '${d.item_name}' (${d.item_code}) must be a number greater than 0.`)
        return
      }
    }
    setSaving(true)
    setError('')
    try {
      const saved = await maintenanceApi.putAssetSpares(assetId, draft.map((d) => ({
        store_item_id: d.store_item_id, qty_per_replacement: Number(d.qty), is_critical: d.is_critical, remarks: d.remarks.trim() || null,
      })))
      setLines(saved)
      setEditing(false)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save the bill of spares.'))
    } finally {
      setSaving(false)
    }
  }

  const stockBadge = (l: MaintenanceAssetSpare) => {
    const min = l.minimum_stock ?? l.reorder_level
    const [hex, label] = l.below_min
      ? ['#DC2626', 'Below min']
      : l.reorder_level != null && l.on_hand_total <= l.reorder_level
        ? ['#F59E0B', 'At reorder']
        : min == null ? ['#78716c', 'No min set'] : ['#16A34A', 'OK']
    return (
      <Pill label={label} hex={hex} />
    )
  }

  return (
    <div style={sectionStyle}>
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard changes?"
        message="Your edits to the bill of spares haven't been saved. Discard them?"
        confirmLabel="Discard"
        danger
        onConfirm={() => { setConfirmDiscard(false); setEditing(false); setError('') }}
        onCancel={() => setConfirmDiscard(false)}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Bill of Spares</h3>
          <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '4px 0 0' }}>
            Store items this asset consumes. Mark a spare critical to get an alert when Store stock drops below its minimum.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!editing && (
            <button data-tour="maint-bos-stock-btn" onClick={() => router.push('/dashboard/maintenance/spares')} style={secondaryBtnStyle}>Spares stock</button>
          )}
          {canEdit && !editing && !loading && (
            <button data-tour="maint-bos-edit-btn" onClick={startEdit} style={secondaryBtnStyle}>{lines.length ? 'Edit' : '+ Add spares'}</button>
          )}
          {editing && (
            <>
              <button data-tour="maint-bos-cancel" onClick={cancelEdit} disabled={saving} style={secondaryBtnStyle}>Cancel</button>
              <button
                data-tour="maint-bos-save"
                onClick={save} disabled={saving}
                style={{ ...primaryBtnStyle, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
      ) : !editing ? (
        lines.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No spares listed for this asset yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>{['Item', 'Qty / Replacement', 'Critical', 'On Hand (all stores)', 'Min / Reorder', 'Stock', 'Remarks'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={lines.length} />}</th>)}</tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: TEXT.heading }}>{l.item_code}</div>
                      <div style={{ fontSize: 12, color: TEXT.secondary }}>{l.item_name}</div>
                    </td>
                    <td style={tdStyle}>{fmtQty(l.qty_per_replacement)} {l.uom || ''}</td>
                    <td style={tdStyle}>
                      {l.is_critical ? <Pill label="Critical" hex="#DC2626" /> : '—'}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{fmtQty(l.on_hand_total)} {l.uom || ''}</td>
                    <td style={tdStyle}>{fmtQty(l.minimum_stock)} / {fmtQty(l.reorder_level)}</td>
                    <td style={tdStyle}>{stockBadge(l)}</td>
                    <td style={{ ...tdStyle, color: TEXT.secondary }}>{l.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <>
          <div style={{ marginBottom: 12, maxWidth: 520 }}>
            <input
              data-tour="maint-bos-search"
              style={inputStyle} value={itemSearch} onChange={(e) => setItemSearch(e.target.value)}
              placeholder="Add a spare — search Store items by code, name or part number…"
            />
            {itemSearch.trim() && (
              <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 6, border: `1px solid ${BORDER.light}`, borderRadius: 10, background: 'rgba(255,255,255,.85)' }}>
                {itemOptions.length === 0 ? (
                  <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0, padding: 10 }}>No matching Store items. Create the spare in Store › Items first.</p>
                ) : itemOptions.slice(0, 15).map((it) => {
                  const already = draft.some((d) => d.store_item_id === it.id)
                  return (
                    <div key={it.id} onClick={() => !already && addItem(it)} style={{
                      display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 10px', fontSize: 13,
                      cursor: already ? 'default' : 'pointer', opacity: already ? 0.5 : 1, borderTop: `1px solid ${BORDER.light}`,
                    }}>
                      <span><b>{it.item_code}</b> {it.item_name}{it.item_type && it.item_type !== 'spare_part' ? <span style={{ color: TEXT.muted }}> · {it.item_type}</span> : null}</span>
                      <span style={{ color: TEXT.muted, whiteSpace: 'nowrap' }}>{already ? 'added' : it.uom || ''}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {draft.length === 0 ? (
            <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No spares on the list. Search above to add one, or Save to clear the list.</p>
          ) : (
            <div data-tour="maint-bos-draft" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead>
                  <tr>{['Item', 'Qty / Replacement', 'Critical', 'Remarks', ''].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={draft.length} />}</th>)}</tr>
                </thead>
                <tbody>
                  {draft.map((d, idx) => (
                    <tr key={d.store_item_id}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600, color: TEXT.heading }}>{d.item_code}</div>
                        <div style={{ fontSize: 12, color: TEXT.secondary }}>{d.item_name}</div>
                      </td>
                      <td style={{ ...tdStyle, width: 150 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input style={{ ...inputStyle, width: 90 }} type="number" min={0} step="any" value={d.qty} onChange={(e) => patch(idx, { qty: e.target.value })} />
                          <span style={{ fontSize: 12, color: TEXT.muted }}>{d.uom || ''}</span>
                        </div>
                      </td>
                      <td style={{ ...tdStyle, width: 80 }}>
                        <input type="checkbox" checked={d.is_critical} onChange={(e) => patch(idx, { is_critical: e.target.checked })} />
                      </td>
                      <td style={tdStyle}>
                        <input style={{ ...inputStyle, maxWidth: 320 }} maxLength={255} value={d.remarks} onChange={(e) => patch(idx, { remarks: e.target.value })} placeholder="e.g. Spindle front bearing" />
                      </td>
                      <td style={{ ...tdStyle, width: 70 }}>
                        <span onClick={() => setDraft(draft.filter((_, i) => i !== idx))} style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', cursor: 'pointer' }}>Remove</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
