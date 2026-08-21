'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { vendorsApi } from '@/lib/api'
import { Vendor } from '@/types'
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
const STATUS_HEX: Record<string, string> = { active: '#22c55e', blacklisted: '#dc2626', under_review: '#f59e0b' }
const QUAL_HEX: Record<string, string> = { qualified: '#22c55e', pending: '#f59e0b', disqualified: '#dc2626' }

export default function VendorDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const params = useParams()
  const router = useRouter()
  const vendorId = Number(params.id)

  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState<Record<string, string>>({})

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await vendorsApi.get(vendorId)
      setVendor(data)
      setForm({
        name: data.name || '', contact_person: data.contact_person || '', phone: data.phone || '',
        email: data.email || '', address: data.address || '', gstin: data.gstin || '',
        category: data.category, payment_terms: data.payment_terms || '', bank_details: data.bank_details || '',
        status: data.status, qualification_status: data.qualification_status,
      })
    } catch {
      setError('Vendor not found.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && vendorId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, vendorId])

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await vendorsApi.update(vendorId, form)
      setEditing(false)
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to save vendor.')
    } finally {
      setBusy(false)
    }
  }

  const set = (field: string, value: string) => setForm((prev) => ({ ...prev, [field]: value }))

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading…</p>
  if (error && !vendor) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!vendor) return null

  return (
    <div style={{ width: '100%', maxWidth: 780 }}>
      <button onClick={() => router.push('/dashboard/purchase/vendors')} style={{ fontSize: 13, fontWeight: 600, color: TEXT.secondary, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}>
        ← Back to Vendors
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{vendor.name}</h1>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[vendor.status]}1a`, color: STATUS_HEX[vendor.status], textTransform: 'capitalize' }}>
              {vendor.status.replace('_', ' ')}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${QUAL_HEX[vendor.qualification_status]}1a`, color: QUAL_HEX[vendor.qualification_status], textTransform: 'capitalize' }}>
              {vendor.qualification_status}
            </span>
          </div>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>{vendor.category}</p>
        </div>
        <button onClick={() => setEditing((v) => !v)} style={{ padding: '10px 20px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {editing ? 'Cancel Edit' : 'Edit Vendor'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {!editing ? (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Vendor Details</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            <InfoRow label="Contact Person" value={vendor.contact_person || '—'} />
            <InfoRow label="Phone" value={vendor.phone || '—'} />
            <InfoRow label="Email" value={vendor.email || '—'} />
            <InfoRow label="GSTIN" value={vendor.gstin || '—'} />
            <InfoRow label="Payment Terms" value={vendor.payment_terms || '—'} />
            <InfoRow label="Bank Details" value={vendor.bank_details || '—'} />
            <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Address" value={vendor.address || '—'} /></div>
            {vendor.remarks && <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Remarks" value={vendor.remarks} /></div>}
          </div>
        </div>
      ) : (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Edit Vendor</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            <div>
              <label style={labelStyle}>Vendor Name</label>
              <input style={inputStyle} value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <select style={inputStyle} value={form.category} onChange={(e) => set('category', e.target.value)}>
                <option value="materials">Materials</option>
                <option value="services">Services</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Contact Person</label>
              <input style={inputStyle} value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input style={inputStyle} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input style={inputStyle} value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>GSTIN</label>
              <input style={inputStyle} value={form.gstin} onChange={(e) => set('gstin', e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Address</label>
              <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.address} onChange={(e) => set('address', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Payment Terms</label>
              <input style={inputStyle} value={form.payment_terms} onChange={(e) => set('payment_terms', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Bank Details</label>
              <input style={inputStyle} value={form.bank_details} onChange={(e) => set('bank_details', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select style={inputStyle} value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="under_review">Under Review</option>
                <option value="blacklisted">Blacklisted</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Qualification Status</label>
              <select style={inputStyle} value={form.qualification_status} onChange={(e) => set('qualification_status', e.target.value)}>
                <option value="pending">Pending</option>
                <option value="qualified">Qualified</option>
                <option value="disqualified">Disqualified</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <button disabled={busy} onClick={save} style={{ padding: '10px 26px', borderRadius: 12, border: 'none', cursor: busy ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{label}</p>
      <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0 }}>{value}</p>
    </div>
  )
}
