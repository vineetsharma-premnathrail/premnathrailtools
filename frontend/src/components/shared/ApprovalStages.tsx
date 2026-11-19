'use client'

// The stages of one approval as a left-to-right stepper (stacks on a phone):
//   [1 Department head ✓] → [2 Project head ✓] → [3 Purchase team ✓]
// Each stage card says what matters only: who decided, when, their comment —
// or who it is waiting for. In an "any one approves" stage the people who did
// not need to act are folded into "+N others could approve" (click to see).
// `compact` draws a one-line chain for summaries (Procurement progress).
// Used by ApprovalPanel (every module) and the PR tracker (2026-11-19).

import { useState } from 'react'
import { BORDER, TEXT } from '@/lib/theme'

export type StageStep = {
  sequence: number
  stage_name: string
  status: string
  approver_name?: string | null
  decided_by_name?: string | null
  decided_at?: string | null
  comment?: string | null
  via?: string | null
  approval_mode?: 'any' | 'all' | string
  due_at?: string | null
}

type StageState = 'approved' | 'rejected' | 'returned' | 'pending' | 'waiting' | 'skipped' | 'cancelled'

const STATE: Record<StageState, { label: string; hex: string; icon: string }> = {
  approved: { label: 'Approved', hex: '#16A34A', icon: '✓' },
  rejected: { label: 'Rejected', hex: '#DC2626', icon: '✕' },
  returned: { label: 'Returned', hex: '#7c3aed', icon: '↩' },
  pending: { label: 'Waiting', hex: '#D97706', icon: '…' },
  waiting: { label: 'Not yet', hex: '#a8a29e', icon: '' },
  skipped: { label: 'Skipped', hex: '#a8a29e', icon: '–' },
  cancelled: { label: 'Cancelled', hex: '#a8a29e', icon: '–' },
}
const VIA_LABEL: Record<string, string> = { delegation: 'as delegate', escalation: 'after escalation', admin: 'admin stand-in' }

