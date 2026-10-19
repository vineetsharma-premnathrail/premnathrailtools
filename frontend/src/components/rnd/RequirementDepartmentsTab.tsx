'use client'

// Departments panel at the top of a requirement's Tasks & Departments tab: the
// R&D head shares the requirement with Design, Electrical and/or Hydraulic &
// Pneumatic (what R&D needs + a reply-by date). A shared department works on it
// with R&D — every department's tasks, the documents each department shows to
// all, the discussion — and answers from its own Requirements page: feasible /
// feasible with changes / not feasible, remarks and files; the reply shows here. Sharing again with a department is a
// new request: an unanswered earlier one is marked "Replaced" (they answer only
// the latest), and every earlier reply stays on record.

import { useEffect, useState } from 'react'
import { rndApi } from '@/lib/api'
import { RndRequirementShare, RndShareDepartment, RndWorkDocument } from '@/types'
import { TEXT, BORDER, GLASS, SHADOWS } from '@/lib/theme'
import { formatDate, formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import DateField from '@/components/erp/DateField'
import { primaryBtnStyle } from '@/components/shared/ui'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetSection, SheetIcon, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}

const DEPARTMENTS: { key: RndShareDepartment; label: string }[] = [
  { key: 'design', label: 'Design' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'hydraulic', label: 'Hydraulic & Pneumatic' },
]

export const RESPONSE_HEX: Record<string, string> = { feasible: '#16A34A', feasible_with_changes: '#B45309', not_feasible: '#DC2626' }

export function shareBadge(s: RndRequirementShare): { label: string; hex: string } {
  if (s.status === 'responded') return { label: s.response_label || 'Replied', hex: RESPONSE_HEX[s.response || ''] || '#16A34A' }
  if (s.status === 'replaced') return { label: 'Replaced by newer request', hex: '#a8a29e' }
  if (s.is_overdue) return { label: 'Reply overdue', hex: '#DC2626' }
  return { label: 'Awaiting reply', hex: '#2563EB' }
}

export function Chip({ label, hex }: { label: string; hex: string }) {
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{label}</span>
}

