'use client'

import { useEffect, useState } from 'react'
import { hydraulicApi } from '@/lib/api'
import { HydCircuit, HydLookupOption } from '@/types'
import { SheetColumns, SheetSection, SHEET, sheetInput, sheetLabel, sheetHint, Req, Optional, SheetError } from '@/components/shared/FormSheet'
import HydFormShell, { HydShellProps, Cell, fieldRow } from '@/components/hydraulic/HydFormShell'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import { SYSTEM_TYPE_LABELS } from '@/components/hydraulic/labels'

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
  mode, title: shellTitle, subtitle, nav, onBack, onCancel,
}: HydShellProps & {
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

  const handleSubmit = async () => {
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
    <HydFormShell
      mode={mode} title={shellTitle} subtitle={subtitle} nav={nav} onBack={onBack} onCancel={onCancel}
      icon={initial ? 'edit' : 'link'} busy={saving} submitLabel={submitLabel} submitIcon={initial ? 'check' : 'plus'}
      onSubmit={handleSubmit} tour="hyd-cir-form" backTour="hyd-cir-back-btn" submitTour="hyd-cir-save-btn"
    >
      <SheetColumns
        left={<>
          <SheetError error={error} />
          <SheetSection icon="link" title="Circuit">
            <div style={fieldRow}>
              <Cell basis={260} grow>
                <label style={sheetLabel}>Title <Req /></label>
                <input data-tour="hyd-cir-title" style={sheetInput} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Main press circuit" maxLength={255} />
              </Cell>
            </div>
            <div style={{ ...fieldRow, marginBottom: 0 }}>
              <Cell tour="hyd-cir-system" basis={240} grow max={380}>
                <label style={sheetLabel}>System</label>
                <SearchableSelect value={systemId} onChange={setSystemId} placeholder="Search system…"
                  options={[{ value: '', label: '— Not linked to a system —' }, ...systems.map((s) => ({ value: String(s.id), label: s.label }))]} />
              </Cell>
              <Cell tour="hyd-cir-medium" basis={150}>
                <label style={sheetLabel}>Medium</label>
                {!initial && !systemId ? (
                  <select style={sheetInput} value={systemType} onChange={(e) => setSystemType(e.target.value)}>
                    {Object.entries(SYSTEM_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                ) : (
                  <div style={{ ...sheetInput, background: SHEET.SOFT }}>{SYSTEM_TYPE_LABELS[effectiveType] || effectiveType}</div>
                )}
              </Cell>
            </div>
            <p style={sheetHint}>
              {systemId ? 'The medium follows the linked system.' : initial ? "The medium can't be changed after creation — link a system to take on its medium." : "Pick a system to take on its medium, or choose one here — it can't be changed later."}
            </p>
          </SheetSection>
          <SheetSection icon="doc" title="Drawing">
            <div style={{ ...fieldRow, marginBottom: 0 }}>
              <Cell basis={180} grow max={260}>
                <label style={sheetLabel}>Drawing Number</label>
                <input data-tour="hyd-cir-drawing-number" style={sheetInput} value={drawingNumber} onChange={(e) => setDrawingNumber(e.target.value)} placeholder="PRL-HYD-0012" maxLength={100} />
              </Cell>
              <Cell basis={160} grow max={220}>
                <label style={sheetLabel}>Symbol Standard</label>
                <input data-tour="hyd-cir-symbol-standard" style={sheetInput} value={symbolStandard} onChange={(e) => setSymbolStandard(e.target.value)} placeholder="ISO 1219-1" maxLength={100} />
              </Cell>
            </div>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="list" title="Description" extra={<Optional />}>
            <textarea data-tour="hyd-cir-description" style={{ ...sheetInput, minHeight: 90, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What the circuit does — actuators, sequence, pressure settings…" aria-label="Description" />
          </SheetSection>
          <SheetSection icon="history" title="Change Note" extra={<Optional />}>
            <textarea data-tour="hyd-cir-change-note" style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={changeNote} onChange={(e) => setChangeNote(e.target.value)}
              placeholder={initial && initial.revision !== 'A' ? 'What changed in this revision' : 'Initial issue'} aria-label="Change note" />
          </SheetSection>
        </>}
      />
    </HydFormShell>
  )
}