function fmt(d?: string | null) {
  if (!d) return ''
  const x = new Date(d)
  return `${x.toLocaleDateString('en-GB')}, ${x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

type Stage = { seq: number; name: string; mode: string; steps: StageStep[] }

function group(steps: StageStep[]): Stage[] {
  const out: Stage[] = []
  for (const s of [...steps].sort((a, b) => a.sequence - b.sequence)) {
    const g = out.find((x) => x.seq === s.sequence)
    if (g) g.steps.push(s)
    else out.push({ seq: s.sequence, name: s.stage_name, mode: s.approval_mode || 'any', steps: [s] })
  }
  return out
}

function stateOf(g: Stage): StageState {
  const st = g.steps.map((s) => s.status)
  if (st.includes('rejected')) return 'rejected'
  if (st.includes('returned')) return 'returned'
  if (st.includes('pending')) return 'pending'
  if (st.includes('approved') && (g.mode !== 'all' || st.every((x) => x === 'approved' || x === 'skipped'))) return 'approved'
  if (st.every((x) => x === 'skipped')) return 'skipped'
  if (st.every((x) => x === 'cancelled' || x === 'skipped')) return 'cancelled'
  return 'waiting'
}

const decided = (s: StageStep) => ['approved', 'rejected', 'returned'].includes(s.status)
const nameList = (steps: StageStep[]) => Array.from(new Set(steps.map((s) => s.approver_name).filter((n): n is string => !!n)))

function Decision({ s }: { s: StageStep }) {
  const st = STATE[s.status as StageState] || STATE.waiting
  const by = s.decided_by_name && s.decided_by_name !== s.approver_name ? s.decided_by_name : null
  return (
    <div style={{ fontSize: 12.5, color: TEXT.body, lineHeight: 1.45 }}>
      <div style={{ fontWeight: 600, color: TEXT.heading }}>
        <span style={{ color: st.hex }}>{st.icon} </span>{s.approver_name || '—'}
      </div>
      {by && <div style={{ fontSize: 11.5, color: TEXT.muted }}>decided by {by}{s.via && VIA_LABEL[s.via] ? ` (${VIA_LABEL[s.via]})` : ''}</div>}
      {s.decided_at && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{fmt(s.decided_at)}</div>}
      {s.comment && <div style={{ fontStyle: 'italic', color: TEXT.secondary, marginTop: 2, wordBreak: 'break-word' }}>&ldquo;{s.comment}&rdquo;</div>}
    </div>
  )
}

function Others({ names, label }: { names: string[]; label: string }) {
  const [open, setOpen] = useState(false)
  if (!names.length) return null
  return (
    <div style={{ marginTop: 6, fontSize: 11.5, color: TEXT.muted }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: TEXT.muted, fontSize: 11.5, textDecoration: 'underline dotted' }}>
        {open ? 'Hide' : `+${names.length} ${label}`}
      </button>
      {open && <div style={{ marginTop: 3, lineHeight: 1.5 }}>{names.join(', ')}</div>}
    </div>
  )
}

function StageCard({ g, current }: { g: Stage; current: boolean }) {
  const state = stateOf(g)
  const st = STATE[state]
  const many = g.steps.length > 1
  const done = g.steps.filter(decided)
  const pending = g.steps.filter((s) => s.status === 'pending')
  const rest = g.steps.filter((s) => !decided(s) && s.status !== 'pending')
  const due = pending.find((s) => s.due_at)?.due_at
  return (
    <div style={{
      flex: '1 1 0', minWidth: 0, borderRadius: 12, padding: '10px 12px', background: '#fff',
      border: `1px solid ${current ? st.hex : BORDER.light}`, boxShadow: current ? `0 0 0 3px ${st.hex}1f` : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span aria-hidden="true" style={{
          width: 22, height: 22, borderRadius: '50%', flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11.5, fontWeight: 700, color: '#fff', background: st.hex,
        }}>{state === 'approved' ? '✓' : state === 'rejected' ? '✕' : g.seq}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.name}>{g.name}</div>
          <div style={{ fontSize: 11, color: st.hex, fontWeight: 600 }}>
            {st.label}{many && state !== 'skipped' ? <span style={{ color: TEXT.muted, fontWeight: 500 }}> · {g.mode === 'all' ? 'everyone must approve' : 'any one approves'}</span> : null}
          </div>
        </div>
      </div>

      {done.map((s, i) => <div key={`d${i}`} style={{ marginBottom: 6 }}><Decision s={s} /></div>)}

      {pending.length > 0 && (
        <div style={{ fontSize: 12.5, color: TEXT.body }}>
          <span style={{ color: TEXT.muted }}>{pending.length > 1 ? 'Waiting for any of: ' : 'Waiting for '}</span>
          <b style={{ fontWeight: 600, color: TEXT.heading }}>{nameList(pending).slice(0, 3).join(', ')}</b>
          {due && <div style={{ fontSize: 11.5, color: TEXT.muted }}>escalates {fmt(due)}</div>}
          <Others names={nameList(pending).slice(3)} label="more" />
        </div>
      )}

      {state === 'waiting' && done.length === 0 && pending.length === 0 && (
        <div style={{ fontSize: 12.5, color: TEXT.muted }}>{nameList(rest).slice(0, 3).join(', ') || 'Comes after the stage before'}</div>
      )}
      {state === 'skipped' && <div style={{ fontSize: 12.5, color: TEXT.muted }}>Not needed for this record</div>}
      {state === 'cancelled' && done.length === 0 && <div style={{ fontSize: 12.5, color: TEXT.muted }}>Request withdrawn</div>}

      {/* "Any one approves" stage already decided: the others did not need to act. */}
      {done.length > 0 && <Others names={nameList(rest).filter((n) => !nameList(done).includes(n))} label={rest.length === 1 ? 'other could approve' : 'others could approve'} />}
      {state === 'waiting' && <Others names={nameList(rest).slice(3)} label="more" />}
    </div>
  )
}

export default function ApprovalStages({ steps, currentSequence, compact = false }: {
  steps: StageStep[]
  /** The stage being decided now (highlighted). */
  currentSequence?: number | null
  compact?: boolean
}) {
  const stages = group(steps)
  if (!stages.length) return null

  if (compact) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
        {stages.map((g, i) => {
          const state = stateOf(g)
          const st = STATE[state]
          const who = g.steps.filter(decided).map((s) => s.decided_by_name || s.approver_name).filter(Boolean)[0]
            || (state === 'pending' ? nameList(g.steps.filter((s) => s.status === 'pending')).slice(0, 2).join(' / ') + (nameList(g.steps.filter((s) => s.status === 'pending')).length > 2 ? ' …' : '') : '')
          return (
            <span key={g.seq} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <span aria-hidden="true" style={{ color: TEXT.muted }}>→</span>}
              <span title={`${g.name}: ${st.label}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999,
                background: `${st.hex}14`, border: `1px solid ${st.hex}40`, color: TEXT.heading,
              }}>
                <b style={{ color: st.hex }}>{st.icon || g.seq}</b>
                <span style={{ fontWeight: 600 }}>{g.name}</span>
                {who && <span style={{ color: TEXT.secondary }}>· {who}</span>}
                {state === 'skipped' && <span style={{ color: TEXT.muted }}>· skipped</span>}
              </span>
            </span>
          )
        })}
      </div>
    )
  }

  return (
    <div className="approval-stages" style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
      <style>{`@media (max-width: 760px) { .approval-stages { flex-direction: column; } .approval-stages .as-arrow { transform: rotate(90deg); align-self: center; } }`}</style>
      {stages.map((g, i) => (
        <div key={g.seq} style={{ display: 'contents' }}>
          {i > 0 && <span className="as-arrow" aria-hidden="true" style={{ alignSelf: 'center', color: TEXT.muted, fontSize: 16, flex: 'none' }}>→</span>}
          <StageCard g={g} current={g.seq === currentSequence && stateOf(g) === 'pending'} />
        </div>
      ))}
    </div>
  )
}
