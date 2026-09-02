'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { itemsApi, storeApi } from '@/lib/api'
import { Item, StoreLocation } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, BRAND } from '@/lib/theme'
import StoreNav from '@/components/store/StoreNav'
import { Field, Row, Section, inputStyle as sharedInputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import Checkbox from '@/components/Checkbox'

const textareaStyle: React.CSSProperties = { ...sharedInputStyle, resize: 'vertical', minHeight: 70, fontFamily: 'inherit' }
const searchInputStyle: React.CSSProperties = { flex: 1, minWidth: 240, maxWidth: 360, padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13.5, outline: 'none' }
const createButtonStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13.5, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
}
const tableWrapStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden',
}
const thStyle: React.CSSProperties = { padding: '12px 16px', color: TEXT.muted, fontWeight: 600, fontSize: 11.5, letterSpacing: '.04em', textTransform: 'uppercase' }

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  )
}

const ITEM_TYPES = ['Stock Item', 'Non-Stock Item', 'Service Item', 'Fixed Asset']
const ITEM_GROUPS = [
  'Raw Material', 'Consumable', 'Spare Part', 'Hardware', 'Electrical',
  'Hydraulic', 'Pneumatic', 'Finished Good', 'Packaging', 'Other',
]
const UNITS_OF_MEASURE = ['Nos', 'Kg', 'Ltr', 'Mtr', 'Box', 'Set', 'Pcs', 'Roll', 'Pair', 'Unit']
const MAKE_OR_BUY = ['Make', 'Buy']
const BATCH_SERIAL_OPTIONS = ['None', 'Batch', 'Serial', 'Batch & Serial']
const GST_RATES = ['0%', '5%', '12%', '18%', '28%']
const ITEM_STATUSES = ['Active', 'Inactive']

const emptyForm = (): Partial<Item> => ({ item_group: ITEM_GROUPS[0], unit_of_measure: UNITS_OF_MEASURE[0], item_status: 'Active' })

