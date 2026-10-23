'use client'

import { Fragment, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignLookupOption, DesignMyTasks, DesignRequestDeliverable, DesignTaskItem, DesignWorkTask } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { PRIORITY_LABELS, toOptions } from '@/components/design/designMeta'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { recordPath } from '@/lib/recordRef'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18, flex: '1 1 440px', minWidth: 0,
}
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '10px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }

const PM_STATUS_LABELS: Record<string, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled' }
const PM_STATUS_HEX: Record<string, string> = { todo: '#78716c', in_progress: '#2563EB', blocked: '#DC2626', done: '#16A34A', cancelled: '#a8a29e' }
// Deliverable status = drawing display_status or BOM display status.
const DELIV_LABELS: Record<string, string> = {
  draft: 'Draft', in_review: 'In check', in_approval: 'In approval', approved: 'Awaiting customer', released: 'Released',
  revising: 'Released · revising', obsolete: 'Obsolete', customer_rejected: 'Customer rejected', superseded: 'Superseded',
}
const DELIV_HEX: Record<string, string> = {
  draft: '#78716c', in_review: '#2563EB', in_approval: '#7C3AED', approved: '#0891B2', released: '#16A34A',
  revising: '#0f766e', obsolete: '#DC2626', customer_rejected: '#B91C1C', superseded: '#a8a29e',
}

const GROUPS: { key: keyof DesignMyTasks; title: string; hint: string; hex: string; empty: string }[] = [
  { key: 'to_review', title: 'Drawings to check', hint: 'You are the named checker', hex: '#2563EB', empty: 'No drawing revisions are waiting for your check.' },
  { key: 'to_approve', title: 'Drawings to approve', hint: 'Checked, waiting for your approval', hex: '#7C3AED', empty: 'No drawing revisions are waiting for your approval.' },
  { key: 'returned_to_me', title: 'Drawings returned to me', hint: 'Fix and resubmit', hex: '#DC2626', empty: 'No drawings have been returned to you.' },
  { key: 'to_release', title: 'Ready to release', hint: 'Customer approved — release the revision', hex: '#16A34A', empty: 'No customer-approved revisions are waiting for release.' },
  { key: 'boms_to_review', title: 'BOMs to check', hint: 'You are the named checker', hex: '#2563EB', empty: 'No BOM revisions are waiting for your check.' },
  { key: 'boms_to_approve', title: 'BOMs to approve', hint: 'Checked, waiting for your release', hex: '#7C3AED', empty: 'No BOM revisions are waiting for your approval.' },
  { key: 'boms_returned_to_me', title: 'BOMs returned to me', hint: 'Fix and resubmit', hex: '#DC2626', empty: 'No BOMs have been returned to you.' },
  { key: 'customer_comments', title: 'Customer comments', hint: 'Assigned to you — close with a resolution', hex: '#0891B2', empty: 'No open customer comments are assigned to you.' },
  { key: 'ecrs_to_vote', title: 'Change requests to vote on', hint: 'You are on the change board', hex: '#F59E0B', empty: 'No change requests are waiting for your vote.' },
  { key: 'ecrs_to_decide', title: 'Change requests to progress', hint: 'Impact check or final decision (Design head)', hex: '#b45309', empty: 'No change requests are waiting on you.' },
  { key: 'ecns_to_approve', title: 'Change notices to decide', hint: 'You are the named approver', hex: '#F59E0B', empty: 'No change notices are waiting for your decision.' },
  { key: 'ecns_to_implement', title: 'Change notices to release', hint: 'Open — release once every affected drawing/BOM is released', hex: '#0f766e', empty: 'No open change notices of yours.' },
  { key: 'ecns_to_acknowledge', title: 'Change notices to acknowledge', hint: 'For your department', hex: '#0f766e', empty: 'No change notices are waiting for your department’s acknowledgement.' },
  { key: 'my_drafts', title: 'My drafts', hint: 'Not yet submitted', hex: '#78716c', empty: 'You have no draft revisions.' },
]
const ACTION_KEYS: (keyof DesignMyTasks)[] = [
  'to_review', 'to_approve', 'returned_to_me', 'to_release', 'boms_to_review', 'boms_to_approve', 'boms_returned_to_me',
  'customer_comments', 'ecrs_to_vote', 'ecrs_to_decide', 'ecns_to_approve', 'ecns_to_acknowledge',
]

