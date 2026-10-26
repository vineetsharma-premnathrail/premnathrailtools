'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import OrganizationNav from '@/components/organization/OrganizationNav'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { grcApi, AccessReviewLineRow, AccessReviewRow } from '@/lib/basisApi'
import { extractErrorMessages } from '@/lib/validation'
import { BORDER, GLASS, SHADOWS, TEXT } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle, RowCount, Pill as UiPill } from '@/components/shared/ui'

// Organization › Access Reviews (SAP GRC User Access Review). Every reporting
// manager confirms or revokes the roles their reports hold; campaign admins
// (organization:access_reviews:edit) start and close campaigns and can decide
// unassigned lines (users without a manager).

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18, marginBottom: 16,
}
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11.5, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const td: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const DECISION_LABELS: Record<string, string> = { keep: 'Kept', revoke: 'Revoked', pending: 'Pending' }
const DECISION_HEX: Record<string, string> = { keep: '#16A34A', revoke: '#DC2626', pending: '#F59E0B' }
const STATUS_HEX: Record<string, string> = { open: '#2563EB', closed: '#78716c' }
const errBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }

function Pill({ status }: { status: string }) {
  const hex = DECISION_HEX[status] || STATUS_HEX[status] || '#78716c'
  return <UiPill label={DECISION_LABELS[status] || status} hex={hex} />
}