export default function StoreItemMasterPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [locations, setLocations] = useState<StoreLocation[]>([])

  const [groupFilter, setGroupFilter] = useState('')
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false)
  const [groupDropdownCoords, setGroupDropdownCoords] = useState({ top: 0, left: 0 })
  const groupHeaderRef = useRef<HTMLSpanElement>(null)
  const groupDropdownRef = useRef<HTMLDivElement>(null)

  const openGroupDropdown = () => {
    const rect = groupHeaderRef.current?.getBoundingClientRect()
    if (rect) setGroupDropdownCoords({ top: rect.bottom + 6, left: rect.left })
    setGroupDropdownOpen((v) => !v)
  }

  useEffect(() => {
    if (!groupDropdownOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (groupHeaderRef.current?.contains(target)) return
      if (groupDropdownRef.current?.contains(target)) return
      setGroupDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [groupDropdownOpen])

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Partial<Item>>(emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await itemsApi.list({ search: search || undefined, limit: 1000 })
      setItems(data)
    } catch {
      setError('Failed to load items.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) {
      load()
      storeApi.listLocations().then(setLocations).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const set = <K extends keyof Item>(field: K) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const value = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const resetForm = () => {
    setForm(emptyForm())
    setFormError('')
    setShowForm(false)
  }

  const handleSubmit = async () => {
    setFormError('')
    if (!form.item_code?.trim() || !form.item_name?.trim()) {
      setFormError('Item Code and Item Name are required.')
      return
    }
    setSubmitting(true)
    try {
      await itemsApi.create({
        item_code: form.item_code.trim(),
        item_name: form.item_name.trim(),
        item_type: form.item_type || undefined,
        item_group: form.item_group || undefined,
        description: form.description || undefined,
        unit_of_measure: form.unit_of_measure || undefined,
        purchase_uom: form.purchase_uom || undefined,
        item_specification: form.item_specification || undefined,
        manufacturer_part_number: form.manufacturer_part_number || undefined,
        make_or_buy: form.make_or_buy || undefined,
        default_warehouse_id: form.default_warehouse_id || undefined,
        minimum_stock: form.minimum_stock === undefined || form.minimum_stock === null ? undefined : Number(form.minimum_stock),
        maximum_stock: form.maximum_stock === undefined || form.maximum_stock === null ? undefined : Number(form.maximum_stock),
        hsn_sac: form.hsn_sac || undefined,
        gst_tax: form.gst_tax || undefined,
        quality_inspection_required: !!form.quality_inspection_required,
        batch_serial_tracking: form.batch_serial_tracking || undefined,
        item_status: form.item_status || undefined,
      })
      resetForm()
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setFormError(err.response?.data?.detail || 'Failed to create item.')
    } finally {
      setSubmitting(false)
    }
  }

  const displayedItems = groupFilter ? items.filter((it) => it.item_group === groupFilter) : items

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Item Master</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>{items.length} item(s)</p>
        </div>
        {showForm ? (
          <button onClick={resetForm} type="button" style={secondaryBtnStyle}>
            ← Back
          </button>
        ) : (
          <button onClick={() => setShowForm(true)} style={createButtonStyle}>
            <PencilIcon />
            Create Item
          </button>
        )}
      </div>

      {!showForm && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search item by code or name…"
            style={searchInputStyle}
          />
        </div>
      )}

      {showForm && (
        <div style={{ width: '100%' }}>
          {formError && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {formError}
            </div>
          )}

          <Section title="Basic Details" style={{ marginBottom: 20 }}>
            <Row>
              <Field label="Item Code *">
                <input style={sharedInputStyle} value={form.item_code || ''} onChange={set('item_code')} />
              </Field>
              <Field label="Item Name *">
                <input style={sharedInputStyle} value={form.item_name || ''} onChange={set('item_name')} />
              </Field>
              <Field label="Item Type">
                <select style={sharedInputStyle} value={form.item_type || ''} onChange={set('item_type')}>
                  <option value="">—</option>
                  {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Item Category / Group">
                <select style={sharedInputStyle} value={form.item_group || ''} onChange={set('item_group')}>
                  <option value="">—</option>
                  {ITEM_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
            </Row>
            <Field label="Description">
              <textarea style={textareaStyle} value={form.description || ''} onChange={set('description')} rows={3} />
            </Field>
          </Section>

          <Section title="Units & Specification" style={{ marginBottom: 20 }}>
            <Row>
              <Field label="Stock UOM">
                <select style={sharedInputStyle} value={form.unit_of_measure || ''} onChange={set('unit_of_measure')}>
                  <option value="">—</option>
                  {UNITS_OF_MEASURE.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
              <Field label="Purchase UOM">
                <select style={sharedInputStyle} value={form.purchase_uom || ''} onChange={set('purchase_uom')}>
                  <option value="">—</option>
                  {UNITS_OF_MEASURE.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
              <Field label="Manufacturer / Part Number">
                <input style={sharedInputStyle} value={form.manufacturer_part_number || ''} onChange={set('manufacturer_part_number')} />
              </Field>
              <Field label="Make or Buy">
                <select style={sharedInputStyle} value={form.make_or_buy || ''} onChange={set('make_or_buy')}>
                  <option value="">—</option>
                  {MAKE_OR_BUY.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            </Row>
            <Field label="Item Specification">
              <textarea style={textareaStyle} value={form.item_specification || ''} onChange={set('item_specification')} rows={3} />
            </Field>
          </Section>

          <Section title="Stock & Warehouse" style={{ marginBottom: 20 }}>
            <Row>
              <Field label="Default Warehouse">
                <select
                  style={sharedInputStyle}
                  value={form.default_warehouse_id ? String(form.default_warehouse_id) : ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, default_warehouse_id: e.target.value ? Number(e.target.value) : undefined }))}
                >
                  <option value="">—</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
              <Field label="Minimum Stock">
                <input type="number" style={sharedInputStyle} value={form.minimum_stock ?? ''} onChange={set('minimum_stock')} />
              </Field>
              <Field label="Maximum Stock">
                <input type="number" style={sharedInputStyle} value={form.maximum_stock ?? ''} onChange={set('maximum_stock')} />
              </Field>
            </Row>
          </Section>

          <Section title="Tax & Compliance" style={{ marginBottom: 20 }}>
            <Row>
              <Field label="HSN Code">
                <input style={sharedInputStyle} value={form.hsn_sac || ''} onChange={set('hsn_sac')} />
              </Field>
              <Field label="GST / Tax">
                <select style={sharedInputStyle} value={form.gst_tax || ''} onChange={set('gst_tax')}>
                  <option value="">—</option>
                  {GST_RATES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Batch / Serial Tracking">
                <select style={sharedInputStyle} value={form.batch_serial_tracking || ''} onChange={set('batch_serial_tracking')}>
                  <option value="">—</option>
                  {BATCH_SERIAL_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Item Status">
                <select style={sharedInputStyle} value={form.item_status || 'Active'} onChange={set('item_status')}>
                  {ITEM_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </Row>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.secondary, marginTop: 4 }}>
              <Checkbox checked={!!form.quality_inspection_required} onChange={set('quality_inspection_required')} />
              Quality Inspection Required
            </span>
          </Section>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button onClick={resetForm} disabled={submitting} type="button" style={{ padding: '12px 22px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={submitting} type="button" style={{ ...primaryBtnStyle, padding: '12px 26px', fontSize: 14, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}>
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {!showForm && (
        <>
          {error && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={tableWrapStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                  <th style={thStyle}>Item Code</th>
                  <th style={thStyle}>Item Name</th>
                  <th style={{ ...thStyle, whiteSpace: 'nowrap' }}>
                    <span
                      ref={groupHeaderRef}
                      onClick={openGroupDropdown}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none', color: groupFilter ? BRAND.primaryActive : TEXT.muted }}
                    >
                      Item Group
                      {groupFilter && <span>({groupFilter})</span>}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </span>
                    {groupDropdownOpen && typeof document !== 'undefined' && createPortal(
                      <div
                        ref={groupDropdownRef}
                        style={{
                          position: 'fixed', top: groupDropdownCoords.top, left: groupDropdownCoords.left, zIndex: 1000, minWidth: 160,
                          background: '#fff', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)',
                          boxShadow: '0 8px 24px rgba(15,23,42,0.16)', overflow: 'hidden', textTransform: 'none', letterSpacing: 'normal',
                        }}
                      >
                        <div
                          onClick={() => { setGroupFilter(''); setGroupDropdownOpen(false) }}
                          style={{ padding: '8px 14px', fontSize: 12.5, fontWeight: !groupFilter ? 700 : 500, color: !groupFilter ? BRAND.primaryActive : TEXT.secondary, cursor: 'pointer', background: !groupFilter ? 'rgba(255,122,69,0.08)' : 'transparent' }}
                        >
                          All Item Groups
                        </div>
                        {ITEM_GROUPS.map((g) => (
                          <div
                            key={g}
                            onClick={() => { setGroupFilter(g); setGroupDropdownOpen(false) }}
                            style={{ padding: '8px 14px', fontSize: 12.5, fontWeight: groupFilter === g ? 700 : 500, color: groupFilter === g ? BRAND.primaryActive : TEXT.secondary, cursor: 'pointer', background: groupFilter === g ? 'rgba(255,122,69,0.08)' : 'transparent' }}
                          >
                            {g}
                          </div>
                        ))}
                      </div>,
                      document.body
                    )}
                  </th>
                  <th style={thStyle}>HSN/SAC</th>
                  <th style={thStyle}>Unit of Measure</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '20px 16px', textAlign: 'center', color: TEXT.muted }}>Loading…</td>
                  </tr>
                ) : displayedItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '20px 16px', textAlign: 'center', color: TEXT.muted }}>No items found.</td>
                  </tr>
                ) : (
                  displayedItems.map((it) => (
                    <tr
                      key={it.id}
                      onClick={() => router.push(`/dashboard/store/item-master/${it.id}/edit`)}
                      style={{ borderBottom: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: TEXT.heading }}>{it.item_code}</td>
                      <td style={{ padding: '12px 16px', color: TEXT.body }}>{it.item_name}</td>
                      <td style={{ padding: '12px 16px', color: TEXT.body }}>{it.item_group || '—'}</td>
                      <td style={{ padding: '12px 16px', color: TEXT.body }}>{it.hsn_sac || '—'}</td>
                      <td style={{ padding: '12px 16px', color: TEXT.body }}>{it.unit_of_measure || '—'}</td>
                      <td style={{ padding: '12px 16px' }} onClick={(e) => e.stopPropagation()}>
                        <span
                          onClick={() => router.push(`/dashboard/store/item-master/${it.id}/edit`)}
                          style={{ fontSize: 11.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}
                        >
                          Edit
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
