'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { vendorsApi } from '@/lib/api'
import { Vendor } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import P2PNav from '@/components/p2p/P2PNav'
import { secondaryBtnStyle } from '@/components/shared/ui'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20,
}

const STATUS_HEX: Record<string, string> = { active: '#22c55e', blacklisted: '#dc2626', under_review: '#f59e0b' }

const TABS = [
  { value: 'info', label: 'Info' },
  { value: 'contact', label: 'Contact' },
  { value: 'address', label: 'Address' },
  { value: 'more', label: 'More Information' },
] as const

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{label}</p>
      <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0 }}>{value}</p>
    </div>
  )
}

export default function P2PSupplierDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('p2p')
  const params = useParams()
  const router = useRouter()
  const vendorId = Number(params.id)

  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('info')

  useEffect(() => {
    if (!isAuthorized || !vendorId) return
    setLoading(true)
    setError('')
    vendorsApi.get(vendorId)
      .then(setVendor)
      .catch(() => setError('Supplier not found.'))
      .finally(() => setLoading(false))
  }, [isAuthorized, vendorId])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <P2PNav />

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading…</p>
      ) : error || !vendor ? (
        <p style={{ fontSize: 13, color: '#b91c1c' }}>{error || 'Supplier not found.'}</p>
      ) : (
        <div style={{ width: '100%', maxWidth: 780 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 4, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{vendor.name}</h1>
              <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[vendor.status]}1a`, color: STATUS_HEX[vendor.status], textTransform: 'capitalize' }}>
                {vendor.status.replace('_', ' ')}
              </span>
              {vendor.is_draft && (
                <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: 'rgba(0,0,0,0.06)', color: '#78716c' }}>
                  Draft
                </span>
              )}
            </div>
            <button onClick={() => router.push('/dashboard/p2p/supplier')} type="button" style={secondaryBtnStyle}>
              ← Back
            </button>
          </div>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 20px' }}>
            {vendor.supplier_type || '—'}{vendor.supplier_group ? ` · ${vendor.supplier_group}` : ''}
          </p>

          <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
            {TABS.map((t) => {
              const isActive = tab === t.value
              return (
                <button
                  key={t.value}
                  onClick={() => setTab(t.value)}
                  type="button"
                  style={{
                    padding: '10px 16px',
                    marginBottom: -1,
                    fontSize: 12.5,
                    fontWeight: 600,
                    letterSpacing: '.02em',
                    textTransform: 'uppercase',
                    color: isActive ? '#FF6A2A' : '#78716c',
                    borderBottom: isActive ? '2px solid #FF6A2A' : '2px solid transparent',
                    borderTop: 'none',
                    borderLeft: 'none',
                    borderRight: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    fontFamily: 'inherit',
                  }}
                >
                  {t.label}
                </button>
              )
            })}
          </div>

          {tab === 'info' && (
            <div style={sectionStyle}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                <InfoRow label="Supplier Type" value={vendor.supplier_type || '—'} />
                <InfoRow label="Supplier Group" value={vendor.supplier_group || '—'} />
                <InfoRow label="GST Category" value={vendor.gst_category || '—'} />
                <InfoRow label="GSTIN" value={vendor.gstin || '—'} />
                <InfoRow label="PAN" value={vendor.pan || '—'} />
                <InfoRow label="Category" value={vendor.category} />
              </div>
            </div>
          )}

          {tab === 'contact' && (
            <div style={sectionStyle}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                <InfoRow label="Contact Person" value={vendor.contact_person || '—'} />
                <InfoRow label="Phone" value={vendor.phone || '—'} />
                <InfoRow label="Email" value={vendor.email || vendor.contact_email || '—'} />
                <InfoRow label="Mobile" value={vendor.contact_mobile || '—'} />
              </div>
            </div>
          )}

          {tab === 'address' && (
            <div style={sectionStyle}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Address" value={vendor.address || '—'} /></div>
                <InfoRow label="City / Town" value={vendor.city || '—'} />
                <InfoRow label="Postal Code" value={vendor.postal_code || '—'} />
                <InfoRow label="State / Province" value={vendor.state || '—'} />
                <InfoRow label="Country" value={vendor.country || '—'} />
              </div>
            </div>
          )}

          {tab === 'more' && (
            <div style={sectionStyle}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                <InfoRow label="Payment Terms" value={vendor.payment_terms || '—'} />
                <InfoRow label="Bank Details" value={vendor.bank_details || '—'} />
                <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Remarks" value={vendor.remarks || '—'} /></div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
