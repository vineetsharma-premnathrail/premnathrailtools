'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { vendorsApi } from '@/lib/api'
import { Vendor } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import P2PNav, { SUPPLIER_SECTIONS } from '@/components/p2p/P2PNav'

const STATUS_HEX: Record<string, string> = {
  active: '#22c55e', blacklisted: '#dc2626', under_review: '#f59e0b',
}
const QUAL_HEX: Record<string, string> = {
  qualified: '#22c55e', pending: '#f59e0b', disqualified: '#dc2626',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const searchInputStyle: React.CSSProperties = { flex: 1, minWidth: 240, maxWidth: 360, padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13.5, outline: 'none' }
const createButtonStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, border: 'none', cursor: 'pointer',
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

const SUPPLIER_TYPES = ['Company', 'Individual', 'Partnership', 'Proprietorship']
const GST_CATEGORIES = ['Registered Regular', 'Registered Composition', 'Unregistered', 'SEZ', 'Overseas']
const SUPPLIER_GROUPS = [
  'Distributor', 'Electrical', 'Hardware', 'Local', 'Raw Material',
  'Services', 'Pneumatic', 'Hydraulic', 'Consumable', 'Market',
]

const emptySupplierForm = {
  name: '',
  supplier_type: 'Company',
  supplier_group: 'Distributor',
  gst_category: 'Registered Regular',
  contact_first_name: '',
  contact_last_name: '',
  contact_email: '',
  contact_mobile: '',
  address_line1: '',
  address_line2: '',
  city: '',
  postal_code: '',
  state: '',
  country: '',
  gstin: '',
  category: 'materials',
  payment_terms: '',
  bank_details: '',
}

function SupplierSection() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [showMoreDetails, setShowMoreDetails] = useState(false)
  const [form, setForm] = useState(emptySupplierForm)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await vendorsApi.list({ search: search || undefined, limit: 1000 })
      setVendors(data)
    } catch {
      setError('Failed to load suppliers.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const setField = (field: keyof typeof emptySupplierForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }))
  }

  const resetForm = () => {
    setForm(emptySupplierForm)
    setShowMoreDetails(false)
    setFormError('')
    setShowForm(false)
  }

  const handleSubmit = async (isDraft: boolean) => {
    setFormError('')
    if (!form.name.trim()) { setFormError('Supplier name is required.'); return }
    setSubmitting(true)
    try {
      await vendorsApi.create({
        name: form.name.trim(),
        supplier_type: form.supplier_type || undefined,
        supplier_group: form.supplier_group || undefined,
        gst_category: form.gst_category || undefined,
        contact_first_name: form.contact_first_name || undefined,
        contact_last_name: form.contact_last_name || undefined,
        contact_email: form.contact_email || undefined,
        contact_mobile: form.contact_mobile || undefined,
        address_line1: form.address_line1 || undefined,
        address_line2: form.address_line2 || undefined,
        city: form.city || undefined,
        postal_code: form.postal_code || undefined,
        state: form.state || undefined,
        country: form.country || undefined,
        gstin: form.gstin || undefined,
        category: form.category,
        payment_terms: form.payment_terms || undefined,
        bank_details: form.bank_details || undefined,
        is_draft: isDraft,
      })
      resetForm()
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setFormError(err.response?.data?.detail || 'Failed to create supplier.')
    } finally {
      setSubmitting(false)
    }
  }

  if (showForm) {
    return (
      <div>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: TEXT.heading, margin: '0 0 16px' }}>New Supplier</h2>

        {formError && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {formError}
          </div>
        )}

        <div style={sectionStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            <div>
              <label style={labelStyle}>Supplier Name *</label>
              <input style={inputStyle} value={form.name} onChange={setField('name')} />
            </div>
            <div>
              <label style={labelStyle}>Supplier Type</label>
              <select style={inputStyle} value={form.supplier_type} onChange={setField('supplier_type')}>
                {SUPPLIER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Supplier Group</label>
              <select style={inputStyle} value={form.supplier_group} onChange={setField('supplier_group')}>
                {SUPPLIER_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>GST Category</label>
              <select style={inputStyle} value={form.gst_category} onChange={setField('gst_category')}>
                {GST_CATEGORIES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Primary Contact Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            <div>
              <label style={labelStyle}>First Name</label>
              <input style={inputStyle} value={form.contact_first_name} onChange={setField('contact_first_name')} />
            </div>
            <div>
              <label style={labelStyle}>Last Name</label>
              <input style={inputStyle} value={form.contact_last_name} onChange={setField('contact_last_name')} />
            </div>
            <div>
              <label style={labelStyle}>Email ID</label>
              <input style={inputStyle} value={form.contact_email} onChange={setField('contact_email')} />
            </div>
            <div>
              <label style={labelStyle}>Mobile Number</label>
              <input style={inputStyle} value={form.contact_mobile} onChange={setField('contact_mobile')} />
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Primary Address Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Address Line 1</label>
              <input style={inputStyle} value={form.address_line1} onChange={setField('address_line1')} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Address Line 2</label>
              <input style={inputStyle} value={form.address_line2} onChange={setField('address_line2')} />
            </div>
            <div>
              <label style={labelStyle}>City / Town</label>
              <input style={inputStyle} value={form.city} onChange={setField('city')} />
            </div>
            <div>
              <label style={labelStyle}>Postal Code</label>
              <input style={inputStyle} value={form.postal_code} onChange={setField('postal_code')} />
            </div>
            <div>
              <label style={labelStyle}>State / Province</label>
              <input style={inputStyle} value={form.state} onChange={setField('state')} />
            </div>
            <div>
              <label style={labelStyle}>Country</label>
              <input style={inputStyle} value={form.country} onChange={setField('country')} />
            </div>
          </div>
        </div>

        {!showMoreDetails ? (
          <button
            onClick={() => setShowMoreDetails(true)}
            type="button"
            style={{ padding: '10px 18px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', marginBottom: 20 }}
          >
            + More Details
          </button>
        ) : (
          <div style={sectionStyle}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>More Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              <div>
                <label style={labelStyle}>GSTIN</label>
                <input style={inputStyle} value={form.gstin} onChange={setField('gstin')} />
              </div>
              <div>
                <label style={labelStyle}>Category</label>
                <select style={inputStyle} value={form.category} onChange={setField('category')}>
                  <option value="materials">Materials</option>
                  <option value="services">Services</option>
                  <option value="both">Both</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Payment Terms</label>
                <input style={inputStyle} value={form.payment_terms} onChange={setField('payment_terms')} placeholder="e.g. Net 30" />
              </div>
              <div>
                <label style={labelStyle}>Bank Details</label>
                <input style={inputStyle} value={form.bank_details} onChange={setField('bank_details')} />
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button onClick={resetForm} disabled={submitting} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={() => handleSubmit(true)} disabled={submitting} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer' }}>
            Save as Draft
          </button>
          <button onClick={() => handleSubmit(false)} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search supplier by name…"
          style={searchInputStyle}
        />
        <button onClick={() => setShowForm(true)} style={createButtonStyle}>
          <PencilIcon />
          Create Supplier
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <th style={thStyle}>Supplier Name</th>
              <th style={thStyle}>Supplier Type</th>
              <th style={thStyle}>Contact</th>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Qualification</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: '20px 16px', textAlign: 'center', color: TEXT.muted }}>Loading…</td>
              </tr>
            ) : vendors.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '20px 16px', textAlign: 'center', color: TEXT.muted }}>No suppliers found.</td>
              </tr>
            ) : (
              vendors.map((v) => (
                <tr key={v.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: TEXT.heading }}>
                    {v.name}
                    {v.is_draft && (
                      <span style={{ marginLeft: 8, display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 10.5, fontWeight: 600, color: '#78716c', background: 'rgba(0,0,0,0.06)' }}>
                        Draft
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', color: TEXT.body }}>{v.supplier_type || '—'}</td>
                  <td style={{ padding: '12px 16px', color: TEXT.body }}>
                    {v.contact_person || '—'}
                    {v.phone ? ` · ${v.phone}` : ''}
                  </td>
                  <td style={{ padding: '12px 16px', color: TEXT.body, textTransform: 'capitalize' }}>{v.category}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 9999, fontSize: 11.5, fontWeight: 600, color: STATUS_HEX[v.status], background: `${STATUS_HEX[v.status]}18`, textTransform: 'capitalize' }}>
                      {v.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 9999, fontSize: 11.5, fontWeight: 600, color: QUAL_HEX[v.qualification_status], background: `${QUAL_HEX[v.qualification_status]}18`, textTransform: 'capitalize' }}>
                      {v.qualification_status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default function P2PSupplierPage() {
  const { isAuthorized, isLoading } = useRequireApp('p2p')
  const searchParams = useSearchParams()
  const section = searchParams.get('section') || 'supplier'

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <P2PNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>
            {SUPPLIER_SECTIONS.find((s) => s.value === section)?.label || 'Suppliers'}
          </h1>
        </div>
      </div>

      {section === 'supplier' ? (
        <SupplierSection />
      ) : (
        <p style={{ color: TEXT.muted, fontSize: 13.5 }}>
          {SUPPLIER_SECTIONS.find((s) => s.value === section)?.label} is coming soon.
        </p>
      )}
    </div>
  )
}
