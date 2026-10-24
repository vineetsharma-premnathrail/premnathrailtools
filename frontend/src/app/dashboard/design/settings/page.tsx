'use client'

import AnchoredDropdown from '@/components/design/AnchoredDropdown'
import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignLookupOption, DesignSettings } from '@/types'
import { TEXT, SHADOWS } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { ACK_DEPARTMENT_LABELS, TEAM_ROLE_LABELS, toOptions } from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'

type Section = 'team' | 'approvals' | 'board' | 'ack'
type TeamRow = { user_id: string; role: 'head' | 'reviewer' | 'designer' }

const EDITABLE_ROLES = ['head', 'reviewer', 'designer'] as const
const ROLE_HEX: Record<string, string> = { admin: '#7C3AED', head: '#FF6A2A', reviewer: '#2563EB', designer: '#16A34A', viewer: '#78716c' }

// White card per settings block, holding a SheetSection (same look as the FormSheet popups).
const cardStyle: React.CSSProperties = {
  background: '#fff', border: `1px solid ${SHEET.LINE}`, borderRadius: 18, boxShadow: '0 1px 3px rgba(15,23,42,0.05)',
  padding: '20px 24px 0', marginBottom: 16,
}
const noteStyle: React.CSSProperties = { ...sheetHint, margin: '0 0 14px' }
const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 9999, fontSize: 12, fontWeight: 600,
  background: '#eff6ff', color: SHEET.BLUE, border: '1px solid #bfdbfe',
}

function pill(label: string, hex: string) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

// Multi-select by search with removable chips (same UX as the P2P approver picker).
function UserChips({ ids, onChange, users, disabled, placeholder }: {
  ids: number[]; onChange: (ids: number[]) => void; users: DesignLookupOption[]; disabled?: boolean; placeholder: string
}) {
  const [search, setSearch] = useState('')
  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return users.filter((u) => !ids.includes(u.id) && (u.label.toLowerCase().includes(q) || (u.code || '').toLowerCase().includes(q))).slice(0, 8)
  }, [search, users, ids])
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: ids.length ? 8 : 0 }}>
        {ids.map((id) => (
          <span key={id} style={chipStyle}>
            {byId.get(id)?.label || `User #${id}`}
            {!disabled && (
              <span onClick={() => onChange(ids.filter((x) => x !== id))} style={{ cursor: 'pointer', fontSize: 14, lineHeight: 1 }} title="Remove">×</span>
            )}
          </span>
        ))}
        {disabled && ids.length === 0 && <span style={{ fontSize: 13, color: SHEET.MUTED }}>Nobody named.</span>}
      </div>
      {!disabled && (
        <div style={{ position: 'relative', maxWidth: 360 }}>
          <input style={sheetInput} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={placeholder} />
          {matches.length > 0 && (
            <AnchoredDropdown style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: `1px solid ${SHEET.LINE}`, borderRadius: 10, boxShadow: SHADOWS.glass(), zIndex: 20, overflow: 'hidden' }}>
              {matches.map((u) => (
                <div key={u.id} onClick={() => { onChange([...ids, u.id]); setSearch('') }} style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderTop: `1px solid ${SHEET.LINE}` }}>
                  <div style={{ color: SHEET.INK, fontWeight: 600 }}>{u.label}</div>
                  {u.code && <div style={{ fontSize: 11.5, color: SHEET.MUTED }}>{u.code}</div>}
                </div>
              ))}
            </AnchoredDropdown>
          )}
        </div>
      )}
    </div>
  )
}

