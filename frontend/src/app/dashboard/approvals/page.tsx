'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle } from '@phosphor-icons/react'
import { useAuth } from '@/hooks/useAuth'
import { approvalsApi, usersApi } from '@/lib/api'
import { ApprovalDelegationInfo, ApprovalRequestInfo, ApprovalTransactionType, DirectoryUser } from '@/types'
import { BORDER, GLASS, SHADOWS, TEXT } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle, Pill } from '@/components/shared/ui'
import NotificationBell from '@/components/erp/NotificationBell'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import DelegationForm from '@/components/organization/DelegationForm'
import { extractErrorMessages } from '@/lib/validation'

// My Approvals (own Sidebar entry, not an Organization tab — 2026-10-31) —
// open to every signed-in user: what waits for me (as
// approver, delegate or escalation target), what I submitted, what I decided,
// and my own out-of-office delegations.

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18, marginBottom: 16,
}
const STATUS_HEX: Record<string, string> = { pending: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', returned: '#7c3aed', cancelled: '#78716c' }
const STATUS_LABEL: Record<string, string> = { pending: 'Waiting', approved: 'Approved', rejected: 'Rejected', returned: 'Returned', cancelled: 'Cancelled' }
type Tab = 'inbox' | 'mine' | 'decided' | 'delegations'

function fmtDate(d?: string | null) {
  return d ? new Date(d).toLocaleDateString('en-GB') : ''
}

export default function MyApprovalsPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('inbox')
  const [rows, setRows] = useState<ApprovalRequestInfo[]>([])
  const [delegations, setDelegations] = useState<ApprovalDelegationInfo[]>([])
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [types, setTypes] = useState<ApprovalTransactionType[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  // Only the latest request may fill the list — a slow answer for the tab
  // just left must not land under the tab now shown.
  const reqId = useRef(0)

  const load = useCallback(() => {
    const id = ++reqId.current
    const fail = (fallback: string) => (e: unknown) => { if (id === reqId.current) setError(extractErrorMessages(e, fallback).join(' ')) }
    const done = () => { if (id === reqId.current) setLoading(false) }
    if (tab === 'delegations') {
      approvalsApi.myDelegations().then((r) => { if (id === reqId.current) { setDelegations(r); setError('') } })
        .catch(fail('Could not load your delegations — reload the page; if it keeps failing, the server may be down.')).finally(done)
      return
    }
    const fn = tab === 'inbox' ? approvalsApi.inbox : tab === 'mine' ? approvalsApi.mine : approvalsApi.decided
    fn().then((r) => { if (id === reqId.current) { setRows(r); setError('') } })
      .catch(fail('Could not load approvals — reload the page; if it keeps failing, the server may be down.')).finally(done)
  }, [tab])

  useEffect(() => { if (user) load() }, [user, load])
  useEffect(() => {
    if (!user || tab !== 'delegations' || users.length) return
    usersApi.directory().then(setUsers).catch(() => {})
    approvalsApi.types().then(setTypes).catch(() => setTypes([]))
  }, [user, tab, users.length])

  if (isLoading || !user) return null

  // Errors come back to the popup, which shows them inside itself.
  const addDelegation = async (payload: Record<string, unknown>): Promise<true | string> => {
    try {
      await approvalsApi.createDelegation(payload)
      load()
      return true
    } catch (e) {
      return extractErrorMessages(e, 'Could not add the delegation.').join(' ')
    }
  }
  const endDelegation = async (id: number) => {
    try { await approvalsApi.endDelegation(id); load() } catch (e) { setError(extractErrorMessages(e, 'Could not end the delegation.').join(' ')) }
  }

  const TABS: [Tab, string][] = [['inbox', 'Waiting for me'], ['mine', 'My submissions'], ['decided', 'Decided by me'], ['delegations', 'My delegations']]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>My Approvals</h1>
        <NotificationBell />
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => { if (k !== tab) { setTab(k); setOpen(null); setRows([]); setLoading(true) } }}
            style={{ ...secondaryBtnStyle, ...(tab === k ? { borderColor: '#c2410c', color: '#c2410c' } : {}) }}>
            {l}{k === 'inbox' && tab === 'inbox' && !loading ? ` (${rows.length})` : ''}
          </button>
        ))}
      </div>
      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}

      {tab !== 'delegations' && (
        <div style={cardStyle}>
          {rows.length === 0 && (loading || error || tab !== 'inbox') && <p style={{ fontSize: 13, color: '#57534e', margin: 0 }}>{loading ? 'Loading…' : error ? 'Could not load this list — see the message above.' : 'Nothing here yet.'}</p>}
          {rows.length === 0 && !loading && !error && tab === 'inbox' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8, padding: '40px 16px' }}>
              <CheckCircle size={44} weight="duotone" color="#16A34A" aria-hidden />
              <div style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading }}>You are all caught up</div>
              <p style={{ fontSize: 13, color: '#57534e', margin: 0, maxWidth: 360 }}>Approvals sent to you appear here.</p>
              <button type="button" style={{ ...secondaryBtnStyle, marginTop: 6 }} onClick={() => { setTab('mine'); setOpen(null); setRows([]); setLoading(true) }}>See My submissions</button>
            </div>
          )}
          {rows.map((r) => (
            <div key={r.id} style={{ borderTop: `1px solid ${BORDER.light}`, padding: '10px 0' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 300px', minWidth: 0, cursor: 'pointer' }} onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{r.reference ? `${r.reference} — ` : ''}{r.title}</div>
                  <div style={{ fontSize: 12, color: '#57534e' }}>
                    {r.type_label} · from {r.requester_name || '—'} · {fmtDate(r.submitted_at)}
                    {r.amount != null ? ` · ₹${r.amount.toLocaleString('en-IN')}` : ''}
                    {r.acting_for ? ` · on behalf of ${r.acting_for}` : ''}
                  </div>
                </div>
                <Pill label={STATUS_LABEL[r.status] || r.status} hex={STATUS_HEX[r.status] || '#78716c'} />
                {r.url && <span style={{ color: '#c2410c', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }} onClick={() => router.push(r.url!)}>Open document</span>}
                <span style={{ color: TEXT.secondary, fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }} onClick={() => setOpen(open === r.id ? null : r.id)}>
                  {open === r.id ? 'Hide' : tab === 'inbox' ? 'Decide' : 'Details'}
                </span>
              </div>
              {open === r.id && (
                <div style={{ marginTop: 10 }}>
                  <ApprovalPanel entityType={r.entity_type} entityId={r.entity_id} onChanged={() => { setOpen(null); load() }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'delegations' && (
        <>
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 320px' }}>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 6px' }}>Delegate my approvals</h2>
                <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>
                  While you&apos;re away, the delegate can decide anything waiting for you in the chosen dates. They still need the
                  module&apos;s Approve permission where the workflow requires it. Every decision records that it was made on your behalf.
                </p>
              </div>
              <button type="button" style={primaryBtnStyle} onClick={() => setShowNew(true)}>+ New delegation</button>
            </div>
          </div>
          {showNew && (
            <DelegationForm users={users} types={types} forOthers={false} onSubmit={addDelegation} onClose={() => setShowNew(false)} />
          )}
          <div style={cardStyle}>
            {delegations.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{loading ? 'Loading…' : 'No delegations.'}</p>}
            {delegations.map((d) => (
              <div key={d.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${BORDER.light}`, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 320px', fontSize: 13, color: TEXT.body }}>
                  <b>{d.delegator_id === user.id ? `You → ${d.delegate_name}` : `${d.delegator_name} → you`}</b>
                  {' '}· {fmtDate(d.start_date)} – {fmtDate(d.end_date)} · {d.workflow_label || (d.module_label ? `${d.module_label} (all)` : 'All approvals')}
                  {d.reason ? ` · ${d.reason}` : ''}
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: d.state === 'active' ? '#16A34A' : d.state === 'upcoming' ? '#2563EB' : '#78716c' }}>{d.state}</span>
                {d.state !== 'ended' && d.delegator_id === user.id && (
                  <span style={{ color: '#DC2626', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }} onClick={() => endDelegation(d.id)}>End now</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
