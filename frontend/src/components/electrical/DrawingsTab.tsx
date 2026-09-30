'use client'

// Drawings tab of an Electrical job — the revision-controlled drawing register
// behind the Electrical Schematics, Electrical Drawing / Revision and As-Built
// Electrical Records stages. Each drawing carries R0, R1 … revisions that go
// draft → submitted → approved / rejected; files stream through the backend.
import { useEffect, useRef, useState } from 'react'
import { electricalApi } from '@/lib/api'
import { ElectricalDrawing, ElectricalDrawingRevision, ElectricalJobDetail, ElectricalMeta } from '@/types'
import { useAuth } from '@/hooks/useAuth'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'
import { TEXT, BORDER, DANGER } from '@/lib/theme'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import {
  inputStyle, sectionStyle, sectionTitle, thStyle, tdStyle, primaryBtn, smallBtn, smallDangerBtn, linkStyle,
  tableWrap, mutedText, pill, Pill, ErrorBanner, NoticeBanner, Modal, F, rowStyle,
  REVISION_STATUS_LABELS, REVISION_STATUS_HEX, fmtBytes, openBlob, strOrNull,
} from '@/components/electrical/shared'

const DRAWING_ACCEPT = '.pdf,.dwg,.dxf,.png,.jpg,.jpeg'

type Confirm = { title: string; message: string; confirmLabel: string; danger: boolean; run: () => Promise<unknown>; fallback: string; notice: string }
type Decision = { kind: 'approve' | 'reject'; drawing: ElectricalDrawing; rev: ElectricalDrawingRevision }

const emptyAdd = { title: '', drawing_type: 'schematic', drawing_number: '', is_as_built: false, description: '', change_summary: 'First issue' }
type EditForm = { drawing_number: string; title: string; drawing_type: string; is_as_built: boolean; description: string }

