'use client'

import Select from '@/components/shared/Select'
// Service › Contracts — customer AMC / CMC service contracts (SAP VA45 list).

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { serviceContractsApi, ServiceContract } from '@/lib/sdServiceApi'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { recordPath } from '@/lib/recordRef'
import ErpNav from '@/components/erp/ErpNav'
import { CONTRACT_TYPE_LABELS, FREQUENCY_LABELS } from '@/components/erp/ServiceContractForm'
import { inputStyle, primaryBtnStyle } from '@/components/shared/ui'
import { GLASS, SHADOWS } from '@/lib/theme'
import { formatINR } from '@/components/sales/labels'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', pending_approval: 'Pending approval', active: 'Active', expired: 'Expired', renewed: 'Renewed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#78716c', pending_approval: '#F59E0B', active: '#16A34A', expired: '#DC2626', renewed: '#2563eb', cancelled: '#a8a29e' }
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: '#57534e', borderTop: '1px solid rgba(0,0,0,0.05)' }

export default function ServiceContractsPage() {
  const { isAuthorized, isLoading } = useRequireApp('erp')
  const { can } = useCan()
  const router = useRouter()
  const [rows, setRows] = useState<ServiceContract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [expiring, setExpiring] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (status) params.status = status
    if (expiring) params.expiring_within_days = 60
    if (search.trim()) params.search = search.trim()
    setLoading(true)
    serviceContractsApi.list(params).then((d) => { setRows(d); setError('') })
      .catch((e) => setError(extractErrorMessages(e, 'Could not load the service contracts.').join(' ')))
      .finally(() => setLoading(false))
  }, [isAuthorized, status, expiring, search])

  if (isLoading || !isAuthorized) return null
  const open = (c: ServiceContract) => router.push(recordPath('/dashboard/erp/service-contracts', c))

  return (
    <div style={{ padding: 24 }}>
      <ErpNav />
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#1c1917' }}>Service Contracts</h1>
          <p style={{ fontSize: 13, color: '#78716c', margin: '4px 0 0' }}>AMC / CMC contracts: covered machines, included visits, SLA and the billing plan.</p>
        </div>
        {can('erp', 'service_contracts', 'create') && <button style={primaryBtnStyle} onClick={() => router.push('/dashboard/erp/service-contracts/new')}>+ New contract</button>}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        <div style={{ flex: '0 1 280px', minWidth: 200 }}><input style={inputStyle} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number, title, PO…" /></div>
        <div style={{ flex: '0 1 180px', minWidth: 160 }}>
          <Select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={expiring} onChange={(e) => setExpiring(e.target.checked)} /> Ending within 60 days
        </label>
      </div>
      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      <div style={{ borderRadius: 16, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead><tr>{['Contract', 'Type', 'Customer', 'Period', 'Machines', 'Visits', 'Value', 'Billing', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10} style={{ ...td, color: '#a8a29e' }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={10} style={{ ...td, color: '#a8a29e' }}>No service contracts.</td></tr>}
            {rows.map((c) => (
              <tr key={c.id} onClick={() => open(c)} style={{ cursor: 'pointer' }}>
                <td style={{ ...td, fontWeight: 600, color: '#FF7A45', whiteSpace: 'nowrap' }}>{c.contract_number}<div style={{ fontWeight: 400, fontSize: 12, color: '#78716c' }}>{c.title || ''}</div></td>
                <td style={td}>{CONTRACT_TYPE_LABELS[c.contract_type] || c.contract_type}</td>
                <td style={td}>{c.customer_name}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatDate(c.start_date)} → {formatDate(c.end_date)}{c.days_to_expiry != null && c.days_to_expiry <= 60 ? <div style={{ fontSize: 11.5, color: '#b45309' }}>ends in {c.days_to_expiry} days</div> : null}</td>
                <td style={td}>{c.machines.length}</td>
                <td style={td}>{c.visits_included ? `${c.visits_used} / ${c.visits_included}` : `${c.visits_used} / ∞`}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatINR(c.contract_value)}</td>
                <td style={td}>{FREQUENCY_LABELS[c.billing_frequency] || c.billing_frequency}</td>
                <td style={td}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[c.status] || '#78716c'}1a`, color: STATUS_HEX[c.status] || '#78716c', whiteSpace: 'nowrap' }}>{STATUS_LABELS[c.status] || c.status}</span>
                </td>
                <td style={td} onClick={(e) => e.stopPropagation()}><span onClick={() => open(c)} style={{ fontSize: 11.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>View</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