function LinesTable({ lines, onKeep, onRevoke, showReviewer, canDecide }: { lines: AccessReviewLineRow[]; onKeep: (l: AccessReviewLineRow) => void; onRevoke: (l: AccessReviewLineRow) => void; showReviewer?: boolean; canDecide: (l: AccessReviewLineRow) => boolean }) {
  return (
    <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
        <thead><tr>
          <th style={th}>Employee <RowCount count={lines.length} /></th><th style={th}>Access</th>{showReviewer && <th style={th}>Reviewer</th>}
          <th style={th}>Decision</th><th style={th}>Comment</th><th style={th}></th>
        </tr></thead>
        <tbody>
          {lines.length === 0 && <tr><td style={td} colSpan={showReviewer ? 6 : 5}>Nothing to review.</td></tr>}
          {lines.map((l) => (
            <tr key={l.id}>
              <td style={{ ...td, fontWeight: 600 }}>{l.user_name}{l.period && <div style={{ fontSize: 11, color: TEXT.muted, fontWeight: 400 }}>{l.period}</div>}</td>
              <td style={td}>{l.label}</td>
              {showReviewer && <td style={td}>{l.reviewer_name || <span style={{ color: '#b45309' }}>Unassigned (no manager)</span>}</td>}
              <td style={td}><Pill status={l.decision || 'pending'} />{l.decided_by_name && <div style={{ fontSize: 11, color: TEXT.muted, marginTop: 3 }}>by {l.decided_by_name}</div>}</td>
              <td style={td}>{l.comment || '—'}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                {l.decision !== 'revoke' && canDecide(l) && <>
                  {l.decision !== 'keep' && <button type="button" style={{ ...secondaryBtnStyle, padding: '6px 12px', marginRight: 6 }} onClick={() => onKeep(l)}>Keep</button>}
                  <button type="button" style={{ ...secondaryBtnStyle, padding: '6px 12px', color: '#b91c1c' }} onClick={() => onRevoke(l)}>Revoke</button>
                </>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function AccessReviewsPage() {
  const { user, isLoading } = useAuth()
  const { can } = useCan()
  const canView = can('organization', 'access_reviews', 'view')
  const canEdit = can('organization', 'access_reviews', 'edit')
  const [mine, setMine] = useState<AccessReviewLineRow[]>([])
  const [reviews, setReviews] = useState<AccessReviewRow[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
  const [detail, setDetail] = useState<(AccessReviewRow & { lines: AccessReviewLineRow[] }) | null>(null)
  const [period, setPeriod] = useState('')
  const [due, setDue] = useState('')
  const [error, setError] = useState('')
  const [revoking, setRevoking] = useState<AccessReviewLineRow | null>(null)
  const [closing, setClosing] = useState<AccessReviewRow | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [revokeReason, setRevokeReason] = useState('')
  const [revokeError, setRevokeError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    grcApi.myLines().then(setMine).catch((e) => setError(extractErrorMessages(e, 'Could not load your review lines.').join(' ')))
    if (canView) grcApi.reviews().then(setReviews).catch((e) => setError(extractErrorMessages(e, 'Could not load access reviews.').join(' ')))
  }, [canView])
  useEffect(() => { if (user) load() }, [user, load])
  useEffect(() => {
    if (openId) grcApi.review(openId).then(setDetail).catch((e) => setError(extractErrorMessages(e, 'Could not load the review.').join(' ')))
    else setDetail(null)
  }, [openId])

  if (isLoading || !user) return null

  const refresh = () => { load(); if (openId) grcApi.review(openId).then(setDetail).catch(() => {}) }
  // Mirrors the backend (grc.decide_line): the assigned reviewer or an Access Reviews editor decides,
  // only while the review is open, and nobody but an admin recertifies their own access.
  const meIsAdmin = user.role === 'admin' || !!(user as { is_azure_admin?: boolean }).is_azure_admin
  const mayDecide = (l: AccessReviewLineRow, reviewOpen: boolean) =>
    reviewOpen && (l.reviewer_id === user.id || canEdit) && (l.user_id !== user.id || meIsAdmin)
  const decide = async (l: AccessReviewLineRow, decision: 'keep' | 'revoke', comment?: string) => {
    setError('')
    try { await grcApi.decide(l.id, decision, comment); refresh() } catch (e) { setError(extractErrorMessages(e, 'Could not save the decision.').join(' ')) }
  }
  const openRevoke = (l: AccessReviewLineRow) => { setRevokeReason(''); setRevokeError(''); setRevoking(l) }
  const submitRevoke = async () => {
    const l = revoking
    if (!l) return
    if (!revokeReason.trim()) { setRevokeError('Say why the access is being revoked (e.g. "moved to Sales, no longer posts GRNs") — it is kept in the audit trail.'); return }
    setBusy(true); setRevokeError('')
    try { await grcApi.decide(l.id, 'revoke', revokeReason); setRevoking(null); refresh() } catch (e) { setRevokeError(extractErrorMessages(e, 'Could not save the decision.').join(' ')) } finally { setBusy(false) }
  }
  const openStart = () => { setPeriod(''); setDue(''); setStartError(''); setStarting(true) }
  const start = async () => {
    if (!period.trim()) { setStartError('Enter the period this review covers, e.g. 2026-Q4.'); return }
    setBusy(true); setStartError('')
    try { const r = await grcApi.startReview(period.trim(), due || null); setPeriod(''); setDue(''); setStarting(false); setOpenId(r.id); load() } catch (e) { setStartError(extractErrorMessages(e, 'Could not start the review.').join(' ')) } finally { setBusy(false) }
  }
  const close = async () => {
    const r = closing; setClosing(null)
    if (!r) return
    try { await grcApi.closeReview(r.id); refresh() } catch (e) { setError(extractErrorMessages(e, 'Could not close the review.').join(' ')) }
  }

  return (
    <div>
      <OrganizationNav />
      <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Access Reviews</h1>
      <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 16px' }}>Periodic recertification: each manager confirms the access their team still needs. A revoke removes the role at once.</p>
      {error && <div style={errBox}>{error}</div>}
      {revoking && (
        <FormSheet width={580} icon="shield" iconColor="#DC2626" title="Revoke this access?" subtitle={`${revoking.user_name} · ${revoking.label}`}
          onClose={() => setRevoking(null)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setRevoking(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={submitRevoke} disabled={busy || !revokeReason.trim()} style={sheetBtn('primary', '#DC2626', busy || !revokeReason.trim())}>
              <SheetIcon name="x" size={16} />{busy ? 'Saving…' : 'Revoke'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {revokeError && <div style={errBox}>{revokeError}</div>}
            <SheetSection icon="chat" title="Reason" color="#DC2626">
              <label style={sheetLabel}>Why is this access no longer needed? <Req /></label>
              <textarea style={{ ...sheetInput, minHeight: 80 }} value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} placeholder="e.g. moved to Sales, no longer posts GRNs" autoFocus />
              <p style={sheetHint}>{revoking.user_name} loses &quot;{revoking.label}&quot; immediately. The reason is kept in the audit trail.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}
      {starting && (
        <FormSheet width={580} icon="calendar" title="Start access review" subtitle="Every reporting manager confirms or revokes the access their team holds"
          onClose={() => setStarting(false)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setStarting(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={start} disabled={busy || !period.trim()} style={sheetBtn('primary', SHEET.BLUE, busy || !period.trim())}>
              <SheetIcon name="send" size={16} />{busy ? 'Starting…' : 'Start review'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {startError && <div style={errBox}>{startError}</div>}
            <SheetSection icon="calendar" title="Campaign">
              <div style={{ marginBottom: 14 }}>
                <label style={sheetLabel}>Period <Req /></label>
                <input style={sheetInput} placeholder="e.g. 2026-Q4" value={period} onChange={(e) => setPeriod(e.target.value)} autoFocus />
                <p style={sheetHint}>The label managers see on their review lines.</p>
              </div>
              <div>
                <label style={sheetLabel}>Due date <Optional /></label>
                <DateField value={due} onChange={setDue} placeholder="DD-MM-YYYY" />
                <p style={sheetHint}>Reviewers are reminded until every line they own is decided.</p>
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}
      <ConfirmDialog open={!!closing} title="Close this review?" confirmLabel="Close review"
        message={closing ? `${closing.pending} line(s) are still undecided — they stay as they are and are reported as not reviewed.` : ''}
        onConfirm={close} onCancel={() => setClosing(null)} />

      <div style={cardStyle}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Waiting for my decision ({mine.filter((l) => !l.decision).length})</h2>
        <LinesTable lines={mine} onKeep={(l) => decide(l, 'keep')} onRevoke={openRevoke} canDecide={(l) => mayDecide(l, true)} />
      </div>

      {canView && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0, flex: '1 1 200px' }}>Campaigns</h2>
            {canEdit && <button type="button" style={primaryBtnStyle} onClick={openStart}>Start review</button>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead><tr><th style={th}>Period <RowCount count={reviews.length} /></th><th style={th}>Status</th><th style={th}>Due</th><th style={th}>Lines</th><th style={th}>Pending</th><th style={th}>Kept</th><th style={th}>Revoked</th><th style={th}>Unassigned</th><th style={th}></th></tr></thead>
              <tbody>
                {reviews.length === 0 && <tr><td style={td} colSpan={9}>No access review has been run yet.</td></tr>}
                {reviews.map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer', background: openId === r.id ? 'rgba(244,113,59,0.05)' : undefined }} onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.period}</td><td style={td}><Pill status={r.status} /></td>
                    <td style={td}>{r.due_date ? new Date(r.due_date).toLocaleDateString('en-GB') : '—'}</td>
                    <td style={td}>{r.total}</td><td style={td}>{r.pending}</td><td style={td}>{r.kept}</td><td style={td}>{r.revoked}</td><td style={td}>{r.unassigned}</td>
                    <td style={td} onClick={(e) => e.stopPropagation()}>
                      {canEdit && r.status === 'open' && <button type="button" style={{ ...secondaryBtnStyle, padding: '6px 12px' }} onClick={() => setClosing(r)}>Close</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>{detail.period} — all lines</h3>
              <LinesTable lines={detail.lines} showReviewer onKeep={(l) => decide(l, 'keep')} onRevoke={openRevoke} canDecide={(l) => mayDecide(l, detail.status === 'open')} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
