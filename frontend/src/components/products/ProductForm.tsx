'use client'

import { useEffect, useState } from 'react'
import { productsApi } from '@/lib/api'
import { FinishedProduct, ProductApplication, ProductMeta, ProductStoreItemOption } from '@/types'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { ErrorBanner } from '@/components/products/ProductBits'
import { extractErrorMessages } from '@/lib/validation'

type SpecRow = { parameter: string; value: string; unit: string }

const chipStyle = (on: boolean): React.CSSProperties => ({
  fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 9999, cursor: 'pointer', userSelect: 'none',
  border: `1px solid ${on ? SHEET.BLUE : SHEET.LINE}`, background: on ? '#eff6ff' : '#fff',
  color: on ? SHEET.BLUE : SHEET.BODY,
})
const hintStyle = sheetHint
const L = ({ children }: { children: React.ReactNode }) => <label style={sheetLabel}>{children}</label>

/** Create / edit form for a product. `initial` = edit mode (code is fixed once created). */
export default function ProductForm({ initial, onSaved, onCancel, nav }: {
  initial?: FinishedProduct
  onSaved: (p: FinishedProduct) => void
  onCancel: () => void
  /** Module sub-nav, rendered above the form header. */
  nav?: React.ReactNode
}) {
  const [meta, setMeta] = useState<ProductMeta | null>(null)
  const [applications, setApplications] = useState<ProductApplication[]>([])
  const [form, setForm] = useState({
    code: initial?.code || '',
    name: initial?.name || '',
    product_type: initial?.product_type || 'vehicle',
    model_number: initial?.model_number || '',
    status: initial?.status || 'development',
    short_description: initial?.short_description || '',
    description: initial?.description || '',
    hsn_code: initial?.hsn_code || '',
    uom: initial?.uom || 'Nos',
    warranty_months: initial?.warranty_months != null ? String(initial.warranty_months) : '',
  })
  const [appIds, setAppIds] = useState<number[]>(initial?.applications.map((a) => a.id) || [])
  const [specs, setSpecs] = useState<SpecRow[]>(
    initial?.specifications.length
      ? initial.specifications.map((s) => ({ parameter: s.parameter, value: s.value, unit: s.unit || '' }))
      : [{ parameter: '', value: '', unit: '' }],
  )
  const [storeItem, setStoreItem] = useState<{ id: number; label: string } | null>(
    initial?.store_item_id ? { id: initial.store_item_id, label: `${initial.store_item_code} — ${initial.store_item_name}` } : null,
  )
  const [itemSearch, setItemSearch] = useState('')
  const [itemResults, setItemResults] = useState<ProductStoreItemOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    productsApi.meta().then(setMeta).catch((e) => setError(extractErrorMessages(e, 'Failed to load product types.')))
    productsApi.listApplications({ include_inactive: true }).then(setApplications).catch((e) => setError(extractErrorMessages(e, 'Failed to load applications.')))
  }, [])

  useEffect(() => {
    const term = itemSearch.trim()
    if (!term) return
    const t = setTimeout(() => {
      productsApi.searchStoreItems(term).then(setItemResults).catch((e) => setError(extractErrorMessages(e, 'Failed to search store items.')))
    }, 250)
    return () => clearTimeout(t)
  }, [itemSearch])

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const toggleApp = (id: number) => setAppIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  const setSpec = (i: number, k: keyof SpecRow, v: string) => setSpecs((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))

  // Retired applications stay visible only when this product already uses them.
  const shownApps = applications.filter((a) => a.is_active || appIds.includes(a.id))

  const save = async () => {
    setError('')
    if (!form.code.trim() || !form.name.trim()) {
      setError('Product code and name are required — e.g. code RRB-SV, name RRB Sanding Vehicle.')
      return
    }
    // Code is fixed once created — the edit payload leaves it out.
    const { code, ...rest } = form
    const payload: Record<string, unknown> = {
      ...rest,
      ...(initial ? {} : { code }),
      warranty_months: form.warranty_months.trim() === '' ? null : Number(form.warranty_months),
      store_item_id: storeItem?.id ?? null,
      application_ids: appIds,
      specifications: specs.filter((s) => s.parameter.trim() || s.value.trim()),
    }
    setSaving(true)
    try {
      const saved = initial ? await productsApi.update(initial.id, payload) : await productsApi.create(payload)
      onSaved(saved)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save the product.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormPage nav={nav} icon={initial ? 'edit' : 'box'} title={initial ? `Edit ${initial.code}` : 'New Product'}
      subtitle={initial ? `${initial.name} — the code is fixed once created.` : 'A finished product the company sells — the master Sales, Design, Production and Service refer to.'}
      onBack={onCancel} backTour="product-form-back"
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" style={sheetBtn('primary', SHEET.BLUE, saving)} onClick={save} disabled={saving}>
          <SheetIcon name={initial ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : initial ? 'Save changes' : 'Create product'}
        </button>
      </>}>
      <SheetColumns
        left={<>
          <ErrorBanner error={error} />
          <SheetSection icon="box" title="Product">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '0 1 140px', minWidth: 120 }}>
                <L>Code <Req /></L>
                <input style={{ ...sheetInput, textTransform: 'uppercase' }} value={form.code} disabled={!!initial} onChange={(e) => set('code', e.target.value)} placeholder="RRB-SV" maxLength={30} />
              </div>
              <div style={{ flex: '1 1 240px', maxWidth: 360 }}>
                <L>Name <Req /></L><input style={sheetInput} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="RRB Sanding Vehicle" />
              </div>
              <div style={{ flex: '0 1 200px', minWidth: 170 }}>
                <L>Type</L>
                <select style={sheetInput} value={form.product_type} onChange={(e) => set('product_type', e.target.value)}>
                  {(meta?.types || []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div style={{ flex: '1 1 160px', maxWidth: 220 }}>
                <L>Model number</L><input style={sheetInput} value={form.model_number} onChange={(e) => set('model_number', e.target.value)} placeholder="PRT-SV-01" />
              </div>
              <div style={{ flex: '0 1 160px', minWidth: 150 }}>
                <L>Status</L>
                <select style={sheetInput} value={form.status} onChange={(e) => set('status', e.target.value)}>
                  {(meta?.statuses || []).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <p style={hintStyle}>Only <b>Active</b> products should be quoted and sold. Phased out = still serviced, not sold new. A product can be deleted only while it is In development.</p>
          </SheetSection>

          <SheetSection icon="doc" title="Description">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <L>Short description (one line, for quotations)</L>
                <input style={sheetInput} value={form.short_description} onChange={(e) => set('short_description', e.target.value)} maxLength={300} placeholder="Self-propelled road-rail vehicle for rail-head sanding" />
              </div>
              <div>
                <L>Detailed description</L>
                <textarea style={{ ...sheetInput, minHeight: 110, resize: 'vertical' }} value={form.description} onChange={(e) => set('description', e.target.value)} />
              </div>
            </div>
          </SheetSection>

          <SheetSection icon="list" title="Technical specifications" extra={<Optional />}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {specs.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input style={{ ...sheetInput, flex: '1 1 200px', width: 'auto', maxWidth: 300 }} value={s.parameter} onChange={(e) => setSpec(i, 'parameter', e.target.value)} placeholder="Parameter (e.g. Max speed on rail)" />
                  <input style={{ ...sheetInput, flex: '1 1 140px', width: 'auto', maxWidth: 220 }} value={s.value} onChange={(e) => setSpec(i, 'value', e.target.value)} placeholder="Value (e.g. 40)" />
                  <input style={{ ...sheetInput, flex: '0 1 100px', width: 100 }} value={s.unit} onChange={(e) => setSpec(i, 'unit', e.target.value)} placeholder="Unit" />
                  <button type="button" aria-label="Remove row" title="Remove row" style={sheetBtn('ghost', '#DC2626')}
                    onClick={() => setSpecs((rows) => (rows.length === 1 ? [{ parameter: '', value: '', unit: '' }] : rows.filter((_, j) => j !== i)))}><SheetIcon name="trash" size={16} /></button>
                </div>
              ))}
              <div>
                <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => setSpecs((rows) => [...rows, { parameter: '', value: '', unit: '' }])}><SheetIcon name="plus" size={15} />Add row</button>
              </div>
            </div>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="tag" title="Applications" extra={<Optional />}>
            <p style={{ ...hintStyle, margin: '0 0 10px' }}>Where this product is used.</p>
            {shownApps.length === 0 ? (
              <p style={{ ...hintStyle, marginTop: 0 }}>No applications yet — add them under the Applications tab (e.g. OHE inspection, Track sanding), then tick them here.</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {shownApps.map((a) => (
                  <span key={a.id} style={chipStyle(appIds.includes(a.id))} onClick={() => toggleApp(a.id)} title={a.description || a.name}>
                    {appIds.includes(a.id) ? '✓ ' : ''}{a.name}{a.is_active ? '' : ' (retired)'}
                  </span>
                ))}
              </div>
            )}
          </SheetSection>

          <SheetSection icon="truck" title="Sales & service defaults">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '0 1 90px', minWidth: 80 }}>
                <L>Unit</L><input style={sheetInput} value={form.uom} onChange={(e) => set('uom', e.target.value)} />
              </div>
              <div style={{ flex: '0 1 110px', minWidth: 100 }}>
                <L>HSN code</L><input style={sheetInput} value={form.hsn_code} onChange={(e) => set('hsn_code', e.target.value)} placeholder="8604" maxLength={20} />
              </div>
              <div style={{ flex: '0 1 140px', minWidth: 130 }}>
                <L>Warranty (months)</L><input type="number" min={0} max={240} style={sheetInput} value={form.warranty_months} onChange={(e) => set('warranty_months', e.target.value)} placeholder="12" />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <L>Finished-good store item</L>
              {storeItem ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, ...sheetInput }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{storeItem.label}</span>
                  <span style={{ cursor: 'pointer', color: SHEET.MUTED, fontWeight: 700 }} onClick={() => setStoreItem(null)} title="Unlink">×</span>
                </div>
              ) : (
                <>
                  <input style={sheetInput} value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search item code or name…" />
                  {itemSearch.trim() !== '' && itemResults.length > 0 && (
                    <div style={{ marginTop: 6, border: `1px solid ${SHEET.LINE}`, borderRadius: 10, background: '#fff', maxHeight: 220, overflowY: 'auto' }}>
                      {itemResults.map((it) => (
                        <div key={it.id} style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderTop: `1px solid ${SHEET.LINE}` }}
                          onClick={() => {
                            setStoreItem({ id: it.id, label: `${it.item_code} — ${it.item_name}` })
                            if (!form.hsn_code && it.hsn_sac_code) set('hsn_code', it.hsn_sac_code)
                            setItemSearch(''); setItemResults([])
                          }}>
                          <b>{it.item_code}</b> — {it.item_name}{it.uom ? ` (${it.uom})` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <p style={hintStyle}>The store item is the stock/BOM code Design, Production and Sales orders use for this product. Link it once the item exists in Store.</p>
          </SheetSection>
        </>}
      />
    </FormPage>
  )
}
