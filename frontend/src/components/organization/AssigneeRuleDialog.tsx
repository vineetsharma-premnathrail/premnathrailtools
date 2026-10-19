'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { TEXT, BORDER, BRAND } from '@/lib/theme'
import { inputStyle } from '@/components/shared/ui'

/**
 * Who a role's members may pick in one "Assign to" field (backend
 * core/assignee_rules.py). Opened from the feature row of the Permission
 * Matrix. `rule` null = no restriction.
 */

export interface AssigneeRule { mode: string; departments?: number[]; roles?: number[]; users?: number[] }
export interface AssigneeOption { id: number; label: string; sub?: string | null }

export function describeRule(rule: AssigneeRule | null | undefined, modes: Record<string, string>): string {
  if (!rule) return 'Anyone the screen allows'
  if (rule.mode !== 'custom') return modes[rule.mode] || rule.mode
  const n = (rule.departments?.length || 0) + (rule.roles?.length || 0) + (rule.users?.length || 0)
  return `Selected (${n})`
}

export default function AssigneeRuleDialog({ open, title, hint, rule, modes, departments, roles, users, readOnly, onSave, onClose }: {
  open: boolean
  title: string
  hint?: string
  rule: AssigneeRule | null
  modes: Record<string, string>
  departments: AssigneeOption[]
  roles: AssigneeOption[]
  users: AssigneeOption[]
  readOnly?: boolean
  onSave: (rule: AssigneeRule | null) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState(rule?.mode || '')
  const [picked, setPicked] = useState({ departments: rule?.departments || [], roles: rule?.roles || [], users: rule?.users || [] })
  const [error, setError] = useState('')
  useEscapeKey(open, onClose)
  if (!open || typeof document === 'undefined') return null

  const save = () => {
    if (!mode) { onSave(null); return }
    if (mode !== 'custom') { onSave({ mode }); return }
    if (!picked.departments.length && !picked.roles.length && !picked.users.length) {
      setError('Pick at least one department, role or person — or choose another option.')
      return
    }
    onSave({ mode, ...picked })
  }

  const choices: [string, string, string][] = [
    ['', 'Anyone the screen allows', 'No extra limit — only the screen’s own rules (e.g. the requirement’s departments, the project team).'],
    ['self', modes.self, 'They can only give tasks to themselves.'],
    ['team', modes.team, 'Themselves and everyone under them in Reporting Manager (any level).'],
    ['department', modes.department, 'People whose Department is the same as theirs.'],
    ['custom', modes.custom, 'Anyone in the departments, holding the roles, or named below.'],
  ]

  return createPortal(
    <div onClick={onClose} className="dialog-backdrop"
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="dialog-panel"
        style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: TEXT.heading }}>{title}</h3>
        {hint && <p style={{ margin: '0 0 14px', fontSize: 12.5, color: TEXT.muted }}>{hint}</p>}
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {choices.map(([key, label, help]) => (
            <label key={key || 'none'} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 10, cursor: readOnly ? 'default' : 'pointer',
              border: `1px solid ${mode === key ? BRAND.primary : BORDER.normal}`, background: mode === key ? 'rgba(244,113,59,0.06)' : '#fff' }}>
              <input type="radio" name="assignee-rule" checked={mode === key} disabled={readOnly} onChange={() => { setMode(key); setError('') }} style={{ marginTop: 3 }} />
              <span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{label}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted }}>{help}</span>
              </span>
            </label>
          ))}
        </div>
        {mode === 'custom' && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ChipPicker label="Departments" options={departments} value={picked.departments} readOnly={readOnly}
              onChange={(v) => { setPicked((p) => ({ ...p, departments: v })); setError('') }} />
            <ChipPicker label="Roles" options={roles} value={picked.roles} readOnly={readOnly}
              onChange={(v) => { setPicked((p) => ({ ...p, roles: v })); setError('') }} />
            <ChipPicker label="People" options={users} value={picked.users} readOnly={readOnly}
              onChange={(v) => { setPicked((p) => ({ ...p, users: v })); setError('') }} />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onClose} style={btn(false)}>{readOnly ? 'Close' : 'Cancel'}</button>
          {!readOnly && <button type="button" onClick={save} style={btn(true)}>Apply</button>}
        </div>
        {!readOnly && <p style={{ margin: '10px 0 0', fontSize: 11.5, color: TEXT.muted, textAlign: 'right' }}>Applied to the role when you save it.</p>}
      </div>
    </div>,
    document.body,
  )
}

/** Multi-select by search with removable chips (same UX as the P2P approver picker). */
function ChipPicker({ label, options, value, onChange, readOnly }: {
  label: string; options: AssigneeOption[]; value: number[]; onChange: (v: number[]) => void; readOnly?: boolean
}) {
  const [search, setSearch] = useState('')
  const byId = new Map(options.map((o) => [o.id, o]))
  const q = search.trim().toLowerCase()
  const matches = q ? options.filter((o) => !value.includes(o.id) && `${o.label} ${o.sub || ''}`.toLowerCase().includes(q)).slice(0, 8) : []
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>{label}</div>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {value.map((id) => (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 9999, background: 'rgba(244,113,59,0.1)', color: BRAND.primaryActive }}>
              {byId.get(id)?.label || `#${id}`}
              {!readOnly && <span style={{ cursor: 'pointer' }} onClick={() => onChange(value.filter((x) => x !== id))}>×</span>}
            </span>
          ))}
        </div>
      )}
      {!readOnly && (
        <div style={{ position: 'relative' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`} style={inputStyle} />
          {matches.length > 0 && (
            <div style={{ marginTop: 4, border: `1px solid ${BORDER.normal}`, borderRadius: 10, overflow: 'hidden' }}>
              {matches.map((o) => (
                <div key={o.id} onClick={() => { onChange([...value, o.id]); setSearch('') }}
                  style={{ padding: '7px 12px', fontSize: 12.5, cursor: 'pointer', borderTop: `1px solid ${BORDER.normal}` }}>
                  {o.label}{o.sub && <span style={{ color: TEXT.muted }}> · {o.sub}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function btn(primary: boolean): React.CSSProperties {
  return {
    padding: '9px 18px', borderRadius: 9999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: primary ? 'none' : `1px solid ${BORDER.normal}`, background: primary ? BRAND.primary : '#fff', color: primary ? '#fff' : TEXT.body,
  }
}
