'use client'

// Sales › Pricing — pricing conditions (SAP VK11 create / VK12 change / VK13
// display): validity-dated prices for products, spares and service rates,
// customer-specific prices and discounts, and freight. Documents (SO lines,
// quotation lines, service invoices) default their price from these records.

import Select from '@/components/shared/Select'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { salesApi } from '@/lib/api'
import { pricingApi, PriceCondition, Option } from '@/lib/sdServiceApi'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { useCan } from '@/lib/permissions'
import SalesNav from '@/components/sales/SalesNav'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { sectionStyle, inputStyle, labelStyle, thStyle, tdStyle, Pill, ErrorBanner, PageHeader } from '@/components/sales/SalesUi'
import { primaryBtnStyle, RowCount } from '@/components/shared/ui'
import { formatINR } from '@/components/sales/labels'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetSection, SheetIcon, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

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
const today = () => new Date().toLocaleDateString('en-CA')
const emptyForm = (): FormState => ({
  condition_type: 'price', item_kind: 'product', product_id: '', store_item_id: '', service_code: '', customer_id: '',
  amount: '', percent: '', freight_basis: 'per_order', min_price: '', uom: '', valid_from: today(), valid_to: '', remarks: '',
})
const num = (v: string) => (v.trim() === '' ? null : Number(v))

function valueText(c: PriceCondition) {
  if (c.condition_type === 'price') return `${formatINR(c.amount)}${c.uom ? ` / ${c.uom}` : ''}`
  if (c.condition_type === 'discount') return `${c.percent}%`
  return c.freight_basis === 'percent' ? `${c.percent}% of value` : `${formatINR(c.amount)} / order`
}

