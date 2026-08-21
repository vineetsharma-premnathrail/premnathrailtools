'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { vendorsApi } from '@/lib/api'
import { Vendor } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BRAND } from '@/lib/theme'

const STATUS_HEX: Record<string, string> = {
  active: '#22c55e', blacklisted: '#dc2626', under_review: '#f59e0b',
}
const QUAL_HEX: Record<string, string> = {
  qualified: '#22c55e', pending: '#f59e0b', disqualified: '#dc2626',
}

export default function VendorsPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const router = useRouter()
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await vendorsApi.list({ search: search || undefined, limit: 1000 })
      setVendors(data)
    } catch {
      setError('Failed to load vendors.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Purchase Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Vendors</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>{vendors.length} vendor(s)</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/purchase/vendors/new')}
          style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}
        >
          + New Vendor
        </button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search vendor by name…"
        style={{ width: '100%', maxWidth: 360, padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13.5, outline: 'none', marginBottom: 16 }}
      />

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 340px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['Name', 'Contact', 'Category', 'GSTIN', 'Status', 'Qualification', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && vendors.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No vendors yet.</td></tr>
            )}
            {vendors.map((v) => (
              <tr key={v.id} onClick={() => router.push(`/dashboard/purchase/vendors/${v.id}`)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{v.name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{v.contact_person || '—'}{v.phone ? ` · ${v.phone}` : ''}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, textTransform: 'capitalize' }}>{v.category}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{v.gstin || '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[v.status]}1a`, color: STATUS_HEX[v.status], whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                    {v.status.replace('_', ' ')}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${QUAL_HEX[v.qualification_status]}1a`, color: QUAL_HEX[v.qualification_status], whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                    {v.qualification_status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }} onClick={(e) => e.stopPropagation()}>
                  <span onClick={() => router.push(`/dashboard/purchase/vendors/${v.id}`)} style={{ fontSize: 11.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
