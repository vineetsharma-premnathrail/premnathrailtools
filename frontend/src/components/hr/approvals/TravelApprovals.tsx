'use client'

import { useCallback, useEffect, useState } from 'react'
import { hrApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { HrTravelRequest } from '@/types'
import PromptDialog from '@/components/erp/PromptDialog'
import { dangerBtnStyle } from '@/components/shared/ui'
import { TravelSummary } from '@/components/hr/admin/TravelDialogs'
import { ErrorBanner, SuccessBanner, sectionStyle, primaryActionStyle, fmtDateTime } from '@/components/hr/admin/adminUi'
import { TEXT, BORDER } from '@/lib/theme'

// Travel requests waiting for the signed-in user's decision. Renders nothing
// when there are none (and nothing while loading).
export default function TravelApprovals() {
  const [rows, setRows] = useState<HrTravelRequest[] | null>(null)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<{ kind: 'approve' | 'reject'; t: HrTravelRequest } | null>(null)

  const load = useCallback(() => {
    hrApi.travelApprovals()
      .then((r) => { setRows(r); setError([]) })
      .catch((err) => { setRows([]); setError(extractErrorMessages(err, 'Travel approvals could not be loaded.')) })
  }, [])

  useEffect(() => { load() }, [load])

  const decide = async (remarks: string) => {
    if (!pending) return
    const { kind, t } = pending
    setPending(null)
    try {
      if (kind === 'approve') await hrApi.approveTravel(t.id, remarks)
      else await hrApi.rejectTravel(t.id, remarks)
      setNotice(`${t.request_no} ${kind === 'approve' ? 'approved' : 'rejected'}. ${t.user_name} has been notified.`)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'The travel request could not be updated.'))
    }
  }

  if (rows === null) return null
  if (rows.length === 0 && !error.length && !notice) return null

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }}>Travel requests</p>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B' }}>{rows.length} pending</span>
      </div>
      <ErrorBanner error={error} />
      <SuccessBanner message={notice} />
      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Nothing else waiting.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((t) => (
            <div key={t.id} style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.7)', border: `1px solid ${BORDER.light}` }}>
              <div style={{ flex: '0 1 200px', minWidth: 160 }}>
                <p style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 2px' }}>{t.user_name}</p>
                <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>{t.user_department || '—'}</p>
                <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '4px 0 0' }}>{t.request_no} · raised {fmtDateTime(t.created_at)}</p>
                {!t.approver_id && <p style={{ fontSize: 11.5, color: '#2563EB', margin: '4px 0 0' }}>No manager set — any HR user can decide</p>}
              </div>
              <div style={{ flex: '1 1 280px' }}><TravelSummary t={t} /></div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="button" style={{ ...primaryActionStyle, padding: '8px 16px' }} onClick={() => setPending({ kind: 'approve', t })}>Approve</button>
                <button type="button" style={dangerBtnStyle} onClick={() => setPending({ kind: 'reject', t })}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <PromptDialog
        open={!!pending}
        title={pending ? `${pending.kind === 'approve' ? 'Approve' : 'Reject'} ${pending.t.request_no}?` : ''}
        message={pending ? `${pending.t.user_name}: ${pending.t.from_city} → ${pending.t.to_city}.${pending.kind === 'reject' ? ' Say why (required) so they can re-plan.' : ''}` : undefined}
        placeholder={pending?.kind === 'reject' ? 'Reason for rejection…' : 'Remarks (optional)…'}
        confirmLabel={pending?.kind === 'approve' ? 'Approve' : 'Reject'}
        cancelLabel="Back"
        danger={pending?.kind === 'reject'}
        onConfirm={decide}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
