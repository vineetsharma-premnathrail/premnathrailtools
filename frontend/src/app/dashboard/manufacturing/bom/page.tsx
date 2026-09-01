'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { manufacturingApi } from '@/lib/api'
import { BOM, BOMItemInput, Material } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND } from '@/lib/theme'
import ManufacturingNav from '@/components/manufacturing/ManufacturingNav'
import { Field, Row3, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'

export default function ManufacturingBOMPage() {
  const { isAuthorized, isLoading } = useRequireApp('manufacturing')
  const [boms, setBoms] = useState<BOM[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [outputMaterialId, setOutputMaterialId] = useState('')
  const [outputQuantity, setOutputQuantity] = useState('1')
  const [items, setItems] = useState<BOMItemInput[]>([{ material_id: 0, quantity: 1 }])

  const load = async () => {
    setLoading(true)
    try {
      const [b, m] = await Promise.all([manufacturingApi.listBOMs(), manufacturingApi.listMaterials()])
      setBoms(b)
      setMaterials(m)
    } catch {
      setError('Failed to load BOMs.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const setItem = (i: number, patch: Partial<BOMItemInput>) => {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  }

  const create = async () => {
    setError('')
    if (!code.trim() || !name.trim() || !outputMaterialId) { setError('Code, name and output material are required.'); return }
    const validItems = items.filter((it) => it.material_id)
    setBusy(true)
    try {
      await manufacturingApi.createBOM({
        code: code.trim(),
        name: name.trim(),
        output_material_id: Number(outputMaterialId),
        output_quantity: Number(outputQuantity) || 1,
        items: validItems,
      })
      setCode(''); setName(''); setOutputMaterialId(''); setOutputQuantity('1'); setItems([{ material_id: 0, quantity: 1 }])
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to create BOM.')
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
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>BOM</h1>

      <ManufacturingNav />

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <Section title="Add BOM" style={{ marginBottom: 20 }}>
        <Row3>
          <Field label="Code *">
            <input style={inputStyle} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. BOM-001" />
          </Field>
          <Field label="Name *">
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Output Quantity">
            <input type="number" style={inputStyle} value={outputQuantity} onChange={(e) => setOutputQuantity(e.target.value)} />
          </Field>
        </Row3>
        <Field label="Output Material *">
          <select style={inputStyle} value={outputMaterialId} onChange={(e) => setOutputMaterialId(e.target.value)}>
            <option value="">Select material</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
            ))}
          </select>
        </Field>

        <p style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary, margin: '10px 0 6px' }}>Components</p>
        {items.map((it, i) => (
          <Row3 key={i}>
            <Field label="Material">
              <select style={inputStyle} value={it.material_id || ''} onChange={(e) => setItem(i, { material_id: Number(e.target.value) })}>
                <option value="">Select material</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Quantity">
              <input type="number" style={inputStyle} value={it.quantity} onChange={(e) => setItem(i, { quantity: Number(e.target.value) })} />
            </Field>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                style={{ ...secondaryBtnStyle, height: 40 }}
              >
                Remove
              </button>
            </div>
          </Row3>
        ))}
        <button onClick={() => setItems((prev) => [...prev, { material_id: 0, quantity: 1 }])} style={secondaryBtnStyle}>
          + Add Component
        </button>

        <div>
          <button disabled={busy} onClick={create} style={{ ...primaryBtnStyle, marginTop: 12, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Adding…' : 'Add BOM'}
          </button>
        </div>
      </Section>

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['Code', 'Name', 'Output Material', 'Output Qty', 'Components', 'Status'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && boms.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No BOMs yet.</td></tr>
            )}
            {boms.map((b) => (
              <tr key={b.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{b.code}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{b.name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{b.output_material_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{b.output_quantity}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.secondary }}>
                  {b.items.length === 0 ? '—' : b.items.map((it) => `${it.material_code || it.material_name} × ${it.quantity}`).join(', ')}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: b.is_active ? '#16a34a' : '#94a3b8' }}>{b.is_active ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
