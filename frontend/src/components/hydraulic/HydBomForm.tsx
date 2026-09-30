'use client'

import { useEffect, useMemo, useState } from 'react'
import { hydraulicApi } from '@/lib/api'
import { HydBom, HydComponent, HydLookupOption } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import { SYSTEM_TYPE_LABELS } from '@/components/hydraulic/labels'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }
const rowStyle: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', padding: 12, borderRadius: 12,
  border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.45)',
}
const removeBtn: React.CSSProperties = { ...secondaryBtnStyle, padding: '9px 12px', color: DANGER.primary, borderColor: DANGER.border }
const readOnlyBox: React.CSSProperties = { ...inputStyle, background: 'rgba(0,0,0,0.03)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

interface LineRow { key: number; tag_number: string; component_id: string; quantity: string; uom: string; remarks: string }

let rowKey = 0
const nextKey = () => ++rowKey
const blankLine = (): LineRow => ({ key: nextKey(), tag_number: '', component_id: '', quantity: '1', uom: 'NOS', remarks: '' })
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/**
 * Create / edit form for a draft hydraulic BOM. Lines are tagged with the
 * circuit's symbol tags (P1, V3…); on save the full line list replaces
 * whatever the draft had. Costs shown here are an estimate from the
 * component master — the saved BOM's roll-up is computed by the backend.
 */
export default function HydBomForm({
  initial,
  defaultSystemId,
  submitLabel,
  onSubmit,
}: {
  initial?: HydBom | null
  defaultSystemId?: string
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [title, setTitle] = useState(initial?.title || '')
  const [systemId, setSystemId] = useState(initial?.system_id ? String(initial.system_id) : (defaultSystemId || ''))
  const [systemType, setSystemType] = useState<string>(initial?.system_type || 'hydraulic')
  const [circuitId, setCircuitId] = useState(initial?.circuit_id ? String(initial.circuit_id) : '')
  const [remarks, setRemarks] = useState(initial?.remarks || '')
  const [lines, setLines] = useState<LineRow[]>(
    initial?.items.length
      ? initial.items.map((i) => ({
        key: nextKey(), tag_number: i.tag_number || '', component_id: String(i.component_id),
        quantity: String(i.quantity), uom: i.uom || 'NOS', remarks: i.remarks || '',
      }))
      : [blankLine()],
  )
  const [systems, setSystems] = useState<HydLookupOption[]>([])
  const [circuits, setCircuits] = useState<HydLookupOption[]>([])
  const [components, setComponents] = useState<HydLookupOption[]>([])
  const [unitCosts, setUnitCosts] = useState<Record<number, number>>({})
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  const selectedSystem = systems.find((s) => String(s.id) === systemId)
  // A linked system dictates the medium; otherwise the BOM keeps its own
  // (systemType starts from the saved value when editing).
  const effectiveType = selectedSystem?.extra || systemType

  useEffect(() => {
    hydraulicApi.lookupSystems().then(setSystems).catch((err) => setError(extractErrorMessages(err, 'Failed to load systems.')))
    // The lookup doesn't carry cost, so pull unit costs from the master once.
    hydraulicApi.listComponents({ status: 'active' })
      .then((data: HydComponent[]) => {
        const map: Record<number, number> = {}
        for (const c of Array.isArray(data) ? data : []) map[c.id] = c.unit_cost || 0
        setUnitCosts(map)
      })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load component unit costs.')))
  }, [])

  // Both lists reload when the system / medium changes; `cancelled` stops a
  // slower earlier response from overwriting the newer one.
  useEffect(() => {
    let cancelled = false
    hydraulicApi.lookupCircuits(systemId ? Number(systemId) : undefined)
      .then((data) => { if (!cancelled) setCircuits(data) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Failed to load circuits.')) })
    return () => { cancelled = true }
  }, [systemId])

  useEffect(() => {
    let cancelled = false
    hydraulicApi.lookupComponents(effectiveType)
      .then((data) => { if (!cancelled) setComponents(data) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Failed to load components.')) })
    return () => { cancelled = true }
  }, [effectiveType])

  // Lines already on the BOM may point at components the lookup no longer
  // returns (obsolete, or the other medium) — keep them selectable/labelled.
  const componentOptions = useMemo(() => {
    const opts = components.map((c) => ({ value: String(c.id), label: c.label }))
    const known = new Set(opts.map((o) => o.value))
    for (const i of initial?.items || []) {
      const v = String(i.component_id)
      if (!known.has(v)) {
        known.add(v)
        opts.push({ value: v, label: `${i.component_code || `#${i.component_id}`} — ${i.component_name || 'Component'}${i.manufacturer || i.model_number ? ` · ${[i.manufacturer, i.model_number].filter(Boolean).join(' ')}` : ''} (not in current list)` })
      }
    }
    return opts
  }, [components, initial])

  const circuitOptions = useMemo(() => {
    const opts = circuits.map((c) => ({ value: String(c.id), label: c.label }))
    if (initial?.circuit_id && !opts.some((o) => o.value === String(initial.circuit_id)) && String(initial.circuit_id) === circuitId) {
      opts.push({ value: String(initial.circuit_id), label: `${initial.circuit_number || `#${initial.circuit_id}`} Rev ${initial.circuit_revision || '?'}` })
    }
    return [{ value: '', label: '— No circuit —' }, ...opts]
  }, [circuits, initial, circuitId])

  const costOf = (componentId: string): number => {
    if (!componentId) return 0
    const id = Number(componentId)
    if (unitCosts[id] != null) return unitCosts[id]
    return initial?.items.find((i) => i.component_id === id)?.unit_cost || 0
  }
  const lineCost = (r: LineRow) => (r.component_id && Number(r.quantity) > 0 ? costOf(r.component_id) * Number(r.quantity) : 0)
  const total = lines.reduce((sum, r) => sum + lineCost(r), 0)

  const updateLine = (key: number, patch: Partial<LineRow>) => setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const handleSystemChange = (v: string) => {
    setSystemId(v)
    // The circuit list is filtered by system, so a previous pick may no longer apply.
    setCircuitId('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!title.trim()) { setError('BOM title is required — e.g. "Power pack BOM" or "Clamp circuit BOM".'); return }

    const isBlank = (r: LineRow) => !r.component_id && !r.tag_number.trim() && !r.remarks.trim()
    const filled = lines.filter((r) => !isBlank(r))
    for (let idx = 0; idx < filled.length; idx++) {
      const r = filled[idx]
      const where = `Line ${lines.indexOf(r) + 1}${r.tag_number.trim() ? ` (tag ${r.tag_number.trim().toUpperCase()})` : ''}`
      if (!r.component_id) { setError(`${where} has no component — pick one from the component master or remove the line.`); return }
      if (!(Number(r.quantity) > 0)) { setError(`${where}: quantity must be more than zero.`); return }
      if (!r.uom.trim()) { setError(`${where}: unit of measure is required (e.g. NOS, M, SET).`); return }
      if (r.tag_number.trim().length > 30) { setError(`${where}: tag number can be at most 30 characters.`); return }
    }
    const tags = filled.map((r) => r.tag_number.trim().toUpperCase()).filter(Boolean)
    const dupes = [...new Set(tags.filter((t, i) => tags.indexOf(t) !== i))]
    if (dupes.length) {
      setError(`Tag ${dupes.join(', ')} is used on more than one line — each circuit tag should appear once. Combine the lines or correct the tag.`)
      return
    }

    setSaving(true)
    try {
      await onSubmit({
        ...(initial ? {} : { system_type: effectiveType }),
        title: title.trim(),
        system_id: systemId ? Number(systemId) : null,
        circuit_id: circuitId ? Number(circuitId) : null,
        remarks: remarks.trim() || null,
        items: filled.map((r) => ({
          component_id: Number(r.component_id),
          tag_number: r.tag_number.trim().toUpperCase() || null,
          quantity: Number(r.quantity),
          uom: r.uom.trim().toUpperCase(),
          remarks: r.remarks.trim() || null,
        })),
      })
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save BOM.'))
    } finally {
      setSaving(false)
    }
  }

  const lineCount = lines.filter((r) => r.component_id).length

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>BOM</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Power pack BOM" maxLength={255} />
          </div>
          <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
            <label style={labelStyle}>System</label>
            <SearchableSelect value={systemId} onChange={handleSystemChange} placeholder="Search system…"
              options={[{ value: '', label: '— Not linked to a system —' }, ...systems.map((s) => ({ value: String(s.id), label: s.label }))]} />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Medium</label>
            {!initial && !systemId ? (
              <select style={inputStyle} value={systemType} onChange={(e) => setSystemType(e.target.value)}>
                {Object.entries(SYSTEM_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            ) : (
              <div style={readOnlyBox}>{SYSTEM_TYPE_LABELS[effectiveType] || effectiveType}</div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 300px', maxWidth: 460 }}>
            <label style={labelStyle}>Circuit</label>
            <SearchableSelect value={circuitId} onChange={setCircuitId} placeholder="Search circuit…" options={circuitOptions} />
          </div>
          <div style={{ flex: '1 1 300px' }}>
            <label style={labelStyle}>Remarks</label>
            <textarea style={{ ...inputStyle, minHeight: 44, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }}>
          {systemId ? 'Circuits and components are limited to the chosen system and its medium.' : 'Pick a system to narrow the circuit list; the component list follows the medium.'}
        </p>
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <p style={sectionTitle}>Lines ({lineCount})</p>
          <button type="button" style={secondaryBtnStyle} onClick={() => setLines([...lines, blankLine()])}>+ Add Line</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {lines.map((r) => (
            <div key={r.key} style={rowStyle}>
              <div style={{ flex: '0 1 90px', minWidth: 80 }}>
                <label style={labelStyle}>Tag</label>
                <input style={{ ...inputStyle, textTransform: 'uppercase' }} value={r.tag_number} placeholder="P1" maxLength={30}
                  onChange={(e) => updateLine(r.key, { tag_number: e.target.value.toUpperCase() })} />
              </div>
              <div style={{ flex: '1 1 300px', maxWidth: 460 }}>
                <label style={labelStyle}>Component</label>
                <SearchableSelect value={r.component_id} onChange={(v) => updateLine(r.key, { component_id: v })} options={componentOptions} placeholder="Search code, name or make…" />
              </div>
              <div style={{ flex: '0 1 100px', minWidth: 90 }}>
                <label style={labelStyle}>Qty</label>
                <input style={inputStyle} type="number" min={0} step="any" value={r.quantity} onChange={(e) => updateLine(r.key, { quantity: e.target.value })} />
              </div>
              <div style={{ flex: '0 1 90px', minWidth: 80 }}>
                <label style={labelStyle}>UOM</label>
                <input style={{ ...inputStyle, textTransform: 'uppercase' }} value={r.uom} maxLength={20} onChange={(e) => updateLine(r.key, { uom: e.target.value.toUpperCase() })} />
              </div>
              <div style={{ flex: '0 1 120px', minWidth: 110 }}>
                <label style={labelStyle}>Line Cost</label>
                <div style={readOnlyBox} title={r.component_id ? `${inr(costOf(r.component_id))} each` : undefined}>{r.component_id ? inr(lineCost(r)) : '—'}</div>
              </div>
              <div style={{ flex: '1 1 180px', maxWidth: 260 }}>
                <label style={labelStyle}>Remarks</label>
                <input style={inputStyle} value={r.remarks} onChange={(e) => updateLine(r.key, { remarks: e.target.value })} />
              </div>
              <button type="button" style={removeBtn} onClick={() => setLines(lines.filter((x) => x.key !== r.key))} aria-label="Remove line">×</button>
            </div>
          ))}
          {lines.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No lines yet — a BOM needs at least one component line before it can be released.</p>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: TEXT.muted }}>Estimated from component master unit costs</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading }}>Total {inr(total)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" disabled={saving} style={{
          padding: '12px 22px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
          background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1,
          boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
        }}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