function taskHref(t: DesignTaskItem) {
  if (t.link) return t.link
  return t.kind.startsWith('ecn') ? recordPath('/dashboard/design/change-notices', t, 'ecn_id') : recordPath('/dashboard/design/documents', t, 'document_id')
}

function taskRef(t: DesignTaskItem) {
  if (t.kind.startsWith('bom')) return `${t.bom_number || 'BOM'} ${t.revision_label || ''}`.trim()
  if (t.kind.startsWith('ecr')) return t.ecr_number || 'ECR'
  if (t.kind.startsWith('ecn')) return t.ecn_number || 'ECN'
  if (t.kind === 'customer_comment') return t.comment || 'Customer comment'
  return `${t.doc_number} ${t.revision_label}`
}

function delivHref(d: DesignRequestDeliverable) {
  return d.kind === 'bom' ? recordPath('/dashboard/design/boms', d) : recordPath('/dashboard/design/documents', d)
}

function smallPill(label: string, hex: string) {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{label}</span>
  )
}

type LinkForm = { kind: 'document' | 'bom'; id: string }

export default function DesignTasksPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const router = useRouter()
  const [tasks, setTasks] = useState<DesignMyTasks | null>(null)
  const [work, setWork] = useState<DesignWorkTask[] | null>(null)
  const [includeDone, setIncludeDone] = useState(false)
  const [documents, setDocuments] = useState<DesignLookupOption[]>([])
  const [boms, setBoms] = useState<DesignLookupOption[]>([])
  const [linkFor, setLinkFor] = useState<number | null>(null)
  const [linkForm, setLinkForm] = useState<LinkForm>({ kind: 'document', id: '' })
  const [unlink, setUnlink] = useState<{ linkId: number; label: string; task: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [linkError, setLinkError] = useState<string | string[]>('')
  const [error, setError] = useState<string | string[]>('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    designApi.getMyTasks()
      .then(setTasks)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load your review and approval queue.')))
    Promise.all([designApi.lookupDocuments(), designApi.lookupBoms(false)])
      .then(([d, b]) => { setDocuments(d); setBoms(b) })
      .catch(() => { /* pickers only — linking shows its own error */ })
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    designApi.getMyWork(includeDone)
      .then(setWork)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load your project tasks.')))
  }, [isAuthorized, includeDone])

  if (isLoading || !isAuthorized) return null

  const reloadWork = async () => setWork(await designApi.getMyWork(includeDone))

  const doLink = async (task: DesignWorkTask) => {
    if (!linkForm.id) { setLinkError(`Pick a ${linkForm.kind === 'bom' ? 'BOM' : 'drawing'} to link to “${task.title}”.`); return }
    setBusy(true); setLinkError(''); setError(''); setSuccess('')
    try {
      await designApi.linkDeliverable({
        pm_task_id: task.task_id,
        document_id: linkForm.kind === 'document' ? Number(linkForm.id) : null,
        bom_id: linkForm.kind === 'bom' ? Number(linkForm.id) : null,
      })
      await reloadWork()
      setSuccess(`Deliverable linked to “${task.title}”.`)
      setLinkFor(null)
      setLinkForm({ kind: 'document', id: '' })
    } catch (err) {
      setLinkError(extractErrorMessages(err, 'Linking the deliverable failed.'))
    } finally {
      setBusy(false)
    }
  }

  const doUnlink = async () => {
    const target = unlink
    setUnlink(null)
    if (!target) return
    setBusy(true); setError(''); setSuccess('')
    try {
      await designApi.unlinkDeliverable(target.linkId)
      await reloadWork()
      setSuccess(`${target.label} unlinked from “${target.task}”.`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Unlinking the deliverable failed.'))
    } finally {
      setBusy(false)
    }
  }

  const open = (t: DesignTaskItem) => router.push(taskHref(t))
  const linkTask = linkFor !== null ? (work || []).find((t) => t.task_id === linkFor) || null : null
  const openLink = (taskId: number) => { setLinkFor(taskId); setLinkForm({ kind: 'document', id: '' }); setLinkError('') }
  const total = tasks ? ACTION_KEYS.reduce((n, k) => n + (tasks[k] || []).length, 0) : 0
  const overdueWork = work ? work.filter((t) => t.is_overdue).length : 0

  return (
    <div>
      <DesignNav />

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design Module</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>My Work</h1>
        <p data-tour="design-tasks-summary" style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
          {work ? `${work.length} project task${work.length === 1 ? '' : 's'}${overdueWork ? ` (${overdueWork} overdue)` : ''}` : ''}
          {work && tasks ? ' · ' : ''}
          {tasks ? (total ? `${total} review/approval item${total === 1 ? '' : 's'} need your action.` : 'No reviews or approvals waiting on you.') : ''}
        </p>
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

      {/* My project tasks (Project Management) with their design deliverables */}
      <div data-tour="design-tasks-work" style={{ ...sectionStyle, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#FF6A2A', margin: 0 }}>My project tasks</p>
          {work && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: '#FF6A2A1a', color: '#FF6A2A' }}>{work.length}</span>}
          <span style={{ fontSize: 12, color: TEXT.muted, flex: 1 }}>Tasks assigned to you in Project Management — link the drawings and BOMs that deliver each one.</span>
          <label data-tour="design-tasks-include-done" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.secondary, cursor: 'pointer' }}>
            <input type="checkbox" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} /> Show closed tasks
          </label>
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>
          When every linked deliverable is released the task shows “Ready to close” — close the task itself in Project Management.
        </p>
        {work === null ? (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
        ) : work.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No {includeDone ? '' : 'open '}Project Management tasks are assigned to you.</p>
        ) : (
          <div data-tour="design-tasks-work-table" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr>{['Project / WBS', 'Task', 'Due', 'Status', 'Deliverables', ''].map((h, i) => <th key={`${h}-${i}`} style={thStyle}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {work.map((t) => {
                  const pmHex = PM_STATUS_HEX[t.status] || '#78716c'
                  return (
                    <Fragment key={t.task_id}>
                      <tr>
                        <td style={{ ...tdStyle, maxWidth: 220 }}>
                          <div style={{ fontWeight: 600, color: TEXT.heading }}>{t.project_label || `Project #${t.project_id}`}</div>
                          {t.milestone_title && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{t.milestone_title}</div>}
                        </td>
                        <td style={{ ...tdStyle, maxWidth: 280 }}>
                          <div style={{ fontWeight: 600, color: TEXT.heading }}>{t.title}</div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                            {t.priority && t.priority !== 'medium' && smallPill(PRIORITY_LABELS[t.priority] || t.priority, t.priority === 'urgent' || t.priority === 'high' ? '#DC2626' : '#78716c')}
                            {t.requirement_changed && smallPill('⚠ Requirement changed', '#b45309')}
                            {t.ready_to_close && smallPill('✓ Ready to close in Project Management', '#16A34A')}
                          </div>
                        </td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: t.is_overdue ? '#DC2626' : TEXT.body, fontWeight: t.is_overdue ? 700 : 400 }}>
                          {t.due_date ? formatDate(t.due_date) : '—'}
                          {t.is_overdue && <div style={{ fontSize: 11 }}>overdue</div>}
                        </td>
                        <td style={tdStyle}>{smallPill(PM_STATUS_LABELS[t.status] || t.status, pmHex)}</td>
                        <td style={{ ...tdStyle, minWidth: 280 }}>
                          {t.deliverables.length === 0 ? (
                            <span style={{ color: TEXT.muted }}>None linked yet</span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {t.deliverables.map((d, idx) => {
                                const linkId = t.link_ids[idx]
                                const hex = DELIV_HEX[d.status] || '#78716c'
                                return (
                                  <div key={`${d.kind}-${d.id}`} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <span onClick={() => router.push(delivHref(d))} title={d.title} style={{ fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>
                                      {d.kind === 'bom' ? 'BOM ' : ''}{d.number}
                                    </span>
                                    {smallPill(DELIV_LABELS[d.status] || d.status.replace(/_/g, ' '), hex)}
                                    <span style={{ fontSize: 11.5, color: TEXT.muted }}>{d.released_revision_label ? `rel. ${d.released_revision_label}` : 'not released'}</span>
                                    {linkId !== undefined && (
                                      <button type="button" disabled={busy} onClick={() => setUnlink({ linkId, label: d.number, task: t.title })}
                                        style={{ border: 'none', background: 'transparent', color: '#DC2626', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, padding: 0 }}>
                                        Unlink
                                      </button>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                          <button type="button" disabled={busy} style={{ ...secondaryBtnStyle, padding: '5px 12px', fontSize: 12 }}
                            onClick={() => openLink(t.task_id)}>
                            + Link deliverable
                          </button>
                        </td>
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }}>Reviews, approvals &amp; changes</p>
      {!tasks && !error && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>}
      {tasks && (
        <div data-tour="design-tasks-queues" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          {GROUPS.map((g) => {
            const rows = tasks[g.key] || []
            return (
              <div key={g.key} data-tour={`design-tasks-group-${g.key}`} style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: g.hex, margin: 0 }}>{g.title}</p>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: `${g.hex}1a`, color: g.hex }}>{rows.length}</span>
                  <span style={{ fontSize: 12, color: TEXT.muted }}>{g.hint}</span>
                </div>
                {rows.length === 0 ? (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{g.empty}</p>
                ) : (
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    {rows.map((t, i) => (
                      <div key={`${t.kind}-${t.revision_id ?? t.bom_id ?? t.ecr_id ?? t.ecn_id ?? t.submission_id}-${i}`} onClick={() => open(t)}
                        style={{ padding: '10px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <p style={{ flex: 1, fontSize: 13, fontWeight: 600, color: TEXT.heading, margin: 0 }}>
                            {taskRef(t)}
                            <span style={{ fontWeight: 400, color: TEXT.secondary }}> — {t.title}</span>
                          </p>
                          <span style={{ fontSize: 11.5, color: t.days_waiting >= 7 ? '#DC2626' : TEXT.muted, whiteSpace: 'nowrap', fontWeight: t.days_waiting >= 7 ? 700 : 400 }}>
                            {t.days_waiting === 0 ? 'today' : `${t.days_waiting} day${t.days_waiting === 1 ? '' : 's'}`}
                          </span>
                        </div>
                        <p style={{ fontSize: 12, color: TEXT.muted, margin: '2px 0 0' }}>
                          {t.author_name ? `by ${t.author_name}` : ''}{t.since ? `${t.author_name ? ' · ' : ''}since ${formatDate(t.since)}` : ''}
                        </p>
                        {t.comment && t.kind !== 'customer_comment' && (
                          <p style={{ fontSize: 12.5, color: t.kind === 'release' ? '#15803d' : '#b91c1c', margin: '4px 0 0' }}>“{t.comment}”</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {linkTask && (
        <FormSheet width={580} icon="link" title="Link a deliverable" busy={busy} onClose={() => setLinkFor(null)}
          subtitle={`${linkTask.title}${linkTask.project_label ? ` · ${linkTask.project_label}` : ''}`}
          footer={<>
            <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => setLinkFor(null)}>Cancel</button>
            <button type="button" data-tour="design-tasks-link-btn" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={() => doLink(linkTask)}>
              <SheetIcon name="link" size={16} />{busy ? 'Linking…' : 'Link'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={linkError} />
            <SheetSection icon="doc" title="Deliverable">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '0 1 130px', minWidth: 120 }}>
                  <label style={sheetLabel}>Type <Req /></label>
                  <select data-tour="design-tasks-link-kind" style={sheetInput} value={linkForm.kind}
                    onChange={(e) => setLinkForm({ kind: e.target.value as LinkForm['kind'], id: '' })}>
                    <option value="document">Drawing</option>
                    <option value="bom">BOM</option>
                  </select>
                </div>
                <div data-tour="design-tasks-link-pick" style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <label style={sheetLabel}>{linkForm.kind === 'bom' ? 'BOM' : 'Drawing'} <Req /></label>
                  <SearchableSelect value={linkForm.id} onChange={(v) => setLinkForm({ ...linkForm, id: v })}
                    options={linkForm.kind === 'bom'
                      ? boms.map((b) => ({ value: String(b.id), label: `${b.label}${b.extra ? ` (${b.extra})` : ''}` }))
                      : toOptions(documents)}
                    placeholder={linkForm.kind === 'bom' ? 'Select BOM…' : 'Select drawing…'} />
                </div>
              </div>
              <p style={sheetHint}>The deliverable shows against the task with its live status. When every linked deliverable is released the task shows “Ready to close”.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <ConfirmDialog
        open={unlink !== null}
        title="Unlink this deliverable?"
        message={unlink ? `${unlink.label} will no longer count towards “${unlink.task}”. The drawing/BOM itself is not changed.` : ''}
        confirmLabel="Unlink"
        danger
        onConfirm={doUnlink}
        onCancel={() => setUnlink(null)}
      />
    </div>
  )
}
