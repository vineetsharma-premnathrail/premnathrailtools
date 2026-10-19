'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignChangeNoticeDetail, DesignEcnAcknowledgement } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import ChangeNoticeForm, { EffectivityFields } from '@/components/design/ChangeNoticeForm'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn, sheetLabel, SheetError } from '@/components/shared/FormSheet'
import { DANGER_RED } from '@/components/design/DesignSheets'
import ReasonSheet from '@/components/shared/ReasonSheet'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { secondaryBtnStyle, dangerBtnStyle, InfoRow } from '@/components/shared/ui'
import {
  ACK_DEPARTMENT_LABELS, DISPOSITION_LABELS, ECN_EFFECTIVITY_LABELS, ECN_PRIORITY_LABELS, ECN_REASON_LABELS, ECN_STATUS_LABELS,
} from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

const STATUS_HEX: Record<string, string> = { draft: '#78716c', submitted: '#F59E0B', approved: '#2563EB', rejected: '#DC2626', implemented: '#16A34A', closed: '#0f766e', cancelled: '#a8a29e' }
const IMPL_LABELS: Record<string, string> = { pending: 'No revision yet', draft: 'Draft', in_review: 'In Review', in_approval: 'In Approval', approved: 'Awaiting customer', released: 'Released', customer_rejected: 'Customer rejected' }
const IMPL_HEX: Record<string, string> = { pending: '#DC2626', draft: '#78716c', in_review: '#2563EB', in_approval: '#7C3AED', approved: '#0891b2', released: '#16A34A', customer_rejected: '#DC2626' }
const EVENT_LABELS: Record<string, string> = {
  ecn_created: 'raised the change notice', ecn_updated: 'edited it', ecn_submitted: 'submitted it for approval', ecn_approved: 'approved it',
  ecn_rejected: 'rejected it', ecn_implemented: 'released the ECN', ecn_cancelled: 'cancelled it', comment: 'commented',
  document_revision_started: 'started a drawing revision under it', document_released: 'released a drawing revision under it',
  ecn_created_from_ecr: 'created it from the approved change request', ecn_effectivity_updated: 'updated the effectivity / disposition',
  ecn_acknowledged: 'acknowledged it', ecn_closed: 'closed it (all departments acknowledged)',
  bom_revision_started: 'started a BOM revision under it', bom_released: 'released a BOM revision under it',
}

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary,
  color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 6px 16px ${SHADOWS.glowOrange}`,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }

function pill(label: string, hex: string) {
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{label}</span>
}

type Confirm = 'submit' | 'implement' | 'delete' | null
type Prompt = 'approve' | 'reject' | 'cancel' | null

export default function ChangeNoticeDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('design')
  const router = useRouter()
  const params = useParams()
  const { id, error: linkError } = useRecordId(params.id as string)

  const [ecn, setEcn] = useState<DesignChangeNoticeDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [success, setSuccess] = useState('')
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [ackRow, setAckRow] = useState<DesignEcnAcknowledgement | null>(null)
  const [comment, setComment] = useState('')
  const [editingEff, setEditingEff] = useState(false)
  const [effError, setEffError] = useState<string | string[]>('')
  const [eff, setEff] = useState({
    effectivity_type: 'immediate', effectivity_date: '', effectivity_serial: '', effectivity_note: '',
    stock_disposition: 'not_applicable', wip_disposition: 'not_applicable', disposition_note: '', target_date: '',
  })

  useEffect(() => {
    if (!isAuthorized || !id) return
    designApi.getChangeNotice(id)
      .then(setEcn)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the change notice.')))
  }, [isAuthorized, id])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><DesignNav /><InvalidRecordLink message={linkError} listHref="/dashboard/design/change-notices" listLabel="Back to changes" /></div>)

  const can = (a: string) => !!ecn?.allowed_actions.includes(a)

  const act = async (fn: () => Promise<DesignChangeNoticeDetail>, fallback: string, done: string) => {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      setEcn(await fn())
      setSuccess(done)
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  const runConfirm = async () => {
    const which = confirm
    setConfirm(null)
    if (!ecn || !which) return
    if (which === 'submit') await act(() => designApi.submitChangeNotice(ecn.id), 'Submitting failed.', `${ecn.ecn_number} submitted — ${ecn.approver_name || 'the approver'} has been notified.`)
    if (which === 'implement') await act(() => designApi.implementChangeNotice(ecn.id), 'Releasing the ECN failed.', `${ecn.ecn_number} released — the departments have been asked to acknowledge it.`)
    if (which === 'delete') {
      setBusy(true)
      try {
        await designApi.deleteChangeNotice(ecn.id)
        router.push('/dashboard/design/change-notices?tab=ecn')
      } catch (err) {
        setError(extractErrorMessages(err, 'Deleting failed.'))
        setBusy(false)
      }
    }
  }

  // Popup actions: errors are thrown back to the popup (shown inside it), the
  // popup closes only on success.
  const runPrompt = async (value: string) => {
    const which = prompt
    if (!ecn || !which) return
    setError('')
    setSuccess('')
    if (which === 'approve') { setEcn(await designApi.approveChangeNotice(ecn.id, value)); setSuccess(`${ecn.ecn_number} approved — document owners have been asked to start their revisions.`) }
    if (which === 'reject') { setEcn(await designApi.rejectChangeNotice(ecn.id, value)); setSuccess(`${ecn.ecn_number} rejected.`) }
    if (which === 'cancel') { setEcn(await designApi.cancelChangeNotice(ecn.id, value)); setSuccess(`${ecn.ecn_number} cancelled.`) }
    setPrompt(null)
  }

  const runAcknowledge = async (value: string) => {
    const row = ackRow
    if (!ecn || !row) return
    const dept = ACK_DEPARTMENT_LABELS[row.department] || row.department
    setError('')
    setSuccess('')
    setEcn(await designApi.acknowledgeEcn(ecn.id, row.department, value.trim() || undefined))
    setSuccess(`${ecn.ecn_number} acknowledged for ${dept}.`)
    setAckRow(null)
  }

  const save = async (payload: Record<string, unknown>) => {
    if (!ecn) return
    if (await act(() => designApi.updateChangeNotice(ecn.id, payload), 'Saving failed.', 'Change notice saved.')) setEditing(false)
  }

  const startEditEff = () => {
    if (!ecn) return
    setEff({
      effectivity_type: ecn.effectivity_type || 'immediate', effectivity_date: ecn.effectivity_date || '', effectivity_serial: ecn.effectivity_serial || '',
      effectivity_note: ecn.effectivity_note || '', stock_disposition: ecn.stock_disposition || 'not_applicable',
      wip_disposition: ecn.wip_disposition || 'not_applicable', disposition_note: ecn.disposition_note || '', target_date: ecn.target_date || '',
    })
    setEffError('')
    setEditingEff(true)
  }
  const saveEff = async () => {
    if (!ecn) return
    if (eff.effectivity_type === 'date' && !eff.effectivity_date) { setEffError('Effectivity is "From a date" — pick the date the change takes effect.'); return }
    if (eff.effectivity_type === 'serial' && !eff.effectivity_serial.trim()) { setEffError('Effectivity is "From a serial number" — enter the first serial number it applies to.'); return }
    setBusy(true)
    setEffError('')
    setError('')
    setSuccess('')
    try {
      setEcn(await designApi.updateEcnEffectivity(ecn.id, {
        effectivity_type: eff.effectivity_type,
        effectivity_date: eff.effectivity_type === 'date' ? eff.effectivity_date || null : null,
        effectivity_serial: eff.effectivity_type === 'serial' ? eff.effectivity_serial.trim() || null : null,
        effectivity_note: eff.effectivity_note.trim() || null,
        stock_disposition: eff.stock_disposition, wip_disposition: eff.wip_disposition,
        disposition_note: eff.disposition_note.trim() || null,
        target_date: eff.target_date || null,
      }))
      setSuccess('Effectivity and disposition saved.')
      setEditingEff(false)
    } catch (err) {
      setEffError(extractErrorMessages(err, 'Saving the effectivity failed.'))
    } finally {
      setBusy(false)
    }
  }

  const postComment = async () => {
    if (!ecn || !comment.trim()) return
    if (await act(() => designApi.addChangeNoticeComment(ecn.id, comment.trim()), 'Posting the comment failed.', 'Comment added.')) setComment('')
  }

  const pendingDocs = ecn ? ecn.documents.filter((d) => d.implementation_status !== 'released') : []
  const pendingBoms = ecn ? ecn.boms.filter((b) => b.implementation_status !== 'released') : []
  const totalItems = ecn ? ecn.documents.length + ecn.boms.length : 0
  const beforeApproval = ecn ? ecn.status === 'draft' || ecn.status === 'submitted' : false
  const effectivityText = (() => {
    if (!ecn) return '—'
    const base = ECN_EFFECTIVITY_LABELS[ecn.effectivity_type] || ecn.effectivity_type
    if (ecn.effectivity_type === 'date' && ecn.effectivity_date) return `${base}: ${formatDate(ecn.effectivity_date)}`
    if (ecn.effectivity_type === 'serial' && ecn.effectivity_serial) return `${base}: ${ecn.effectivity_serial}`
    if (ecn.effectivity_type === 'project') return `${base}: ${ecn.pm_project_label || ecn.erp_project_label || 'not set'}`
    return base
  })()

  if (ecn && editing) {
    return (
      <ChangeNoticeForm
        nav={<DesignNav />}
        tour="design-ecn-header"
        title={`Edit ${ecn.ecn_number}`}
        subtitle={`${ecn.title} — every field can be changed until the ECN is submitted for approval.`}
        onBack={() => setEditing(false)}
        backTour="design-ecn-edit-back-btn"
        error={error}
        initial={ecn} currentUserId={user?.id} submitLabel="Save Changes" saving={busy} onSubmit={save} onCancel={() => setEditing(false)} onError={setError}
      />
    )
  }

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Engineering Change Notice</p>
          <h1 data-tour="design-ecn-header" style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {ecn ? <>{ecn.ecn_number} <span style={{ fontWeight: 500, color: TEXT.secondary }}>— {ecn.title}</span> {pill(ECN_STATUS_LABELS[ecn.status] || ecn.status, STATUS_HEX[ecn.status] || '#78716c')}</> : 'Change Notice'}
          </h1>
          {ecn?.ecr_id && (
            <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
              From change request{' '}
              <span onClick={() => router.push(recordPath('/dashboard/design/change-requests', ecn, 'ecr_id'))} style={{ color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>{ecn.ecr_number}</span>
            </p>
          )}
        </div>
        <button data-tour="design-ecn-back-btn" onClick={() => router.push('/dashboard/design/change-notices?tab=ecn')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {success && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          {success}
        </div>
      )}

      {ecn && (
        <>
          <div data-tour="design-ecn-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {can('edit') && <button data-tour="design-ecn-edit-btn" disabled={busy} style={secondaryBtnStyle} onClick={() => { setError(''); setSuccess(''); setEditing(true) }}>Edit</button>}
            {can('submit') && <button data-tour="design-ecn-submit-btn" disabled={busy} style={primaryBtn} onClick={() => setConfirm('submit')}>Submit for Approval</button>}
            {can('approve') && !ecn.approval_engine && <button data-tour="design-ecn-approve-btn" disabled={busy} style={primaryBtn} onClick={() => setPrompt('approve')}>Approve</button>}
            {can('reject') && !ecn.approval_engine && <button data-tour="design-ecn-reject-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setPrompt('reject')}>Reject</button>}
            {can('implement') && <button data-tour="design-ecn-release-btn" disabled={busy} style={primaryBtn} onClick={() => setConfirm('implement')}>Release ECN</button>}
            {can('cancel') && <button data-tour="design-ecn-cancel-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setPrompt('cancel')}>Cancel ECN</button>}
            {can('delete') && <button data-tour="design-ecn-delete-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setConfirm('delete')}>Delete</button>}
          </div>

          <ApprovalPanel
            entityType="design_ecn" entityId={ecn.id} title="ECN approval"
            onChanged={() => { designApi.getChangeNotice(ecn.id).then(setEcn).catch(() => { /* panel shows its own error */ }) }}
          />

          {ecn.status === 'approved' && pendingDocs.length + pendingBoms.length > 0 && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.2)', color: '#1e40af', fontSize: 13 }}>
              Open. {pendingDocs.length + pendingBoms.length} of {totalItems} affected item{totalItems === 1 ? '' : 's'} still need a released revision raised under {ecn.ecn_number} before the ECN can be released — open each drawing / BOM and start a new revision, picking this ECN.
            </div>
          )}
          {ecn.status === 'implemented' && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
              Released. Waiting for {ecn.acknowledgements.length - ecn.acknowledged_count} of {ecn.acknowledgements.length} department{ecn.acknowledgements.length === 1 ? '' : 's'} to acknowledge — the ECN closes when all have.
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '2 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div data-tour="design-ecn-drawings" style={sectionStyle}>
                <p style={sectionTitle}>Affected drawings</p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                    <thead>
                      <tr>{['Drawing', 'What changes', 'Owner', 'Controlled rev', 'Under this ECN'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {ecn.documents.map((d) => (
                        <tr key={d.id} onClick={() => router.push(recordPath('/dashboard/design/documents', d, 'document_id'))} style={{ cursor: 'pointer' }}>
                          <td style={tdStyle}><strong>{d.doc_number}</strong><div style={{ color: TEXT.muted }}>{d.title}</div></td>
                          <td style={{ ...tdStyle, maxWidth: 260 }}>{d.change_description || '—'}</td>
                          <td style={tdStyle}>{d.owner_name || '—'}</td>
                          <td style={tdStyle}>{d.released_revision_label || '—'}</td>
                          <td style={tdStyle}>
                            {beforeApproval ? <span style={{ color: TEXT.muted }}>After approval</span> : (
                              <>{d.ecn_revision_label && <strong style={{ marginRight: 6 }}>{d.ecn_revision_label}</strong>}
                                {pill(IMPL_LABELS[d.implementation_status] || d.implementation_status, IMPL_HEX[d.implementation_status] || '#78716c')}</>
                            )}
                          </td>
                        </tr>
                      ))}
                      {ecn.documents.length === 0 && (
                        <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No affected drawings.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div data-tour="design-ecn-boms" style={sectionStyle}>
                <p style={sectionTitle}>Affected BOMs</p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                    <thead>
                      <tr>{['BOM', 'What changes', 'Released rev', 'Under this ECN'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {ecn.boms.map((b) => (
                        <tr key={b.id} onClick={() => router.push(recordPath('/dashboard/design/boms', b, 'bom_id'))} style={{ cursor: 'pointer' }}>
                          <td style={tdStyle}><strong>{b.bom_number}</strong><div style={{ color: TEXT.muted }}>{b.title}</div></td>
                          <td style={{ ...tdStyle, maxWidth: 260 }}>{b.change_description || '—'}</td>
                          <td style={tdStyle}>{b.released_revision_label || '—'}</td>
                          <td style={tdStyle}>
                            {beforeApproval ? <span style={{ color: TEXT.muted }}>After approval</span> : (
                              <>{b.ecn_revision_label && <strong style={{ marginRight: 6 }}>{b.ecn_revision_label}</strong>}
                                {pill(IMPL_LABELS[b.implementation_status] || b.implementation_status, IMPL_HEX[b.implementation_status] || '#78716c')}</>
                            )}
                          </td>
                        </tr>
                      ))}
                      {ecn.boms.length === 0 && (
                        <tr><td colSpan={4} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No affected BOMs.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div data-tour="design-ecn-effectivity" style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                  <p style={{ ...sectionTitle, margin: 0, flex: 1 }}>Effectivity &amp; disposition</p>
                  {can('edit_effectivity') && (
                    <button type="button" data-tour="design-ecn-eff-edit-btn" style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 12 }} onClick={startEditEff}>Edit</button>
                  )}
                </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                    <InfoRow label="Takes effect" value={effectivityText} />
                    <InfoRow label="Stock on hand" value={DISPOSITION_LABELS[ecn.stock_disposition] || ecn.stock_disposition} />
                    <InfoRow label="Work in progress" value={DISPOSITION_LABELS[ecn.wip_disposition] || ecn.wip_disposition} />
                    {ecn.effectivity_note && <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Effectivity note" value={ecn.effectivity_note} /></div>}
                    {ecn.disposition_note && <div style={{ gridColumn: '1 / -1' }}><InfoRow label="Disposition note" value={ecn.disposition_note} /></div>}
                  </div>
              </div>

              {ecn.acknowledgements.length > 0 && (
                <div data-tour="design-ecn-acks" style={sectionStyle}>
                  <p style={sectionTitle}>Department acknowledgements ({ecn.acknowledged_count} / {ecn.acknowledgements.length})</p>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                      <thead>
                        <tr>{['Department', 'Acknowledged by', 'When', 'Remarks', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {ecn.acknowledgements.map((a) => (
                          <tr key={a.id}>
                            <td style={{ ...tdStyle, fontWeight: 600 }}>{ACK_DEPARTMENT_LABELS[a.department] || a.department}</td>
                            <td style={tdStyle}>{a.acknowledged_at ? a.acknowledged_by_name || '—' : pill('Pending', '#F59E0B')}</td>
                            <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{a.acknowledged_at ? formatDateTime(a.acknowledged_at) : '—'}</td>
                            <td style={{ ...tdStyle, maxWidth: 280, whiteSpace: 'pre-wrap' }}>{a.remarks || '—'}</td>
                            <td style={tdStyle}>
                              {a.can_acknowledge && !a.acknowledged_at && (
                                <button type="button" disabled={busy} style={{ ...secondaryBtnStyle, padding: '5px 12px', fontSize: 12 }} onClick={() => setAckRow(a)}>Acknowledge</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div data-tour="design-ecn-change" style={sectionStyle}>
                <p style={sectionTitle}>Change</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <InfoRow label="Description" value={ecn.description || '—'} />
                  <InfoRow label="Impact" value={ecn.impact_assessment || '—'} />
                </div>
              </div>
            </div>

            <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div data-tour="design-ecn-details" style={sectionStyle}>
                <p style={sectionTitle}>Details</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {ecn.ecr_id && (
                    <div>
                      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }}>Change request</p>
                      <p onClick={() => router.push(recordPath('/dashboard/design/change-requests', ecn, 'ecr_id'))} style={{ fontSize: 13, color: '#FF6A2A', fontWeight: 600, margin: 0, cursor: 'pointer' }}>{ecn.ecr_number}</p>
                    </div>
                  )}
                  <InfoRow label="Reason" value={ECN_REASON_LABELS[ecn.reason] || ecn.reason} />
                  <InfoRow label="Priority" value={ECN_PRIORITY_LABELS[ecn.priority] || ecn.priority} />
                  <InfoRow label="Target date" value={formatDate(ecn.target_date)} />
                  <InfoRow label="Project" value={ecn.pm_project_label || '—'} />
                  <InfoRow label="Machine" value={ecn.erp_project_label || '—'} />
                  <InfoRow label="Raised by" value={`${ecn.created_by_name || '—'} · ${formatDate(ecn.created_at)}`} />
                  <InfoRow label="Approver" value={ecn.approver_name || 'Not named yet'} />
                  {ecn.decided_at && <InfoRow label={ecn.status === 'rejected' ? 'Rejected by' : 'Approved by'} value={`${ecn.decided_by_name || '—'} · ${formatDate(ecn.decided_at)}${ecn.decision_comment ? ` — ${ecn.decision_comment}` : ''}`} />}
                  {ecn.implemented_at && <InfoRow label="Released" value={`${ecn.implemented_by_name || '—'} · ${formatDate(ecn.implemented_at)}`} />}
                  {ecn.closed_at && <InfoRow label="Closed" value={formatDate(ecn.closed_at)} />}
                  {ecn.cancelled_at && <InfoRow label="Cancelled" value={`${formatDate(ecn.cancelled_at)} — ${ecn.cancel_reason || ''}`} />}
                </div>
              </div>

              <div data-tour="design-ecn-timeline" style={sectionStyle}>
                <p style={sectionTitle}>Timeline</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input style={inputStyle} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…" onKeyDown={(e) => { if (e.key === 'Enter') postComment() }} />
                  <button type="button" disabled={busy || !comment.trim()} style={{ ...secondaryBtnStyle, whiteSpace: 'nowrap' }} onClick={postComment}>Post</button>
                </div>
                {ecn.events.map((e) => (
                  <div key={e.id} style={{ padding: '8px 0', borderTop: `1px solid ${BORDER.light}` }}>
                    <p style={{ fontSize: 12.5, color: TEXT.body, margin: 0 }}>
                      <strong>{e.actor_name || 'System'}</strong> {EVENT_LABELS[e.action] || e.action.replace(/_/g, ' ')}
                      {e.doc_number ? <span style={{ color: TEXT.muted }}> · {e.doc_number}{e.revision_label ? ` ${e.revision_label}` : ''}</span> : null}
                    </p>
                    {e.comment && e.action !== 'document_released' && <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '2px 0 0', whiteSpace: 'pre-wrap' }}>{e.comment}</p>}
                    <p style={{ fontSize: 11, color: TEXT.muted, margin: '2px 0 0' }}>{formatDateTime(e.created_at)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'submit' ? 'Submit for approval?' : confirm === 'implement' ? 'Release this ECN?' : 'Delete this draft?'}
        message={
          confirm === 'submit' ? `${ecn?.ecn_number} goes to ${ecn?.approver_name || 'the approver'} for a decision. It can't be edited after this.`
            : confirm === 'implement' ? 'Every affected drawing and BOM has a released revision under this ECN. The effectivity and disposition are frozen, and Production, Purchase, Store, Quality and Project are asked to acknowledge it.'
              : 'The draft change notice is deleted.'
        }
        confirmLabel={confirm === 'submit' ? 'Submit' : confirm === 'implement' ? 'Release ECN' : 'Delete'}
        danger={confirm === 'delete'}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
      {ecn && prompt && (
        <ReasonSheet
          open
          key={prompt}
          icon={prompt === 'approve' ? 'check' : prompt === 'reject' ? 'x' : 'trash'}
          iconColor={prompt === 'approve' ? '#16a34a' : DANGER_RED}
          title={prompt === 'approve' ? 'Approve change notice' : prompt === 'reject' ? 'Reject change notice' : 'Cancel change notice'}
          subtitle={`${ecn.ecn_number} — ${ecn.title}`}
          label={prompt === 'approve' ? 'Remarks' : 'Reason'}
          requireValue={prompt !== 'approve'}
          requiredMessage={prompt === 'reject' ? 'Give a reason for rejecting — the person who raised it sees it.' : 'Give a reason for cancelling.'}
          placeholder={prompt === 'approve' ? 'e.g. Approved — apply from the next production order' : 'Reason…'}
          hint={prompt === 'approve' ? 'Document owners are notified to raise their next revisions under this ECN.' : prompt === 'reject' ? 'This is final — the person who raised it sees your reason.' : 'The ECN is kept on record as cancelled.'}
          confirmLabel={prompt === 'approve' ? 'Approve' : prompt === 'reject' ? 'Reject' : 'Cancel ECN'}
          errorFallback={prompt === 'approve' ? 'Approval failed.' : prompt === 'reject' ? 'Rejecting failed.' : 'Cancelling failed.'}
          onConfirm={runPrompt}
          onCancel={() => setPrompt(null)}
        />
      )}
      {ecn && ackRow && (
        <ReasonSheet
          open
          icon="check" iconColor="#16a34a"
          title={`Acknowledge for ${ACK_DEPARTMENT_LABELS[ackRow.department] || ackRow.department}`}
          subtitle={`${ecn.ecn_number} — ${ecn.title}`}
          label="Remarks"
          placeholder="e.g. 12 brackets moved to rework"
          hint="Confirm your department has seen the change and acted on it (stock, open orders, routings, inspection plans)."
          confirmLabel="Acknowledge"
          errorFallback="Acknowledging failed."
          onConfirm={runAcknowledge}
          onCancel={() => setAckRow(null)}
        />
      )}
      {ecn && editingEff && (
        <FormSheet width={720} icon="calendar" title="Effectivity & disposition" subtitle={`${ecn.ecn_number} — when the change takes effect and what happens to stock and work in progress.`}
          onClose={() => setEditingEff(false)} busy={busy}
          footer={<>
            <button type="button" data-tour="design-ecn-eff-cancel-btn" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => setEditingEff(false)}>Cancel</button>
            <button type="button" data-tour="design-ecn-eff-save-btn" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={saveEff}>
              <SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={effError} />
            <SheetSection icon="calendar" title="Effectivity & disposition">
              <EffectivityFields
                value={{
                  effectivityType: eff.effectivity_type, effectivityDate: eff.effectivity_date, effectivitySerial: eff.effectivity_serial,
                  effectivityNote: eff.effectivity_note, stockDisposition: eff.stock_disposition, wipDisposition: eff.wip_disposition, dispositionNote: eff.disposition_note,
                }}
                set={{
                  setEffectivityType: (v) => setEff((p) => ({ ...p, effectivity_type: v })),
                  setEffectivityDate: (v) => setEff((p) => ({ ...p, effectivity_date: v })),
                  setEffectivitySerial: (v) => setEff((p) => ({ ...p, effectivity_serial: v })),
                  setEffectivityNote: (v) => setEff((p) => ({ ...p, effectivity_note: v })),
                  setStockDisposition: (v) => setEff((p) => ({ ...p, stock_disposition: v })),
                  setWipDisposition: (v) => setEff((p) => ({ ...p, wip_disposition: v })),
                  setDispositionNote: (v) => setEff((p) => ({ ...p, disposition_note: v })),
                }}
                extra={
                  <div style={{ flex: '0 1 170px', minWidth: 160 }}>
                    <label style={sheetLabel}>Target date</label>
                    <DateField value={eff.target_date} onChange={(v) => setEff((p) => ({ ...p, target_date: v }))} />
                  </div>
                }
              />
            </SheetSection>
          </div>
        </FormSheet>
      )}
    </div>
  )
}