export default function DrawingsTab({ job, meta, canEdit, onChanged }: { job: ElectricalJobDetail; meta: ElectricalMeta; canEdit: boolean; onChanged: () => void }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [drawings, setDrawings] = useState<ElectricalDrawing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState(emptyAdd)
  const [addFile, setAddFile] = useState<File | null>(null)
  const [editing, setEditing] = useState<ElectricalDrawing | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ drawing_number: '', title: '', drawing_type: 'schematic', is_as_built: false, description: '' })
  const [revFor, setRevFor] = useState<ElectricalDrawing | null>(null)
  const [revSummary, setRevSummary] = useState('')
  const [revFile, setRevFile] = useState<File | null>(null)
  const [formError, setFormError] = useState<string | string[]>('')

  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [decisionHint, setDecisionHint] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<ElectricalDrawingRevision | null>(null)

  const typeLabel = (t: string) => meta.drawing_types?.[t] || t.replace(/_/g, ' ')

  // Bumped after every successful mutation to re-fetch the register.
  const [reloadKey, setReloadKey] = useState(0)
  const load = () => setReloadKey((k) => k + 1)

  useEffect(() => {
    let cancelled = false
    electricalApi.listJobDrawings(job.id)
      .then((data) => { if (!cancelled) setDrawings(Array.isArray(data) ? data : []) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, `Could not load the drawings for ${job.job_number}.`)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [job.id, job.job_number, reloadKey])

  /** Runs a mutation, then reloads the register and tells the job page. */
  const run = async (fn: () => Promise<unknown>, fallback: string, successNotice: string): Promise<boolean> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
      setNotice(successNotice)
      load()
      onChanged()
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: number) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  // ---- Add drawing ----
  const openAdd = () => { setAddForm(emptyAdd); setAddFile(null); setFormError(''); setAddOpen(true) }
  const submitAdd = async () => {
    if (!addForm.title.trim()) { setFormError('Drawing title is required.'); return }
    const fd = new FormData()
    fd.append('title', addForm.title.trim())
    fd.append('drawing_type', addForm.drawing_type)
    if (addForm.drawing_number.trim()) fd.append('drawing_number', addForm.drawing_number.trim())
    fd.append('is_as_built', addForm.is_as_built ? 'true' : 'false')
    if (addForm.description.trim()) fd.append('description', addForm.description.trim())
    fd.append('change_summary', addForm.change_summary.trim() || 'First issue')
    if (addFile) fd.append('file', addFile)
    setBusy(true)
    setFormError('')
    try {
      const created: ElectricalDrawing = await electricalApi.createDrawing(job.id, fd)
      setAddOpen(false)
      const label = created?.drawing_number ? `Drawing ${created.drawing_number}` : 'Drawing'
      setNotice(addFile ? `${label} added with its R0 file.` : `${label} added as an R0 draft — attach the file before submitting it for approval.`)
      if (created?.id) setExpanded((prev) => new Set(prev).add(created.id))
      load()
      onChanged()
    } catch (err) {
      setFormError(extractErrorMessages(err, 'Could not add the drawing.'))
    } finally {
      setBusy(false)
    }
  }

  // ---- Edit drawing ----
  const openEdit = (d: ElectricalDrawing) => {
    setEditForm({ drawing_number: d.drawing_number, title: d.title, drawing_type: d.drawing_type, is_as_built: d.is_as_built, description: d.description || '' })
    setFormError('')
    setEditing(d)
  }
  const submitEdit = async () => {
    if (!editing) return
    if (!editForm.title.trim()) { setFormError('Drawing title is required.'); return }
    if (!editForm.drawing_number.trim()) { setFormError('Drawing number is required.'); return }
    setBusy(true)
    setFormError('')
    try {
      await electricalApi.updateDrawing(editing.id, {
        drawing_number: editForm.drawing_number.trim(),
        title: editForm.title.trim(),
        drawing_type: editForm.drawing_type,
        is_as_built: editForm.is_as_built,
        description: strOrNull(editForm.description),
      })
      setEditing(null)
      setNotice(`Drawing ${editForm.drawing_number.trim().toUpperCase()} updated.`)
      load()
      onChanged()
    } catch (err) {
      setFormError(extractErrorMessages(err, `Could not update drawing ${editing.drawing_number}.`))
    } finally {
      setBusy(false)
    }
  }

  // ---- New revision ----
  const openNewRev = (d: ElectricalDrawing) => { setRevSummary(''); setRevFile(null); setFormError(''); setRevFor(d) }
  const submitNewRev = async () => {
    if (!revFor) return
    if (!revSummary.trim()) { setFormError('Describe what changed in this revision.'); return }
    const fd = new FormData()
    fd.append('change_summary', revSummary.trim())
    if (revFile) fd.append('file', revFile)
    setBusy(true)
    setFormError('')
    try {
      await electricalApi.createRevision(revFor.id, fd)
      const id = revFor.id
      setNotice(`New revision started on ${revFor.drawing_number}.${revFile ? '' : ' Attach its file before submitting it for approval.'}`)
      setRevFor(null)
      setExpanded((prev) => new Set(prev).add(id))
      load()
      onChanged()
    } catch (err) {
      setFormError(extractErrorMessages(err, `Could not start a new revision on ${revFor.drawing_number}.`))
    } finally {
      setBusy(false)
    }
  }

  // ---- Revision file upload (single hidden input shared by every draft row) ----
  const pickFile = (rev: ElectricalDrawingRevision) => {
    uploadTarget.current = rev
    fileInputRef.current?.click()
  }
  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const rev = uploadTarget.current
    uploadTarget.current = null
    if (!file || !rev) return
    await run(() => electricalApi.uploadRevisionFile(rev.id, file), `Could not upload the file to ${rev.revision_label}.`, `File "${file.name}" attached to ${rev.revision_label}.`)
  }

  // ---- Approve / reject ----
  const confirmDecision = async (value: string) => {
    if (!decision) return
    const { kind, drawing, rev } = decision
    if (kind === 'reject' && !value.trim()) {
      setDecisionHint('A reason is required — tell the author what to fix before rejecting.')
      return
    }
    setDecision(null)
    setDecisionHint('')
    if (kind === 'approve') {
      await run(() => electricalApi.approveRevision(rev.id, value.trim() || undefined), `Could not approve ${drawing.drawing_number} ${rev.revision_label}.`, `${drawing.drawing_number} ${rev.revision_label} approved.`)
    } else {
      await run(() => electricalApi.rejectRevision(rev.id, value.trim()), `Could not reject ${drawing.drawing_number} ${rev.revision_label}.`, `${drawing.drawing_number} ${rev.revision_label} rejected and sent back to the author.`)
    }
  }

  const runConfirm = async () => {
    if (!confirm) return
    const c = confirm
    setConfirm(null)
    await run(c.run, c.fallback, c.notice)
  }

  const total = drawings.length
  const awaiting = drawings.filter((d) => d.latest_revision_status === 'submitted').length
  const asBuiltApproved = drawings.filter((d) => d.is_as_built && d.approved_revision_label).length
  const typeOptions = Object.entries(meta.drawing_types || {})

  const revisionActions = (d: ElectricalDrawing, rev: ElectricalDrawingRevision) => {
    const isPreparer = !!user && rev.prepared_by_id === user.id
    const canPrepare = canEdit && (isAdmin || !rev.prepared_by_id || isPreparer)
    const canDiscard = canPrepare && d.revisions.length > 1
    const out: React.ReactNode[] = []
    if (rev.status === 'draft' && canPrepare) {
      out.push(<button key="file" type="button" style={smallBtn} disabled={busy} onClick={() => pickFile(rev)}>{rev.has_file ? 'Replace file' : 'Upload file'}</button>)
      out.push(
        <button
          key="submit" type="button"
          style={{ ...smallBtn, opacity: rev.has_file ? 1 : 0.5, cursor: rev.has_file ? 'pointer' : 'not-allowed' }}
          disabled={busy || !rev.has_file}
          title={rev.has_file ? 'Send this revision for approval' : `Attach the drawing file to ${rev.revision_label} before submitting it for approval.`}
          onClick={() => run(() => electricalApi.submitRevision(rev.id), `Could not submit ${d.drawing_number} ${rev.revision_label}.`, `${d.drawing_number} ${rev.revision_label} submitted for approval.`)}
        >
          Submit for approval
        </button>,
      )
    }
    if (rev.status === 'submitted' && (isAdmin || !isPreparer)) {
      out.push(<button key="approve" type="button" style={{ ...smallBtn, color: '#15803d', borderColor: 'rgba(22,163,74,0.35)' }} disabled={busy} onClick={() => { setDecisionHint(''); setDecision({ kind: 'approve', drawing: d, rev }) }}>Approve</button>)
      out.push(<button key="reject" type="button" style={smallDangerBtn} disabled={busy} onClick={() => { setDecisionHint(''); setDecision({ kind: 'reject', drawing: d, rev }) }}>Reject</button>)
    }
    if ((rev.status === 'draft' || rev.status === 'submitted') && canDiscard) {
      out.push(
        <button
          key="discard" type="button" style={smallDangerBtn} disabled={busy}
          onClick={() => setConfirm({
            title: `Discard ${d.drawing_number} ${rev.revision_label}?`,
            message: `${rev.revision_label} (${rev.status === 'submitted' ? 'awaiting approval' : 'draft'}) will be removed from the register. Earlier revisions stay as they are.`,
            confirmLabel: 'Discard', danger: true,
            run: () => electricalApi.discardRevision(rev.id),
            fallback: `Could not discard ${d.drawing_number} ${rev.revision_label}.`,
            notice: `${d.drawing_number} ${rev.revision_label} discarded.`,
          })}
        >
          Discard
        </button>,
      )
    }
    return out.length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{out}</div> : <span style={{ color: TEXT.muted }}>—</span>
  }

  return (
    <div>
      <ErrorBanner error={error} />
      <NoticeBanner notice={notice} />

      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
          <div>
            <h3 style={{ ...sectionTitle, margin: '0 0 6px' }}>Drawings</h3>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, color: TEXT.body }}>
              <span><strong>{total}</strong> drawing{total === 1 ? '' : 's'}</span>
              <span style={{ color: awaiting ? '#b45309' : TEXT.body }}><strong>{awaiting}</strong> awaiting approval</span>
              <span><strong>{asBuiltApproved}</strong> as-built approved</span>
            </div>
          </div>
          {canEdit && <button type="button" style={primaryBtn} disabled={busy} onClick={openAdd}>+ Add Drawing</button>}
        </div>
        <p style={{ ...mutedText, fontSize: 12, marginBottom: 14 }}>
          Schematics stage needs an approved schematic or single line diagram; As-Built stage needs approved drawings marked as-built.
        </p>

        {loading ? (
          <p style={mutedText}>Loading drawings…</p>
        ) : drawings.length === 0 ? (
          <p style={mutedText}>No drawings on this job yet.{canEdit ? ' Add the schematic or single line diagram first — each drawing starts as an R0 draft.' : ''}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {drawings.map((d) => {
              const isOpen = expanded.has(d.id)
              const hasOpenRev = d.revisions.some((r) => r.status === 'draft' || r.status === 'submitted')
              return (
                <div key={d.id} style={{ borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.55)' }}>
                  <div
                    onClick={() => toggle(d.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', cursor: 'pointer', flexWrap: 'wrap' }}
                  >
                    <span aria-hidden style={{ fontSize: 11, color: TEXT.muted, width: 12, display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: TEXT.heading, fontSize: 13.5 }}>{d.drawing_number}</span>
                        <span style={{ fontSize: 13, color: TEXT.body }}>{d.title}</span>
                        {d.is_as_built && <span style={pill('#0d9488')}>As-built</span>}
                      </div>
                      <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 2 }}>
                        {typeLabel(d.drawing_type)} · {d.revisions.length} revision{d.revisions.length === 1 ? '' : 's'}
                        {d.approved_revision_label
                          ? <span style={{ color: '#15803d', fontWeight: 600 }}> · Approved: {d.approved_revision_label}</span>
                          : <span style={{ color: DANGER.primary, fontWeight: 600 }}> · No approved revision</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {d.latest_revision_label && <span style={{ fontSize: 12, color: TEXT.muted }}>{d.latest_revision_label}</span>}
                      <Pill value={d.latest_revision_status} labels={REVISION_STATUS_LABELS} hex={REVISION_STATUS_HEX} />
                    </div>
                    {canEdit && (
                      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {!hasOpenRev && <button type="button" style={smallBtn} disabled={busy} onClick={() => openNewRev(d)}>New Revision</button>}
                        <button type="button" style={smallBtn} disabled={busy} onClick={() => openEdit(d)}>Edit</button>
                        <button
                          type="button" style={smallBtn} disabled={busy}
                          onClick={() => run(
                            () => electricalApi.updateDrawing(d.id, { is_as_built: !d.is_as_built }),
                            `Could not change the as-built flag on ${d.drawing_number}.`,
                            d.is_as_built ? `${d.drawing_number} is no longer marked as-built.` : `${d.drawing_number} marked as-built.`,
                          )}
                        >
                          {d.is_as_built ? 'Unmark as-built' : 'Mark as-built'}
                        </button>
                        <button
                          type="button" style={smallDangerBtn} disabled={busy}
                          onClick={() => setConfirm({
                            title: `Delete drawing ${d.drawing_number}?`,
                            message: `"${d.title}" and all of its revisions will be removed. A drawing with an approved revision on record can't be deleted — raise a new revision instead.`,
                            confirmLabel: 'Delete', danger: true,
                            run: () => electricalApi.deleteDrawing(d.id),
                            fallback: `Could not delete drawing ${d.drawing_number}.`,
                            notice: `Drawing ${d.drawing_number} deleted.`,
                          })}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>

                  {isOpen && (
                    <div style={{ padding: '0 12px 12px' }}>
                      {d.description && <p style={{ ...mutedText, fontSize: 12.5, margin: '0 0 10px 24px' }}>{d.description}</p>}
                      <div style={{ ...tableWrap, maxHeight: 'none' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                          <thead>
                            <tr>
                              {['Rev', 'Status', 'Change summary', 'File', 'Prepared by', 'Submitted', 'Decision', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {[...d.revisions].reverse().map((rev) => (
                              <tr key={rev.id}>
                                <td style={{ ...tdStyle, fontWeight: 700, color: TEXT.heading }}>{rev.revision_label}</td>
                                <td style={tdStyle}><Pill value={rev.status} labels={REVISION_STATUS_LABELS} hex={REVISION_STATUS_HEX} /></td>
                                <td style={{ ...tdStyle, maxWidth: 260 }}>{rev.change_summary || '—'}</td>
                                <td style={tdStyle}>
                                  {rev.has_file ? (
                                    <button
                                      type="button" style={{ ...linkStyle, textAlign: 'left' }}
                                      onClick={() => openBlob(() => electricalApi.getRevisionContent(rev.id), setError, `Could not open the file of ${d.drawing_number} ${rev.revision_label}.`)}
                                    >
                                      {rev.file_name || 'Open file'}
                                      {rev.file_size ? <span style={{ color: TEXT.muted, fontWeight: 400 }}> · {fmtBytes(rev.file_size)}</span> : null}
                                    </button>
                                  ) : (
                                    <span style={{ color: TEXT.muted, fontSize: 12 }}>No file yet</span>
                                  )}
                                </td>
                                <td style={tdStyle}>{rev.prepared_by_name || '—'}</td>
                                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{rev.submitted_at ? formatDateTime(rev.submitted_at) : '—'}</td>
                                <td style={{ ...tdStyle, maxWidth: 240 }}>
                                  {rev.decided_by_name || rev.decided_at ? (
                                    <div>
                                      <div>{rev.decided_by_name || '—'}</div>
                                      {rev.decided_at && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{formatDateTime(rev.decided_at)}</div>}
                                      {rev.decision_comment && <div style={{ fontSize: 12, color: TEXT.secondary, marginTop: 2 }}>“{rev.decision_comment}”</div>}
                                    </div>
                                  ) : '—'}
                                </td>
                                <td style={tdStyle}>{revisionActions(d, rev)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept={DRAWING_ACCEPT} onChange={onFilePicked} style={{ display: 'none' }} />

      {/* Add drawing */}
      <Modal open={addOpen} title="Add Drawing" onClose={() => !busy && setAddOpen(false)}>
        <ErrorBanner error={formError} />
        <div style={rowStyle}>
          <F label="Title *" basis={280} grow max={420}>
            <input style={inputStyle} value={addForm.title} onChange={(e) => setAddForm({ ...addForm, title: e.target.value })} placeholder="e.g. Main 24V DC distribution schematic" autoFocus />
          </F>
          <F label="Drawing type" basis={190}>
            <select style={inputStyle} value={addForm.drawing_type} onChange={(e) => setAddForm({ ...addForm, drawing_type: e.target.value })}>
              {typeOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Drawing number" basis={220} grow max={300}>
            <input style={inputStyle} value={addForm.drawing_number} onChange={(e) => setAddForm({ ...addForm, drawing_number: e.target.value })} placeholder="Leave blank to auto-number" />
          </F>
          <div style={{ flex: '0 1 160px', display: 'flex', alignItems: 'flex-end', paddingBottom: 9 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
              <input type="checkbox" checked={addForm.is_as_built} onChange={(e) => setAddForm({ ...addForm, is_as_built: e.target.checked })} />
              As-built drawing
            </label>
          </div>
        </div>
        <div style={rowStyle}>
          <F label="Description" basis={300} grow>
            <textarea style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} rows={2} value={addForm.description} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} />
          </F>
        </div>
        <div style={rowStyle}>
          <F label="R0 change summary" basis={260} grow max={420}>
            <input style={inputStyle} value={addForm.change_summary} onChange={(e) => setAddForm({ ...addForm, change_summary: e.target.value })} />
          </F>
          <F label="File (optional)" basis={240} grow max={360}>
            <input type="file" accept={DRAWING_ACCEPT} onChange={(e) => setAddFile(e.target.files?.[0] || null)} style={inputStyle} />
          </F>
        </div>
        <p style={{ ...mutedText, fontSize: 12, marginBottom: 14 }}>The drawing starts as an R0 draft. It can be submitted for approval once a file is attached.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" style={smallBtn} disabled={busy} onClick={() => setAddOpen(false)}>Cancel</button>
          <button type="button" style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submitAdd}>{busy ? 'Saving…' : 'Add Drawing'}</button>
        </div>
      </Modal>

      {/* Edit drawing */}
      <Modal open={!!editing} title={`Edit ${editing?.drawing_number || 'drawing'}`} onClose={() => !busy && setEditing(null)}>
        <ErrorBanner error={formError} />
        <div style={rowStyle}>
          <F label="Drawing number *" basis={220} grow max={300}>
            <input style={inputStyle} value={editForm.drawing_number} onChange={(e) => setEditForm({ ...editForm, drawing_number: e.target.value })} />
          </F>
          <F label="Drawing type" basis={190}>
            <select style={inputStyle} value={editForm.drawing_type} onChange={(e) => setEditForm({ ...editForm, drawing_type: e.target.value })}>
              {typeOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Title *" basis={280} grow max={460}>
            <input style={inputStyle} value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
          </F>
          <div style={{ flex: '0 1 160px', display: 'flex', alignItems: 'flex-end', paddingBottom: 9 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
              <input type="checkbox" checked={editForm.is_as_built} onChange={(e) => setEditForm({ ...editForm, is_as_built: e.target.checked })} />
              As-built drawing
            </label>
          </div>
        </div>
        <div style={rowStyle}>
          <F label="Description" basis={300} grow>
            <textarea style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} rows={3} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
          </F>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" style={smallBtn} disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
          <button type="button" style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submitEdit}>{busy ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </Modal>

      {/* New revision */}
      <Modal open={!!revFor} title={`New revision of ${revFor?.drawing_number || 'drawing'}`} onClose={() => !busy && setRevFor(null)} width={560}>
        <ErrorBanner error={formError} />
        {revFor && (
          <p style={{ ...mutedText, fontSize: 12.5, marginBottom: 12 }}>
            {revFor.title} — currently {revFor.latest_revision_label || 'no revisions'}{revFor.approved_revision_label ? `, approved ${revFor.approved_revision_label}` : ''}. The new revision starts as a draft; approving it supersedes the current approved one.
          </p>
        )}
        <div style={rowStyle}>
          <F label="Change summary *" basis={300} grow>
            <textarea style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} rows={3} value={revSummary} onChange={(e) => setRevSummary(e.target.value)} placeholder="What changed in this revision?" autoFocus />
          </F>
        </div>
        <div style={rowStyle}>
          <F label="File (optional)" basis={300} grow>
            <input type="file" accept={DRAWING_ACCEPT} onChange={(e) => setRevFile(e.target.files?.[0] || null)} style={inputStyle} />
          </F>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" style={smallBtn} disabled={busy} onClick={() => setRevFor(null)}>Cancel</button>
          <button type="button" style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submitNewRev}>{busy ? 'Saving…' : 'Start Revision'}</button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />

      <PromptDialog
        open={!!decision}
        title={decision ? `${decision.kind === 'approve' ? 'Approve' : 'Reject'} ${decision.drawing.drawing_number} ${decision.rev.revision_label}?` : ''}
        message={decisionHint || (decision?.kind === 'approve'
          ? 'Approving supersedes the previously approved revision of this drawing. Add an optional comment.'
          : 'Say why the revision is rejected so the author knows what to fix (required).')}
        placeholder={decision?.kind === 'approve' ? 'Optional comment…' : 'Reason for rejection…'}
        confirmLabel={decision?.kind === 'approve' ? 'Approve' : 'Reject'}
        danger={decision?.kind === 'reject'}
        onConfirm={confirmDecision}
        onCancel={() => { setDecision(null); setDecisionHint('') }}
      />
    </div>
  )
}
