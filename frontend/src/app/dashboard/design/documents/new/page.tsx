'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignLookupOption } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { DOC_TYPE_LABELS, DISCIPLINE_LABELS, FILE_ROLE_LABELS, DESIGN_FILE_ACCEPT, formatBytes, toOptions } from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const hintStyle: React.CSSProperties = { fontSize: 12, color: TEXT.muted, margin: '6px 0 0' }

type Staged = { file: File; role: string }

export default function NewDesignDocumentPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('design')
  const router = useRouter()

  const [users, setUsers] = useState<DesignLookupOption[]>([])
  const [projects, setProjects] = useState<DesignLookupOption[]>([])
  const [machines, setMachines] = useState<DesignLookupOption[]>([])
  const [items, setItems] = useState<DesignLookupOption[]>([])
  const [departments, setDepartments] = useState<DesignLookupOption[]>([])

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [documentType, setDocumentType] = useState('part_drawing')
  const [discipline, setDiscipline] = useState('mechanical')
  const [pmProjectId, setPmProjectId] = useState('')
  const [erpProjectId, setErpProjectId] = useState('')
  const [storeItemId, setStoreItemId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [ownerChoice, setOwnerId] = useState('')
  const [reviewerId, setReviewerId] = useState('')
  const [approverId, setApproverId] = useState('')
  const [changeSummary, setChangeSummary] = useState('')
  const [staged, setStaged] = useState<Staged[]>([])
  const [nextRole, setNextRole] = useState('primary')
  const [submitNow, setSubmitNow] = useState(true)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([
      designApi.lookupUsers(), designApi.lookupProjects(), designApi.lookupMachines(),
      designApi.lookupItems(), designApi.lookupDepartments(),
    ])
      .then(([u, p, m, i, d]) => { setUsers(u); setProjects(p); setMachines(m); setItems(i); setDepartments(d) })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the form options.')))
  }, [isAuthorized])

  // Owner defaults to the creator until someone else is picked.
  const ownerId = ownerChoice || (user ? String(user.id) : '')

  // Checker/approver pickers never offer the author (the current user) —
  // the backend refuses them anyway.
  const signatoryOptions = useMemo(
    () => toOptions(users.filter((u) => u.id !== user?.id).map((u) => ({ id: u.id, label: u.code ? `${u.label} — ${u.code}` : u.label })), 'Not decided yet'),
    [users, user],
  )

  if (isLoading || !isAuthorized) return null

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const incoming = Array.from(list).map((file) => ({ file, role: nextRole }))
    setStaged((prev) => [...prev, ...incoming.filter((n) => !prev.some((p) => p.file.name.toLowerCase() === n.file.name.toLowerCase()))])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (title.trim().length < 2) { setError('Give the document a title (at least 2 characters).'); return }
    if (reviewerId && reviewerId === approverId) { setError('The checker and the approver must be two different people.'); return }
    if (submitNow) {
      if (!reviewerId || !approverId) { setError('To submit for check right away, name both a checker and an approver — or untick “Submit for check now”.'); return }
      if (!staged.length) { setError('To submit for check right away, attach at least one file — or untick “Submit for check now”.'); return }
    }

    setSaving(true)
    let created
    try {
      created = await designApi.createDocument({
        title: title.trim(),
        description: description.trim() || null,
        document_type: documentType,
        discipline,
        pm_project_id: pmProjectId ? Number(pmProjectId) : null,
        erp_project_id: erpProjectId ? Number(erpProjectId) : null,
        store_item_id: storeItemId ? Number(storeItemId) : null,
        department_id: departmentId ? Number(departmentId) : null,
        owner_id: ownerId ? Number(ownerId) : null,
        reviewer_id: reviewerId ? Number(reviewerId) : null,
        approver_id: approverId ? Number(approverId) : null,
        change_summary: changeSummary.trim() || null,
      })
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create the document.'))
      setSaving(false)
      return
    }

    // The document exists now — file/submit problems are reported on its
    // detail page rather than blocking creation.
    const revisionId = created.revisions[0]?.id
    const problems: string[] = []
    if (revisionId) {
      for (const role of ['primary', 'native', 'supporting']) {
        const files = staged.filter((s) => s.role === role).map((s) => s.file)
        if (!files.length) continue
        try {
          await designApi.uploadRevisionFiles(revisionId, files, role)
        } catch (err) {
          problems.push(...extractErrorMessages(err, `Uploading ${FILE_ROLE_LABELS[role]} files failed.`))
        }
      }
      if (submitNow && !problems.length) {
        try {
          await designApi.submitRevision(revisionId)
        } catch (err) {
          problems.push(...extractErrorMessages(err, 'The document was saved, but submitting it for check failed.'))
        }
      }
    }
    const query = problems.length ? `?notice=${encodeURIComponent(problems.join(' '))}` : ''
    router.push(`/dashboard/design/documents/${created.id}${query}`)
  }

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design Module</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>New Document</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>Creates the document with its first revision (R0). The number is assigned automatically from the type.</p>
        </div>
        <button onClick={() => router.push('/dashboard/design/documents')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={sectionStyle}>
          <p style={sectionTitle}>Document</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 320px', maxWidth: 560 }}>
              <label style={labelStyle}>Title *</label>
              <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Front bogie frame — general arrangement" maxLength={255} />
            </div>
            <div style={{ flex: '0 1 200px', minWidth: 180 }}>
              <label style={labelStyle}>Type *</label>
              <select style={inputStyle} value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
                {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 1 180px', minWidth: 160 }}>
              <label style={labelStyle}>Discipline *</label>
              <select style={inputStyle} value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
                {Object.entries(DISCIPLINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Description</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Scope, applicable variant, key notes…" />
          </div>
        </div>

        <div style={sectionStyle}>
          <p style={sectionTitle}>Associations</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
              <label style={labelStyle}>Project</label>
              <SearchableSelect value={pmProjectId} onChange={setPmProjectId} options={toOptions(projects, 'None')} placeholder="Select project…" />
            </div>
            <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
              <label style={labelStyle}>Machine (RRV / asset)</label>
              <SearchableSelect value={erpProjectId} onChange={setErpProjectId} options={toOptions(machines, 'None')} placeholder="Select machine…" />
            </div>
            <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
              <label style={labelStyle}>Part (Store item)</label>
              <SearchableSelect value={storeItemId} onChange={setStoreItemId} options={toOptions(items, 'None')} placeholder="Select item…" />
            </div>
            <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
              <label style={labelStyle}>Department</label>
              <SearchableSelect value={departmentId} onChange={setDepartmentId} options={toOptions(departments, 'None')} placeholder="Select department…" />
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <p style={sectionTitle}>R0 — sign-off</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
              <label style={labelStyle}>Owner (responsible engineer)</label>
              <SearchableSelect value={ownerId} onChange={setOwnerId} options={toOptions(users)} placeholder="Select owner…" />
            </div>
            <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
              <label style={labelStyle}>Checked by</label>
              <SearchableSelect value={reviewerId} onChange={setReviewerId} options={signatoryOptions} placeholder="Select checker…" />
            </div>
            <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
              <label style={labelStyle}>Approved by</label>
              <SearchableSelect value={approverId} onChange={setApproverId} options={signatoryOptions} placeholder="Select approver…" />
            </div>
          </div>
          <p style={hintStyle}>The checker and approver must be two different people, and neither can be you. Only people with Design access are listed.</p>
          <div style={{ marginTop: 12, maxWidth: 700 }}>
            <label style={labelStyle}>Issue note</label>
            <input style={inputStyle} value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} placeholder="Initial issue" />
          </div>
        </div>

        <div style={sectionStyle}>
          <p style={sectionTitle}>Files</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: '0 1 240px', minWidth: 200 }}>
              <label style={labelStyle}>Add as</label>
              <select style={inputStyle} value={nextRole} onChange={(e) => setNextRole(e.target.value)}>
                {Object.entries(FILE_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 280px', maxWidth: 460 }}>
              <label style={labelStyle}>Choose files</label>
              <input type="file" multiple accept={DESIGN_FILE_ACCEPT} style={inputStyle} onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
            </div>
          </div>
          <p style={hintStyle}>Attach the controlled print (PDF) as the primary file, and the DWG/STEP/SolidWorks source as native. Files can still be added or removed until the revision is submitted.</p>
          {staged.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {staged.map((s, idx) => (
                <div key={`${s.file.name}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.55)' }}>
                  <span style={{ flex: 1, fontSize: 13, color: TEXT.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.file.name}</span>
                  <span style={{ fontSize: 12, color: TEXT.muted }}>{formatBytes(s.file.size)}</span>
                  <select value={s.role} onChange={(e) => setStaged((prev) => prev.map((p, i) => (i === idx ? { ...p, role: e.target.value } : p)))}
                    style={{ ...inputStyle, width: 190, padding: '6px 8px', fontSize: 12.5 }}>
                    {Object.entries(FILE_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <button type="button" onClick={() => setStaged((prev) => prev.filter((_, i) => i !== idx))}
                    style={{ border: 'none', background: 'transparent', color: '#DC2626', cursor: 'pointer', fontSize: 16 }} aria-label={`Remove ${s.file.name}`}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.secondary, cursor: 'pointer' }}>
            <input type="checkbox" checked={submitNow} onChange={(e) => setSubmitNow(e.target.checked)} /> Submit R0 for check now
          </label>
          <button type="button" onClick={() => router.push('/dashboard/design/documents')} style={secondaryBtnStyle} disabled={saving}>Cancel</button>
          <button type="submit" disabled={saving} style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: saving ? 'wait' : 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`, opacity: saving ? 0.7 : 1,
          }}>
            {saving ? 'Saving…' : submitNow ? 'Create & Submit' : 'Create Draft'}
          </button>
        </div>
      </form>
    </div>
  )
}
