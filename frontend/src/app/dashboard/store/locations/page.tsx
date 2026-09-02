'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreLocation } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND } from '@/lib/theme'
import StoreNav from '@/components/store/StoreNav'
import { Field, Row3, Section, inputStyle, primaryBtnStyle } from '@/components/shared/ui'

export default function StoreLocationsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [address, setAddress] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      setLocations(await storeApi.listLocations())
    } catch {
      setError('Failed to load locations.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const create = async () => {
    setError('')
    if (!name.trim() || !code.trim()) { setError('Name and code are required.'); return }
    setBusy(true)
    try {
      await storeApi.createLocation({ name: name.trim(), code: code.trim(), address: address || undefined })
      setName(''); setCode(''); setAddress('')
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to create location.')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Store Module
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Storage Locations</h1>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <Section title="Add Location" style={{ marginBottom: 20 }}>
        <Row3>
          <Field label="Name *">
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Code *">
            <input style={inputStyle} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. MAIN-01" />
          </Field>
          <Field label="Address">
            <input style={inputStyle} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        </Row3>
        <button disabled={busy} onClick={create} style={{ ...primaryBtnStyle, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Adding…' : 'Add Location'}
        </button>
      </Section>

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['Name', 'Code', 'Address', 'Status'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && locations.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No locations yet.</td></tr>
            )}
            {locations.map((l) => (
              <tr key={l.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{l.name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{l.code}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{l.address || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: l.is_active ? '#16a34a' : '#94a3b8' }}>{l.is_active ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
