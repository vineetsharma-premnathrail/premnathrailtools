'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { manufacturingApi } from '@/lib/api'
import { Material } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND } from '@/lib/theme'
import ManufacturingNav from '@/components/manufacturing/ManufacturingNav'
import { Field, Row3, Section, inputStyle, primaryBtnStyle } from '@/components/shared/ui'

export default function ManufacturingMaterialPage() {
  const { isAuthorized, isLoading } = useRequireApp('manufacturing')
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [category, setCategory] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      setMaterials(await manufacturingApi.listMaterials())
    } catch {
      setError('Failed to load materials.')
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
    if (!code.trim() || !name.trim()) { setError('Code and name are required.'); return }
    setBusy(true)
    try {
      await manufacturingApi.createMaterial({ code: code.trim(), name: name.trim(), unit: unit || undefined, category: category || undefined })
      setCode(''); setName(''); setUnit(''); setCategory('')
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to create material.')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Manufacturing
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Material</h1>

      <ManufacturingNav />

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <Section title="Add Material" style={{ marginBottom: 20 }}>
        <Row3>
          <Field label="Code *">
            <input style={inputStyle} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. RM-001" />
          </Field>
          <Field label="Name *">
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Unit">
            <input style={inputStyle} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. kg, pcs" />
          </Field>
        </Row3>
        <Field label="Category">
          <input style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <button disabled={busy} onClick={create} style={{ ...primaryBtnStyle, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Adding…' : 'Add Material'}
        </button>
      </Section>

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['Code', 'Name', 'Unit', 'Category', 'Status'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && materials.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No materials yet.</td></tr>
            )}
            {materials.map((m) => (
              <tr key={m.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{m.code}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{m.name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{m.unit || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{m.category || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: m.is_active ? '#16a34a' : '#94a3b8' }}>{m.is_active ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
