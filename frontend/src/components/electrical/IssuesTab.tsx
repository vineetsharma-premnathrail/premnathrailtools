'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { electricalApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import {
  ElectricalCable, ElectricalIssue, ElectricalIssueSeverity, ElectricalJobDetail, ElectricalLookupOption,
  ElectricalMeta, ElectricalPanel, ElectricalTest,
} from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import {
  inputStyle, labelStyle, sectionStyle, sectionTitle, primaryBtn, smallBtn, smallDangerBtn, mutedText,
  Pill, ErrorBanner, NoticeBanner, Modal, F, rowStyle,
  TEST_RESULT_LABELS, SEVERITY_LABELS, SEVERITY_HEX, ISSUE_STATUS_LABELS, ISSUE_STATUS_HEX, toOptions, strOrNull,
} from '@/components/electrical/shared'

type Filter = 'open' | 'all'

interface IssueForm {
  title: string
  symptom: string
  severity: ElectricalIssueSeverity
  test_id: string
  panel_id: string
  cable_id: string
  assigned_to_id: string
}

const emptyForm = (): IssueForm => ({ title: '', symptom: '', severity: 'major', test_id: '', panel_id: '', cable_id: '', assigned_to_id: '' })

const OPEN_STATUSES = ['open', 'investigating']

const filterBtn = (active: boolean): React.CSSProperties => ({
  padding: '7px 14px', borderRadius: 9999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
  border: `1px solid ${active ? '#FF6A2A' : BORDER.normal}`,
  background: active ? 'rgba(255,106,42,0.10)' : 'rgba(255,255,255,.7)',
  color: active ? '#c2410c' : TEXT.secondary,
})

const cardStyle: React.CSSProperties = {
  borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.6)', padding: '12px 14px', marginBottom: 10,
}
const smallMuted: React.CSSProperties = { fontSize: 11.5, color: TEXT.muted }
const detailLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, marginBottom: 2 }
const detailText: React.CSSProperties = { fontSize: 13, color: TEXT.body, whiteSpace: 'pre-wrap', margin: 0 }

