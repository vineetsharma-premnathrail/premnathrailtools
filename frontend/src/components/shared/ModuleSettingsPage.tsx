'use client'

// Generic settings page for the shared settings framework
// (backend app/core/settings_framework.py, plan §27). A module page only
// supplies its nav, title and the three API calls:
//
//   <ModuleSettingsPage title="Maintenance settings" nav={<MaintenanceNav />}
//     load={maintenanceApi.getSettings} save={maintenanceApi.saveSettings}
//     reset={maintenanceApi.resetSetting} />
//
// The page itself must still do the useRequireApp() guard.

import { ReactNode, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SettingSpecDto, SettingsPayload, DirectoryUser } from '@/types'
import { usersApi } from '@/lib/api'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import NotificationRulesPanel, { NotificationEvent, triggerText } from '@/components/shared/NotificationRulesPanel'
import { extractErrorMessages } from '@/lib/validation'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, display: 'block' }
const helpStyle: React.CSSProperties = { fontSize: 11.5, color: TEXT.muted, margin: '4px 0 0' }
const badgeStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: '#64748b1a', color: '#64748b', whiteSpace: 'nowrap',
}
const linkBtnStyle: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: BRAND.primary, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
}
const chipStyle = (active: boolean): React.CSSProperties => ({
  fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 9999, cursor: 'pointer',
  border: `1px solid ${active ? BRAND.primaryBorder : BORDER.normal}`,
  background: active ? BRAND.primarySoft : 'rgba(255,255,255,.7)', color: active ? BRAND.primaryActive : TEXT.secondary,
})

const USER_TYPES = ['user', 'users']

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
}