export default function RequirementDepartmentsTab({ source, recordId, isHead, onSharesChange }: {
  source: 'inquiry' | 'tender'; recordId: number; isHead: boolean
  /** Told whenever the list of shares loads or changes (the task chips follow it). */
  onSharesChange?: (shares: RndRequirementShare[]) => void
}) {
  const [shares, setShares] = useState<RndRequirementShare[] | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [picked, setPicked] = useState<RndShareDepartment[]>([])
  const [note, setNote] = useState('')
  const [due, setDue] = useState('')
  const [saving, setSaving] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareError, setShareError] = useState<string | string[]>('')
  useEscapeKey(shareOpen && !saving, () => setShareOpen(false))

  const load = () => rndApi.listShares(source, recordId)
    .then((d) => { setShares(d); onSharesChange?.(d); setError('') })
    .catch((err) => { setShares((s) => s || []); setError(extractErrorMessages(err, 'Could not load the departments this requirement was shared with.')) })
  useEffect(() => { load() }, [source, recordId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Local today as YYYY-MM-DD (DateField's format) — a reply-by date can't be in the past.
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const duePast = !!due && due < today
  const cantShare = saving || picked.length === 0 || !note.trim() || duePast

  const waiting = new Set((shares || []).filter((s) => s.status === 'open').map((s) => s.department))

  const share = async () => {
    setSaving(true)
    setShareError('')
    try {
      const next = await rndApi.shareRequirement(source, recordId, { departments: picked, note, due_date: due || null })
      setShares(next)
      onSharesChange?.(next)
      setPicked([])
      setNote('')
      setDue('')
      setShareOpen(false)
    } catch (err) {
      setShareError(extractErrorMessages(err, 'Could not share the requirement.'))
    } finally {
      setSaving(false)
    }
  }

  const openFile = async (d: RndWorkDocument) => {
    try { await rndApi.openWorkDocument(d) } catch (err) { setError(extractErrorMessages(err, `Could not open "${d.name}".`)) }
  }

  return (
    <div>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {isHead && shareOpen && (
        <FormSheet tour="rnd-req-share-sheet" width={580} icon="users" title="Share with Departments" subtitle="Ask Design, Electrical or Hydraulic & Pneumatic for their feasibility."
          onClose={() => setShareOpen(false)} busy={saving}
          footer={<>
            <button type="button" onClick={() => setShareOpen(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="button" onClick={share} disabled={cantShare} style={sheetBtn('primary', SHEET.BLUE, cantShare)}>
              <SheetIcon name="send" size={16} />{saving ? 'Sharing…' : picked.length > 1 ? `Share with ${picked.length} departments` : 'Share with department'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
          {shareError && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {Array.isArray(shareError) ? shareError.join(' ') : shareError}
            </div>
          )}
          <SheetSection icon="users" title="Departments">
          <label style={sheetLabel}>Share with <Req /></label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {DEPARTMENTS.map((d) => {
              const busy = waiting.has(d.key)
              const on = picked.includes(d.key)
              // Sharing again while a reply is pending replaces that request (new note / date).
              return (
                <button
                  key={d.key}
                  type="button"
                  title={busy ? `${d.label} hasn't replied yet — sharing again replaces that request with this note and date` : undefined}
                  onClick={() => setPicked((p) => (on ? p.filter((x) => x !== d.key) : [...p, d.key]))}
                  style={{
                    padding: '7px 14px', borderRadius: 9999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    color: on ? '#fff' : '#57534e', background: on ? '#FF7A45' : 'rgba(255,255,255,.6)',
                    border: `1px solid ${on ? '#FF7A45' : 'rgba(0,0,0,0.1)'}`,
                  }}
                >
                  {on ? '✓ ' : ''}{d.label}{busy ? ' · awaiting reply' : ''}
                </button>
              )
            })}
          </div>
          <p style={sheetHint}>
            The department works on this requirement with R&amp;D: it sees every department&apos;s tasks and gives tasks to anyone in R&amp;D or a shared department, uploads documents (choosing whether other departments see them), joins the discussion, and replies with its feasibility.
          </p>
          </SheetSection>
          <SheetSection icon="chat" title="The Request">
              <label style={sheetLabel}>What R&amp;D needs from them <Req /></label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                autoFocus
                placeholder="e.g. Check whether a 600 mm platform height fits the hydraulic power pack and the panel layout."
                style={{ ...sheetInput, resize: 'vertical' }}
              />
              <div style={{ maxWidth: 200, marginTop: 14 }}>
                <label style={sheetLabel}>Reply by <Optional /></label>
                <DateField value={due} onChange={setDue} />
              </div>
              <p style={{ ...sheetHint, color: duePast ? '#b91c1c' : SHEET.MUTED }}>
                {duePast ? 'This date is in the past — pick today or later.' : 'Date the department must send its feasibility reply. Optional.'}
              </p>
          </SheetSection>
          </div>
        </FormSheet>
      )}

      <div data-tour="rnd-req-shares" style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', margin: '0 0 12px' }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }}>Department replies</p>
          {isHead && (
            <button data-tour="rnd-req-share-form" type="button" onClick={() => { setShareError(''); setShareOpen(true) }} style={primaryBtnStyle}>+ Share with departments</button>
          )}
        </div>
        {shares === null ? (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
        ) : shares.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
            Not shared with any department yet.{isHead ? ' Use “+ Share with departments” to ask Design, Electrical or Hydraulic & Pneumatic for their feasibility.' : ' The R&D head shares it when department input is needed.'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {shares.map((s) => {
              const badge = shareBadge(s)
              return (
                <div key={s.id} style={{ padding: '12px 14px', borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,0.55)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading }}>{s.department_label}</span>
                      <Chip {...badge} />
                      <span style={{ fontSize: 11.5, color: TEXT.muted }}>
                        shared by {s.shared_by || '—'}, {formatDateTime(s.shared_at)}{s.due_date ? ` · reply by ${formatDate(s.due_date)}` : ''}
                      </span>
                    </div>
                  </div>
                  <p style={{ fontSize: 12.5, color: TEXT.body, margin: '8px 0 0', whiteSpace: 'pre-wrap' }}><strong>Asked:</strong> {s.note}</p>
                  {s.status === 'responded' && (
                    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: `${badge.hex}0d`, border: `1px solid ${badge.hex}33` }}>
                      <p style={{ fontSize: 12.5, color: TEXT.body, margin: 0, whiteSpace: 'pre-wrap' }}>
                        <strong style={{ color: badge.hex }}>{s.response_label}</strong> — {s.responded_by}, {formatDateTime(s.responded_at)}
                        {s.response_remarks ? <><br />{s.response_remarks}</> : null}
                      </p>
                      {s.files.length > 0 && (
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                          {s.files.map((f) => (
                            <a key={f.id} href="#" onClick={(e) => { e.preventDefault(); openFile(f) }} style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}>{f.name}</a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {s.status === 'replaced' && (
                    <p style={{ fontSize: 12, color: TEXT.muted, margin: '6px 0 0' }}>Replaced by a newer request on {formatDateTime(s.replaced_at)} — no reply needed on this one.</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