export default function SalesPricingPage() {
  const { isAuthorized, isLoading } = useRequireApp('sales')
  const { can } = useCan()
  const [rows, setRows] = useState<PriceCondition[]>([])
  const [meta, setMeta] = useState<{ condition_types: Option[]; item_kinds: Option[]; service_codes: Option[]; freight_bases: Option[] } | null>(null)
  const [customers, setCustomers] = useState<{ value: string; label: string }[]>([])
  const [items, setItems] = useState<{ value: string; label: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [metaError, setMetaError] = useState<string | string[]>('')
  const [typeFilter, setTypeFilter] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
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
    setLoading(true)
    pricingApi.list(params).then((d) => { setRows(d); setError('') })
      .catch((e) => setError(extractErrorMessages(e, 'Could not load the pricing conditions.')))
      .finally(() => setLoading(false))
  }, [typeFilter, customerFilter, currentOnly])

  useEffect(() => { if (isAuthorized) load() }, [isAuthorized, load])
  useEffect(() => {
    if (!isAuthorized) return
    pricingApi.meta().then(setMeta).catch((e) => { setMeta(null); setMetaError(extractErrorMessages(e, 'Could not load the condition types and service rates, so new conditions cannot be added — reload the page.')) })
    salesApi.lookupCustomers().then((cs: { id: number; name: string; gst_number: string | null }[]) =>
      setCustomers(cs.map((c) => ({ value: String(c.id), label: c.gst_number ? `${c.name} (${c.gst_number})` : c.name })))).catch(() => setCustomers([]))
  }, [isAuthorized])
  useEffect(() => {
    // Only products / spares pick from a list; other kinds never show it.
    if (!form || (form.item_kind !== 'product' && form.item_kind !== 'spare')) return
    pricingApi.lookupItems(form.item_kind as 'product' | 'spare').then((r) => setItems(r.map((x) => ({ value: String(x.id), label: x.label }))))
      .catch(() => setItems([]))
  }, [form?.item_kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const edit = (c: PriceCondition) => {
    setFormError('')
    setForm({
      id: c.id, condition_type: c.condition_type, item_kind: c.item_kind, product_id: String(c.product_id || ''),
      store_item_id: String(c.store_item_id || ''), service_code: c.service_code || '', customer_id: String(c.customer_id || ''),
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
      uom: form.uom || null, valid_from: form.valid_from, valid_to: form.valid_to || null, remarks: form.remarks || null,
    }
    try {
      if (form.id) await pricingApi.update(form.id, body)
      else await pricingApi.create({
        ...body, condition_type: form.condition_type, item_kind: form.item_kind,
        product_id: form.product_id ? Number(form.product_id) : null, store_item_id: form.store_item_id ? Number(form.store_item_id) : null,
        service_code: form.service_code || null, customer_id: form.customer_id ? Number(form.customer_id) : null,
      })
      setForm(null)
      load()
    } catch (e) {
      setFormError(extractErrorMessages(e, 'Could not save the condition.'))
    } finally {
      setSaving(false)
    }
  }

  const endToday = async (c: PriceCondition) => {
    try { await pricingApi.update(c.id, { valid_to: today() }); load() } catch (e) { setError(extractErrorMessages(e, 'Could not end the condition.')) }
  }
  const doDelete = async () => {
    if (!toDelete) return
    try { await pricingApi.remove(toDelete.id); setToDelete(null); load() } catch (e) { setToDelete(null); setError(extractErrorMessages(e, 'Could not delete the condition.')) }
  }

  const kinds = useMemo(() => {
    const all = meta?.item_kinds || []
    if (!form) return all
    if (form.condition_type === 'price') return all.filter((k) => k.value !== 'any')
    if (form.condition_type === 'freight') return all.filter((k) => k.value === 'any')
    return all
  }, [meta, form])

  if (isLoading || !isAuthorized) return null
  const canCreate = can('sales', 'pricing', 'create')
  const canEdit = can('sales', 'pricing', 'edit')
  const canDel = can('sales', 'pricing', 'delete')

  return (
    <div>
      <SalesNav />
      <PageHeader title="Pricing" subtitle="Price lists for spares and service rates, customer prices and discounts, and freight. Vehicles and machines are priced per quotation.">
        {canCreate && <button style={primaryBtnStyle} onClick={() => { setFormError(''); setForm(emptyForm()) }}>+ New condition</button>}
      </PageHeader>
      <ErrorBanner error={error} />
      <ErrorBanner error={metaError} />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14, alignItems: 'flex-end' }}>
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
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 10 }}>
          <input type="checkbox" checked={currentOnly} onChange={(e) => setCurrentOnly(e.target.checked)} /> Valid today only
        </label>
      </div>

      <div style={{ ...sectionStyle, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead><tr>{['Type', 'For', 'Customer', 'Value', 'Min. price', 'Valid from', 'Valid to', 'Remarks', ''].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ ...tdStyle, color: '#a8a29e' }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={9} style={{ ...tdStyle, color: '#a8a29e' }}>No pricing conditions{currentOnly ? ' valid today' : ''}.</td></tr>}
            {rows.map((c) => (
              <tr key={c.id}>
                <td style={tdStyle}><Pill label={TYPE_LABELS[c.condition_type] || c.condition_type} hex={TYPE_HEX[c.condition_type] || '#78716c'} /></td>
                <td style={tdStyle}>{c.item_label}</td>
                <td style={tdStyle}>{c.customer_name || <span style={{ color: '#a8a29e' }}>All (list)</span>}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 600 }}>{valueText(c)}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{c.min_price == null ? '—' : formatINR(c.min_price)}</td>
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
        <FormSheet tour="sales-pricing-form" width={640} icon="tag" title={form.id ? 'Change Condition' : 'New Pricing Condition'}
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
            <SheetSection icon="tag" title="Condition">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '0 1 150px', minWidth: 140 }}>
                  <label style={sheetLabel}>Type <Req /></label>
                  <Select disabled={!!form.id} style={sheetInput} value={form.condition_type}
                    onChange={(e) => set({ condition_type: e.target.value, item_kind: e.target.value === 'freight' ? 'any' : e.target.value === 'price' ? 'product' : form.item_kind })}>
                    {(meta?.condition_types || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
                <div style={{ flex: '0 1 190px', minWidth: 170 }}>
                  <label style={sheetLabel}>For <Req /></label>
                  <Select disabled={!!form.id} style={sheetInput} value={form.item_kind} onChange={(e) => set({ item_kind: e.target.value, product_id: '', store_item_id: '', service_code: '' })}>
                    {kinds.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
              </div>
              {(form.item_kind === 'product' || form.item_kind === 'spare') && (
                <div style={{ marginTop: 14, maxWidth: 420 }}>
                  <label style={sheetLabel}>{form.item_kind === 'product' ? 'Product' : 'Spare (Item Master)'} <Req /></label>
                  {form.id ? <div style={{ fontSize: 13, paddingTop: 4, color: SHEET.INK }}>{rows.find((r) => r.id === form.id)?.item_label}</div> : (
                    <SearchableSelect value={form.item_kind === 'product' ? form.product_id : form.store_item_id} options={items} placeholder="Pick…"
                      onChange={(v) => set(form.item_kind === 'product' ? { product_id: v } : { store_item_id: v })} />
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
              <div style={{ marginTop: 14, maxWidth: 420 }}>
                <label style={sheetLabel}>Customer {form.condition_type === 'discount' ? '' : <Optional />}</label>
                {form.id ? <div style={{ fontSize: 13, paddingTop: 4, color: SHEET.INK }}>{rows.find((r) => r.id === form.id)?.customer_name || 'All (list)'}</div> : (
                  <SearchableSelect value={form.customer_id} onChange={(v) => set({ customer_id: v })} options={[{ value: '', label: 'All customers (list)' }, ...customers]} placeholder="All customers (list)" />
                )}
                {form.condition_type !== 'discount' && !form.id && <p style={sheetHint}>Blank = the list price for all customers.</p>}
              </div>
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
                    <label style={sheetLabel}>{form.condition_type === 'price' ? 'Rate (₹)' : 'Amount (₹)'}</label>
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
                      <label style={sheetLabel}>Min. price (₹)</label>
                      <input type="number" min={0} style={sheetInput} value={form.min_price} onChange={(e) => set({ min_price: e.target.value })} />
                    </div>
                    <div style={{ flex: '0 1 90px', minWidth: 80 }}>
                      <label style={sheetLabel}>Unit</label>
                      <input style={sheetInput} value={form.uom} onChange={(e) => set({ uom: e.target.value })} />
                    </div>
                  </>
                )}
              </div>
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
              <p style={sheetHint}>Leave “Valid to” blank for an open-ended condition.</p>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks</label>
              <input style={sheetInput} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} placeholder="e.g. Rate contract RC/2026/12" />
            </SheetSection>
          </div>
        </FormSheet>
      )}
      <ConfirmDialog open={!!toDelete} title="Delete pricing condition"
        message={`Delete ${toDelete ? `${TYPE_LABELS[toDelete.condition_type]} for ${toDelete.item_label}` : ''}? Lines already priced from it keep their price. To stop using it from a date, use “End today” instead.`}
        onConfirm={doDelete} onCancel={() => setToDelete(null)} />
    </div>
  )
}
