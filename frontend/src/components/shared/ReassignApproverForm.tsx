'use client'

import { useEffect, useState } from 'react'
import Select from '@/components/shared/Select'
import { approvalsApi, usersApi } from '@/lib/api'
import { ApprovalRequestInfo, DirectoryUser } from '@/types'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import UserChipsPicker from '@/components/organization/UserChipsPicker'
import { extractErrorMessages } from '@/lib/validation'

/**
 * Admin popup: hand one open approval step to another person (approver on
 * leave / left). The admin never decides it — the new approver does, and the
 * move goes on the approval trail with the reason (owner, 2026-11-04).
 */
export default function ReassignApproverForm({ req, currentUserId, onDone, onClose }: {
  req: ApprovalRequestInfo
  currentUserId?: number
  onDone: (out: ApprovalRequestInfo) => void
  onClose: () => void
}) {
  const open = req.steps.filter((s) => s.status === 'pending' || s.status === 'waiting')
  const [stepId, setStepId] = useState<number>(open.find((s) => s.status === 'pending')?.id ?? open[0]?.id ?? 0)
  const [to, setTo] = useState<number[]>([])
  const [reason, setReason] = useState('')
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    usersApi.directory().then(setUsers).catch((e) => setError(extractErrorMessages(e, 'Could not load the people list — reload the page and try again.').join(' ')))
  }, [])

  const step = open.find((s) => s.id === stepId)
  // Not yourself (admins never decide) and not the person who already holds the step.
  const pickable = users.filter((u) => u.id !== currentUserId && u.id !== step?.approver_id)

  const submit = async () => {
    if (!stepId) { setError('Pick the approval step to hand over.'); return }
    if (!to[0]) { setError('Pick who should approve this step instead.'); return }
    if (!reason.trim()) { setError("Write why you are reassigning it (e.g. 'approver on leave till 20 Nov') — it goes on the approval trail."); return }
    setBusy(true); setError('')
    try {
      const out = await approvalsApi.reassign(req.id, stepId, to[0], reason.trim())
      onDone(out)
    } catch (e) {
      setError(extractErrorMessages(e, 'Could not reassign the approval.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet width={560} icon="users" title="Reassign approver" busy={busy} onClose={onClose}
      subtitle={`${req.reference ? `${req.reference} — ` : ''}${req.title}`}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Reassign'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && (
          <div role="alert" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {error}
          </div>
        )}
        <SheetSection icon="user" title="Hand over">
          <label style={sheetLabel}>Step <Req /></label>
          <Select style={sheetInput} value={String(stepId)} onChange={(e) => { setStepId(Number(e.target.value)); setTo([]) }} aria-label="Approval step">
            {open.map((s) => (
              <option key={s.id} value={s.id}>
                {s.sequence}. {s.stage_name} — {s.approver_name || 'nobody'}{s.status === 'waiting' ? ' (later stage)' : ''}
              </option>
            ))}
          </Select>
          <label style={{ ...sheetLabel, marginTop: 14 }}>New approver <Req /></label>
          <UserChipsPicker users={pickable} value={to} onChange={setTo} max={1} placeholder="Person who approves instead…" />
          <p style={sheetHint}>
            You can&apos;t pick yourself — an admin hands the approval over but never decides it. The new approver gets a notification
            and the approval email.
          </p>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Reason <Req /></label>
          <input style={sheetInput} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Approver on leave till 20 Nov" maxLength={500} />
        </SheetSection>
      </div>
    </FormSheet>
  )
}
