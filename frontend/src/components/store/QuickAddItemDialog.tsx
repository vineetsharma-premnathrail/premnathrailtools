'use client'

// Add a new Item Master item without leaving the Before PO receipt (owner, 2026-11-14)
// or the goods receipt (GRN) — a PR line typed by hand gets its item code here (2026-11-18).
// Only what the receipt needs: type, category, name, unit, technical details (+ HSN / GST if known).
// While the name / details are typed, the Item Master is searched for look-alikes
// (same name on this vendor's bill, same or similar name) so an existing item is
// used instead of a duplicate. The new item is flagged "Added at inward — needs
// review" and is completed later in the Item Master (planning, quality, ledgers).
// Backend: GET /store/items/similar, POST /store/items { from_inward: true }.

import { useEffect, useMemo, useState } from 'react'
import { storeApi } from '@/lib/api'
import { StoreItem, StoreItemCategory, StoreItemMeta, StoreItemSimilar } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import Select from '@/components/shared/Select'
import { Pill } from '@/components/shared/ui'
import { FormSheet, SheetError, SheetField, SheetSection, Optional, SHEET, sheetBtn, sheetInput, sheetHint } from '@/components/shared/FormSheet'

type Form = { itemType: string; category: string; name: string; uom: string; spec: string; hsn: string; gst: string }
const MATCH_LABEL: Record<StoreItemSimilar['match'], { label: string; hex: string }> = {
  bill_name: { label: "On this vendor's bill", hex: '#16a34a' },
  same_name: { label: 'Same name', hex: '#dc2626' },
  similar: { label: 'Similar', hex: '#d97706' },
}