export default function IssuesTab({ job, meta, canEdit, onChanged }: { job: ElectricalJobDetail; meta: ElectricalMeta; canEdit: boolean; onChanged: () => void }) {
  const { user } = useAuth()
  const [issues, setIssues] = useState<ElectricalIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState<Filter>('open')

  const [tests, setTests] = useState<ElectricalTest[]>([])
  const [panels, setPanels] = useState<ElectricalPanel[]>([])
  const [cables, setCables] = useState<ElectricalCable[]>([])
  const [users, setUsers] = useState<ElectricalLookupOption[]>([])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ElectricalIssue | null>(null)
  const [form, setForm] = useState<IssueForm>(emptyForm())
  const [formError, setFormError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  const [resolving, setResolving] = useState<ElectricalIssue | null>(null)
  const [rootCause, setRootCause] = useState('')
  const [corrective, setCorrective] = useState('')
  const [resolveError, setResolveError] = useState<string | string[]>('')

  const [deleteTarget, setDeleteTarget] = useState<ElectricalIssue | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => (
    electricalApi.listJobIssues(job.id)
      .then((d) => setIssues(Array.isArray(d) ? d : []))
      .catch((err) => setError(extractErrorMessages(err, "Couldn't load this job's troubleshooting log. Refresh the page to try again.")))
      .finally(() => setLoading(false))
  ), [job.id])

  const loadTests = useCallback(() => (
    electricalApi.listJobTests(job.id).then((d) => setTests(Array.isArray(d) ? d : [])).catch(() => setTests([]))
  ), [job.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    loadTests()
    electricalApi.listPanels(job.id).then((d) => setPanels(Array.isArray(d) ? d : [])).catch(() => setPanels([]))
    electricalApi.listCables(job.id).then((d) => setCables(Array.isArray(d) ? d : [])).catch(() => setCables([]))
    electricalApi.lookupUsers().then((d) => setUsers(Array.isArray(d) ? d : [])).catch(() => setUsers([]))
  }, [job.id, loadTests])

  const openCount = useMemo(() => issues.filter((i) => OPEN_STATUSES.includes(i.status)).length, [issues])
  const visible = useMemo(() => (filter === 'open' ? issues.filter((i) => OPEN_STATUSES.includes(i.status)) : issues), [issues, filter])

  const testTypeLabel = (k: string) => meta.test_types[k] || k.replace(/_/g, ' ')
  const testOptions = tests.map((t) => ({
    value: String(t.id),
    label: `${t.test_number} · ${testTypeLabel(t.test_type)} · ${TEST_RESULT_LABELS[t.result] || t.result}${t.needs_retest ? ' (needs retest)' : ''}`,
  }))
  const cableOptions = [
    { value: '', label: '— None —' },
    ...cables.map((c) => ({ value: String(c.id), label: `${c.cable_tag} · ${c.from_point} → ${c.to_point}` })),
  ]
  const userOptions = toOptions(users, '— Unassigned —')

  const set = <K extends keyof IssueForm>(key: K, value: IssueForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  const afterMutation = async (msg: string) => {
    setError('')
    setNotice(msg)
    await load()
    onChanged()
  }

  const openCreate = () => {
    loadTests()
    setForm(emptyForm()); setEditing(null); setFormError(''); setFormOpen(true)
  }

  const openEdit = (i: ElectricalIssue) => {
    loadTests()
    setForm({
      title: i.title,
      symptom: i.symptom || '',
      severity: i.severity,
      test_id: i.test_id ? String(i.test_id) : '',
      panel_id: i.panel_id ? String(i.panel_id) : '',
      cable_id: i.cable_id ? String(i.cable_id) : '',
      assigned_to_id: i.assigned_to_id ? String(i.assigned_to_id) : '',
    })
    setEditing(i); setFormError(''); setFormOpen(true)
  }

  const closeForm = () => { setFormOpen(false); setEditing(null); setFormError('') }

  const saveForm = async () => {
    if (!form.title.trim()) { setFormError('Give the issue a short title describing the fault.'); return }
    const payload = {
      title: form.title.trim(),
      symptom: strOrNull(form.symptom),
      severity: form.severity,
      test_id: form.test_id ? Number(form.test_id) : null,
      panel_id: form.panel_id ? Number(form.panel_id) : null,
      cable_id: form.cable_id ? Number(form.cable_id) : null,
      assigned_to_id: form.assigned_to_id ? Number(form.assigned_to_id) : null,
    }
    setSaving(true)
    setFormError('')
    try {
      if (editing) {
        const saved: ElectricalIssue = await electricalApi.updateIssue(editing.id, payload)
        closeForm()
        await afterMutation(`Issue ${saved.issue_number} updated.`)
      } else {
        const saved: ElectricalIssue = await electricalApi.createIssue(job.id, payload)
        closeForm()
        if (filter !== 'open') setFilter('open')
        await afterMutation(`Issue ${saved.issue_number} logged.`)
      }
    } catch (err) {
      setFormError(extractErrorMessages(err, editing
        ? "Couldn't save the issue changes. Check the fields and try again."
        : "Couldn't log the issue. Check the fields and try again."))
    } finally {
      setSaving(false)
    }
  }

  const openResolve = (i: ElectricalIssue) => {
    setResolving(i)
    setRootCause(i.root_cause || '')
    setCorrective(i.corrective_action || '')
    setResolveError('')
  }

  const saveResolve = async () => {
    if (!resolving) return
    if (!rootCause.trim()) { setResolveError('Enter the root cause — what actually caused the fault.'); return }
    if (!corrective.trim()) { setResolveError('Enter the corrective action — what was done to fix it.'); return }
    setSaving(true)
    setResolveError('')
    try {
      const saved: ElectricalIssue = await electricalApi.resolveIssue(resolving.id, { root_cause: rootCause.trim(), corrective_action: corrective.trim() })
      setResolving(null)
      await afterMutation(`Issue ${saved.issue_number} resolved.`)
    } catch (err) {
      setResolveError(extractErrorMessages(err, `Couldn't resolve issue ${resolving.issue_number}. Try again.`))
    } finally {
      setSaving(false)
    }
  }

  const runAction = async (i: ElectricalIssue, action: 'investigate' | 'close' | 'reopen') => {
    setBusyId(i.id)
    try {
      if (action === 'investigate') {
        await electricalApi.updateIssue(i.id, { status: 'investigating' })
        await afterMutation(`Issue ${i.issue_number} is now under investigation.`)
      } else if (action === 'close') {
        await electricalApi.closeIssue(i.id)
        await afterMutation(`Issue ${i.issue_number} closed.`)
      } else {
        await electricalApi.reopenIssue(i.id)
        if (filter !== 'open') setFilter('open')
        await afterMutation(`Issue ${i.issue_number} reopened.`)
      }
    } catch (err) {
      setNotice('')
      const verb = action === 'investigate' ? 'start investigating' : action
      setError(extractErrorMessages(err, `Couldn't ${verb} issue ${i.issue_number}. Refresh and try again.`))
    } finally {
      setBusyId(null)
    }
  }

  const confirmDelete = async () => {
    const i = deleteTarget
    if (!i) return
    setDeleteTarget(null)
    try {
      await electricalApi.deleteIssue(i.id)
      await afterMutation(`Issue ${i.issue_number} deleted.`)
    } catch (err) {
      setNotice('')
      setError(extractErrorMessages(err, `Couldn't delete issue ${i.issue_number}. Refresh and try again.`))
    }
  }

  const canDelete = (i: ElectricalIssue) => OPEN_STATUSES.includes(i.status) && !!user && (user.role === 'admin' || i.reported_by_id === user.id)

  return (
    <div>
      <ErrorBanner error={error} />
      <NoticeBanner notice={notice} />

      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ ...sectionTitle, margin: '0 8px 0 0' }}>Troubleshooting Log</h3>
            <button type="button" onClick={() => setFilter('open')} style={filterBtn(filter === 'open')}>Open ({openCount})</button>
            <button type="button" onClick={() => setFilter('all')} style={filterBtn(filter === 'all')}>All ({issues.length})</button>
          </div>
          {canEdit && <button type="button" onClick={openCreate} style={primaryBtn}>+ Log Issue</button>}
        </div>
        <p style={{ ...smallMuted, margin: '0 0 14px' }}>Troubleshooting stage completes once no issue is open or investigating.</p>

        {loading ? (
          <p style={{ ...mutedText, textAlign: 'center', padding: 20 }}>Loading…</p>
        ) : visible.length === 0 ? (
          <p style={{ ...mutedText, textAlign: 'center', padding: 20 }}>
            {filter === 'open'
              ? (issues.length ? 'No open issues — every logged fault has been resolved.' : 'No issues logged on this job.')
              : 'No issues logged on this job.'}
            {canEdit && !issues.length ? ' Use "+ Log Issue" when a fault is found.' : ''}
          </p>
        ) : visible.map((i) => {
          const isOpen = OPEN_STATUSES.includes(i.status)
          const links = [
            i.test_number && `Test ${i.test_number}`,
            i.panel_tag && `Panel ${i.panel_tag}`,
            i.cable_tag && `Cable ${i.cable_tag}`,
          ].filter(Boolean).join(' · ')
          const busy = busyId === i.id
          return (
            <div key={i.id} style={{ ...cardStyle, borderLeft: `3px solid ${SEVERITY_HEX[i.severity] || '#78716c'}` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading }}>{i.issue_number}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: TEXT.body }}>{i.title}</span>
                    <Pill value={i.severity} labels={SEVERITY_LABELS} hex={SEVERITY_HEX} />
                    <Pill value={i.status} labels={ISSUE_STATUS_LABELS} hex={ISSUE_STATUS_HEX} />
                  </div>
                  <div style={{ ...smallMuted, marginTop: 4, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    {links && <span>Linked: {links}</span>}
                    <span>Assigned to: {i.assigned_to_name || 'Unassigned'}</span>
                    <span>Reported by {i.reported_by_name || '—'}{i.created_at ? ` on ${formatDate(i.created_at)}` : ''}</span>
                    {i.resolved_by_name && <span>Resolved by {i.resolved_by_name}{i.resolved_at ? ` · ${formatDateTime(i.resolved_at)}` : ''}</span>}
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {i.status === 'open' && <button type="button" disabled={busy} onClick={() => runAction(i, 'investigate')} style={smallBtn}>Start investigating</button>}
                    {isOpen && <button type="button" disabled={busy} onClick={() => openResolve(i)} style={smallBtn}>Resolve</button>}
                    {isOpen && <button type="button" disabled={busy} onClick={() => openEdit(i)} style={smallBtn}>Edit</button>}
                    {i.status === 'resolved' && <button type="button" disabled={busy} onClick={() => runAction(i, 'close')} style={smallBtn}>Close</button>}
                    {!isOpen && <button type="button" disabled={busy} onClick={() => runAction(i, 'reopen')} style={smallBtn}>Reopen</button>}
                    {canDelete(i) && <button type="button" disabled={busy} onClick={() => setDeleteTarget(i)} style={smallDangerBtn}>Delete</button>}
                  </div>
                )}
              </div>

              {(i.symptom || i.root_cause || i.corrective_action) && (
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${BORDER.light}` }}>
                  {i.symptom && (
                    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                      <div style={detailLabel}>Symptom</div>
                      <p style={detailText}>{i.symptom}</p>
                    </div>
                  )}
                  {i.root_cause && (
                    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                      <div style={detailLabel}>Root Cause</div>
                      <p style={detailText}>{i.root_cause}</p>
                    </div>
                  )}
                  {i.corrective_action && (
                    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                      <div style={detailLabel}>Corrective Action</div>
                      <p style={detailText}>{i.corrective_action}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <Modal open={formOpen} title={editing ? `Edit Issue ${editing.issue_number}` : 'Log Issue'} onClose={closeForm} width={680}>
        <ErrorBanner error={formError} />
        <div style={rowStyle}>
          <F label="Title *" basis={320} grow>
            <input style={inputStyle} value={form.title} maxLength={255} placeholder="e.g. Tail lamp flickers under load" onChange={(e) => set('title', e.target.value)} />
          </F>
          <F label="Severity" basis={140}>
            <select style={inputStyle} value={form.severity} onChange={(e) => set('severity', e.target.value as ElectricalIssueSeverity)}>
              {Object.entries(SEVERITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </F>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Symptom</label>
          <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }} value={form.symptom} placeholder="What was observed, when, and under what conditions" onChange={(e) => set('symptom', e.target.value)} />
        </div>
        <div style={rowStyle}>
          <F label="Linked Test" basis={260} grow max={360}>
            <select style={inputStyle} value={form.test_id} onChange={(e) => set('test_id', e.target.value)}>
              <option value="">— None —</option>
              {testOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </F>
          <F label="Panel" basis={200} grow max={300}>
            <select style={inputStyle} value={form.panel_id} onChange={(e) => set('panel_id', e.target.value)}>
              <option value="">— None —</option>
              {panels.map((p) => <option key={p.id} value={String(p.id)}>{p.panel_tag} — {p.name}</option>)}
            </select>
          </F>
        </div>
        <div style={{ ...rowStyle, marginBottom: 16 }}>
          <F label="Cable" basis={260} grow max={380}>
            <SearchableSelect value={form.cable_id} onChange={(v) => set('cable_id', v)} options={cableOptions} placeholder={cables.length ? 'Select cable…' : 'No cables in this job'} />
          </F>
          <F label="Assigned To" basis={220} grow max={320}>
            <SearchableSelect value={form.assigned_to_id} onChange={(v) => set('assigned_to_id', v)} options={userOptions} placeholder="— Unassigned —" />
          </F>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={closeForm} style={smallBtn} disabled={saving}>Cancel</button>
          <button type="button" onClick={saveForm} style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Log Issue'}
          </button>
        </div>
      </Modal>

      <Modal open={!!resolving} title={resolving ? `Resolve Issue ${resolving.issue_number}` : 'Resolve Issue'} onClose={() => setResolving(null)} width={600}>
        <ErrorBanner error={resolveError} />
        {resolving && <p style={{ ...mutedText, marginBottom: 12 }}>{resolving.title}</p>}
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Root Cause *</label>
          <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }} value={rootCause} placeholder="What actually caused the fault" onChange={(e) => setRootCause(e.target.value)} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Corrective Action *</label>
          <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }} value={corrective} placeholder="What was done to fix it (and any retest recorded)" onChange={(e) => setCorrective(e.target.value)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={() => setResolving(null)} style={smallBtn} disabled={saving}>Cancel</button>
          <button type="button" onClick={saveResolve} style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }} disabled={saving}>
            {saving ? 'Saving…' : 'Resolve Issue'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title={deleteTarget ? `Delete issue ${deleteTarget.issue_number}?` : 'Delete issue?'}
        message="This removes the issue from the troubleshooting log. Only delete an issue logged by mistake — a real fault should be resolved instead so it stays on record."
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
