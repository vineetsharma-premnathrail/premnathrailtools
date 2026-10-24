'use client'

import Select from '@/components/shared/Select'
import { useState } from 'react'
import { ApprovalTransactionType, DirectoryUser } from '@/types'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import DateField from '@/components/erp/DateField'
import UserChipsPicker from '@/components/organization/UserChipsPicker'

// Local date — toISOString() is UTC and gives yesterday before 05:30 IST.
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/**
 * New delegation popup: who approves for whom, when, and for which module /
 * document type. `onSubmit` resolves `true` when saved (the popup closes) or
 * an error message, shown inside the popup.
 */
export default function DelegationForm({ users, types, forOthers, onSubmit, onClose }: {
  users: DirectoryUser[]
  types: ApprovalTransactionType[]
  forOthers: boolean
  onSubmit: (payload: Record<string, unknown>) => Promise<true | string>
  onClose: () => void
}) {
  const [delegator, setDelegator] = useState<number[]>([])
  const [delegate, setDelegate] = useState<number[]>([])
  const [start, setStart] = useState(today())
  const [end, setEnd] = useState(today())
  const [scope, setScope] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const modules = Array.from(new Map(types.map((t) => [t.module_key, t.module_label])).entries())

  const submit = async () => {
    const [kind, key] = scope.split(':')
    setBusy(true); setError('')
    const out = await onSubmit({
      delegator_id: forOthers ? delegator[0] : undefined, delegate_id: delegate[0], start_date: start, end_date: end,
      module_key: kind === 'm' ? key : undefined, workflow_key: kind === 'w' ? scope.slice(2) : undefined, reason,
    })
    setBusy(false)
    if (out === true) onClose()
    else setError(out)
  }

  return (
    <FormSheet width={580} icon="users" title="New delegation" busy={busy} onClose={onClose}
      subtitle={forOthers ? 'Someone else decides a person’s approvals while they are away' : 'Someone else decides your approvals while you are away'}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Add delegation'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {error}
          </div>
        )}
        <SheetSection icon="user" title="Who">
          {forOthers && (
            <div style={{ marginBottom: 14 }}>
              <label style={sheetLabel}>Whose approvals <Req /></label>
              <UserChipsPicker users={users} value={delegator} onChange={setDelegator} max={1} placeholder="Person going away…" />
            </div>
          )}
          <label style={sheetLabel}>Approved by (delegate) <Req /></label>
          <UserChipsPicker users={users} value={delegate} onChange={setDelegate} max={1} placeholder="Stand-in…" />
          <p style={sheetHint}>The delegate still needs the module&apos;s Approve permission where the workflow requires it.</p>
        </SheetSection>
        <SheetSection icon="calendar" title="When and for what">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}><label style={sheetLabel}>From <Req /></label><DateField value={start} onChange={setStart} /></div>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}><label style={sheetLabel}>To <Req /></label><DateField value={end} onChange={setEnd} /></div>
          </div>
          <label style={{ ...sheetLabel, marginTop: 14 }}>For <Optional /></label>
          <Select style={sheetInput} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">All approvals</option>
            {modules.map(([k, l]) => <option key={k} value={`m:${k}`}>{l} — all</option>)}
            {types.map((t) => <option key={t.key} value={`w:${t.key}`}>{t.module_label} — {t.label}</option>)}
          </Select>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Reason <Optional /></label>
          <input style={sheetInput} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. On leave" />
        </SheetSection>
      </div>
    </FormSheet>
  )
}