// users / multi_select hold sets: the same members in another order are not a change.
function sameValue(a: unknown, b: unknown, type?: string): boolean {
  if ((type === 'users' || type === 'multi_select') && Array.isArray(a) && Array.isArray(b)) {
    const norm = (x: unknown[]) => x.map((v) => String(v)).sort()
    return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
  }
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function displayValue(spec: SettingSpecDto, value: unknown, users: DirectoryUser[]): string {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return '—'
  if (spec.type === 'bool') return value ? 'Yes' : 'No'
  if (spec.type === 'select' || spec.type === 'multi_select') {
    const items = Array.isArray(value) ? value : [value]
    return items.map((v) => spec.options?.find((o) => o.value === String(v))?.label || String(v)).join(', ')
  }
  if (USER_TYPES.includes(spec.type)) {
    const items = Array.isArray(value) ? value : [value]
    return items.map((v) => users.find((u) => u.id === Number(v))?.name || `User #${v}`).join(', ')
  }
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export default function ModuleSettingsPage({
  title,
  nav,
  backHref,
  load,
  save,
  reset,
  extraSections,
  leadSections,
  tourPrefix,
}: {
  title: string
  nav?: ReactNode
  backHref?: string
  load: () => Promise<SettingsPayload>
  save: (values: Record<string, unknown>) => Promise<SettingsPayload>
  reset: (key: string) => Promise<SettingsPayload>
  extraSections?: ReactNode
  /** Rendered above the setting groups (extraSections go below the Save bar). */
  leadSections?: ReactNode
  /** Emits data-tour="<prefix>-group-<group>", "<prefix>-field-<key>" and "<prefix>-save" for a guided tour. */
  tourPrefix?: string
}) {
  const router = useRouter()
  const [payload, setPayload] = useState<SettingsPayload | null>(null)
  // Raw form state: numbers / json_list are edited as text and parsed on save.
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string[] | null>(null)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [users, setUsers] = useState<DirectoryUser[]>([])
  // One key from a field's "Reset to default", several from a notification row's reset.
  const [resetReq, setResetReq] = useState<{ keys: string[]; label: string } | null>(null)
  const [userSearch, setUserSearch] = useState<Record<string, string>>({})

  const toDraft = (p: SettingsPayload): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const spec of p.specs) {
      const v = p.values[spec.key]
      if (spec.type === 'int' || spec.type === 'decimal') out[spec.key] = v === null || v === undefined ? '' : String(v)
      else if (spec.type === 'json_list') out[spec.key] = Array.isArray(v) ? v.join(', ') : ''
      else if (spec.type === 'json') out[spec.key] = JSON.stringify(v ?? null, null, 2)
      else out[spec.key] = v
    }
    return out
  }

  const apply = (p: SettingsPayload) => {
    setPayload(p)
    setDraft(toDraft(p))
    setFieldErrors({})
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    load()
      .then((p) => {
        if (cancelled) return
        apply(p)
        if (p.specs.some((s) => USER_TYPES.includes(s.type))) {
          usersApi.directory().then((u) => { if (!cancelled) setUsers(u) }).catch(() => { /* picker falls back to ids */ })
        }
      })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Could not load the settings — reload the page.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const specsByGroup = useMemo(() => {
    const map: Record<string, SettingSpecDto[]> = {}
    for (const s of payload?.specs || []) (map[s.group] ||= []).push(s)
    return map
  }, [payload])

  // notify_<event> groups (backend notify_rules.notification_specs) are shown together
  // in one compact NotificationRulesPanel instead of a card per event.
  const notifyEvents = useMemo<NotificationEvent[]>(() => {
    if (!payload) return []
    return payload.groups.flatMap((g) => {
      const specs = specsByGroup[g.key] || []
      const find = (suffix: string) => specs.find((s) => s.key === `${g.key}_${suffix}`)
      const enabled = find('enabled'), usersSpec = find('users'), channels = find('channels'), emails = find('emails')
      if (!g.key.startsWith('notify_') || !enabled || !usersSpec || !channels || !emails || specs.length !== 4) return []
      return [{
        group: g.key,
        label: g.label.replace(/^Notification\s+—\s+/, ''),
        trigger: triggerText(enabled),
        keys: { enabled: enabled.key, users: usersSpec.key, channels: channels.key, emails: emails.key },
        channelOptions: channels.options || [],
      }]
    })
  }, [payload, specsByGroup])
  const notifyGroups = useMemo(() => new Set(notifyEvents.map((e) => e.group)), [notifyEvents])

  const userOptions = useMemo(() => users.map((u) => ({ value: String(u.id), label: `${u.name}${u.department ? ` — ${u.department}` : ''}` })), [users])

  const canEdit = !!payload?.can_edit

  // Parses one draft value into what the API expects; returns an error text instead when invalid.
  const parse = (spec: SettingSpecDto, raw: unknown): { value?: unknown; error?: string } => {
    if (spec.type === 'int' || spec.type === 'decimal') {
      const s = String(raw ?? '').trim()
      if (!s) return { error: `${spec.label} is required — enter a number.` }
      const n = Number(s)
      if (!Number.isFinite(n)) return { error: `${spec.label} must be a number — enter digits only.` }
      if (spec.type === 'int' && !Number.isInteger(n)) return { error: `${spec.label} must be a whole number — remove the decimal part.` }
      if ((spec.min !== null && n < spec.min) || (spec.max !== null && n > spec.max)) {
        const range = spec.min !== null && spec.max !== null ? `between ${spec.min} and ${spec.max}` : spec.min !== null ? `at least ${spec.min}` : `at most ${spec.max}`
        return { error: `${spec.label} must be ${range} — enter a number in that range.` }
      }
      return { value: n }
    }
    if (spec.type === 'json_list') {
      const parts = String(raw ?? '').split(',').map((x) => x.trim()).filter(Boolean)
      // A list whose code default is all numbers (e.g. reminder days [30, 7, 1]) stays numeric.
      const def = spec.default
      const numeric = Array.isArray(def) && def.length > 0 && def.every((x) => typeof x === 'number')
      if (!numeric) return { value: parts }
      const wholeOnly = (def as number[]).every((x) => Number.isInteger(x))
      const nums: number[] = []
      for (const p of parts) {
        const n = Number(p)
        if (!Number.isFinite(n)) return { error: `${spec.label}: "${p}" is not a number — enter numbers separated by commas.` }
        if (wholeOnly && !Number.isInteger(n)) return { error: `${spec.label}: "${p}" must be a whole number — remove the decimal part.` }
        nums.push(n)
      }
      return { value: nums }
    }
    if (spec.type === 'json') {
      try { return { value: JSON.parse(String(raw ?? 'null')) } } catch { return { error: `${spec.label} is not valid JSON — check brackets and quotes.` } }
    }
    return { value: raw }
  }

  const dirty = useMemo(() => {
    if (!payload) return {} as Record<string, { value?: unknown; error?: string }>
    const out: Record<string, { value?: unknown; error?: string }> = {}
    for (const spec of payload.specs) {
      if (spec.locked) continue
      const parsed = parse(spec, draft[spec.key])
      if (parsed.error) {
        // Only an edited field can be "dirty"; compare raw text to the loaded value.
        if (!sameValue(draft[spec.key], toDraft(payload)[spec.key], spec.type)) out[spec.key] = parsed
        continue
      }
      if (!sameValue(parsed.value, payload.values[spec.key], spec.type)) out[spec.key] = parsed
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, payload])

  const dirtyCount = Object.keys(dirty).length

  const setField = (key: string, value: unknown) => {
    setDraft((d) => ({ ...d, [key]: value }))
    if (key in fieldErrors) {
      const remaining = { ...fieldErrors }
      delete remaining[key]
      setFieldErrors(remaining)
      // Last highlighted field fixed: drop the "Fix the highlighted fields" banner.
      if (Object.keys(remaining).length === 0) setError(null)
    }
    setNotice('')
  }

  const handleSave = async () => {
    if (!payload) return
    const errs: Record<string, string> = {}
    const values: Record<string, unknown> = {}
    for (const [key, p] of Object.entries(dirty)) {
      if (p.error) errs[key] = p.error
      else values[key] = p.value
    }
    if (Object.keys(errs).length) {
      setFieldErrors(errs)
      setError(['Fix the highlighted fields — nothing was saved.'])
      return
    }
    if (!Object.keys(values).length) return
    setSaving(true)
    setError(null)
    try {
      apply(await save(values))
      setNotice('Settings saved.')
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the settings — try again.'))
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    const req = resetReq
    setResetReq(null)
    if (!req) return
    setError(null)
    try {
      let p: SettingsPayload | null = null
      for (const key of req.keys) p = await reset(key)
      if (p) apply(p)
      setNotice(req.keys.length > 1 ? `${req.label} reset to its default.` : 'Setting reset to its default.')
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not reset the setting — try again.'))
    }
  }

  const renderInput = (spec: SettingSpecDto) => {
    const v = draft[spec.key]
    const disabled = !canEdit || spec.locked
    const errBorder = fieldErrors[spec.key] ? { borderColor: 'rgba(220,38,38,0.6)' } : {}

    if (disabled) {
      return <div style={{ fontSize: 13.5, color: TEXT.body, padding: '6px 0', whiteSpace: 'pre-wrap' }}>{displayValue(spec, payload?.values[spec.key], users)}</div>
    }

    switch (spec.type) {
      case 'bool':
        return (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: TEXT.body, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!v} onChange={(e) => setField(spec.key, e.target.checked)} />
            {v ? 'Yes' : 'No'}
          </label>
        )
      case 'int':
      case 'decimal':
        return (
          <input type="number" inputMode={spec.type === 'int' ? 'numeric' : 'decimal'} step={spec.type === 'int' ? 1 : 'any'}
            min={spec.min ?? undefined} max={spec.max ?? undefined}
            value={String(v ?? '')} onChange={(e) => setField(spec.key, e.target.value)}
            style={{ ...inputStyle, maxWidth: 160, ...errBorder }} />
        )
      case 'prefix':
        return (
          <input value={String(v ?? '')} maxLength={10} onChange={(e) => setField(spec.key, e.target.value.toUpperCase())}
            style={{ ...inputStyle, maxWidth: 140, textTransform: 'uppercase', ...errBorder }} />
        )
      case 'text':
        return <input value={String(v ?? '')} maxLength={500} onChange={(e) => setField(spec.key, e.target.value)} style={{ ...inputStyle, maxWidth: 420, ...errBorder }} />
      case 'longtext':
        return <textarea value={String(v ?? '')} maxLength={5000} rows={6} onChange={(e) => setField(spec.key, e.target.value)} style={{ ...inputStyle, maxWidth: 720, resize: 'vertical', fontFamily: 'inherit', ...errBorder }} />
      case 'select':
        return (
          <select value={String(v ?? '')} onChange={(e) => setField(spec.key, e.target.value)} style={{ ...inputStyle, maxWidth: 280, ...errBorder }}>
            {(spec.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )
      case 'multi_select': {
        const selected = Array.isArray(v) ? (v as string[]) : []
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(spec.options || []).map((o) => {
              const on = selected.includes(o.value)
              return (
                <button key={o.value} type="button" style={chipStyle(on)}
                  onClick={() => setField(spec.key, (spec.options || []).map((opt) => opt.value).filter((val) => (val === o.value ? !on : selected.includes(val))))}>
                  {on ? '✓ ' : ''}{o.label}
                </button>
              )
            })}
          </div>
        )
      }
      case 'user':
        if (!users.length) {
          return (
            <div>
              <input type="number" value={v === null || v === undefined ? '' : String(v)}
                onChange={(e) => setField(spec.key, e.target.value ? Number(e.target.value) : null)} style={{ ...inputStyle, maxWidth: 160 }} />
              <p style={helpStyle}>User list unavailable — enter the user ID.</p>
            </div>
          )
        }
        return (
          <div style={{ maxWidth: 340 }}>
            <SearchableSelect value={v === null || v === undefined ? '' : String(v)} onChange={(x) => setField(spec.key, x ? Number(x) : null)}
              options={userOptions} placeholder="Select a person..." />
          </div>
        )
      case 'users': {
        const ids = Array.isArray(v) ? (v as number[]) : []
        const q = (userSearch[spec.key] || '').trim().toLowerCase()
        const matches = q
          ? users.filter((u) => !ids.includes(u.id) && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))).slice(0, 8)
          : []
        return (
          <div style={{ maxWidth: 420, position: 'relative' }}>
            {ids.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {ids.map((id) => (
                  <span key={id} style={{ ...chipStyle(true), cursor: 'default', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {users.find((u) => u.id === id)?.name || `User #${id}`}
                    <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => setField(spec.key, ids.filter((x) => x !== id))}>×</span>
                  </span>
                ))}
              </div>
            )}
            <input value={userSearch[spec.key] || ''} placeholder="Search people to add..."
              onChange={(e) => setUserSearch((s) => ({ ...s, [spec.key]: e.target.value }))} style={inputStyle} />
            {matches.length > 0 && (
              <div style={{ marginTop: 4, borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: '#fff', overflow: 'hidden' }}>
                {matches.map((u) => (
                  <div key={u.id} style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid ${BORDER.light}` }}
                    onClick={() => { setField(spec.key, [...ids, u.id]); setUserSearch((s) => ({ ...s, [spec.key]: '' })) }}>
                    {u.name} <span style={{ color: TEXT.muted }}>· {u.email}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      }
      case 'json_list':
        return (
          <div style={{ maxWidth: 420 }}>
            <input value={String(v ?? '')} onChange={(e) => setField(spec.key, e.target.value)} style={inputStyle} />
            <p style={helpStyle}>Separate entries with commas.</p>
          </div>
        )
      default:
        return (
          <textarea value={String(v ?? '')} rows={4} onChange={(e) => setField(spec.key, e.target.value)}
            style={{ ...inputStyle, maxWidth: 520, fontFamily: 'monospace', ...errBorder }} />
        )
    }
  }

  const resetSpec = resetReq?.keys.length === 1 ? payload?.specs.find((s) => s.key === resetReq.keys[0]) : undefined
  const resetMessage = !resetReq ? ''
    : resetSpec ? `${resetSpec.label} will go back to its default (${displayValue(resetSpec, resetSpec.default, users)}). The change is recorded in the audit log.`
    : `${resetReq.label} will go back to its defaults (switched off, nobody selected, Portal bell only). The change is recorded in the audit log.`
  const firstNotifyGroup = notifyEvents[0]?.group

  return (
    <div style={{ width: '100%' }}>
      {nav}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 6px' }}>{title}</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 20px' }}>
            Values you change here apply right away. A setting showing <b>Default</b> follows the value built into the system.
          </p>
        </div>
        {backHref && <button type="button" onClick={() => router.push(backHref)} style={secondaryBtnStyle}>← Back</button>}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error.join(' ')}
        </div>
      )}
      {notice && !error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#166534', fontSize: 13 }}>
          {notice}
        </div>
      )}

      {loading && <div style={{ ...sectionStyle, color: TEXT.muted, fontSize: 13 }}>Loading settings…</div>}

      {payload && !payload.can_edit && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.2)', color: '#1e40af', fontSize: 13 }}>
          Read-only. {payload.editors_note}
        </div>
      )}

      {leadSections}

      {payload && payload.groups.filter((g) => specsByGroup[g.key]?.length).map((g) => notifyGroups.has(g.key) ? (
        g.key === firstNotifyGroup ? (
          <NotificationRulesPanel key="notifications" events={notifyEvents} draft={draft} setField={setField} users={users}
            canEdit={canEdit} dirtyKeys={new Set(Object.keys(dirty))} fieldErrors={fieldErrors} isDefault={payload.is_default}
            onReset={(keys, label) => setResetReq({ keys, label })} tourPrefix={tourPrefix} />
        ) : null
      ) : (
        <div key={g.key} style={sectionStyle} data-tour={tourPrefix ? `${tourPrefix}-group-${g.key}` : undefined}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>{g.label}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {specsByGroup[g.key].map((spec) => {
              const isDefault = payload.is_default[spec.key]
              const meta = payload.meta[spec.key]
              return (
                <div key={spec.key} style={{ paddingBottom: 14, borderBottom: `1px solid ${BORDER.light}` }}
                  data-tour={tourPrefix ? `${tourPrefix}-field-${spec.key}` : undefined}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                    <span style={labelStyle}>{spec.label}</span>
                    {isDefault && <span style={badgeStyle}>Default</span>}
                    {spec.locked && <span style={badgeStyle}>Locked</span>}
                    {dirty[spec.key] && <span style={{ ...badgeStyle, background: `${BRAND.primary}1a`, color: BRAND.primaryActive }}>Unsaved</span>}
                    {canEdit && !spec.locked && !isDefault && (
                      <button type="button" style={linkBtnStyle} onClick={() => setResetReq({ keys: [spec.key], label: spec.label })}>Reset to default</button>
                    )}
                  </div>
                  {renderInput(spec)}
                  {fieldErrors[spec.key] && <p style={{ ...helpStyle, color: '#b91c1c' }}>{fieldErrors[spec.key]}</p>}
                  {spec.help && <p style={helpStyle}>{spec.help}</p>}
                  {!isDefault && meta && (meta.updated_by_name || meta.updated_at) && (
                    <p style={helpStyle}>
                      Changed{meta.updated_by_name ? ` by ${meta.updated_by_name}` : ''}{meta.updated_at ? ` on ${fmtDate(meta.updated_at)}` : ''}
                      {' · '}default: {displayValue(spec, spec.default, users)}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {payload && canEdit && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
          <button type="button" onClick={handleSave} disabled={saving || dirtyCount === 0}
            data-tour={tourPrefix ? `${tourPrefix}-save` : undefined}
            style={{ ...primaryBtnStyle, opacity: saving || dirtyCount === 0 ? 0.6 : 1, cursor: saving || dirtyCount === 0 ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : dirtyCount ? `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}` : 'No changes'}
          </button>
          {dirtyCount > 0 && (
            <button type="button" style={secondaryBtnStyle} onClick={() => { setDraft(toDraft(payload)); setFieldErrors({}); setError(null) }}>
              Discard changes
            </button>
          )}
        </div>
      )}

      {extraSections}

      <ConfirmDialog
        open={!!resetReq}
        title="Reset to default?"
        message={resetMessage}
        confirmLabel="Reset"
        onConfirm={handleReset}
        onCancel={() => setResetReq(null)}
      />
    </div>
  )
}