export default function DesignSettingsPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const [settings, setSettings] = useState<DesignSettings | null>(null)
  const [users, setUsers] = useState<DesignLookupOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState<Section | null>(null)

  const [team, setTeam] = useState<TeamRow[]>([])
  const [approverId, setApproverId] = useState('')
  const [overdueDays, setOverdueDays] = useState('')
  const [responseDays, setResponseDays] = useState('')
  const [board, setBoard] = useState<number[]>([])
  const [ack, setAck] = useState<Record<string, number[]>>({})

  const apply = (s: DesignSettings) => {
    setSettings(s)
    setTeam(s.team.map((t) => ({ user_id: String(t.user_id), role: t.role })))
    setApproverId(s.default_approver_id ? String(s.default_approver_id) : '')
    setOverdueDays(String(s.review_overdue_days))
    setResponseDays(String(s.customer_response_days))
    setBoard(s.change_board_member_ids || [])
    setAck(Object.fromEntries(Object.keys(ACK_DEPARTMENT_LABELS).map((d) => [d, s.ecn_acknowledger_ids?.[d] || []])))
  }

  useEffect(() => {
    if (!isAuthorized) return
    designApi.getSettings()
      .then(apply)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load Design settings.')))
    designApi.lookupUsers()
      .then(setUsers)
      .catch((err) => setError(extractErrorMessages(err, 'Loading the user list failed — the pickers will be empty.')))
  }, [isAuthorized])

  const userOptions = useMemo(() => toOptions(users.map((u) => ({ id: u.id, label: u.code ? `${u.label} — ${u.code}` : u.label }))), [users])
  const approverOptions = useMemo(() => [{ value: '', label: 'None — the author picks every time' }, ...userOptions], [userOptions])

  if (isLoading || !isAuthorized) return null

  const canEdit = !!settings?.can_edit
  const noAppById = new Map((settings?.team || []).filter((t) => !t.has_design_app).map((t) => [String(t.user_id), true]))

  const save = async (section: Section, payload: Record<string, unknown>, done: string) => {
    setSaving(section)
    setError('')
    setSuccess('')
    try {
      apply(await designApi.updateSettings(payload))
      setSuccess(done)
    } catch (err) {
      setError(extractErrorMessages(err, 'Saving Design settings failed.'))
    } finally {
      setSaving(null)
    }
  }

  const saveTeam = () => {
    const rows = team.filter((r) => r.user_id)
    if (rows.length && !rows.some((r) => r.role === 'head')) { setError('The team needs at least one Design head — they release drawings and decide ECRs.'); return }
    const seen = new Set<string>()
    for (const r of rows) {
      if (seen.has(r.user_id)) { setError(`${users.find((u) => String(u.id) === r.user_id)?.label || 'A user'} is listed twice in the team.`); return }
      seen.add(r.user_id)
    }
    save('team', { team: rows.map((r) => ({ user_id: Number(r.user_id), role: r.role })) },
      rows.length ? `Design team saved — ${rows.length} member${rows.length === 1 ? '' : 's'}, role checks on.` : 'Team cleared — everyone with the Design app now works as a designer.')
  }
  const saveApprovals = () => {
    const overdue = Number(overdueDays)
    const response = Number(responseDays)
    if (!Number.isInteger(overdue) || overdue < 1 || overdue > 90) { setError('Review overdue days must be a whole number from 1 to 90.'); return }
    if (!Number.isInteger(response) || response < 1 || response > 365) { setError('Customer response days must be a whole number from 1 to 365.'); return }
    save('approvals', { default_approver_id: approverId ? Number(approverId) : null, review_overdue_days: overdue, customer_response_days: response }, 'Approvals & timing saved.')
  }

  const updateTeamRow = (idx: number, patch: Partial<TeamRow>) => setTeam(team.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  const saveBtn = (section: Section, onClick: () => void, label: string) => canEdit && (
    <button type="button" data-tour={`design-settings-save-${section}`} disabled={!!saving} style={sheetBtn('primary', SHEET.BLUE, !!saving)} onClick={onClick}>
      <SheetIcon name="check" size={16} />{saving === section ? 'Saving…' : label}
    </button>
  )
  const nameOf = (id: string) => users.find((u) => String(u.id) === id)?.label

  return (
    <div>
      <DesignNav />

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design Module</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Design Settings</h1>
        {settings && (
          <p data-tour="design-settings-role" style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Your role:</span> {pill(TEAM_ROLE_LABELS[settings.my_role] || settings.my_role, ROLE_HEX[settings.my_role] || '#78716c')}
            <span>·</span>
            <span>{settings.updated_at ? <>Last changed by <strong style={{ color: TEXT.body }}>{settings.updated_by_name || '—'}</strong> on {formatDateTime(settings.updated_at)}</> : 'Never changed — showing defaults.'}</span>
          </p>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {success && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          {success}
        </div>
      )}
      {settings && !canEdit && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400E', fontSize: 13 }}>
          Read-only — only the Design head or an admin can change these settings. Ask {settings.team.filter((t) => t.role === 'head').map((t) => t.name).filter(Boolean).join(' or ') || 'the Design head'} if something needs to change.
        </div>
      )}

      <div style={{ ...cardStyle, background: '#f8fbff', border: '1px solid #dbeafe' }}>
        <SheetSection icon="alert" title="What can be configured here">
        <p style={{ fontSize: 13, color: SHEET.BODY, margin: 0 }}>
          Forms, fields, statuses and workflow steps are fixed in code (decision 2026-09-18: no custom fields / form builder). Ask IT for a change.
          This page only sets <em>who</em> does each step and the time limits.
        </p>
        </SheetSection>
      </div>

      {settings && (
        <>
          {/* (a) Design team */}
          <div data-tour="design-settings-team" style={cardStyle}>
            <SheetSection icon="users" title="Design team">
            <p style={noteStyle}>
              No team = everyone with the Design app works as a designer and can release; adding the team turns on role checks.
              Heads release drawings, decide ECRs and manage the library; reviewers check; designers author. Everyone else with the app is a viewer.
            </p>
            {team.length === 0 && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: '0 0 12px' }}>No team set up — role checks are off.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, maxWidth: 760 }}>
              {team.map((r, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 300px', maxWidth: 420 }}>
                    {canEdit ? (
                      <SearchableSelect value={r.user_id} onChange={(v) => updateTeamRow(idx, { user_id: v })} options={userOptions} placeholder="Pick a user…" />
                    ) : (
                      <div style={{ fontSize: 13, fontWeight: 600, color: SHEET.INK }}>{settings.team[idx]?.name || nameOf(r.user_id) || `User #${r.user_id}`}</div>
                    )}
                  </div>
                  <div style={{ flex: '0 1 230px' }}>
                    {canEdit ? (
                      <Select style={sheetInput} value={r.role} onChange={(e) => updateTeamRow(idx, { role: e.target.value as TeamRow['role'] })}>
                        {EDITABLE_ROLES.map((k) => <option key={k} value={k}>{TEAM_ROLE_LABELS[k]}</option>)}
                      </Select>
                    ) : pill(TEAM_ROLE_LABELS[r.role] || r.role, ROLE_HEX[r.role] || '#78716c')}
                  </div>
                  {noAppById.get(r.user_id) && (
                    <span style={{ fontSize: 12, color: '#b45309', fontWeight: 600 }}>⚠ Doesn&apos;t have the Design app — grant it in User Management or they can&apos;t act.</span>
                  )}
                  {canEdit && <button type="button" aria-label="Remove from team" style={sheetBtn('ghost', '#dc2626')} onClick={() => setTeam(team.filter((_, i) => i !== idx))} title="Remove from team"><SheetIcon name="trash" size={16} />Remove</button>}
                </div>
              ))}
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" data-tour="design-settings-add-member-btn" style={sheetBtn('secondary', SHEET.BLUE)} onClick={() => setTeam([...team, { user_id: '', role: team.length === 0 ? 'head' : 'designer' }])}><SheetIcon name="plus" size={16} />Add Member</button>
                {saveBtn('team', saveTeam, 'Save Team')}
              </div>
            )}
            </SheetSection>
          </div>

          {/* (b) Approvals & timing */}
          <div data-tour="design-settings-approvals" style={cardStyle}>
            <SheetSection icon="clock" title="Approvals & timing">
            <p style={noteStyle}>The default approver is pre-filled on every new revision (the author can change it). Overdue days flag checks/approvals waiting too long on the dashboard; customer response days set the due date on a transmittal when it is sent. The check → approval stages themselves (who signs, in what order, escalation) are set in Organization › Approval Workflows (&ldquo;Drawing / document revision release&rdquo;, &ldquo;BOM revision release&rdquo;).</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
              <div data-tour="design-settings-approver" style={{ flex: '1 1 280px', maxWidth: 380 }}>
                <label style={sheetLabel}>Default approver</label>
                {canEdit
                  ? <SearchableSelect value={approverId} onChange={setApproverId} options={approverOptions} placeholder="None" />
                  : <div style={{ fontSize: 13, color: SHEET.INK }}>{settings.default_approver_name || 'None'}</div>}
              </div>
              <div data-tour="design-settings-overdue-days" style={{ flex: '0 1 170px', minWidth: 170 }}>
                <label style={sheetLabel}>Review overdue after (days)</label>
                {canEdit
                  ? <input type="number" min={1} max={90} style={sheetInput} value={overdueDays} onChange={(e) => setOverdueDays(e.target.value)} />
                  : <div style={{ fontSize: 13, color: SHEET.INK }}>{settings.review_overdue_days} days</div>}
              </div>
              <div data-tour="design-settings-response-days" style={{ flex: '0 1 190px', minWidth: 190 }}>
                <label style={sheetLabel}>Customer response due (days)</label>
                {canEdit
                  ? <input type="number" min={1} max={365} style={sheetInput} value={responseDays} onChange={(e) => setResponseDays(e.target.value)} />
                  : <div style={{ fontSize: 13, color: SHEET.INK }}>{settings.customer_response_days} days</div>}
              </div>
            </div>
            {saveBtn('approvals', saveApprovals, 'Save Approvals & Timing')}
            </SheetSection>
          </div>

          {/* (c) Change board */}
          <div data-tour="design-settings-board" style={cardStyle}>
            <SheetSection icon="shield" title="Change board members">
            <p style={noteStyle}>Pre-filled as the voting board on every ECR once Design records its impact (it can be adjusted per ECR). The Design head decides after every board member has voted.</p>
            <div style={{ marginBottom: 14 }}>
              <UserChips ids={board} onChange={setBoard} users={users} disabled={!canEdit} placeholder="Search a user to add…" />
            </div>
            {saveBtn('board', () => save('board', { change_board_member_ids: board }, 'Change board saved.'), 'Save Change Board')}
            </SheetSection>
          </div>

          {/* (d) ECN acknowledgers */}
          <div data-tour="design-settings-ack" style={cardStyle}>
            <SheetSection icon="check" title="ECN acknowledgers per department">
            <p style={noteStyle}>After an ECN is released each department acknowledges it before it closes. When none are named for a department, anyone holding that department&apos;s app may acknowledge for it.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 14 }}>
              {Object.entries(ACK_DEPARTMENT_LABELS).map(([dept, label]) => (
                <div key={dept} style={{ display: 'flex', gap: 14, flexWrap: 'wrap', paddingTop: 12, borderTop: `1px solid ${SHEET.LINE}` }}>
                  <div style={{ flex: '0 0 170px', fontSize: 13, fontWeight: 700, color: SHEET.INK, paddingTop: 6 }}>
                    {label}
                    {(ack[dept] || []).length === 0 && <div style={{ fontSize: 11.5, fontWeight: 400, color: SHEET.MUTED }}>Any {label} app holder</div>}
                  </div>
                  <div style={{ flex: '1 1 320px' }}>
                    <UserChips ids={ack[dept] || []} onChange={(ids) => setAck({ ...ack, [dept]: ids })} users={users} disabled={!canEdit} placeholder={`Add a ${label.toLowerCase()} acknowledger…`} />
                  </div>
                </div>
              ))}
            </div>
            {saveBtn('ack', () => save('ack', { ecn_acknowledger_ids: ack }, 'ECN acknowledgers saved.'), 'Save Acknowledgers')}
            </SheetSection>
          </div>
        </>
      )}
    </div>
  )
}
