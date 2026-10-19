'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRequireApp, useAuth } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityApprovedVendor } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { Section, InfoRow, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle } from '@/components/shared/ui'
import { Pill, PageHeader, ErrorBanner, ActionSheet, fmtDate, AVL_STATUS_LABELS, AVL_STATUS_HEX, SAMPLING_LABELS } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { sheetInput, sheetLabel, sheetHint, Req } from '@/components/shared/FormSheet'

type Prompt = null | { action: 'approve' | 'watch' | 'release-watch' | 'request-block' | 'request-unblock' | 'reject-pending'; title: string; message: string; label: string }

export default function AvlDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const { user } = useAuth()
  const router = useRouter()
  const { id: recordId, error: linkError } = useRecordId(useParams().id as string)
  const id = recordId ?? 0
  const [a, setA] = useState<QualityApprovedVendor | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [reason, setReason] = useState('')
  const { can } = useCan()
  // Approve / watch / block requests need quality:supplier_quality:edit (route) and a Quality head's
  // quality:supplier_quality:approve (service can_approve_vendor).
  const canManage = can('quality', 'supplier_quality', 'edit') && can('quality', 'supplier_quality', 'approve')

  useEffect(() => {
    if (!isAuthorized || !id) return
    qualityApi.getAvl(id).then(setA).catch((e) => setError(extractErrorMessages(e, 'Failed to load this vendor entry.')))
  }, [isAuthorized, id])
  const reload = () => { qualityApi.getAvl(id).then(setA).catch((e) => setError(extractErrorMessages(e, 'Failed to reload this vendor entry.'))) }

  const run = async (fn: () => Promise<QualityApprovedVendor>, fallback: string) => {
    setError('')
    setBusy(true)
    try {
      setA(await fn())
      setPrompt(null)
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><QualityNav /><InvalidRecordLink message={linkError} listHref="/dashboard/quality/supplier-quality" listLabel="Back to supplier quality" /></div>)
  if (!a) {
    return (
      <div>
        <QualityNav />
        <PageHeader title="Approved vendor"><button type="button" onClick={() => router.push('/dashboard/quality/supplier-quality')} style={secondaryBtnStyle}>← Back</button></PageHeader>
        <ErrorBanner error={error} />
        {!error && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}
      </div>
    )
  }
  const isPartner = Boolean((user as { is_partner?: boolean } | null)?.is_partner)

  return (
    <div>
      <QualityNav />
      {prompt && (
        <ActionSheet icon={prompt.action === 'approve' || prompt.action === 'release-watch' ? 'check' : prompt.action === 'reject-pending' ? 'x' : 'alert'}
          iconColor={prompt.action === 'approve' || prompt.action === 'release-watch' ? '#16A34A' : '#DC2626'}
          title={prompt.title} subtitle={`${a.vendor_name} — ${a.item_name}`} onClose={() => { if (!busy) { setPrompt(null); setError('') } }}
          busy={busy} error={error} submitLabel={prompt.label} disabled={!reason.trim()}
          onSubmit={() => {
            const p = prompt
            if (p.action === 'reject-pending') run(() => qualityApi.avlDecision(a.id, false, reason), 'Failed to record the decision.')
            else run(() => qualityApi.avlAction(a.id, p.action as 'approve', reason), 'Failed to update the vendor.')
          }}>
          <p style={{ ...sheetHint, margin: '0 0 14px' }}>{prompt.message}</p>
          <label style={sheetLabel}>Reason <Req /></label>
          <textarea style={{ ...sheetInput, minHeight: 80 }} value={reason} onChange={(ev) => setReason(ev.target.value)} autoFocus />
        </ActionSheet>
      )}

      <PageHeader title={`${a.vendor_name} — ${a.item_name}`} subtitle="Quality · Approved vendor list">
        <Pill text={AVL_STATUS_LABELS[a.status]} hex={AVL_STATUS_HEX[a.status]} />
        <button type="button" onClick={() => router.push('/dashboard/quality/supplier-quality')} style={secondaryBtnStyle}>← Back</button>
      </PageHeader>
      {!prompt && <ErrorBanner error={error} />}

      {a.pending_action && (
        <Section title={`${a.pending_action === 'block' ? 'Block' : 'Unblock'} waiting for a Partner`} style={{ marginBottom: 20 }}>
          <InfoRow label="Reason" value={a.pending_reason || '—'} />
          <InfoRow label="Requested" value={`${a.pending_requested_by_name || '—'} · ${fmtDate(a.pending_requested_at)}`} />
          {!a.legacy_pending ? (
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Approvers decide in the Approval panel below (Organization › Approval Workflows › Vendor block / unblock).</p>
          ) : isPartner ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" disabled={busy} style={a.pending_action === 'block' ? dangerBtnStyle : primaryBtnStyle}
                onClick={() => run(() => qualityApi.avlDecision(a.id, true, ''), 'Failed to record the decision.')}>Approve {a.pending_action}</button>
              <button type="button" disabled={busy} style={secondaryBtnStyle}
                onClick={() => { setReason(''); setError(''); setPrompt({ action: 'reject-pending', title: `Reject the ${a.pending_action}?`, message: 'Give the reason.', label: 'Reject' }) }}>Reject</button>
            </div>
          ) : <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Only a Partner (Company Info → Partners) can decide this.</p>}
        </Section>
      )}

      <ApprovalPanel key={`${a.status}-${a.pending_action || ''}`} entityType="quality_approved_vendor" entityId={a.id} onChanged={reload} title="Approval workflow" />

      <Section title="Approval" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
          <InfoRow label="Item" value={`${a.item_code || ''} ${a.item_name || ''}`.trim()} />
          <InfoRow label="Status reason" value={a.status_reason || '—'} />
          <InfoRow label="Approved" value={a.approved_at ? `${fmtDate(a.approved_at)} · ${a.approved_by_name || '—'}` : '—'} />
          <InfoRow label="First article" value={a.fai_number || '—'} />
          <InfoRow label="Valid until" value={`${fmtDate(a.valid_until)}${a.expired ? ' — re-evaluation due' : ''}`} />
          <InfoRow label="Last rating" value={a.last_score != null ? `${a.last_score.toFixed(1)} (${a.last_rated_period})` : '—'} />
        </div>
        {canManage && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {a.status === 'trial' && (
            <button type="button" disabled={busy} style={primaryBtnStyle}
              onClick={() => { setReason(''); setError(''); setPrompt({ action: 'approve', title: 'Approve this vendor for the item?', message: 'Record the basis (sample report, audit, trial order). Inspection-controlled items are approved by their first article instead.', label: 'Approve' }) }}>Approve vendor</button>
          )}
          {['trial', 'approved'].includes(a.status) && (
            <button type="button" disabled={busy} style={secondaryBtnStyle}
              onClick={() => { setReason(''); setError(''); setPrompt({ action: 'watch', title: 'Put the vendor on watch?', message: 'Lots switch to tightened sampling and a vendor CAPA is raised. Give the reason.', label: 'Put on watch' }) }}>Put on watch</button>
          )}
          {a.status === 'on_watch' && (
            <button type="button" disabled={busy} style={secondaryBtnStyle}
              onClick={() => { setReason(''); setError(''); setPrompt({ action: 'release-watch', title: 'Take the vendor off watch?', message: 'Needs the vendor CAPA closed. Give the reason.', label: 'Back to approved' }) }}>Take off watch</button>
          )}
          {a.status !== 'blocked' && !a.pending_action && (
            <button type="button" disabled={busy} style={dangerBtnStyle}
              onClick={() => { setReason(''); setError(''); setPrompt({ action: 'request-block', title: 'Request a block?', message: 'A Partner must approve. A blocked vendor gets no PO lines and no lot acceptance for this item. Give the reason.', label: 'Request block' }) }}>Request block</button>
          )}
          {a.status === 'blocked' && !a.pending_action && (
            <button type="button" disabled={busy} style={secondaryBtnStyle}
              onClick={() => { setReason(''); setError(''); setPrompt({ action: 'request-unblock', title: 'Request an unblock?', message: 'A Partner must approve; the vendor returns On watch. Give the reason.', label: 'Request unblock' }) }}>Request unblock</button>
          )}
        </div>}
      </Section>

      <Section title="Sampling (ISO 2859-1 switching)" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
          <InfoRow label="Current state" value={`${SAMPLING_LABELS[a.sampling_state]}${a.skip_lot_active ? ' · skip-lot active' : ''}`} />
          <InfoRow label="Accepted in a row" value={String(a.consecutive_accepted)} />
          <InfoRow label="Recent lots (oldest → newest)" value={(a.recent_lots || []).map((x) => (x ? '✓' : '✗')).join(' ') || '—'} />
        </div>
      </Section>

      <Section title="History" style={{ marginBottom: 20 }}>
        {a.events.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No history.</p> : a.events.map((e) => (
          <p key={e.id} style={{ fontSize: 12.5, margin: 0 }}>
            {fmtDate(e.created_at)} · {e.event.replace(/_/g, ' ')}{e.from_status !== e.to_status && e.to_status ? ` (${AVL_STATUS_LABELS[e.from_status || ''] || e.from_status} → ${AVL_STATUS_LABELS[e.to_status] || e.to_status})` : ''}
            {e.reason ? ` — ${e.reason}` : ''} · {e.user_name || 'System'}
          </p>
        ))}
      </Section>
    </div>
  )
}
