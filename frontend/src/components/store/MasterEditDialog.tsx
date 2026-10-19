'use client'

import { useState } from 'react'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { extractErrorMessages } from '@/lib/validation'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

export interface MasterField {
  key: string
  label: string
  placeholder?: string
  maxLength?: number
  upper?: boolean
  required?: boolean
}

/** Small add/edit popup used by the Store → Settings master-data pages
 *  (Item Types, Units of Measure). Same look as every other form sheet. */
export default function MasterEditDialog({
  open,
  title,
  subtitle,
  note,
  fields,
  initial,
  onSave,
  onClose,
}: {
  open: boolean
  title: string
  subtitle?: string
  note?: string
  fields: MasterField[]
  initial: Record<string, string>
  onSave: (values: Record<string, string>) => Promise<void>
  onClose: () => void
}) {
  // Mounted only while open, so its state starts fresh from `initial` each time.
  if (!open) return null
  return <MasterEditSheet title={title} subtitle={subtitle} note={note} fields={fields} initial={initial} onSave={onSave} onClose={onClose} />
}

function MasterEditSheet({ title, subtitle, note, fields, initial, onSave, onClose }: {
  title: string; subtitle?: string; note?: string; fields: MasterField[]; initial: Record<string, string>
  onSave: (values: Record<string, string>) => Promise<void>; onClose: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(initial)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEscapeKey(true, onClose)

  const save = async () => {
    const missing = fields.find((f) => f.required && !(values[f.key] || '').trim())
    if (missing) { setError(`Enter the ${missing.label.toLowerCase()}.`); return }
    setSaving(true)
    try {
      await onSave(Object.fromEntries(fields.map((f) => [f.key, (values[f.key] || '').trim()])))
      onClose()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save.').join(' '))
    } finally {
      setSaving(false)
    }
  }

  const editing = /^edit/i.test(title)

  return (
    <FormSheet width={520} icon={editing ? 'edit' : 'tag'} title={title} subtitle={subtitle || 'Store master data — used on items and stock documents.'} onClose={onClose} busy={saving}
      footer={<>
        <button data-tour="store-master-cancel-btn" type="button" style={sheetBtn('secondary', SHEET.INK, saving)} disabled={saving} onClick={onClose}>Cancel</button>
        <button data-tour="store-master-save-btn" type="button" style={sheetBtn('primary', SHEET.BLUE, saving)} disabled={saving} onClick={save}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>
        )}
        <SheetSection icon="list" title="Details">
          {fields.map((f, i) => (
            <div key={f.key} data-tour={`store-master-field-${f.key}`} style={{ marginTop: i === 0 ? 0 : 14 }}>
              <label style={sheetLabel}>{f.label} {f.required && <Req />}</label>
              <input autoFocus={i === 0} style={sheetInput} value={values[f.key] || ''} maxLength={f.maxLength} placeholder={f.placeholder}
                onChange={(e) => setValues({ ...values, [f.key]: f.upper ? e.target.value.toUpperCase() : e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && save()} />
            </div>
          ))}
          {note && <p style={sheetHint}>{note}</p>}
        </SheetSection>
      </div>
    </FormSheet>
  )
}
