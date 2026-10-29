'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { productsApi } from '@/lib/api'
import { FinishedProduct, ProductMeta, ProductStoreItemOption } from '@/types'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { ErrorBanner } from '@/components/products/ProductBits'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { pricingApi } from '@/lib/sdServiceApi'
import { CURRENCY_OPTIONS } from '@/components/sales/labels'
import PriceConditionsPanel from '@/components/products/PriceConditionsPanel'
import CurrencyConversions from '@/components/products/CurrencyConversions'


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
  // Free text, one specification per line. A product saved before 2026-10-28 shows its old rows as lines.
  const { can } = useCan()
  // New product: its list price is saved with it (more prices — customer, country — on the product afterwards).
  const [listPrice, setListPrice] = useState('')
  const [priceCurrency, setPriceCurrency] = useState('INR')
  const [techSpec, setTechSpec] = useState<string>(
    initial?.technical_specification
      || (initial?.specifications || []).map((r) => `${r.parameter}: ${r.value}${r.unit ? ` ${r.unit}` : ''}`).join('\n'),
  )
  const [storeItem, setStoreItem] = useState<{ id: number; label: string } | null>(
    initial?.store_item_id ? { id: initial.store_item_id, label: `${initial.store_item_code} — ${initial.store_item_name}` } : null,
  )
  const [itemSearch, setItemSearch] = useState('')
  const [itemResults, setItemResults] = useState<ProductStoreItemOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)
  // A new product's typed data survives a refresh / network failure (lib/formDraft.ts).
  const draft = useFormDraft(initial ? null : 'products-product-new', { form, techSpec, storeItem },
    (d) => { setForm(d.form); setTechSpec(typeof d.techSpec === 'string' ? d.techSpec : ''); setStoreItem(d.storeItem || null) })

  useEffect(() => {
    productsApi.meta().then(setMeta).catch((e) => setError(extractErrorMessages(e, 'Failed to load product types.')))
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
  const isApp = form.product_type === 'application'

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
      technical_specification: techSpec.trim() || null,
    }
    setSaving(true)
    try {
      const saved = initial ? await productsApi.update(initial.id, payload) : await productsApi.create(payload)
      draft.clear()
      if (!initial && listPrice.trim() !== '') {
        try {
          await pricingApi.create({ condition_type: 'price', item_kind: 'product', product_id: saved.id, amount: Number(listPrice),
            currency: priceCurrency, valid_from: new Date().toLocaleDateString('en-CA') })
        } catch (err) {
          const why = extractErrorMessages(err, 'the price could not be saved')
          setError([`${saved.code} was saved, but its list price wasn't: ${Array.isArray(why) ? why.join(' ') : why}`,
            'Open the product from the list and add the price in its Pricing section.'])
          return
        }
      }
      onSaved(saved)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save the product.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormPage nav={nav} icon={initial ? 'edit' : 'box'} title={initial ? `Edit ${initial.code}` : isApp ? 'New Application' : 'New Product'}
      subtitle={initial ? `${initial.name} — the code is fixed once created.` : isApp
        ? 'An add-on sold with a product only when the customer asks for it.'
        : 'A finished product the company sells — the master Sales, Design, Production and Service refer to.'}
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
          <DraftBanner draft={draft} />
          <SheetSection icon="box" title={isApp ? 'Application' : 'Product'}>
            {/* One master: first say whether this is a product or an application (add-on). */}
            <div role="radiogroup" aria-label="Product or application" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {([['product', 'Product'], ['application', 'Application']] as const).map(([k, label]) => {
                const on = k === 'application' ? isApp : !isApp
                return (
                  <button key={k} type="button" role="radio" aria-checked={on} disabled={!!initial && !on}
                    onClick={() => set('product_type', k === 'application' ? 'application' : (initial?.product_type !== 'application' && initial?.product_type) || 'vehicle')}
                    style={sheetBtn(on ? 'primary' : 'secondary', SHEET.BLUE, !!initial && !on)}>{label}</button>
                )
              })}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '0 1 140px', minWidth: 120 }}>
                <L>Code <Req /></L>
                <input style={{ ...sheetInput, textTransform: 'uppercase' }} value={form.code} disabled={!!initial} onChange={(e) => set('code', e.target.value)} placeholder="RRB-SV" maxLength={30} />
              </div>
              <div style={{ flex: '1 1 240px', maxWidth: 360 }}>
                <L>Name <Req /></L><input style={sheetInput} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="RRB Sanding Vehicle" />
              </div>
              {!isApp && <>
                <div style={{ flex: '0 1 200px', minWidth: 170 }}>
                  <L>Type</L>
                  <Select style={sheetInput} value={form.product_type} onChange={(e) => set('product_type', e.target.value)}>
                    {(meta?.types || []).filter((t) => t.value !== 'application').map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                </div>
                <div style={{ flex: '1 1 160px', maxWidth: 220 }}>
                  <L>Model number</L><input style={sheetInput} value={form.model_number} onChange={(e) => set('model_number', e.target.value)} placeholder="PRT-SV-01" />
                </div>
              </>}
              <div style={{ flex: '0 1 160px', minWidth: 150 }}>
                <L>Status</L>
                <Select style={sheetInput} value={form.status} onChange={(e) => set('status', e.target.value)}>
                  {(meta?.statuses || []).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
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
            <textarea aria-label="Technical specifications" style={{ ...sheetInput, minHeight: 140, resize: 'vertical', lineHeight: 1.5 }}
              value={techSpec} onChange={(e) => setTechSpec(e.target.value)}
              placeholder={'One specification per line, e.g.\nMax speed on rail: 40 km/h\nEngine: 4-cylinder diesel, 110 HP\nTrack gauge: 1676 mm'} />
            <p style={hintStyle}>Write each specification on its own line — it prints the same way on quotations and the product page.</p>
          </SheetSection>

          {can('sales', 'pricing', 'view') && (
            <SheetSection icon="rupee" title="Pricing" extra={initial ? undefined : <Optional />}>
              {initial ? (
                <PriceConditionsPanel productId={initial.id} emptyText="No price yet — add the list price, then country prices if they differ" />
              ) : can('sales', 'pricing', 'create') ? (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: '0 1 180px', minWidth: 150 }}>
                      <L>List price ({priceCurrency})</L>
                      <input type="number" min={0} style={sheetInput} value={listPrice} onChange={(e) => setListPrice(e.target.value)} placeholder="5000000" />
                    </div>
                    <div style={{ flex: '0 1 220px', minWidth: 180 }}>
                      <L>Currency</L>
                      <Select style={sheetInput} value={priceCurrency} onChange={(e) => setPriceCurrency(e.target.value)}>
                        {CURRENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    </div>
                  </div>
                  <CurrencyConversions amount={listPrice.trim() === '' ? null : Number(listPrice)} currency={priceCurrency} />
                  <p style={hintStyle}>The price for all customers from today. After saving, open the product to add customer or country prices (e.g. a different price for Bangladesh in USD).</p>
                </>
              ) : (
                <p style={{ ...hintStyle, marginTop: 0 }}>Adding prices needs &apos;Create&apos; on Sales › Pricing — ask an admin to add it to your role.</p>
              )}
            </SheetSection>
          )}
        </>}
        right={<>
          <SheetSection icon="gear" title="Sales & service defaults">
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
