'use client'

import { useEffect, useState } from 'react'
import { hydraulicApi } from '@/lib/api'
import { HydCircuit, HydLookupOption } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
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

/**
 * Create / edit form for a circuit revision. Only rendered while the
 * revision is a draft — the backend refuses edits once it is submitted.
 * Picking a system fixes the medium (the backend copies the system's type);
 * the medium select only appears on create when no system is chosen.
 */
export default function CircuitForm({
  initial,
  defaultSystemId,
  submitLabel,
  onSubmit,
}: {
  initial?: HydCircuit | null
  defaultSystemId?: string
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [title, setTitle] = useState(initial?.title || '')
  const [systemId, setSystemId] = useState(initial?.system_id ? String(initial.system_id) : (defaultSystemId || ''))
  const [systemType, setSystemType] = useState<string>(initial?.system_type || 'hydraulic')
  const [drawingNumber, setDrawingNumber] = useState(initial?.drawing_number || '')
  const [symbolStandard, setSymbolStandard] = useState(initial ? (initial.symbol_standard || '') : 'ISO 1219-1')
  const [description, setDescription] = useState(initial?.description || '')
  const [changeNote, setChangeNote] = useState(initial?.change_note || '')
  const [systems, setSystems] = useState<HydLookupOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    hydraulicApi.lookupSystems().then(setSystems).catch((err) => setError(extractErrorMessages(err, 'Failed to load systems.')))
  }, [])

  const selectedSystem = systems.find((s) => String(s.id) === systemId)
  // A chosen system dictates the medium; otherwise the draft keeps its own
  // (systemType starts from the saved value when editing).
  const effectiveType = selectedSystem?.extra || systemType

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!title.trim()) { setError('Circuit title is required — e.g. "Main press circuit" or "Clamp cylinder circuit".'); return }
    setSaving(true)
    try {
      await onSubmit({
        ...(initial ? {} : { system_type: effectiveType }),
        title: title.trim(),
        system_id: systemId ? Number(systemId) : null,
        drawing_number: drawingNumber.trim() || null,
        symbol_standard: symbolStandard.trim() || null,
        description: description.trim() || null,
        change_note: changeNote.trim() || null,
      })
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save circuit.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Circuit</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Main press circuit" maxLength={255} />
          </div>
          <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
            <label style={labelStyle}>System</label>
            <SearchableSelect value={systemId} onChange={setSystemId} placeholder="Search system…"
              options={[{ value: '', label: '— Not linked to a system —' }, ...systems.map((s) => ({ value: String(s.id), label: s.label }))]} />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 140 }}>
            <label style={labelStyle}>Medium</label>
            {!initial && !systemId ? (
              <select style={inputStyle} value={systemType} onChange={(e) => setSystemType(e.target.value)}>
                {Object.entries(SYSTEM_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            ) : (
              <div style={{ ...inputStyle, background: 'rgba(0,0,0,0.03)' }}>{SYSTEM_TYPE_LABELS[effectiveType] || effectiveType}</div>
            )}
          </div>
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }}>
          {systemId ? 'The medium follows the linked system.' : initial ? "The medium can't be changed after creation — link a system to take on its medium." : "Pick a system to take on its medium, or choose one here — it can't be changed later."}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 180px', maxWidth: 260 }}>
            <label style={labelStyle}>Drawing Number</label>
            <input style={inputStyle} value={drawingNumber} onChange={(e) => setDrawingNumber(e.target.value)} placeholder="PRL-HYD-0012" maxLength={100} />
          </div>
          <div style={{ flex: '1 1 160px', maxWidth: 220 }}>
            <label style={labelStyle}>Symbol Standard</label>
            <input style={inputStyle} value={symbolStandard} onChange={(e) => setSymbolStandard(e.target.value)} placeholder="ISO 1219-1" maxLength={100} />
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 300px' }}>
            <label style={labelStyle}>Description</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What the circuit does — actuators, sequence, pressure settings…" />
          </div>
          <div style={{ flex: '1 1 300px' }}>
            <label style={labelStyle}>Change Note</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={changeNote} onChange={(e) => setChangeNote(e.target.value)}
              placeholder={initial && initial.revision !== 'A' ? 'What changed in this revision' : 'Initial issue'} />
          </div>
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
