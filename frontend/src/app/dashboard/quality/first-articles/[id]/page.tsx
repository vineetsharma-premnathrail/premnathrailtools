'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityFirstArticle } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { Field, Section, InfoRow, inputStyle, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle } from '@/components/shared/ui'
import { Pill, PageHeader, ErrorBanner, fmtDate, LOT_STATUS_LABELS, DECISION_LABELS } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { open: 'Open', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { open: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', cancelled: '#a8a29e' }
const TRIGGER_LABELS: Record<string, string> = { new_item: 'New item', new_revision: 'New drawing revision', new_vendor: 'New vendor', manual: 'Raised manually' }

export default function FirstArticleDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const id = Number(useParams().id)
  const [fai, setFai] = useState<QualityFirstArticle | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [remarks, setRemarks] = useState('')
  const [confirm, setConfirm] = useState<'' | 'approve' | 'reject'>('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !id) return
    qualityApi.getFirstArticle(id).then(setFai).catch((e) => setError(extractErrorMessages(e, 'Failed to load this first article.')))
  }, [isAuthorized, id])

  const decide = async () => {
    const approve = confirm === 'approve'
    setConfirm('')
    setBusy(true)
    setError('')
    try {
      setFai(await qualityApi.decideFirstArticle(id, approve, remarks))
    } catch (err) {
      setError(extractErrorMessages(err, `Failed to ${approve ? 'approve' : 'reject'} the first article.`))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  const back = <button type="button" onClick={() => router.push('/dashboard/quality/first-articles')} style={secondaryBtnStyle}>← Back</button>
  if (!fai) {
    return (
      <div>
        <QualityNav />
        <PageHeader title="First Article">{back}</PageHeader>
        <ErrorBanner error={error} />
        {!error && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}
      </div>
    )
  }
  const revChanged = fai.status === 'approved' && (fai.current_drawing_ref || null) !== (fai.drawing_ref || null)

  return (
    <div>
      <QualityNav />
      <ConfirmDialog open={!!confirm} title={confirm === 'approve' ? 'Approve this first article?' : 'Reject this first article?'}
        message={confirm === 'approve'
          ? `${fai.item_name} (${fai.vendor_name || 'in-house'}${fai.drawing_ref ? `, ${fai.drawing_ref}` : ''}) will be released for regular lots. This can't be undone.`
          : 'The next receipt / production run of this item and source becomes a fresh first article. This can\'t be undone.'}
        confirmLabel={confirm === 'approve' ? 'Approve FAI' : 'Reject FAI'} danger={confirm === 'reject'}
        onCancel={() => setConfirm('')} onConfirm={decide} />
      <PageHeader title={fai.fai_number} subtitle="Quality · First article inspection">
        <Pill text={STATUS_LABELS[fai.status] || fai.status} hex={STATUS_HEX[fai.status]} />
        {back}
      </PageHeader>
      <ErrorBanner error={error} />
      <Section title="First article" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          <InfoRow label="Item" value={`${fai.item_code ? `${fai.item_code} — ` : ''}${fai.item_name}`} />
          <InfoRow label="Source" value={fai.vendor_name || 'In-house production'} />
          <InfoRow label="Why" value={TRIGGER_LABELS[fai.trigger] || fai.trigger} />
          <InfoRow label="Drawing revision" value={fai.drawing_ref || 'No released drawing in Design'} />
          <InfoRow label="Raised from" value={fai.source_reference || fai.source_type} />
          <InfoRow label="Raised" value={`${fai.created_by_name || 'System'} · ${fmtDate(fai.created_at)}`} />
        </div>
        {revChanged && (
          <p style={{ fontSize: 13, color: '#b45309', margin: 0 }}>
            The item&apos;s released drawing is now {fai.current_drawing_ref || 'none'} — this approval covered {fai.drawing_ref || 'no drawing'}, so the next receipt needs a new FAI.
          </p>
        )}
      </Section>
      <Section title="Full drawing check (lot)" style={{ marginBottom: 20 }}>
        {fai.lot_id ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
            <span onClick={() => router.push(`/dashboard/quality/lots/${fai.lot_id}`)} style={{ cursor: 'pointer', fontWeight: 700, color: '#FF6A2A' }}>{fai.lot_number}</span>
            <span>{LOT_STATUS_LABELS[fai.lot_status || ''] || fai.lot_status}</span>
            {fai.lot_decision && <span style={{ color: TEXT.muted }}>Decision: {DECISION_LABELS[fai.lot_decision] || fai.lot_decision}</span>}
          </div>
        ) : <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No lot.</p>}
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
          The lot checks every characteristic of the item&apos;s First article plan — or, without one, its incoming / final plan on the first-article sample (Quality → Settings), accept 0.
        </p>
      </Section>
      {fai.status === 'open' ? (
        <Section title="Decision" style={{ marginBottom: 20 }}>
          <Field label="Remarks (required to reject, or when the lot was accepted with a deviation)">
            <textarea style={{ ...inputStyle, minHeight: 60 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => setConfirm('approve')}>Approve FAI</button>
            <button type="button" disabled={busy} style={dangerBtnStyle} onClick={() => setConfirm('reject')}>Reject FAI</button>
          </div>
        </Section>
      ) : (
        <Section title="Decision" style={{ marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            <InfoRow label="Status" value={STATUS_LABELS[fai.status] || fai.status} />
            <InfoRow label="Decided by" value={`${fai.decided_by_name || '—'} · ${fmtDate(fai.decided_at)}`} />
            {fai.decision_remarks && <InfoRow label="Remarks" value={fai.decision_remarks} />}
          </div>
        </Section>
      )}
    </div>
  )
}
