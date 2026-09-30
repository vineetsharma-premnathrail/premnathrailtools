'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { HrTravelRequest } from '@/types'
import HrNav from '@/components/hr/HrNav'
import MyHrTabs from '@/components/hr/MyHrTabs'
import PromptDialog from '@/components/erp/PromptDialog'
import { TravelFormDialog, TRAVEL_MODE_LABELS, TRAVEL_STATUS_LABELS, TRAVEL_STATUS_HEX } from '@/components/hr/admin/TravelDialogs'
import {
  PageHeader, ErrorBanner, SuccessBanner, Pill, EmptyRow, primaryActionStyle, filterInputStyle,
  tableWrapStyle, thStyle, tdStyle, linkActionStyle, fmtDate, fmtINR,
} from '@/components/hr/admin/adminUi'
import { TEXT } from '@/lib/theme'

export default function MyTravelPage() {
  // Self-service: any logged-in user.
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [rows, setRows] = useState<HrTravelRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [status, setStatus] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<HrTravelRequest | null>(null)
  const [cancelling, setCancelling] = useState<HrTravelRequest | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    hrApi.myTravel(status ? { status } : {})
      .then((r) => { setRows(r); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, 'Your travel requests could not be loaded.')))
      .finally(() => setLoading(false))
  }, [status])

  useEffect(() => { if (user) load() }, [user, load])

  const doCancel = async (remarks: string) => {
    if (!cancelling) return
    const t = cancelling
    setCancelling(null)
    try {
      await hrApi.cancelTravel(t.id, remarks)
      setNotice(`${t.request_no} cancelled.`)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'The travel request could not be cancelled.'))
    }
  }

  if (isLoading || !user) return null

  return (
    <div>
      <HrNav />
      <MyHrTabs />

      <PageHeader
        title="My Travel"
        subtitle="Request approval for business trips. After the trip, claim your expenses under Expense Claims and link them to the trip."
        actions={<button type="button" style={primaryActionStyle} onClick={() => { setEditing(null); setFormOpen(true) }}>+ New Travel Request</button>}
      />

      <ErrorBanner error={error} />
      <SuccessBanner message={notice} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <select style={{ ...filterInputStyle, flex: '0 1 170px' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(TRAVEL_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
          <thead>
            <tr>{['Request', 'Trip', 'Dates', 'Mode', 'Est. cost', 'Approver', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? <EmptyRow colSpan={8} text="Loading…" /> : rows.length === 0 ? (
              <EmptyRow colSpan={8} text={status ? 'No travel requests with this status.' : 'You have not raised any travel requests yet.'} />
            ) : rows.map((t) => (
              <tr key={t.id}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{t.request_no}</td>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600 }}>{t.from_city} → {t.to_city}</div>
                  <div style={{ fontSize: 12, color: TEXT.muted, maxWidth: 280 }}>{t.purpose}</div>
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtDate(t.depart_date)}{t.return_date ? ` – ${fmtDate(t.return_date)}` : ''}</td>
                <td style={tdStyle}>{TRAVEL_MODE_LABELS[t.travel_mode] || t.travel_mode}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {fmtINR(t.estimated_cost)}
                  {Number(t.advance_required) > 0 && <div style={{ fontSize: 12, color: TEXT.muted }}>Advance {fmtINR(t.advance_required)}</div>}
                </td>
                <td style={tdStyle}>
                  {t.decided_by_name || t.approver_name || (t.status === 'pending' ? 'HR' : '—')}
                  {t.decision_remarks && <div style={{ fontSize: 12, color: TEXT.muted, whiteSpace: 'pre-wrap', maxWidth: 240 }}>“{t.decision_remarks}”</div>}
                </td>
                <td style={tdStyle}><Pill hex={TRAVEL_STATUS_HEX[t.status] || '#64748B'} label={TRAVEL_STATUS_LABELS[t.status] || t.status} /></td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {t.can_edit && <button type="button" style={linkActionStyle} onClick={() => { setEditing(t); setFormOpen(true) }}>Edit</button>}
                    {(t.status === 'approved' || t.status === 'completed') && (
                      <button type="button" style={linkActionStyle} onClick={() => router.push('/dashboard/hr/me/claims')}>Claim expenses</button>
                    )}
                    {t.can_cancel && <button type="button" style={{ ...linkActionStyle, color: '#DC2626' }} onClick={() => setCancelling(t)}>Cancel</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TravelFormDialog
        open={formOpen}
        request={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(t) => {
          setFormOpen(false)
          setNotice(editing ? `${t.request_no} updated.` : `${t.request_no} submitted${t.approver_name ? ` to ${t.approver_name}` : ' to HR'} for approval.`)
          load()
        }}
      />
      <PromptDialog
        open={!!cancelling}
        title={`Cancel ${cancelling?.request_no || ''}?`}
        message={cancelling?.status === 'approved' ? 'This trip is already approved; your approver will be told it is cancelled.' : 'The request will be withdrawn.'}
        placeholder="Reason (optional)…"
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
        onConfirm={doCancel}
        onCancel={() => setCancelling(null)}
      />
    </div>
  )
}
