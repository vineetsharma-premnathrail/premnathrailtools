'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { hrApi } from '@/lib/api'
import { HrLifecycleEvent, HrLifecycleImpact, HrLifecycleMeta } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { Field, secondaryBtnStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  permanent: 'Permanent', probation: 'On probation', contract: 'Contract', trainee: 'Trainee', intern: 'Intern', consultant: 'Consultant',
}
const SLOT_LABELS: Record<string, string> = { head: 'Head', secondary: 'Second head', additional: 'Additional head' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const errorBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }
const completeBtn: React.CSSProperties = {
  padding: '11px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
}

function ImpactGroup({ title, count, tone = 'info', children }: { title: string; count: number; tone?: 'block' | 'move' | 'info'; children: React.ReactNode }) {
  const hex = tone === 'block' ? '#DC2626' : tone === 'move' ? '#2563EB' : '#78716C'
  return (
    <div style={{ flex: '1 1 300px', minWidth: 0, padding: '12px 14px', borderRadius: 14, border: `1px solid ${count ? `${hex}40` : BORDER.light}`, background: count ? `${hex}08` : 'rgba(255,255,255,0.5)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: count ? 8 : 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading }}>{title}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: count ? hex : TEXT.muted }}>{count || 'None'}</span>
      </div>
      {count > 0 && <div style={{ maxHeight: 150, overflowY: 'auto', fontSize: 12.5, color: TEXT.body, display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>}
    </div>
  )
}

export default function CompletionPanel({
  event, meta, onDone,
}: {
  event: HrLifecycleEvent
  meta: HrLifecycleMeta | null
  onDone: (ev: HrLifecycleEvent) => void
}) {
  const t = event.event_type
  const [impact, setImpact] = useState<HrLifecycleImpact | null>(null)
  const [impactError, setImpactError] = useState<string[]>([])
  const [error, setError] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const [handover, setHandover] = useState(event.handover_to_id ? String(event.handover_to_id) : '')
  const [force, setForce] = useState(false)
  const [forceReason, setForceReason] = useState('')
  const [employmentType, setEmploymentType] = useState('permanent')
  const [employeeCode, setEmployeeCode] = useState(event.employee_code || '')
  const [probationEnd, setProbationEnd] = useState('')
  const [clearFlags, setClearFlags] = useState<string[]>([])
  const [headSlots, setHeadSlots] = useState<'keep' | 'remove' | 'reassign'>('keep')
  const [reassignApprovals, setReassignApprovals] = useState(false)
  const [linkUser, setLinkUser] = useState('')
  const [linking, setLinking] = useState(false)

  const needsImpact = t === 'exit' || t === 'transfer' || t === 'promotion'
  const loadImpact = useCallback(() => {
    if (!needsImpact || !event.user_id) return
    hrApi.getLifecycleImpact(event.id).then((d) => { setImpact(d); setImpactError([]) }).catch((err) => setImpactError(extractErrorMessages(err, 'Could not load what this event affects.')))
  }, [event.id, event.user_id, needsImpact])

  useEffect(() => { loadImpact() }, [loadImpact, event.items])

  const userOptions = useMemo(
    () => [{ value: '', label: '— Pick someone —' }, ...(meta?.users || []).filter((u) => u.id !== event.user_id).map((u) => ({ value: String(u.id), label: `${u.name} — ${u.designation || u.email}` }))],
    [meta, event.user_id],
  )

  const blocked = !!impact && (impact.blockers.pending_checklist_items > 0 || impact.blockers.unreturned_assets > 0)
  const fromDeptHeaded = impact?.departments_headed.find((d) => d.id === event.from_department_id)
  const handoverName = meta?.users.find((u) => String(u.id) === handover)?.name

  const doLink = async (byEmail: boolean) => {
    setError([])
    setLinking(true)
    try {
      const ev = await hrApi.linkLifecycleUser(event.id, byEmail ? {} : { user_id: Number(linkUser) })
      onDone(ev)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not link the portal user.'))
    } finally {
      setLinking(false)
    }
  }

  const validate = (): string | null => {
    if (t === 'exit') {
      if (blocked && !force) return 'There are pending checklist items or unreturned assets. Close them first, or tick "Complete anyway" and give the reason.'
      if (force && !forceReason.trim()) return 'Write why the exit is being completed with items still open.'
      if (impact?.needs_handover && !handover) return 'Pick the handover person — the leaver still holds work that has to be reassigned.'
    }
    if ((t === 'transfer' || t === 'promotion') && (headSlots === 'reassign' || reassignApprovals) && !handover) {
      return 'Pick the successor to hand the department head slot / pending approvals to.'
    }
    if (t === 'joining' && !event.user_id) return 'Link the portal user first.'
    return null
  }

  const openConfirm = () => {
    const v = validate()
    if (v) { setError([v]); return }
    setError([])
    setConfirmOpen(true)
  }

  const complete = async () => {
    setConfirmOpen(false)
    setSaving(true)
    setError([])
    const payload: Record<string, unknown> = {}
    if (t === 'exit') Object.assign(payload, { handover_to_id: handover ? Number(handover) : null, force, force_reason: force ? forceReason.trim() : null })
    if (t === 'joining') Object.assign(payload, { employment_type: employmentType, employee_code: employeeCode.trim() || null, probation_end_date: probationEnd || null })
    if (t === 'transfer' || t === 'promotion') {
      Object.assign(payload, {
        clear_head_flags: clearFlags, department_head_slots: headSlots, reassign_pending_approvals: reassignApprovals,
        handover_to_id: handover ? Number(handover) : null,
      })
    }
    try {
      const ev = await hrApi.completeLifecycleEvent(event.id, payload)
      onDone(ev)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not complete the event.'))
      loadImpact()
    } finally {
      setSaving(false)
    }
  }

  const confirmMessage = (() => {
    const who = event.subject_name || 'this employee'
    if (t === 'exit') {
      return `This closes ${who}'s employment in one step: their approvals, reportees and department head slots move to ${handoverName || 'nobody'}, their own pending requests are cancelled, the portal account is deactivated and every signed-in session is ended. It can't be undone — a rehire needs a new joining event.`
    }
    if (t === 'joining') return `This creates/updates ${who}'s employee profile, sets the date of joining and applies the department, designation, plant and manager. The portal account is activated.`
    if (t === 'confirmation') return `${who} will be confirmed and moved from probation to active.`
    return `The new department, plant, designation, grade and manager on this event will be applied to ${who}'s profile and portal account.`
  })()

  return (
    <div style={{ ...sectionStyle, border: t === 'exit' ? '1px solid rgba(220,38,38,0.25)' : sectionStyle.border }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>
        {t === 'exit' ? 'Complete exit' : t === 'joining' ? 'Complete joining' : t === 'confirmation' ? 'Confirm employee' : `Apply ${t}`}
      </h3>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 14px' }}>
        {t === 'exit'
          ? 'Review everything the leaver still holds. Completion reassigns it to the handover person, all in one go.'
          : t === 'joining'
            ? 'Once the checklist is done and the portal user is linked, complete the joining to set up the employee record.'
            : 'Review, then complete to apply the change.'}
      </p>

      {error.length > 0 && <div style={errorBox}>{error.join(' ')}</div>}
      {impactError.length > 0 && <div style={errorBox}>{impactError.join(' ')}</div>}

      {/* Joining: link the portal user */}
      {t === 'joining' && !event.user_id && (
        <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid rgba(180,83,9,0.3)', background: 'rgba(245,158,11,0.07)', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E', marginBottom: 6 }}>Step 1 — link the portal user</div>
          <p style={{ fontSize: 12.5, color: TEXT.body, margin: '0 0 10px' }}>
            The joiner&apos;s portal account appears after their first Microsoft sign-in (or an admin Azure sync).
            {event.candidate_email ? <> Search by <b>{event.candidate_email}</b>, or pick the user.</> : ' Pick the user below.'}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {event.candidate_email && (
              <button type="button" disabled={linking} onClick={() => doLink(true)} style={secondaryBtnStyle}>{linking ? 'Searching…' : 'Find by email'}</button>
            )}
            <div style={{ flex: '1 1 260px', maxWidth: 360 }}>
              <SearchableSelect value={linkUser} onChange={setLinkUser} options={userOptions} placeholder="Or pick the portal user…" />
            </div>
            <button type="button" disabled={linking || !linkUser} onClick={() => doLink(false)} style={secondaryBtnStyle}>Link</button>
          </div>
        </div>
      )}

      {t === 'joining' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: '0 1 190px', minWidth: 170 }}>
            <Field label="Employment type">
              <select style={inputStyle} value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
                {(meta?.employment_types || Object.keys(EMPLOYMENT_TYPE_LABELS)).map((x) => <option key={x} value={x}>{EMPLOYMENT_TYPE_LABELS[x] || x}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <Field label="Employee code">
              <input style={inputStyle} value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} placeholder="e.g. PRL-1042" />
            </Field>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 170 }}>
            <Field label="Probation ends"><DateField value={probationEnd} onChange={setProbationEnd} /></Field>
          </div>
          <p style={{ flex: '1 1 220px', fontSize: 12, color: TEXT.muted, margin: '22px 0 0' }}>
            Probation, trainee and intern types (or a probation end date) start the employee on probation; others start active.
          </p>
        </div>
      )}

      {/* Impact preview */}
      {needsImpact && event.user_id && !impact && impactError.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted }}>Checking what this affects…</p>}
      {needsImpact && impact && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
            {t === 'exit' && (
              <>
                <ImpactGroup title="Pending checklist items" count={impact.pending_checklist_items.length} tone="block">
                  {impact.pending_checklist_items.map((i) => <div key={i.id}>• {i.title} <span style={{ color: TEXT.muted }}>({i.owner_name || 'unassigned'})</span></div>)}
                </ImpactGroup>
                <ImpactGroup title="Company assets not returned" count={impact.unreturned_assets.length} tone="block">
                  {impact.unreturned_assets.map((a) => <div key={a.id}>• {a.asset_code} — {a.name}{a.serial_number ? ` (S/N ${a.serial_number})` : ''}</div>)}
                </ImpactGroup>
                <ImpactGroup title="Direct reportees" count={impact.direct_reportees.length} tone="move">
                  {impact.direct_reportees.map((r) => <div key={r.id}>• {r.name}{r.designation ? ` — ${r.designation}` : ''}</div>)}
                </ImpactGroup>
              </>
            )}
            <ImpactGroup title="Department head slots" count={impact.departments_headed.length} tone="move">
              {impact.departments_headed.map((d) => <div key={d.id}>• {d.name} <span style={{ color: TEXT.muted }}>({d.slots.map((s) => SLOT_LABELS[s] || s).join(', ')})</span></div>)}
            </ImpactGroup>
            <ImpactGroup title="Pending P2P approvals" count={impact.pending_p2p_approvals.length} tone="move">
              {impact.pending_p2p_approvals.map((p) => <div key={p.id}>• {p.p2p_number} — {p.roles.join(', ')}{p.requested_by_name ? ` (raised by ${p.requested_by_name})` : ''}</div>)}
            </ImpactGroup>
            <ImpactGroup title="Approval roles" count={impact.role_flags.length} tone={t === 'exit' ? 'move' : 'info'}>
              {impact.role_flags.map((f) => <div key={f.flag}>• {f.label}</div>)}
            </ImpactGroup>
            {t === 'exit' && (
              <>
                <ImpactGroup title="Pending HR approvals" count={impact.pending_hr_approvals.length} tone="move">
                  {impact.pending_hr_approvals.map((a) => <div key={`${a.kind}-${a.id}`}>• {a.label} {a.ref}{a.requester_name ? ` — ${a.requester_name}` : ''}</div>)}
                </ImpactGroup>
                <ImpactGroup title="Open PRs as buyer" count={impact.p2p_buyer_requests.length} tone="move">
                  {impact.p2p_buyer_requests.map((p) => <div key={p.id}>• {p.p2p_number} ({p.status.replace(/_/g, ' ')})</div>)}
                </ImpactGroup>
                <ImpactGroup title="Tasks on other checklists" count={impact.checklist_items_owned.length + impact.templates_owned.length} tone="move">
                  {impact.checklist_items_owned.map((i) => <div key={`i${i.id}`}>• {i.title} ({i.event_no})</div>)}
                  {impact.templates_owned.map((x) => <div key={`t${x.id}`}>• Template: {x.title} ({x.event_type})</div>)}
                </ImpactGroup>
                <ImpactGroup title="Their own open requests" count={impact.own_open_requests.length} tone="info">
                  {impact.own_open_requests.map((o) => (
                    <div key={`${o.kind}-${o.id}`}>• {o.label} {o.ref} — {o.status}{' '}
                      <b style={{ color: o.action === 'cancel' ? '#DC2626' : '#78716C' }}>{o.action === 'cancel' ? 'will be cancelled' : 'kept'}</b>
                    </div>
                  ))}
                </ImpactGroup>
              </>
            )}
          </div>

          {impact.warnings.length > 0 && (
            <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400E', fontSize: 12.5 }}>
              {impact.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
        </>
      )}

      {/* Exit controls */}
      {t === 'exit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 280px', maxWidth: 380 }}>
              <Field label={impact?.needs_handover ? 'Handover to (required)' : 'Handover to'}>
                <SearchableSelect value={handover} onChange={setHandover} options={userOptions} placeholder="— Pick successor or manager —" />
              </Field>
            </div>
            {impact && !impact.needs_handover && (
              <p style={{ flex: '1 1 220px', fontSize: 12, color: TEXT.muted, margin: '0 0 10px' }}>Nothing needs reassigning — a handover person is optional.</p>
            )}
          </div>
          {blocked && (
            <div style={{ padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.04)' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 600, color: '#b91c1c', cursor: 'pointer' }}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                Complete anyway, with items still open
              </label>
              {force && (
                <textarea
                  style={{ ...inputStyle, minHeight: 60, marginTop: 8, resize: 'vertical' }}
                  value={forceReason}
                  onChange={(e) => setForceReason(e.target.value)}
                  placeholder="Why — e.g. employee absconded, laptop to be recovered via courier (kept on record)"
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Mover controls */}
      {(t === 'transfer' || t === 'promotion') && impact && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {impact.role_flags.some((f) => ['is_department_head', 'is_project_head', 'is_plant_head'].includes(f.flag)) && (
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, marginBottom: 6 }}>Remove approval roles that don&apos;t carry over</div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {impact.role_flags.filter((f) => ['is_department_head', 'is_project_head', 'is_plant_head'].includes(f.flag)).map((f) => (
                  <label key={f.flag} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={clearFlags.includes(f.flag)}
                      onChange={(e) => setClearFlags(e.target.checked ? [...clearFlags, f.flag] : clearFlags.filter((x) => x !== f.flag))}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
          )}
          {fromDeptHeaded && (
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, marginBottom: 6 }}>Head slot in {fromDeptHeaded.name} (the old department)</div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {([['keep', 'Keep'], ['remove', 'Remove them'], ['reassign', 'Give it to the successor']] as const).map(([k, label]) => (
                  <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
                    <input type="radio" name="headSlots" checked={headSlots === k} onChange={() => setHeadSlots(k)} /> {label}
                  </label>
                ))}
              </div>
            </div>
          )}
          {impact.pending_p2p_approvals.length > 0 && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
              <input type="checkbox" checked={reassignApprovals} onChange={(e) => setReassignApprovals(e.target.checked)} />
              Move the {impact.pending_p2p_approvals.length} pending P2P approval(s) to the successor
            </label>
          )}
          {(headSlots === 'reassign' || reassignApprovals) && (
            <div style={{ flex: '1 1 280px', maxWidth: 380 }}>
              <Field label="Successor">
                <SearchableSelect value={handover} onChange={setHandover} options={userOptions} placeholder="— Pick successor —" />
              </Field>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          disabled={saving || (t === 'joining' && !event.user_id)}
          onClick={openConfirm}
          style={{
            ...completeBtn,
            background: t === 'exit' ? 'linear-gradient(135deg,#ef4444,#b91c1c)' : completeBtn.background,
            opacity: saving || (t === 'joining' && !event.user_id) ? 0.6 : 1,
            cursor: saving ? 'wait' : completeBtn.cursor,
          }}
        >
          {saving ? 'Completing…' : t === 'exit' ? 'Complete exit' : t === 'joining' ? 'Complete joining' : t === 'confirmation' ? 'Confirm employee' : `Complete ${t}`}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t === 'exit' ? `Complete exit of ${event.subject_name || 'employee'}?` : `Complete ${event.event_no}?`}
        message={confirmMessage}
        confirmLabel={t === 'exit' ? 'Complete exit' : 'Complete'}
        danger={t === 'exit'}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={complete}
      />
    </div>
  )
}
