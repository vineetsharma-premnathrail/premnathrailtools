'use client'

import AnchoredDropdown from '@/components/design/AnchoredDropdown'
import Select from '@/components/shared/Select'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { designApi } from '@/lib/api'
import { DesignCustomerSubmissionDetail, DesignLookupOption, DesignSubmissionComment } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import { useDesignMe } from '@/components/design/useDesignMe'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { secondaryBtnStyle, dangerBtnStyle, InfoRow, primaryBtnStyle, smallSecondaryBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, SHEET, Req, Optional, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { DANGER_RED } from '@/components/design/DesignSheets'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { CUSTOMER_RESPONSE_LABELS, SUBMISSION_STATUS_LABELS, formatBytes, toOptions } from '@/components/design/designMeta'
import { useDesignFeature } from '@/components/design/useDesignFeature'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

const STATUS_HEX: Record<string, string> = { draft: '#78716c', sent: '#2563EB', closed: '#16A34A', cancelled: '#a8a29e' }
const RESPONSE_HEX: Record<string, string> = { pending: '#78716c', approved: '#16A34A', approved_with_comments: '#0f766e', rejected: '#DC2626' }
const REV_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', in_review: 'In check', in_approval: 'In approval', approved: 'Approved — awaiting customer', released: 'Released',
  superseded: 'Superseded', customer_rejected: 'Customer rejected',
}
const REV_STATUS_HEX: Record<string, string> = {
  draft: '#78716c', in_review: '#2563EB', in_approval: '#7C3AED', approved: '#0891b2', released: '#16A34A', superseded: '#a8a29e', customer_rejected: '#DC2626',
}
const EVENT_LABELS: Record<string, string> = {
  submission_created: 'prepared the submission', submission_updated: 'edited the submission', submission_sent: 'sent it to the customer',
  customer_response: 'recorded the customer response', submission_cancelled: 'cancelled the submission', letter_attached: 'attached the customer letter',
  comment: 'added a customer comment action', comment_closed: 'closed a customer comment',
}
const EVENT_HEX: Record<string, string> = {
  submission_sent: '#2563EB', customer_response: '#16A34A', submission_cancelled: '#DC2626', letter_attached: '#7C3AED', comment: '#FF6A2A', comment_closed: '#16A34A',
}
const LETTER_ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg,.msg,.eml,.zip'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const primaryBtn: React.CSSProperties = primaryBtnStyle
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }

function pill(label: string, hex: string) {
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{label}</span>
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// A validation failure thrown from a ReasonSheet submit, shaped like an API
// error so extractErrorMessages shows the message itself inside the popup.
const reasonError = (detail: string) => ({ response: { data: { detail } } })

type Panel = 'edit' | 'send' | 'response' | 'add_action' | null

export default function CustomerSubmissionDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('design')
  const router = useRouter()
  const params = useParams()
  const { id, error: linkError } = useRecordId(params.id as string)
  // Role-level features (Design › Reviews & Approvals); buttons follow the server's allowed_actions.
  const designFeature = useDesignFeature()
  const seeActions = designFeature('reviews', 'comment_actions', 'view')
  const addActions = designFeature('reviews', 'comment_actions', 'create')
  const closeActions = designFeature('reviews', 'comment_actions', 'edit')
  const me = useDesignMe(isAuthorized)

  const [sub, setSub] = useState<DesignCustomerSubmissionDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [success, setSuccess] = useState('')
  const [panel, setPanel] = useState<Panel>(null)
  // Errors from the send / response / edit / add-action popups show inside the popup.
  const [panelError, setPanelError] = useState<string | string[]>('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [closing, setClosing] = useState<DesignSubmissionComment | null>(null)
  const letterRef = useRef<HTMLInputElement>(null)

  const [customers, setCustomers] = useState<DesignLookupOption[]>([])
  const [projects, setProjects] = useState<DesignLookupOption[]>([])
  const [machines, setMachines] = useState<DesignLookupOption[]>([])
  const [users, setUsers] = useState<DesignLookupOption[]>([])
  const [awaiting, setAwaiting] = useState<DesignLookupOption[]>([])

  // Edit form
  const [form, setForm] = useState({ customer_id: '', customer_name: '', contact_name: '', contact_email: '', pm_project_id: '', erp_project_id: '', cover_note: '' })
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [search, setSearch] = useState('')
  // Send
  const [sentDate, setSentDate] = useState(todayIso())
  // Response
  const [responseDate, setResponseDate] = useState(todayIso())
  const [remarks, setRemarks] = useState('')
  const [answers, setAnswers] = useState<Record<number, { response: string; comment: string }>>({})
  // Add action
  const [action, setAction] = useState({ document_id: '', comment: '', assigned_to_id: '' })
  // Role "Assign to" rule (Role & Permissions › Design › Reviews & Approvals › Customer comment actions).
  const allowAssignee = useAssigneeFilter('design:reviews.comment_actions')

  useEffect(() => {
    if (!isAuthorized || !id) return
    designApi.getSubmission(id)
      .then(setSub)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the submission.')))
    Promise.all([designApi.lookupCustomers(), designApi.lookupProjects(), designApi.lookupMachines(), designApi.lookupUsers()])
      .then(([c, p, m, u]) => { setCustomers(c); setProjects(p); setMachines(m); setUsers(u) })
      .catch(() => { /* pickers only — the page still works read-only */ })
  }, [isAuthorized, id])

  // Candidate drawings while editing a draft.
  useEffect(() => {
    if (panel !== 'edit') return
    designApi.lookupAwaitingCustomer(form.customer_id ? Number(form.customer_id) : null)
      .then(setAwaiting)
      .catch((err) => setPanelError(extractErrorMessages(err, 'Failed to load the drawings waiting on the customer.')))
  }, [panel, form.customer_id])

  const lineLabels = useMemo(() => {
    const m: Record<number, string> = {}
    for (const l of sub?.lines || []) m[l.revision_id] = `${l.doc_number || 'Drawing'} ${l.revision_label || ''}`.trim()
    for (const a of awaiting) m[a.id] = a.code || a.label
    return m
  }, [sub, awaiting])
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return awaiting.filter((a) => !selectedIds.includes(a.id) && a.label.toLowerCase().includes(q)).slice(0, 8)
  }, [search, awaiting, selectedIds])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><DesignNav /><InvalidRecordLink message={linkError} listHref="/dashboard/design/reviews" listLabel="Back to reviews" /></div>)

  const can = (a: string) => !!sub?.allowed_actions.includes(a)

  // inPanel: the call comes from a popup, so a failure shows inside it and the popup stays open.
  const act = async (fn: () => Promise<DesignCustomerSubmissionDetail>, fallback: string, done: string, inPanel = false) => {
    setBusy(true)
    if (inPanel) setPanelError(''); else setError('')
    setSuccess('')
    try {
      setSub(await fn())
      setSuccess(done)
      if (inPanel) setError('')
      return true
    } catch (err) {
      if (inPanel) setPanelError(extractErrorMessages(err, fallback)); else setError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  const openPanel = (p: Panel) => {
    if (!sub) return
    setPanelError('')
    if (p === panel) { setPanel(null); return }
    if (p === 'edit') {
      setForm({
        customer_id: sub.customer_id ? String(sub.customer_id) : '', customer_name: sub.customer_id ? '' : sub.customer_name,
        contact_name: sub.contact_name || '', contact_email: sub.contact_email || '',
        pm_project_id: sub.pm_project_id ? String(sub.pm_project_id) : '', erp_project_id: sub.erp_project_id ? String(sub.erp_project_id) : '',
        cover_note: sub.cover_note || '',
      })
      setSelectedIds(sub.lines.map((l) => l.revision_id))
      setSearch('')
    }
    if (p === 'send') setSentDate(todayIso())
    if (p === 'response') {
      setResponseDate(todayIso())
      setRemarks('')
      const init: Record<number, { response: string; comment: string }> = {}
      for (const l of sub.lines) if (l.response === 'pending') init[l.id] = { response: '', comment: '' }
      setAnswers(init)
    }
    if (p === 'add_action') setAction({ document_id: sub.lines.length === 1 ? String(sub.lines[0].document_id) : '', comment: '', assigned_to_id: '' })
    setPanel(p)
  }
  const closePanel = () => { if (busy) return; setPanel(null); setPanelError('') }

  const saveEdit = async () => {
    if (!sub) return
    if (!form.customer_id && form.customer_name.trim().length < 2) { setPanelError('Pick the customer, or type the customer name if they are not in the customer list.'); return }
    if (selectedIds.length === 0) { setPanelError('Keep at least one drawing on the submission — or delete the draft instead.'); return }
    const ok = await act(() => designApi.updateSubmission(sub.id, {
      customer_id: form.customer_id ? Number(form.customer_id) : null,
      customer_name: form.customer_id ? null : form.customer_name.trim(),
      contact_name: form.contact_name.trim() || null, contact_email: form.contact_email.trim() || null,
      pm_project_id: form.pm_project_id ? Number(form.pm_project_id) : null, erp_project_id: form.erp_project_id ? Number(form.erp_project_id) : null,
      cover_note: form.cover_note.trim() || null,
      lines: selectedIds.map((rid) => ({ revision_id: rid })),
    }), 'Saving the submission failed.', 'Submission saved.', true)
    if (ok) setPanel(null)
  }

  const send = async () => {
    if (!sub) return
    if (!sentDate) { setPanelError('Pick the date the drawings were sent to the customer.'); return }
    const ok = await act(() => designApi.sendSubmission(sub.id, sentDate), 'Sending failed.', `${sub.submission_number} marked as sent — the customer response is now being tracked against its due date.`, true)
    if (ok) setPanel(null)
  }

  const recordResponse = async () => {
    if (!sub) return
    const lines = Object.entries(answers).filter(([, a]) => a.response)
    if (lines.length === 0) { setPanelError('Pick the customer\'s response for at least one drawing.'); return }
    const missing = lines.filter(([, a]) => a.response !== 'approved' && !a.comment.trim())
    if (missing.length) {
      const names = missing.map(([lid]) => sub.lines.find((l) => l.id === Number(lid))?.doc_number || `line ${lid}`).join(', ')
      setPanelError(`Write the customer's comment for ${names} — a comment is required when the drawing is approved with comments or rejected.`)
      return
    }
    if (!responseDate) { setPanelError('Pick the date the customer responded.'); return }
    const ok = await act(() => designApi.recordSubmissionResponse(sub.id, {
      response_date: responseDate, remarks: remarks.trim() || undefined,
      lines: lines.map(([lid, a]) => ({ line_id: Number(lid), response: a.response, comment: a.comment.trim() || undefined })),
    }), 'Recording the response failed.', 'Customer response recorded — approved drawings can now be released and rejected ones revised.', true)
    if (ok) setPanel(null)
  }

  const addAction = async () => {
    if (!sub) return
    if (action.comment.trim().length < 2) { setPanelError('Write the customer\'s comment that needs action.'); return }
    const ok = await act(() => designApi.addSubmissionComment(sub.id, {
      document_id: action.document_id ? Number(action.document_id) : null,
      comment: action.comment.trim(),
      assigned_to_id: action.assigned_to_id ? Number(action.assigned_to_id) : null,
    }), 'Adding the action failed.', 'Customer comment action added.', true)
    if (ok) setPanel(null)
  }

  // ReasonSheet submits: throw on failure so the reason shows inside the popup.
  const closeAction = async (value: string) => {
    const c = closing
    if (!c) return
    if (value.trim().length < 2) throw reasonError('Say how the customer comment was resolved — e.g. "Revised in R2, gusset thickened".')
    setSuccess('')
    setSub(await designApi.closeSubmissionComment(c.id, value.trim()))
    setError('')
    setSuccess('Customer comment closed.')
    setClosing(null)
  }

  const cancel = async (value: string) => {
    if (!sub) return
    if (value.trim().length < 3) throw reasonError('Give a reason for cancelling the submission (at least 3 characters).')
    setSuccess('')
    setSub(await designApi.cancelSubmission(sub.id, value.trim()))
    setError('')
    setSuccess(`${sub.submission_number} cancelled.`)
    setCancelOpen(false)
  }

  const remove = async () => {
    setConfirmDelete(false)
    if (!sub) return
    setBusy(true)
    try {
      await designApi.deleteSubmission(sub.id)
      router.push('/dashboard/design/reviews')
    } catch (err) {
      setError(extractErrorMessages(err, 'Deleting the submission failed.'))
      setBusy(false)
    }
  }

  const uploadLetter = async (list: FileList | null) => {
    if (!sub || !list || !list.length) return
    const file = list[0]
    await act(() => designApi.uploadSubmissionLetter(sub.id, file), 'Uploading the letter failed.', `${file.name} attached as the customer letter.`)
    if (letterRef.current) letterRef.current.value = ''
  }

  const openLetter = async (download: boolean) => {
    if (!sub) return
    setError('')
    try {
      await openAttachmentBlob(() => designApi.getSubmissionLetter(sub.id, download), download ? sub.letter_file_name || undefined : undefined)
    } catch (err) {
      setError(extractErrorMessages(err, `Couldn't open ${sub.letter_file_name || 'the letter'}.`))
    }
  }

  const canClose = (c: DesignSubmissionComment) => closeActions && c.status === 'open' && (c.assigned_to_id === user?.id || !!me?.is_head || me?.role === 'admin')
  const pendingLines = sub ? sub.lines.filter((l) => l.response === 'pending') : []

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Customer submission</p>
          <h1 data-tour="design-sub-header" style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {sub ? (
              <>
                {sub.submission_number} <span style={{ fontWeight: 500, color: TEXT.secondary }}>— {sub.customer_name}</span>
                {pill(SUBMISSION_STATUS_LABELS[sub.status] || sub.status, STATUS_HEX[sub.status] || '#78716c')}
                {sub.is_overdue && pill('Overdue', '#DC2626')}
              </>
            ) : 'Submission'}
          </h1>
          {sub && (
            <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
              {sub.lines.length} drawing{sub.lines.length === 1 ? '' : 's'}
              {sub.sent_date ? ` · sent ${formatDate(sub.sent_date)}` : ' · not sent yet'}
              {sub.response_due_date ? ` · response due ${formatDate(sub.response_due_date)}` : ''}
              {sub.status === 'sent' ? ` · waiting ${sub.days_waiting} day${sub.days_waiting === 1 ? '' : 's'}` : ''}
            </p>
          )}
        </div>
        <button data-tour="design-sub-back-btn" onClick={() => router.push('/dashboard/design/reviews')} type="button" style={secondaryBtnStyle}>← Back</button>
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
      {sub?.status === 'cancelled' && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          <strong>Cancelled.</strong> {sub.cancel_reason || ''}
        </div>
      )}

      {sub && (
        <>
          <div data-tour="design-sub-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {can('send') && <button data-tour="design-sub-send-btn" disabled={busy} style={primaryBtn} onClick={() => openPanel('send')}>Send to Customer</button>}
            {can('record_response') && <button data-tour="design-sub-response-btn" disabled={busy} style={primaryBtn} onClick={() => openPanel('response')}>Record Customer Response</button>}
            {can('edit') && <button data-tour="design-sub-edit-btn" disabled={busy} style={secondaryBtnStyle} onClick={() => openPanel('edit')}>Edit</button>}
            {can('cancel') && <button data-tour="design-sub-cancel-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setCancelOpen(true)}>Cancel Submission</button>}
            {can('delete') && <button data-tour="design-sub-delete-btn" disabled={busy} style={dangerBtnStyle} onClick={() => setConfirmDelete(true)}>Delete Draft</button>}
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '2 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div data-tour="design-sub-drawings" style={sectionStyle}>
                <p style={sectionTitle}>Drawings</p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                    <thead>
                      <tr>{['Drawing', 'Title', 'Rev', 'Revision status', 'Customer response', 'Comment'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {sub.lines.map((l) => (
                        <tr key={l.id} onClick={() => router.push(recordPath('/dashboard/design/documents', l, 'document_id'))} style={{ cursor: 'pointer' }}>
                          <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: 'nowrap' }}>{l.doc_number || '—'}</td>
                          <td style={{ ...tdStyle, maxWidth: 240 }}>{l.title || '—'}</td>
                          <td style={{ ...tdStyle, fontWeight: 700 }}>{l.revision_label || '—'}</td>
                          <td style={tdStyle}>{l.revision_status ? pill(REV_STATUS_LABELS[l.revision_status] || l.revision_status, REV_STATUS_HEX[l.revision_status] || '#78716c') : '—'}</td>
                          <td style={tdStyle}>{pill(CUSTOMER_RESPONSE_LABELS[l.response] || l.response, RESPONSE_HEX[l.response] || '#78716c')}</td>
                          <td style={{ ...tdStyle, maxWidth: 260, whiteSpace: 'pre-wrap' }}>{l.response_comment || '—'}</td>
                        </tr>
                      ))}
                      {sub.lines.length === 0 && (
                        <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No drawings on this submission.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {seeActions && (<div data-tour="design-sub-comments" style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                  <p style={{ ...sectionTitle, margin: 0, flex: 1 }}>Customer comment actions</p>
                  {!!me?.is_team && addActions && sub.status !== 'draft' && sub.status !== 'cancelled' && panel !== 'add_action' && (
                    <button type="button" data-tour="design-sub-add-action-btn" style={{ ...smallSecondaryBtnStyle }} onClick={() => openPanel('add_action')}>+ Add action</button>
                  )}
                </div>
                {sub.comments.length === 0 ? (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No customer comments logged as actions.</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
                      <thead>
                        <tr>{['Comment', 'Drawing', 'Assigned to', 'Status', 'Resolution', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {sub.comments.map((c) => (
                          <tr key={c.id}>
                            <td style={{ ...tdStyle, maxWidth: 280, whiteSpace: 'pre-wrap' }}>{c.comment}<div style={{ fontSize: 11, color: TEXT.muted }}>{formatDate(c.created_at)}</div></td>
                            <td style={tdStyle}>
                              {c.document_id ? (
                                <span onClick={() => router.push(recordPath('/dashboard/design/documents', c, 'document_id'))} style={{ color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>{c.doc_number || 'Drawing'}</span>
                              ) : '—'}
                            </td>
                            <td style={tdStyle}>{c.assigned_to_name || '—'}</td>
                            <td style={tdStyle}>{c.status === 'open' ? pill('Open', '#F59E0B') : pill('Done', '#16A34A')}</td>
                            <td style={{ ...tdStyle, maxWidth: 240, whiteSpace: 'pre-wrap' }}>
                              {c.resolution || '—'}
                              {c.closed_at && <div style={{ fontSize: 11, color: TEXT.muted }}>{c.closed_by_name || '—'} · {formatDate(c.closed_at)}</div>}
                            </td>
                            <td style={tdStyle}>
                              {canClose(c) && (
                                <button type="button" disabled={busy} style={{ ...smallSecondaryBtnStyle }} onClick={() => setClosing(c)}>Close</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>)}
            </div>

            <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div data-tour="design-sub-details" style={sectionStyle}>
                <p style={sectionTitle}>Details</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <InfoRow label="Customer" value={sub.customer_name} />
                  <InfoRow label="Contact" value={[sub.contact_name, sub.contact_email].filter(Boolean).join(' · ') || '—'} />
                  <InfoRow label="Project" value={sub.pm_project_label || '—'} />
                  <InfoRow label="Machine" value={sub.erp_project_label || '—'} />
                  {sub.cover_note && <InfoRow label="Cover note" value={sub.cover_note} />}
                  <InfoRow label="Prepared by" value={`${sub.created_by_name || '—'} · ${formatDate(sub.created_at)}`} />
                  <InfoRow label="Sent" value={formatDate(sub.sent_date)} />
                  <InfoRow label="Response due" value={sub.response_due_date ? `${formatDate(sub.response_due_date)}${sub.is_overdue ? ' — overdue' : ''}` : '—'} />
                  <InfoRow label="Customer responded" value={sub.response_date ? `${formatDate(sub.response_date)}${sub.turnaround_days != null ? ` (${sub.turnaround_days} days)` : ''}` : '—'} />
                  {sub.response_remarks && <InfoRow label="Response remarks" value={sub.response_remarks} />}
                </div>
              </div>

              <div data-tour="design-sub-letter" style={sectionStyle}>
                <p style={sectionTitle}>Customer letter</p>
                {sub.letter_file_name ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.55)', flexWrap: 'wrap', marginBottom: 10 }}>
                    <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.letter_file_name}</p>
                      <p style={{ fontSize: 11.5, color: TEXT.muted, margin: 0 }}>{formatBytes(sub.letter_size)}</p>
                    </div>
                    <button type="button" style={{ ...smallSecondaryBtnStyle }} onClick={() => openLetter(false)}>Open</button>
                    <button type="button" style={{ ...smallSecondaryBtnStyle }} onClick={() => openLetter(true)}>Download</button>
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 10px' }}>No customer letter attached.</p>
                )}
                {can('upload_letter') && (
                  <div>
                    <label style={labelStyle}>{busy ? 'Uploading…' : sub.letter_file_name ? 'Replace letter' : 'Upload the customer\'s letter'}</label>
                    <input ref={letterRef} type="file" accept={LETTER_ACCEPT} disabled={busy} style={inputStyle} onChange={(e) => uploadLetter(e.target.files)} />
                  </div>
                )}
              </div>

              <div data-tour="design-sub-timeline" style={sectionStyle}>
                <p style={sectionTitle}>Timeline</p>
                <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 520, overflowY: 'auto' }}>
                  {sub.events.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No activity yet.</p>}
                  {sub.events.map((e) => (
                    <div key={e.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: `1px solid ${BORDER.light}` }}>
                      <span style={{ width: 8, height: 8, borderRadius: 9999, marginTop: 6, flex: 'none', background: EVENT_HEX[e.action] || '#a8a29e' }} />
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 12.5, color: TEXT.body, margin: 0 }}>
                          <strong>{e.actor_name || 'System'}</strong> {EVENT_LABELS[e.action] || e.action.replace(/_/g, ' ')}
                          {e.doc_number ? <span style={{ color: TEXT.muted }}> · {e.doc_number}{e.revision_label ? ` ${e.revision_label}` : ''}</span> : null}
                        </p>
                        {e.comment && <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '2px 0 0', whiteSpace: 'pre-wrap' }}>{e.comment}</p>}
                        <p style={{ fontSize: 11, color: TEXT.muted, margin: '2px 0 0' }}>{formatDateTime(e.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {sub && panel === 'send' && (
        <FormSheet width={580} tour="design-sub-send-panel" icon="send" title={`Send ${sub.submission_number} to the customer`}
          subtitle={`${sub.customer_name} — the drawing list is locked once sent.`}
          onClose={closePanel} busy={busy}
          footer={<>
            <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={closePanel}>Cancel</button>
            <button type="button" data-tour="design-sub-send-save-btn" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={send}><SheetIcon name="send" size={16} />{busy ? 'Saving…' : 'Mark as Sent'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={panelError} />
            <SheetSection icon="calendar" title="Dispatch">
              <div data-tour="design-sub-sent-date" style={{ maxWidth: 200 }}>
                <label style={sheetLabel}>Sent date <Req /></label>
                <DateField value={sentDate} onChange={setSentDate} />
              </div>
              <p style={sheetHint}>The response due date is the sent date plus the customer response days set in Design Settings.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {sub && panel === 'response' && (
        <FormSheet width={880} tour="design-sub-response-panel" icon="chat" title="Record customer response"
          subtitle={`${sub.submission_number} — ${sub.customer_name}. Drawings left on “No response yet” stay pending.`}
          onClose={closePanel} busy={busy}
          footer={<>
            <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={closePanel}>{pendingLines.length === 0 ? 'Close' : 'Cancel'}</button>
            {pendingLines.length > 0 && (
              <button type="button" data-tour="design-sub-response-save-btn" disabled={busy} style={sheetBtn('primary', '#16a34a', busy)} onClick={recordResponse}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Record Response'}</button>
            )}
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={panelError} />
            {pendingLines.length === 0 ? (
              <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Every drawing already has a response.</p>
            ) : (
              <>
                <SheetSection icon="doc" title="Response per drawing">
                  <div data-tour="design-sub-response-lines" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {pendingLines.map((l) => {
                      const a = answers[l.id] || { response: '', comment: '' }
                      const set = (patch: Partial<{ response: string; comment: string }>) => setAnswers((prev) => ({ ...prev, [l.id]: { ...a, ...patch } }))
                      return (
                        <div key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', borderRadius: 10, border: `1px solid ${SHEET.LINE}`, background: SHEET.SOFT }}>
                          <span style={{ flex: '0 1 240px', fontSize: 13, fontWeight: 600, color: SHEET.INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {l.doc_number} {l.revision_label} <span style={{ fontWeight: 400, color: SHEET.MUTED }}>— {l.title}</span>
                          </span>
                          <Select style={{ ...sheetInput, flex: '0 1 210px', width: undefined, padding: '7px 10px' }} value={a.response} onChange={(e) => set({ response: e.target.value })}>
                            <option value="">No response yet</option>
                            <option value="approved">{CUSTOMER_RESPONSE_LABELS.approved}</option>
                            <option value="approved_with_comments">{CUSTOMER_RESPONSE_LABELS.approved_with_comments}</option>
                            <option value="rejected">{CUSTOMER_RESPONSE_LABELS.rejected}</option>
                          </Select>
                          <input style={{ ...sheetInput, flex: '1 1 240px', width: undefined, padding: '7px 10px' }} value={a.comment} onChange={(e) => set({ comment: e.target.value })}
                            placeholder={a.response && a.response !== 'approved' ? 'Customer comment (required)' : 'Customer comment (optional)'} />
                        </div>
                      )
                    })}
                  </div>
                  <p style={sheetHint}>A rejection freezes that revision — start the next revision from the drawing.</p>
                </SheetSection>
                <SheetSection icon="calendar" title="Response">
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <div data-tour="design-sub-response-date" style={{ flex: '0 1 180px', minWidth: 160 }}>
                      <label style={sheetLabel}>Response date <Req /></label>
                      <DateField value={responseDate} onChange={setResponseDate} />
                    </div>
                    <div data-tour="design-sub-response-remarks" style={{ flex: '1 1 300px', maxWidth: 560 }}>
                      <label style={sheetLabel}>Remarks <Optional /></label>
                      <input style={sheetInput} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Letter ref. RDSO/MP/2026/114" />
                    </div>
                  </div>
                </SheetSection>
              </>
            )}
          </div>
        </FormSheet>
      )}

      {sub && panel === 'edit' && (
        <FormSheet width={960} tour="design-sub-edit-panel" icon="edit" title={`Edit ${sub.submission_number}`}
          subtitle="Draft transmittal — change the customer, links, cover note or the drawing list before it is sent."
          onClose={closePanel} busy={busy}
          footer={<>
            <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={closePanel}>Cancel</button>
            <button type="button" data-tour="design-sub-edit-save-btn" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={saveEdit}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}</button>
          </>}>
          <SheetColumns
            left={<>
              <SheetError error={panelError} />
              <SheetSection icon="building" title="Customer">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ flex: '1 1 240px', maxWidth: 380 }}>
                    <label style={sheetLabel}>Customer <Req /></label>
                    <SearchableSelect value={form.customer_id} onChange={(v) => setForm({ ...form, customer_id: v })} options={toOptions(customers, 'Not in the customer list')} placeholder="Select customer…" />
                  </div>
                  {!form.customer_id && (
                    <div style={{ flex: '1 1 220px', maxWidth: 340 }}>
                      <label style={sheetLabel}>Customer name <Req /></label>
                      <input style={sheetInput} value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} maxLength={255} />
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
                  <div style={{ flex: '1 1 200px', maxWidth: 300 }}>
                    <label style={sheetLabel}>Contact name <Optional /></label>
                    <input style={sheetInput} value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} maxLength={255} />
                  </div>
                  <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
                    <label style={sheetLabel}>Contact email <Optional /></label>
                    <input type="email" style={sheetInput} value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} maxLength={255} />
                  </div>
                </div>
              </SheetSection>
              <SheetSection icon="doc" title="Drawings" extra={<Req />}>
                {selectedIds.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {selectedIds.map((rid) => (
                      <span key={rid} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 9999, background: '#eff6ff', color: SHEET.BLUE, fontSize: 12, fontWeight: 600 }}>
                        {lineLabels[rid] || `Revision #${rid}`}
                        <span onClick={() => setSelectedIds((prev) => prev.filter((x) => x !== rid))} style={{ cursor: 'pointer', fontSize: 14, lineHeight: 1 }} aria-label="Remove drawing">×</span>
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ position: 'relative', maxWidth: 520 }}>
                  <input style={sheetInput} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search approved drawings waiting on the customer to add…" />
                  {matches.length > 0 && (
                    <AnchoredDropdown style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, borderRadius: 10, border: `1px solid ${SHEET.LINE}`, background: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
                      {matches.map((a) => (
                        <div key={a.id} onClick={() => { setSelectedIds((prev) => [...prev, a.id]); setSearch('') }}
                          style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderTop: `1px solid ${SHEET.LINE}` }}>
                          {a.label}
                        </div>
                      ))}
                    </AnchoredDropdown>
                  )}
                </div>
              </SheetSection>
            </>}
            right={<>
              <SheetSection icon="link" title="Links" extra={<Optional />}>
                <div style={{ marginBottom: 12 }}>
                  <label style={sheetLabel}>Project</label>
                  <SearchableSelect value={form.pm_project_id} onChange={(v) => setForm({ ...form, pm_project_id: v })} options={toOptions(projects, 'None')} placeholder="Select project…" />
                </div>
                <div>
                  <label style={sheetLabel}>Machine</label>
                  <SearchableSelect value={form.erp_project_id} onChange={(v) => setForm({ ...form, erp_project_id: v })} options={toOptions(machines, 'None')} placeholder="Select machine…" />
                </div>
              </SheetSection>
              <SheetSection icon="chat" title="Cover note" extra={<Optional />}>
                <textarea style={{ ...sheetInput, minHeight: 100, resize: 'vertical' }} value={form.cover_note} onChange={(e) => setForm({ ...form, cover_note: e.target.value })} maxLength={8000} />
              </SheetSection>
            </>}
          />
        </FormSheet>
      )}

      {sub && panel === 'add_action' && (
        <FormSheet width={640} tour="design-sub-action-panel" icon="flag" title="Add customer comment action"
          subtitle={`${sub.submission_number} — log a customer comment that needs work, and who does it.`}
          onClose={closePanel} busy={busy}
          footer={<>
            <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={closePanel}>Cancel</button>
            <button type="button" data-tour="design-sub-action-save-btn" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={addAction}><SheetIcon name="plus" size={16} />{busy ? 'Saving…' : 'Add Action'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={panelError} />
            <SheetSection icon="chat" title="Comment">
              <div data-tour="design-sub-action-comment">
                <label style={sheetLabel}>Customer comment <Req /></label>
                <textarea style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={action.comment} onChange={(e) => setAction({ ...action, comment: e.target.value })} maxLength={8000}
                  placeholder="e.g. Show weld symbol on section B-B" autoFocus />
              </div>
            </SheetSection>
            <SheetSection icon="user" title="Drawing & assignee" extra={<Optional />}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div data-tour="design-sub-action-drawing" style={{ flex: '1 1 220px' }}>
                  <label style={sheetLabel}>Drawing</label>
                  <Select style={sheetInput} value={action.document_id} onChange={(e) => setAction({ ...action, document_id: e.target.value })}>
                    <option value="">Whole submission</option>
                    {sub.lines.map((l) => <option key={l.id} value={l.document_id}>{l.doc_number} {l.revision_label} — {l.title}</option>)}
                  </Select>
                </div>
                <div data-tour="design-sub-action-assignee" style={{ flex: '1 1 220px' }}>
                  <label style={sheetLabel}>Assigned to</label>
                  <SearchableSelect value={action.assigned_to_id} onChange={(v) => setAction({ ...action, assigned_to_id: v })} options={toOptions(users.filter((u) => allowAssignee(u.id)), 'Not assigned')} placeholder="Select designer…" />
                </div>
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this draft submission?"
        message={`${sub?.submission_number || 'The draft'} is deleted. The drawings stay approved and waiting on the customer.`}
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
      {sub && cancelOpen && (
        <ReasonSheet
          open
          icon="x"
          iconColor={DANGER_RED}
          title={`Cancel ${sub.submission_number}`}
          subtitle="The submission is kept on record as cancelled. Its drawings go back to waiting on the customer."
          label="Reason"
          requireValue
          requiredMessage="Give a reason for cancelling the submission (at least 3 characters)."
          placeholder="Reason…"
          confirmLabel="Cancel Submission"
          errorFallback="Cancelling failed."
          onConfirm={cancel}
          onCancel={() => setCancelOpen(false)}
        />
      )}
      {closing && (
        <ReasonSheet
          open
          icon="check"
          iconColor="#16a34a"
          title="Close customer comment"
          subtitle={`“${closing.comment.slice(0, 160)}${closing.comment.length > 160 ? '…' : ''}” — say how it was resolved.`}
          label="Resolution"
          requireValue
          requiredMessage='Say how the customer comment was resolved — e.g. "Revised in R2, gusset thickened".'
          placeholder="Resolution — e.g. revised in R2, weld symbol added"
          confirmLabel="Close Comment"
          errorFallback="Closing the comment failed."
          onConfirm={closeAction}
          onCancel={() => setClosing(null)}
        />
      )}
    </div>
  )
}
