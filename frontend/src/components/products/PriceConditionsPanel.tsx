'use client'

// Price conditions panel (list + create/edit popup). Used on the Product detail
// page (locked to one product: list and country prices only, never per customer,
// owner 2026-10-29) and in Sales Settings (spares, service rates, freight and
// general discounts). Documents (sales order lines, quotation lines, service
// invoices) default their price from these records.

import Select from '@/components/shared/Select'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { salesApi } from '@/lib/api'
import { pricingApi, PriceCondition, Option } from '@/lib/sdServiceApi'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { useCan } from '@/lib/permissions'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { sectionStyle, inputStyle, labelStyle, thStyle, tdStyle, Pill, ErrorBanner } from '@/components/sales/SalesUi'
import { primaryBtnStyle, RowCount } from '@/components/shared/ui'
import { formatMoney, CURRENCY_OPTIONS } from '@/components/sales/labels'
import { COUNTRIES } from '@/components/crm/constants'
import CurrencyConversions from '@/components/products/CurrencyConversions'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetSection, SheetIcon, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

export type PriceItemKind = 'product' | 'spare' | 'service' | 'any'

const TYPE_HEX: Record<string, string> = { price: '#2563eb', discount: '#16a34a', freight: '#7c3aed' }
const TYPE_LABELS: Record<string, string> = { price: 'Price', discount: 'Discount', freight: 'Freight' }

interface FormState {
  id?: number
  condition_type: string
  item_kind: string
  product_id: string
  store_item_id: string
  service_code: string
  customer_id: string
  country: string
  currency: string
  amount: string
  percent: string
  freight_basis: string
  min_price: string
  uom: string
  valid_from: string
  valid_to: string
  remarks: string
}

// Local calendar date (YYYY-MM-DD) — toISOString() is UTC, i.e. yesterday before 05:30 IST.
const COUNTRY_OPTIONS = COUNTRIES.filter((c) => c !== 'Other').map((c) => ({ value: c, label: c }))

// Picking a country picks its currency: its own when it is in the currency list,
// otherwise USD (the usual export currency); no country / India = INR. Still changeable.
const EURO_COUNTRIES = ['Austria', 'Belgium', 'Croatia', 'Cyprus', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Ireland',
  'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Portugal', 'Slovakia', 'Slovenia', 'Spain']
const COUNTRY_CURRENCY: Record<string, string> = {
  India: 'INR', 'United States': 'USD', 'United Kingdom': 'GBP', 'United Arab Emirates': 'AED', Singapore: 'SGD',
  Australia: 'AUD', Canada: 'CAD', Japan: 'JPY', China: 'CNY', 'Saudi Arabia': 'SAR', Qatar: 'QAR', Kuwait: 'KWD',
  Oman: 'OMR', Bangladesh: 'BDT', 'Sri Lanka': 'LKR', Nepal: 'NPR', 'South Africa': 'ZAR',
  ...Object.fromEntries(EURO_COUNTRIES.map((c) => [c, 'EUR'])),
}
const currencyForCountry = (country: string) => {
  const code = country ? COUNTRY_CURRENCY[country] || 'USD' : 'INR'
  return CURRENCY_OPTIONS.some((o) => o.value === code) ? code : 'USD'
}

const today = () => new Date().toLocaleDateString('en-CA')
const num = (v: string) => (v.trim() === '' ? null : Number(v))

function valueText(c: PriceCondition) {
  if (c.condition_type === 'price') return `${formatMoney(c.amount ?? 0, c.currency)}${c.uom ? ` / ${c.uom}` : ''}`
  if (c.condition_type === 'discount') return `${c.percent}%`
  return c.freight_basis === 'percent' ? `${c.percent}% of value` : `${formatMoney(c.amount ?? 0, c.currency)} / order`
}