export default function QuickAddItemDialog({ initialName, initialType, initialCategory, initialSpec, initialUom, subtitle, allowedTypes, vendorId, onClose, onCreated, onPickExisting }: {
  initialName?: string
  initialType?: string
  /** Pre-fills the category (and its type) — e.g. the PR line's category on a GRN. */
  initialCategory?: string
  initialSpec?: string
  initialUom?: string
  subtitle?: string
  /** Item types this receipt may carry (the form's stock types). */
  allowedTypes: (t: string) => boolean
  vendorId?: number
  onClose: () => void
  onCreated: (item: StoreItem) => void
  onPickExisting: (itemId: number) => void
}) {
  const [meta, setMeta] = useState<StoreItemMeta | null>(null)
  const [categories, setCategories] = useState<StoreItemCategory[]>([])
  const [form, setForm] = useState<Form>({ itemType: initialType || '', category: '', name: (initialName || '').trim(), uom: (initialUom || '').toUpperCase(), spec: (initialSpec || '').trim(), hsn: '', gst: '' })
  const [similar, setSimilar] = useState<StoreItemSimilar[]>([])
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  // Only when nothing was handed in from the receipt line — a prefilled name is that line's, not a draft.
  const draft = useFormDraft(initialName ? null : 'store-quick-item-new', form, (d) => setForm((f) => ({ ...f, ...d })))
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))

  useEffect(() => {
    const fail = (what: string) => (err: unknown) => setError(extractErrorMessages(err, `Could not load ${what} — close this window and open it again.`))
    storeApi.getItemMeta().then(setMeta).catch(fail('the item types and units'))
    storeApi.listCategories().then((c: StoreItemCategory[]) => {
      setCategories(c)
      // A handed-in category (with its type) is pre-picked when it is an active one.
      const hit = initialCategory ? c.find((x) => x.is_active && !x.parent_id && x.name === initialCategory) : undefined
      if (hit) setForm((f) => ({ ...f, itemType: f.itemType || hit.item_type || '', category: !hit.item_type || !f.itemType || hit.item_type === f.itemType ? hit.name : f.category }))
    }).catch(fail('the categories'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const types = useMemo(() => (meta?.item_types || []).filter((t) => t.allowed !== false && allowedTypes(t.value)), [meta, allowedTypes])
  const cats = useMemo(() => categories
    .filter((c) => c.is_active && !c.parent_id && (!c.item_type || c.item_type === form.itemType))
    .sort((a, b) => a.name.localeCompare(b.name)), [categories, form.itemType])

  // Look for an existing item while the name / details are typed (debounced).
  useEffect(() => {
    const name = form.name.trim()
    if (name.length < 3) { setSimilar([]); return }
    let live = true
    setChecking(true)
    const t = setTimeout(() => {
      storeApi.similarItems({ name, spec: form.spec.trim() || undefined, vendor_id: vendorId })
        .then((rows) => { if (live) setSimilar(rows) })
        .catch(() => { if (live) setSimilar([]) })
        .finally(() => { if (live) setChecking(false) })
    }, 400)
    return () => { live = false; clearTimeout(t) }
  }, [form.name, form.spec, vendorId])

  const save = async () => {
    setError('')
    if (!form.itemType) { setError('Pick the item type.'); return }
    if (!form.category) { setError('Pick the category — it decides which buyer handles this item on a requisition and how it is reported.'); return }
    if (!form.name.trim()) { setError('Type the item name.'); return }
    if (!form.uom) { setError('Pick the unit of measure the goods are counted in (NOS, KG, MTR…).'); return }
    setBusy(true)
    try {
      const item: StoreItem = await storeApi.createItem({
        from_inward: true, item_type: form.itemType, category: form.category, item_name: form.name.trim(), uom: form.uom,
        description: form.spec.trim() || undefined, hsn_sac_code: form.hsn.trim() || undefined,
        gst_rate: form.gst !== '' ? Number(form.gst) : undefined,
      })
      draft.clear()
      onCreated(item)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not add the item — check the type, category, name and unit and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const strong = similar.some((s) => s.match !== 'similar')
  return (
    <FormSheet icon="box" title="Add a new item" subtitle={subtitle || 'Quick add from this receipt — the rest of its details are completed later in the Item Master'}
      onClose={onClose} busy={busy} width={760} tour="store-quick-item" onSubmit={save}
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" style={sheetBtn('primary', strong ? '#d97706' : SHEET.BLUE, busy)} disabled={busy}>
          {busy ? 'Adding…' : similar.length ? 'Add as a new item anyway' : 'Add item'}
        </button>
      </>}>
      <div style={{ padding: '18px 24px' }}>
        <DraftBanner draft={draft} />
        <SheetError error={error} />
        <SheetSection icon="box" title="Item">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <SheetField label="Item type" required>
              <Select style={sheetInput} value={form.itemType} onChange={(e) => set({ itemType: e.target.value, category: '' })}>
                <option value="">— pick a type</option>
                {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </SheetField>
            <SheetField label="Category" required hint={form.itemType && !cats.length ? 'No category for this type yet — ask the Item Master owner to add one in Store › Settings › Categories.' : undefined}>
              <Select style={sheetInput} value={form.category} onChange={(e) => set({ category: e.target.value })} disabled={!form.itemType}>
                <option value="">{form.itemType ? '— pick a category' : 'Pick the type first'}</option>
                {cats.map((c) => <option key={c.id} value={c.name}>{c.name} ({c.code})</option>)}
              </Select>
            </SheetField>
            <SheetField label="Unit (UOM)" required>
              <Select style={sheetInput} value={form.uom} onChange={(e) => set({ uom: e.target.value })}>
                <option value="">— pick a unit</option>
                {(meta?.uoms || []).map((u) => <option key={u.value} value={u.value}>{u.label === u.value ? u.value : `${u.value} — ${u.label}`}</option>)}
              </Select>
            </SheetField>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginTop: 14 }}>
            <SheetField label="Item name" required>
              <input style={sheetInput} value={form.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Hex Bolt M12 x 50" />
            </SheetField>
            <SheetField label={<>Technical details <Optional /></>}>
              <input style={sheetInput} value={form.spec} maxLength={500} onChange={(e) => set({ spec: e.target.value })} placeholder="Size, grade, make, rating…" />
            </SheetField>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginTop: 14 }}>
            <SheetField label={<>HSN / SAC <Optional /></>}>
              <input style={sheetInput} value={form.hsn} maxLength={8} onChange={(e) => set({ hsn: e.target.value.replace(/\D/g, '') })} placeholder="From the bill, if printed" />
            </SheetField>
            <SheetField label={<>GST % <Optional /></>}>
              <Select style={sheetInput} value={form.gst} onChange={(e) => set({ gst: e.target.value })}>
                <option value="">— not known</option>
                {(meta?.gst_rates || []).map((g) => <option key={g} value={String(g)}>{g}%</option>)}
              </Select>
            </SheetField>
          </div>
        </SheetSection>

        <div data-tour="store-quick-item-similar" role="region" aria-live="polite" aria-label="Items already in the Item Master"
          style={{ marginTop: 6, border: `1px solid ${similar.length ? (strong ? '#fecaca' : '#fde68a') : SHEET.LINE}`, background: similar.length ? (strong ? '#fef2f2' : '#fffbeb') : SHEET.SOFT, borderRadius: 12, padding: '10px 12px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: SHEET.INK, marginBottom: similar.length ? 8 : 0 }}>
            {form.name.trim().length < 3 ? 'Type the item name — the Item Master is checked for the same item as you type.'
              : checking ? 'Checking the Item Master…'
                : similar.length ? 'Already in the Item Master? Use the existing item instead of adding a duplicate.'
                  : 'No similar item found — this looks new.'}
          </div>
          {similar.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0', borderTop: `1px solid ${SHEET.LINE}` }}>
              <Pill label={MATCH_LABEL[s.match].label} hex={MATCH_LABEL[s.match].hex} />
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: SHEET.INK }}>{s.item_code} — {s.item_name}</div>
                <div style={{ fontSize: 12, color: SHEET.MUTED }}>{[s.category, s.uom, s.specification, s.reason].filter(Boolean).join(' · ')}</div>
              </div>
              <button type="button" style={sheetBtn('secondary', SHEET.BLUE)} onClick={() => onPickExisting(s.id)}
                disabled={!allowedTypes(s.item_type || '')} title={allowedTypes(s.item_type || '') ? 'Put this item on the receipt line' : 'This item type cannot be booked on a Before PO receipt'}>
                Use this
              </button>
            </div>
          ))}
        </div>
        <p style={{ ...sheetHint, marginTop: 10 }}>The item gets the next item code, goes onto this receipt line, and is marked <strong>Added at inward — needs review</strong> until the Item Master owner completes its stock levels, quality check and ledgers.</p>
      </div>
    </FormSheet>
  )
}
