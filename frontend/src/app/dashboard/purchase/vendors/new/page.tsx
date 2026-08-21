'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { vendorsApi } from '@/lib/api'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function NewVendorPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const router = useRouter()

  const [name, setName] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [gstin, setGstin] = useState('')
  const [category, setCategory] = useState('materials')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [bankDetails, setBankDetails] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setError('')
    if (!name.trim()) { setError('Vendor name is required.'); return }
    setSubmitting(true)
    try {
      const vendor = await vendorsApi.create({
        name: name.trim(),
        contact_person: contactPerson || undefined,
        phone: phone || undefined,
        email: email || undefined,
        address: address || undefined,
        gstin: gstin || undefined,
        category,
        payment_terms: paymentTerms || undefined,
        bank_details: bankDetails || undefined,
      })
      router.push(`/dashboard/purchase/vendors/${vendor.id}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to create vendor.')
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ width: '100%', maxWidth: 780 }}>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Purchase Module
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Vendor</h1>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Vendor Details</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          <div>
            <label style={labelStyle}>Vendor Name *</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="materials">Materials</option>
              <option value="services">Services</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Contact Person</label>
            <input style={inputStyle} value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Phone</label>
            <input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>GSTIN</label>
            <input style={inputStyle} value={gstin} onChange={(e) => setGstin(e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Address</label>
            <textarea style={{ ...inputStyle, minHeight: 60 }} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Payment Terms</label>
            <input style={inputStyle} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. Net 30" />
          </div>
          <div>
            <label style={labelStyle}>Bank Details</label>
            <input style={inputStyle} value={bankDetails} onChange={(e) => setBankDetails(e.target.value)} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => router.back()} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Creating…' : 'Create Vendor'}
        </button>
      </div>
    </div>
  )
}
