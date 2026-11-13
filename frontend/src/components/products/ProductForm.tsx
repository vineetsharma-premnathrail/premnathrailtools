'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { productsApi } from '@/lib/api'
import { FinishedProduct, ProductMeta, ProductStatus, ProductStoreItemOption, ProductType } from '@/types'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { ErrorBanner, productCodeLabel } from '@/components/products/ProductBits'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { pricingApi } from '@/lib/sdServiceApi'
import { CURRENCY_OPTIONS } from '@/components/sales/labels'
import PriceConditionsPanel from '@/components/products/PriceConditionsPanel'
import CurrencyConversions from '@/components/products/CurrencyConversions'
import { useVisibility } from '@/lib/visibility'
import { VisOptionValues, VisSection } from '@/lib/visibilityComponents'


const hintStyle = sheetHint
const L = ({ children }: { children: React.ReactNode }) => <label style={sheetLabel}>{children}</label>

/** Create / edit form for a product. The code is never typed: the system gives the next number of the type on save. */
export default function ProductForm({ initial, onSaved, onCancel, nav }: {
  initial?: FinishedProduct
  onSaved: (p: FinishedProduct) => void
  onCancel: () => void
  /** Module sub-nav, rendered above the form header. */
  nav?: React.ReactNode
}) {
  const [meta, setMeta] = useState<ProductMeta | null>(null)
  // What the user's roles let them see here (Role editor > CRM > Products > Visibility). In the Role
  // editor's "Preview & choose" nothing is saved or kept as a draft.
  const vis = useVisibility('crm:products')
  const [form, setForm] = useState({
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
  const { canFeature } = useCan()
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
  const draft = useFormDraft(initial || vis.preview ? null : 'products-product-new', { form, techSpec, storeItem },
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
  // Coded values: /products/meta marks each with `allowed` for this user (the server refuses the rest).
  // A saved product keeps its own value in the list; the preview offers every value (the rule being edited
  // is set with the tick buttons under the field).
  type MetaRow = { value: string; label: string; allowed?: boolean }
  const offered = (rows: MetaRow[] | undefined, dropdown: string, current?: string) =>
    vis.options(dropdown, (rows || []).filter((r) => vis.preview || r.allowed !== false || r.value === current), (r) => r.value)
  const typeRows = offered(meta?.types, 'product_type', initial?.product_type)
  const statusRows = offered(meta?.statuses, 'status', initial?.status)
  const productTypeRows = typeRows.filter((t) => t.value !== 'application')
  const mayApp = typeRows.some((t) => t.value === 'application')
  const mayProduct = productTypeRows.length > 0
  // New form: a default the role doesn't offer moves to the first value it does.
  const typeKey = meta ? typeRows.map((t) => t.value).join(',') : ''
  const statusKey = meta ? statusRows.map((s) => s.value).join(',') : ''
  useEffect(() => {
    if (initial || !typeKey) return
    const allowed = typeKey.split(',')
    if (!allowed.includes(form.product_type)) setForm((f) => ({ ...f, product_type: (allowed.find((v) => v !== 'application') || allowed[0]) as ProductType }))
  }, [initial, typeKey, form.product_type])
  useEffect(() => {
    if (initial || !statusKey) return
    const allowed = statusKey.split(',')
    if (!allowed.includes(form.status)) setForm((f) => ({ ...f, status: allowed[0] as ProductStatus }))
  }, [initial, statusKey, form.status])
  const showSide = vis.anySection(['sales_defaults'])

  const save = async () => {
    if (vis.preview) return
    setError('')
    if (!form.name.trim()) {
      setError('Enter the name — e.g. RRB Sanding Vehicle. The code is given by the system when you save.')
      return
    }
    const payload: Record<string, unknown> = {
      ...form,
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
    <FormPage nav={nav} icon={initial ? 'edit' : 'box'} title={initial ? `Edit ${productCodeLabel(initial)}` : isApp ? 'New Application' : 'New Product'}
      subtitle={initial ? `${initial.name} — the code is a running number of its type; changing the type gives it the next number of the new type.` : isApp
        ? 'An add-on sold with a product only when the customer asks for it.'
        : 'A finished product the company sells — the master CRM, Design, Production and Service refer to.'}
      onBack={vis.preview ? undefined : onCancel} backTour="product-form-back"
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onCancel} disabled={saving || vis.preview}>Cancel</button>
        <button type="button" style={sheetBtn('primary', SHEET.BLUE, saving)} onClick={save} disabled={saving || vis.preview}>
          <SheetIcon name={initial ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : initial ? 'Save changes' : 'Create product'}
        </button>
      </>}>
      {(() => {
        const left = <>
          <ErrorBanner error={error} />
          <DraftBanner draft={draft} />
          <VisSection vis={vis} k="product">
          <SheetSection icon="box" title={isApp ? 'Application' : 'Product'}>
            {/* One master: first say whether this is a product or an application (add-on). */}
            <div role="radiogroup" aria-label="Product or application" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {([['product', 'Product'], ['application', 'Application']] as const)
                .filter(([k]) => (k === 'application' ? mayApp || isApp : mayProduct || !isApp))
                .map(([k, label]) => {
                const on = k === 'application' ? isApp : !isApp
                return (
                  <button key={k} type="button" role="radio" aria-checked={on} disabled={!!initial && !on}
                    onClick={() => set('product_type', k === 'application' ? 'application' : (initial?.product_type !== 'application' && initial?.product_type) || productTypeRows[0]?.value || 'vehicle')}
                    style={sheetBtn(on ? 'primary' : 'secondary', SHEET.BLUE, !!initial && !on)}>{label}</button>
                )
              })}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '0 1 140px', minWidth: 120 }}>
                <L>Code</L>
                {/* Never typed: the next number of the type, taken on save (each type has its own 01, 02 …). */}
                <input style={sheetInput} disabled aria-readonly
                  value={initial && initial.product_type === form.product_type ? initial.code : meta?.types.find((t) => t.value === form.product_type)?.next_code || 'Given on save'}
                  title={initial?.old_code ? `Earlier code: ${initial.old_code}` : 'Given by the system when you save — the next number of this type.'} />
              </div>
              <div style={{ flex: '1 1 240px', maxWidth: 360 }}>
                <L>Name <Req /></L><input style={sheetInput} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="RRB Sanding Vehicle" />
              </div>
              {!isApp && <>
                <div style={{ flex: '0 1 200px', minWidth: 170 }}>
                  <L>Type</L>
                  <Select style={sheetInput} value={form.product_type} onChange={(e) => set('product_type', e.target.value)}>
                    {productTypeRows.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                  <VisOptionValues vis={vis} dropdown="product_type" />
                </div>
                <div style={{ flex: '1 1 160px', maxWidth: 220 }}>
                  <L>Model number</L><input style={sheetInput} value={form.model_number} onChange={(e) => set('model_number', e.target.value)} placeholder="PRT-SV-01" />
                </div>
              </>}
              <div style={{ flex: '0 1 160px', minWidth: 150 }}>
                <L>Status</L>
                <Select style={sheetInput} value={form.status} onChange={(e) => set('status', e.target.value)}>
                  {statusRows.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
                <VisOptionValues vis={vis} dropdown="status" />
              </div>
            </div>
            <p style={hintStyle}>Only <b>Active</b> products should be quoted and sold. Phased out = still serviced, not sold new. A product can be deleted only while it is In development.</p>
          </SheetSection>
          </VisSection>

          <VisSection vis={vis} k="description">
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
          </VisSection>

          <VisSection vis={vis} k="technical_specifications">
          <SheetSection icon="list" title="Technical specifications" extra={<Optional />}>
            <textarea aria-label="Technical specifications" style={{ ...sheetInput, minHeight: 140, resize: 'vertical', lineHeight: 1.5 }}
              value={techSpec} onChange={(e) => setTechSpec(e.target.value)}
              placeholder={'One specification per line, e.g.\nMax speed on rail: 40 km/h\nEngine: 4-cylinder diesel, 110 HP\nTrack gauge: 1676 mm'} />
            <p style={hintStyle}>Write each specification on its own line — it prints the same way on quotations and the product page.</p>
          </SheetSection>
          </VisSection>

          {canFeature('crm', 'products', 'pricing', 'view') && (
            <VisSection vis={vis} k="pricing">
            <SheetSection icon="rupee" title="Pricing" extra={initial ? undefined : <Optional />}>
              {initial ? (
                <PriceConditionsPanel productId={initial.id} emptyText="No price yet — add the list price, then country prices if they differ" />
              ) : canFeature('crm', 'products', 'pricing', 'create') ? (
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
                <p style={{ ...hintStyle, marginTop: 0 }}>Adding prices needs &apos;Create&apos; on CRM › Products › Pricing — ask an admin to add it to your role.</p>
              )}
            </SheetSection>
            </VisSection>
          )}
        </>
        const right = (
          <VisSection vis={vis} k="sales_defaults">
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
            <p style={hintStyle}>The store item is the stock/BOM code Design, Production and Projects use for this product. Link it once the item exists in Store.</p>
          </SheetSection>
          </VisSection>
        )
        return showSide ? <SheetColumns left={left} right={right} /> : <div style={{ padding: '20px 24px' }}>{left}</div>
      })()}
    </FormPage>
  )
}
