'use client'

import { useEffect, useState } from 'react'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { extractErrorMessages } from '@/lib/validation'

export interface MasterField {
  key: string
  label: string
  placeholder?: string
  maxLength?: number
  upper?: boolean
  required?: boolean
}

/** Small add/edit dialog used by the Store → Settings master-data pages
 *  (Item Types, Units of Measure). */
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
  const [values, setValues] = useState<Record<string, string>>(initial)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEscapeKey(open, onClose)

  useEffect(() => {
    if (open) { setValues(initial); setError('') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

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

  return (
    <div onClick={onClose} className="dialog-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="dialog-panel" style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
        <p style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: subtitle ? '0 0 4px' : '0 0 14px' }}>{title}</p>
        {subtitle && <p style={{ fontSize: 12.5, color: '#78716c', margin: '0 0 14px' }}>{subtitle}</p>}
        {fields.map((f, i) => (
          <div key={f.key}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#57534e', textTransform: 'uppercase' }}>{f.label}{f.required ? ' *' : ''}</label>
            <input autoFocus={i === 0} style={{ ...inputStyle, margin: '4px 0 12px' }} value={values[f.key] || ''} maxLength={f.maxLength} placeholder={f.placeholder}
              onChange={(e) => setValues({ ...values, [f.key]: f.upper ? e.target.value.toUpperCase() : e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && save()} />
          </div>
        ))}
        {note && <p style={{ fontSize: 12, color: '#78716c', margin: '0 0 12px' }}>{note}</p>}
        {error && <p style={{ fontSize: 12.5, color: '#dc2626', margin: '0 0 12px' }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" style={secondaryBtnStyle} onClick={onClose}>Cancel</button>
          <button type="button" style={primaryBtnStyle} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
