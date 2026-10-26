'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { useCan } from '@/lib/permissions'
import { approvalsApi, usersApi } from '@/lib/api'
import { ApprovalDelegationInfo, ApprovalTransactionType, DirectoryUser } from '@/types'
import { BORDER, GLASS, SHADOWS, TEXT } from '@/lib/theme'
import OrganizationNav from '@/components/organization/OrganizationNav'
import { primaryBtnStyle, RowCount } from '@/components/shared/ui'
import DelegationForm from '@/components/organization/DelegationForm'
import { extractErrorMessages } from '@/lib/validation'

// Organization › Delegations — everyone's approval hand-overs. Users manage
// their own under My Approvals; this tab lets an admin set one up for someone
// who is away without having done it themselves.

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18, marginBottom: 16,
}
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11.5, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const td: React.CSSProperties = { padding: '9px 10px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const STATE_HEX: Record<string, string> = { active: '#16A34A', upcoming: '#2563EB', ended: '#78716c' }

export default function DelegationsPage() {
  const { isAuthorized, isLoading } = useRequireOrgTab('delegations')
  const { can } = useCan()
  const [rows, setRows] = useState<ApprovalDelegationInfo[]>([])
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [types, setTypes] = useState<ApprovalTransactionType[]>([])
  const [showEnded, setShowEnded] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    approvalsApi.listDelegations().then((r) => { setRows(r); setError('') }).catch((e) => setError(extractErrorMessages(e, 'Could not load delegations.').join(' ')))
  }, [])
  useEffect(() => {
    if (!isAuthorized) return
    load()
    usersApi.directory().then(setUsers).catch(() => {})
    approvalsApi.types().then(setTypes).catch(() => {})
  }, [isAuthorized, load])

  if (isLoading || !isAuthorized) return null

  // Errors come back to the popup, which shows them inside itself.
  const add = async (payload: Record<string, unknown>): Promise<true | string> => {
    if (!payload.delegator_id) return 'Pick whose approvals are being delegated.'
    if (!payload.delegate_id) return 'Pick the delegate.'
    try { await approvalsApi.createDelegation(payload); load(); return true } catch (e) { return extractErrorMessages(e, 'Could not add the delegation.').join(' ') }
  }
  const end = async (id: number) => {
    try { await approvalsApi.endDelegation(id); load() } catch (e) { setError(extractErrorMessages(e, 'Could not end the delegation.').join(' ')) }
  }
  const visible = rows.filter((r) => showEnded || r.state !== 'ended')

  return (
    <div>
      <OrganizationNav />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: '0 0 6px' }}>Delegations</h1>
          <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0, maxWidth: 760 }}>
            While a delegation is active, the delegate can decide every approval addressed to the person who is away (all
            modules, one module, or one document type). Decisions show &ldquo;as delegate&rdquo; in the approval history.
          </p>
        </div>
        {can('organization', 'delegations', 'create') && (
          <button type="button" style={primaryBtnStyle} onClick={() => setShowNew(true)}>+ New delegation</button>
        )}
      </div>
      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}

      {showNew && can('organization', 'delegations', 'create') && (
        <DelegationForm users={users} types={types} forOthers onSubmit={add} onClose={() => setShowNew(false)} />
      )}

      <div style={{ ...cardStyle, overflowX: 'auto' }}>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: TEXT.secondary, marginBottom: 8 }}>
          <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} /> Show ended
        </label>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead><tr>{['Away', 'Delegate', 'From', 'To', 'For', 'Reason', 'Status', ''].map((h, hi) => <th key={h} style={th}>{h}{hi === 0 && <RowCount count={visible.length} />}</th>)}</tr></thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: TEXT.muted }}>No delegations.</td></tr>}
            {visible.map((d) => (
              <tr key={d.id}>
                <td style={td}>{d.delegator_name}</td>
                <td style={td}>{d.delegate_name}</td>
                <td style={td}>{new Date(d.start_date).toLocaleDateString('en-GB')}</td>
                <td style={td}>{new Date(d.end_date).toLocaleDateString('en-GB')}</td>
                <td style={td}>{d.workflow_label || (d.module_label ? `${d.module_label} (all)` : 'All approvals')}</td>
                <td style={td}>{d.reason || '—'}</td>
                <td style={{ ...td, color: STATE_HEX[d.state], fontWeight: 600 }}>{d.state}</td>
                <td style={td}>
                  {d.state !== 'ended' && can('organization', 'delegations', 'edit') && (
                    <span style={{ color: '#DC2626', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }} onClick={() => end(d.id)}>End now</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
