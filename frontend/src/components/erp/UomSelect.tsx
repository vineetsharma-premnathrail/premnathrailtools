'use client'

import { useState } from 'react'
import SearchableSelect, { SearchableOption } from '@/components/erp/SearchableSelect'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { storeApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'

/** UOM dropdown with "+ Add new unit" and a per-unit edit pencil inside the list — the unit list is a shared
 *  master (store_uoms), so changes show up on every UOM picker. Pass manage={false} for pick-only (Store item
 *  form — units there are maintained under Store → Settings → Units of Measure). */
export default function UomSelect({
  value,
  onChange,
  options,
  onOptionsChange,
  manage = true,
}: {
  value: string
  onChange: (v: string) => void
  options: SearchableOption[]
  onOptionsChange: (opts: SearchableOption[]) => void
  manage?: boolean
}) {
  const [mode, setMode] = useState<'add' | 'edit' | null>(null)
  const [editing, setEditing] = useState('')
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const close = () => setMode(null)
  useEscapeKey(mode !== null, close)

  const listed = options.some((o) => o.value === value)
  const opts = value && !listed ? [{ value, label: `${value} (not in list)` }, ...options] : options

  const openAdd = (query: string) => { setCode(query.trim().toUpperCase().slice(0, 20)); setLabel(''); setError(''); setMode('add') }
  const openEdit = (target: string) => {
    const current = options.find((o) => o.value === target)
    setEditing(target)
    setCode(target)
    setLabel(current ? current.label.replace(`${target} — `, '').replace(target, '') : '')
    setError('')
    setMode('edit')
  }

  const save = async () => {
    const newCode = code.trim().toUpperCase()
    if (!newCode) { setError('Enter the unit code (e.g. NOS, KG, MTR).'); return }
    setSaving(true)
    try {
      const next = mode === 'add'
        ? await storeApi.createUom({ code: newCode, label: label.trim() })
        : await storeApi.updateUom(editing, { code: newCode, label: label.trim() })
      onOptionsChange(next)
      if (mode === 'add' || editing === value) onChange(newCode)
      close()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the unit.').join(' '))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {manage
        ? <SearchableSelect value={value} onChange={onChange} options={opts} placeholder="Select unit…"
            onAdd={openAdd} addLabel="+ Add new unit" onEdit={(v) => listed || v !== value ? openEdit(v) : openAdd(v)} />
        : <SearchableSelect value={value} onChange={onChange} options={opts} placeholder="Select unit…" />}

      {mode && (
        <div onClick={close} className="dialog-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="dialog-panel" style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: '0 0 14px' }}>{mode === 'add' ? 'Add unit' : `Edit unit ${editing}`}</p>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#57534e', textTransform: 'uppercase' }}>Code *</label>
            <input autoFocus style={{ ...inputStyle, margin: '4px 0 12px' }} value={code} maxLength={20} placeholder="e.g. RFT"
              onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && save()} />
            <label style={{ fontSize: 11, fontWeight: 700, color: '#57534e', textTransform: 'uppercase' }}>Name</label>
            <input style={{ ...inputStyle, margin: '4px 0 12px' }} value={label} maxLength={100} placeholder="e.g. Running foot"
              onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
            {mode === 'edit' && <p style={{ fontSize: 12, color: '#78716c', margin: '0 0 12px' }}>Renaming the code also updates every Store item that uses it.</p>}
            {error && <p style={{ fontSize: 12.5, color: '#dc2626', margin: '0 0 12px' }}>{error}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" style={secondaryBtnStyle} onClick={close}>Cancel</button>
              <button type="button" style={primaryBtnStyle} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