export default function PriceConditionsPanel({ productId, itemKinds, emptyText }: {
  /** Lock the panel to one product: lists that product's conditions and hides the product picker. */
  productId?: number
  /** Restrict to these item kinds (ignored when productId is set). */
  itemKinds?: PriceItemKind[]
  emptyText?: string
}) {
  const { can } = useCan()
  // Memoised on the kinds' values: a new array every render made load() re-run in a loop
  // (endless "Loading…" and a flood of requests to the server).
  const kindsKey = productId ? 'product' : (itemKinds || []).join(',')
  const allowedKinds = useMemo<PriceItemKind[] | null>(() => (kindsKey ? kindsKey.split(',') as PriceItemKind[] : null), [kindsKey])
  const kindOk = useCallback((k: string) => !allowedKinds || (allowedKinds as string[]).includes(k), [allowedKinds])
  // Which item kinds a condition type can be set on (price: never "any"; freight: only "any").
  const kindsFor = useCallback((type: string, all: Option[]) => {
    const byType = type === 'price' ? all.filter((k) => k.value !== 'any') : type === 'freight' ? all.filter((k) => k.value === 'any') : all
    return byType.filter((k) => kindOk(k.value))
  }, [kindOk])

  const emptyForm = useCallback((type = 'price', kind = ''): FormState => ({
    condition_type: type, item_kind: kind || (productId ? 'product' : (allowedKinds?.[0] === 'any' ? 'any' : allowedKinds?.[0] || 'product')),
    product_id: productId ? String(productId) : '', store_item_id: '', service_code: '', customer_id: '', country: '', currency: 'INR',
    amount: '', percent: '', freight_basis: 'per_order', min_price: '', uom: '', valid_from: today(), valid_to: '', remarks: '',
  }), [productId, allowedKinds])

  const [rows, setRows] = useState<PriceCondition[]>([])
  const [meta, setMeta] = useState<{ condition_types: Option[]; item_kinds: Option[]; service_codes: Option[]; freight_bases: Option[] } | null>(null)
  const [customers, setCustomers] = useState<{ value: string; label: string }[]>([])
  const [items, setItems] = useState<{ value: string; label: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [metaError, setMetaError] = useState<string | string[]>('')
  const [typeFilter, setTypeFilter] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [currentOnly, setCurrentOnly] = useState(true)
  const [form, setForm] = useState<FormState | null>(null)
  const [formError, setFormError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState<PriceCondition | null>(null)
  useEscapeKey(!!form && !saving, () => setForm(null))

  const load = useCallback(() => {
    const params: Record<string, unknown> = { current_only: currentOnly }
    if (typeFilter) params.condition_type = typeFilter
    if (customerFilter) params.customer_id = Number(customerFilter)
    if (productId) params.product_id = productId
    setLoading(true)
    pricingApi.list(params).then((d) => {
      setRows(productId ? d.filter((c) => !countryFilter || (countryFilter === '__list__' ? !c.country : c.country === countryFilter)) : d.filter((c) => kindOk(c.item_kind)))
      setError('')
    })
      .catch((e) => setError(extractErrorMessages(e, 'Could not load the prices.')))
      .finally(() => setLoading(false))
  }, [typeFilter, customerFilter, countryFilter, currentOnly, productId, kindOk])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    pricingApi.meta().then(setMeta).catch((e) => { setMeta(null); setMetaError(extractErrorMessages(e, 'Could not load the price types and service rates, so new prices cannot be added — reload the page.')) })
    if (productId) return  // products are priced by country, no customer picker
    salesApi.lookupCustomers().then((cs: { id: number; name: string; gst_number: string | null }[]) =>
      setCustomers(cs.map((c) => ({ value: String(c.id), label: c.gst_number ? `${c.name} (${c.gst_number})` : c.name })))).catch(() => setCustomers([]))
  }, [productId])
  useEffect(() => {
    // Only spares pick from a list here; a locked product needs no picker.
    if (!form || productId || (form.item_kind !== 'product' && form.item_kind !== 'spare')) return
    pricingApi.lookupItems(form.item_kind as 'product' | 'spare').then((r) => setItems(r.map((x) => ({ value: String(x.id), label: x.label }))))
      .catch(() => setItems([]))
  }, [form?.item_kind, productId]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const edit = (c: PriceCondition) => {
    setFormError('')
    setForm({
      id: c.id, condition_type: c.condition_type, item_kind: c.item_kind, product_id: String(c.product_id || ''),
      store_item_id: String(c.store_item_id || ''), service_code: c.service_code || '', customer_id: String(c.customer_id || ''),
      country: c.country || '', currency: c.currency || 'INR',
      amount: c.amount == null ? '' : String(c.amount), percent: c.percent == null ? '' : String(c.percent),
      freight_basis: c.freight_basis || 'per_order', min_price: c.min_price == null ? '' : String(c.min_price), uom: c.uom || '',
      valid_from: c.valid_from, valid_to: c.valid_to || '', remarks: c.remarks || '',
    })
  }

  const save = async () => {
    if (!form) return
    setSaving(true)
    setFormError('')
    const body: Record<string, unknown> = {
      amount: num(form.amount), percent: num(form.percent), freight_basis: form.freight_basis, min_price: num(form.min_price),
      uom: form.uom || null, currency: form.currency || 'INR', valid_from: form.valid_from, valid_to: form.valid_to || null, remarks: form.remarks || null,
    }
    try {
      if (form.id) await pricingApi.update(form.id, body)
      else await pricingApi.create({
        ...body, condition_type: form.condition_type, item_kind: form.item_kind,
        product_id: productId ? productId : (form.product_id ? Number(form.product_id) : null),
        store_item_id: form.store_item_id ? Number(form.store_item_id) : null,
        service_code: form.service_code || null, customer_id: form.customer_id ? Number(form.customer_id) : null,
        country: form.country.trim() || null,
      })
      setForm(null)
      load()
    } catch (e) {
      setFormError(extractErrorMessages(e, 'Could not save the price.'))
    } finally {
      setSaving(false)
    }
  }

  const endToday = async (c: PriceCondition) => {
    try { await pricingApi.update(c.id, { valid_to: today() }); load() } catch (e) { setError(extractErrorMessages(e, 'Could not end the price.')) }
  }
  const doDelete = async () => {
    if (!toDelete) return
    try { await pricingApi.remove(toDelete.id); setToDelete(null); load() } catch (e) { setToDelete(null); setError(extractErrorMessages(e, 'Could not delete the price.')) }
  }

  const kinds = useMemo(() => (meta && form ? kindsFor(form.condition_type, meta.item_kinds) : []), [meta, form, kindsFor])
  // Types that can be created in this panel at all.
  // A product takes prices only (the server refuses product discounts / customer prices).
  const types = useMemo(() => (meta ? meta.condition_types.filter((t) => (!productId || t.value === 'price') && kindsFor(t.value, meta.item_kinds).length > 0) : []), [meta, kindsFor, productId])

  const canCreate = can('sales', 'pricing', 'create')
  const canEdit = can('sales', 'pricing', 'edit')
  const canDel = can('sales', 'pricing', 'delete')
  const showKindPicker = kinds.length > 1
  const showForCol = !productId

  const changeType = (t: string) => {
    if (!meta) return
    const ks = kindsFor(t, meta.item_kinds)
    set({ condition_type: t, item_kind: ks[0]?.value || '', store_item_id: '', service_code: '' })
  }

  return (
    <div>
      <ErrorBanner error={error} />
      <ErrorBanner error={metaError} />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14, alignItems: 'flex-end' }}>
        {productId ? (
          <div style={{ flex: '1 1 260px', maxWidth: 340 }}>
            <label style={labelStyle}>Country</label>
            <SearchableSelect value={countryFilter} onChange={setCountryFilter} options={[{ value: '', label: 'All countries' }, { value: '__list__', label: 'List price (no country)' }, ...COUNTRY_OPTIONS]} placeholder="All countries" />
          </div>
        ) : (<>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Type</label>
            <Select style={inputStyle} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
          <div style={{ flex: '1 1 260px', maxWidth: 340 }}>
            <label style={labelStyle}>Customer</label>
            <SearchableSelect value={customerFilter} onChange={setCustomerFilter} options={[{ value: '', label: 'All customers' }, ...customers]} placeholder="All customers" />
          </div>
        </>)}
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 10 }}>
          <input type="checkbox" checked={currentOnly} onChange={(e) => setCurrentOnly(e.target.checked)} /> Valid today only
        </label>
        {canCreate && (
          <button type="button" style={{ ...primaryBtnStyle, marginLeft: 'auto' }} disabled={!meta || types.length === 0}
            title={!meta ? 'Price types are still loading or could not be loaded.' : undefined}
            onClick={() => { setFormError(''); setForm(emptyForm(types[0]?.value || 'price', meta ? kindsFor(types[0]?.value || 'price', meta.item_kinds)[0]?.value : '')) }}>+ New price</button>
        )}
      </div>

      <div style={{ ...sectionStyle, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: showForCol ? 1000 : 860 }}>
          <thead><tr>{[...(productId ? [] : ['Type']), ...(showForCol ? ['For'] : []), ...(productId ? [] : ['Customer']), 'Country', 'Value', 'Min. price', 'Valid from', 'Valid to', 'Remarks', ''].map((h, hi) => <th key={h || 'actions'} style={thStyle}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10} style={{ ...tdStyle, color: '#a8a29e' }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={10} style={{ ...tdStyle, color: '#a8a29e' }}>{emptyText || 'No prices'}{currentOnly ? ' valid today' : ''}.</td></tr>}
            {rows.map((c) => (
              <tr key={c.id}>
                {!productId && <td style={tdStyle}><Pill label={TYPE_LABELS[c.condition_type] || c.condition_type} hex={TYPE_HEX[c.condition_type] || '#78716c'} /></td>}
                {showForCol && <td style={tdStyle}>{c.item_label}</td>}
                {!productId && <td style={tdStyle}>{c.customer_name || <span style={{ color: '#a8a29e' }}>{c.country ? 'All in country' : 'All (list)'}</span>}</td>}
                <td style={tdStyle}>{c.country || <span style={{ color: '#a8a29e' }}>{productId ? 'All countries (list price)' : '—'}</span>}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 600 }}>{valueText(c)}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{c.min_price == null ? '—' : formatMoney(c.min_price, c.currency)}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(c.valid_from)}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{c.valid_to ? formatDate(c.valid_to) : 'Open'}</td>
                <td style={{ ...tdStyle, maxWidth: 240 }}>{c.remarks || ''}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {canEdit && <span onClick={() => edit(c)} style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', cursor: 'pointer', marginRight: 10 }}>Edit</span>}
                  {canEdit && c.is_current && !c.valid_to && <span onClick={() => endToday(c)} style={{ fontSize: 12, fontWeight: 600, color: '#b45309', cursor: 'pointer', marginRight: 10 }}>End today</span>}
                  {canDel && <span onClick={() => setToDelete(c)} style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', cursor: 'pointer' }}>Delete</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <FormSheet tour="price-condition-form" width={640} icon="tag" title={form.id ? 'Change Price' : 'New Price'}
          subtitle={form.id ? `${TYPE_LABELS[form.condition_type] || form.condition_type} for ${rows.find((r) => r.id === form.id)?.item_label || '—'}` : 'A validity-dated price, discount or freight that documents default from.'}
          onClose={() => setForm(null)} busy={saving}
          footer={<>
            <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={() => setForm(null)} disabled={saving}>Cancel</button>
            <button type="button" style={sheetBtn('primary', SHEET.BLUE, saving)} onClick={save} disabled={saving}>
              <SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <ErrorBanner error={formError} />
            <SheetSection icon="tag" title="Price">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '0 1 150px', minWidth: 140 }}>
                  <label style={sheetLabel}>Type <Req /></label>
                  <Select disabled={!!form.id} style={sheetInput} value={form.condition_type} onChange={(e) => changeType(e.target.value)}>
                    {(form.id ? meta?.condition_types || [] : types).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
                {showKindPicker && (
                  <div style={{ flex: '0 1 190px', minWidth: 170 }}>
                    <label style={sheetLabel}>For <Req /></label>
                    <Select disabled={!!form.id} style={sheetInput} value={form.item_kind} onChange={(e) => set({ item_kind: e.target.value, product_id: '', store_item_id: '', service_code: '' })}>
                      {kinds.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </div>
                )}
              </div>
              {!productId && form.item_kind === 'spare' && (
                <div style={{ marginTop: 14, maxWidth: 420 }}>
                  <label style={sheetLabel}>Spare (Item Master) <Req /></label>
                  {form.id ? <div style={{ fontSize: 13, paddingTop: 4, color: SHEET.INK }}>{rows.find((r) => r.id === form.id)?.item_label}</div> : (
                    <SearchableSelect value={form.store_item_id} options={items} placeholder="Pick…" onChange={(v) => set({ store_item_id: v })} />
                  )}
                </div>
              )}
              {form.item_kind === 'service' && (
                <div style={{ marginTop: 14, maxWidth: 380 }}>
                  <label style={sheetLabel}>Service rate <Req /></label>
                  <Select disabled={!!form.id} style={sheetInput} value={form.service_code}
                    onChange={(e) => set({ service_code: e.target.value, uom: meta?.service_codes.find((s) => s.value === e.target.value)?.uom || form.uom })}>
                    <option value="">Pick…</option>
                    {(meta?.service_codes || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
              )}
              {!productId && <div style={{ marginTop: 14, maxWidth: 420 }}>
                <label style={sheetLabel}>Customer {form.condition_type === 'discount' ? '' : <Optional />}</label>
                {form.id ? <div style={{ fontSize: 13, paddingTop: 4, color: SHEET.INK }}>{rows.find((r) => r.id === form.id)?.customer_name || 'All (list)'}</div> : (
                  <SearchableSelect value={form.customer_id} onChange={(v) => set({ customer_id: v })} options={[{ value: '', label: 'All customers (list)' }, ...customers]} placeholder="All customers (list)" />
                )}
                {form.condition_type !== 'discount' && !form.id && <p style={sheetHint}>Blank = the list price for all customers (or for one country, below).</p>}
              </div>}
              {form.condition_type === 'price' && !form.customer_id && (
                <div style={{ marginTop: 14, maxWidth: 420 }}>
                  <label style={sheetLabel}>Country <Optional /></label>
                  {form.id ? <div style={{ fontSize: 13, paddingTop: 4, color: SHEET.INK }}>{form.country || 'All countries'}</div> : (
                    <SearchableSelect value={form.country} onChange={(v) => set({ country: v, currency: currencyForCountry(v) })} options={[{ value: '', label: 'All countries (list price)' }, ...COUNTRY_OPTIONS]} placeholder="All countries (list price)" />
                  )}
                  <p style={sheetHint}>{productId
                    ? 'Blank = the list price for every country. A country price applies to every customer whose CRM organisation is in that country and wins over the list price.'
                    : 'A country price applies to every customer whose CRM organisation is in that country. Customer price wins over country price, country price over the list price.'}</p>
                </div>
              )}
            </SheetSection>
            <SheetSection icon="rupee" title="Value">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {form.condition_type === 'freight' && (
                  <div style={{ flex: '0 1 190px', minWidth: 170 }}>
                    <label style={sheetLabel}>Freight basis</label>
                    <Select style={sheetInput} value={form.freight_basis} onChange={(e) => set({ freight_basis: e.target.value })}>
                      {(meta?.freight_bases || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </div>
                )}
                {(form.condition_type === 'price' || (form.condition_type === 'freight' && form.freight_basis === 'per_order')) && (
                  <div style={{ flex: '0 1 150px', minWidth: 130 }}>
                    <label style={sheetLabel}>{form.condition_type === 'price' ? `Rate (${form.currency})` : `Amount (${form.currency})`}</label>
                    <input type="number" min={0} style={sheetInput} value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
                  </div>
                )}
                {(form.condition_type === 'discount' || (form.condition_type === 'freight' && form.freight_basis === 'percent')) && (
                  <div style={{ flex: '0 1 110px', minWidth: 100 }}>
                    <label style={sheetLabel}>Percent</label>
                    <input type="number" min={0} max={100} style={sheetInput} value={form.percent} onChange={(e) => set({ percent: e.target.value })} />
                  </div>
                )}
                {form.condition_type === 'price' && (
                  <>
                    <div style={{ flex: '0 1 150px', minWidth: 130 }}>
                      <label style={sheetLabel}>Min. price ({form.currency})</label>
                      <input type="number" min={0} style={sheetInput} value={form.min_price} onChange={(e) => set({ min_price: e.target.value })} />
                    </div>
                    <div style={{ flex: '0 1 200px', minWidth: 170 }}>
                      <label style={sheetLabel}>Currency</label>
                      <Select style={sheetInput} value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
                        {CURRENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    </div>
                    <div style={{ flex: '0 1 90px', minWidth: 80 }}>
                      <label style={sheetLabel}>Unit</label>
                      <input style={sheetInput} value={form.uom} onChange={(e) => set({ uom: e.target.value })} />
                    </div>
                  </>
                )}
              </div>
              {form.condition_type === 'price' && <CurrencyConversions amount={num(form.amount)} currency={form.currency} />}
            </SheetSection>
            <SheetSection icon="calendar" title="Validity">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={sheetLabel}>Valid from <Req /></label>
                  <DateField value={form.valid_from} onChange={(v) => set({ valid_from: v })} />
                </div>
                <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={sheetLabel}>Valid to <Optional /></label>
                  <DateField value={form.valid_to} onChange={(v) => set({ valid_to: v })} />
                </div>
              </div>
              <p style={sheetHint}>Leave “Valid to” blank for an open-ended price.</p>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks</label>
              <input style={sheetInput} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} placeholder="e.g. Rate contract RC/2026/12" />
            </SheetSection>
          </div>
        </FormSheet>
      )}
      <ConfirmDialog open={!!toDelete} title="Delete price"
        message={`Delete ${toDelete ? `${TYPE_LABELS[toDelete.condition_type]} for ${toDelete.item_label}` : ''}? Lines already priced from it keep their price. To stop using it from a date, use “End today” instead.`}
        onConfirm={doDelete} onCancel={() => setToDelete(null)} />
    </div>
  )
}
