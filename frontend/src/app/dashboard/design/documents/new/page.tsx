'use client'

import Select from '@/components/shared/Select'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { designApi } from '@/lib/api'
import { DesignLookupOption, DesignRequest } from '@/types'
import DesignNav from '@/components/design/DesignNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, Req, Optional, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { DANGER_RED } from '@/components/design/DesignSheets'
import { useDesignMe } from '@/components/design/useDesignMe'
import { DOC_TYPE_LABELS, DISCIPLINE_LABELS, FILE_ROLE_LABELS, DESIGN_FILE_ACCEPT, formatBytes, toOptions } from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

type Staged = { file: File; role: string }

function mergeOptions(base: DesignLookupOption[], extra: DesignLookupOption[]): DesignLookupOption[] {
  const seen = new Set(base.map((o) => o.id))
  return [...base, ...extra.filter((o) => !seen.has(o.id))]
}

export default function NewDesignDocumentPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('design')
  const router = useRouter()
  const searchParams = useSearchParams()
  const me = useDesignMe(isAuthorized)
  const { id: requestParamId, error: linkError, loading: requestLinkLoading } = useRecordId(searchParams.get('request_id'))

  const [users, setUsers] = useState<DesignLookupOption[]>([])
  const [projects, setProjects] = useState<DesignLookupOption[]>([])
  const [machines, setMachines] = useState<DesignLookupOption[]>([])
  const [items, setItems] = useState<DesignLookupOption[]>([])
  const [departments, setDepartments] = useState<DesignLookupOption[]>([])
  const [customers, setCustomers] = useState<DesignLookupOption[]>([])
  const [standards, setStandards] = useState<DesignLookupOption[]>([])
  const [requests, setRequests] = useState<DesignRequest[]>([])

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [documentType, setDocumentType] = useState('part_drawing')
  const [discipline, setDiscipline] = useState('mechanical')
  const [pmProjectId, setPmProjectId] = useState('')
  const [erpProjectId, setErpProjectId] = useState('')
  const [storeItemId, setStoreItemId] = useState('')
  const [itemSearch, setItemSearch] = useState('')
  const [itemMsg, setItemMsg] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerApproval, setCustomerApproval] = useState(false)
  const [standardId, setStandardId] = useState('')
  const [requestId, setRequestId] = useState('')
  const [legacyNumber, setLegacyNumber] = useState('')
  const [ownerChoice, setOwnerId] = useState('')
  const [reviewerId, setReviewerId] = useState('')
  const [approverId, setApproverId] = useState('')
  const [changeSummary, setChangeSummary] = useState('')
  const [staged, setStaged] = useState<Staged[]>([])
  const [nextRole, setNextRole] = useState('primary')
  const [submitNow, setSubmitNow] = useState(true)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const draft = useFormDraft(requestLinkLoading ? null : `design-document-new-${requestParamId ?? 0}`,
    { title, description, documentType, discipline, pmProjectId, erpProjectId, storeItemId, departmentId, customerId, customerApproval, standardId, requestId, legacyNumber, ownerChoice, reviewerId, approverId, changeSummary, staged, nextRole, submitNow },
    (d) => {
      setTitle(d.title ?? ''); setDescription(d.description ?? ''); setDocumentType(d.documentType ?? 'part_drawing'); setDiscipline(d.discipline ?? 'mechanical')
      setPmProjectId(d.pmProjectId ?? ''); setErpProjectId(d.erpProjectId ?? ''); setStoreItemId(d.storeItemId ?? ''); setDepartmentId(d.departmentId ?? '')
      setCustomerId(d.customerId ?? ''); setCustomerApproval(!!d.customerApproval); setStandardId(d.standardId ?? ''); setRequestId(d.requestId ?? '')
      setLegacyNumber(d.legacyNumber ?? ''); setOwnerId(d.ownerChoice ?? ''); setReviewerId(d.reviewerId ?? ''); setApproverId(d.approverId ?? '')
      setChangeSummary(d.changeSummary ?? ''); setNextRole(d.nextRole ?? 'primary'); setSubmitNow(d.submitNow ?? true)
    })

  // Picking a request fills customer / project only where still empty.
  const fillFromRequest = (req: DesignRequest) => {
    if (req.customer_id) setCustomerId((v) => v || String(req.customer_id))
    if (req.pm_project_id) setPmProjectId((v) => v || String(req.pm_project_id))
    if (req.erp_project_id) setErpProjectId((v) => v || String(req.erp_project_id))
  }

  useEffect(() => {
    if (!isAuthorized || requestLinkLoading) return
    Promise.all([
      designApi.lookupUsers(), designApi.lookupProjects(), designApi.lookupMachines(),
      designApi.lookupItems(), designApi.lookupDepartments(),
    ])
      .then(([u, p, m, i, d]) => { setUsers(u); setProjects(p); setMachines(m); setItems(i); setDepartments(d) })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the form options.')))
    Promise.all([
      designApi.lookupCustomers(), designApi.lookupStandards(),
      designApi.listRequests({ status: 'open,accepted,in_progress,on_hold' }),
    ])
      .then(([c, s, r]) => {
        // Opened from a design request: link it (set here, not synchronously in the effect).
        if (requestParamId) setRequestId(String(requestParamId))
        setCustomers(c); setStandards(s); setRequests(r)
        // Opened from a design request: carry its customer and project over.
        const pre = requestParamId ? r.find((x) => x.id === requestParamId) : undefined
        if (pre) fillFromRequest(pre)
      })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load customers, standards or design requests.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, requestLinkLoading])

  // The item list loads only the first 200 Item Master codes — search for the rest.
  const searchItems = async () => {
    const q = itemSearch.trim()
    if (!q) return
    setItemMsg('')
    try {
      const found = await designApi.lookupItems(q)
      setItems((prev) => mergeOptions(prev, found))
      setItemMsg(found.length ? `${found.length} found — pick it in the Part list.` : `No Item Master item matches “${q}”. Check the code or name, or ask Store to create the item first.`)
    } catch (err) {
      setItemMsg(extractErrorMessages(err, 'Searching Item Master failed.').join(' '))
    }
  }

  const pickRequest = (v: string) => {
    setRequestId(v)
    const req = requests.find((x) => String(x.id) === v)
    if (req) fillFromRequest(req)
  }

  const requestOptions = useMemo(() => {
    const opts = requests.map((r) => ({ value: String(r.id), label: `${r.request_number} — ${r.title}${r.customer_name ? ` (${r.customer_name})` : ''}` }))
    return [{ value: '', label: 'None' }, ...opts]
  }, [requests])

  // Owner defaults to the creator until someone else is picked.
  const ownerId = ownerChoice || (user ? String(user.id) : '')

  // Checker/approver pickers never offer the author (the current user) —
  // the backend refuses them anyway.
  const signatoryOptions = useMemo(
    () => toOptions(users.filter((u) => u.id !== user?.id).map((u) => ({ id: u.id, label: u.code ? `${u.label} — ${u.code}` : u.label })), 'Not decided yet'),
    [users, user],
  )
  // Role "Assign to" rules (Role & Permissions › Design › Drawings): who may be named owner / checker.
  const allowOwner = useAssigneeFilter('design:documents.owner')
  const allowChecker = useAssigneeFilter('design:documents.check_release')
  const ownerOptions = useMemo(() => toOptions(users.filter((u) => u.id === user?.id || allowOwner(u.id))), [users, user, allowOwner])
  const checkerOptions = useMemo(
    () => toOptions(users.filter((u) => u.id !== user?.id && allowChecker(u.id)).map((u) => ({ id: u.id, label: u.code ? `${u.label} — ${u.code}` : u.label })), 'Not decided yet'),
    [users, user, allowChecker],
  )

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><DesignNav /><InvalidRecordLink message={linkError} listHref="/dashboard/design/documents" listLabel="Back to drawings" /></div>)

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const incoming = Array.from(list).map((file) => ({ file, role: nextRole }))
    setStaged((prev) => [...prev, ...incoming.filter((n) => !prev.some((p) => p.file.name.toLowerCase() === n.file.name.toLowerCase()))])
  }

  const handleSubmit = async () => {
    setError('')
    if (title.trim().length < 2) { setError('Give the document a title (at least 2 characters).'); return }
    if (customerApproval && !customerId) { setError('“Customer approval required” needs a customer — pick the customer who must approve this drawing, or untick the box.'); return }
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
        customer_id: customerId ? Number(customerId) : null,
        customer_approval_required: customerApproval,
        standard_id: standardId ? Number(standardId) : null,
        design_request_id: requestId ? Number(requestId) : null,
        legacy_number: legacyNumber.trim() || null,
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
    draft.clear()
    router.push(`${recordPath('/dashboard/design/documents', created)}${query}`)
  }

  const isViewer = !!me && !me.is_team
  const goBack = () => router.push('/dashboard/design/documents')

  return (
    <FormPage
      nav={<DesignNav />}
      tour="design-docnew-form" backTour="design-docnew-back-btn"
      icon="doc"
      title="New Document"
      subtitle="Creates the document with its first revision (R0). The number is assigned automatically from the type."
      onBack={goBack}
      footer={<>
        {!isViewer && (
          <label data-tour="design-docnew-submit-now" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SHEET.BODY, cursor: 'pointer', marginRight: 'auto' }}>
            <input type="checkbox" checked={submitNow} onChange={(e) => setSubmitNow(e.target.checked)} /> Submit R0 for check now
          </label>
        )}
        <button data-tour="design-docnew-cancel-btn" type="button" onClick={goBack} style={sheetBtn('secondary', SHEET.INK, saving)} disabled={saving}>Cancel</button>
        {!isViewer && (
          <button data-tour="design-docnew-save-btn" type="button" onClick={handleSubmit} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
            <SheetIcon name={submitNow ? 'send' : 'check'} size={16} />{saving ? 'Saving…' : submitNow ? 'Create & Submit' : 'Create Draft'}
          </button>
        )}
      </>}
    >
      {(error || isViewer || draft.restored) && (
        <div style={{ padding: '20px 24px 0' }}>
          <DraftBanner draft={draft} />
          <SheetError error={error} />
          {isViewer && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400E', fontSize: 13 }}>
              You have view-only access to Design — only Design team members create drawings and documents. Ask the Design head to add you to the team in Design → Settings.
            </div>
          )}
        </div>
      )}

      <SheetColumns
        left={<>
          <SheetSection icon="doc" title="Document">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div data-tour="design-docnew-title" style={{ flex: '1 1 320px', maxWidth: 560 }}>
                <label style={sheetLabel}>Title <Req /></label>
                <input style={sheetInput} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Front bogie frame — general arrangement" maxLength={255} />
              </div>
              <div data-tour="design-docnew-type" style={{ flex: '0 1 200px', minWidth: 180 }}>
                <label style={sheetLabel}>Type <Req /></label>
                <Select style={sheetInput} value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
                  {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </div>
              <div data-tour="design-docnew-discipline" style={{ flex: '0 1 180px', minWidth: 160 }}>
                <label style={sheetLabel}>Discipline <Req /></label>
                <Select style={sheetInput} value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
                  {Object.entries(DISCIPLINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
              <div data-tour="design-docnew-legacy" style={{ flex: '0 1 240px', minWidth: 200 }}>
                <label style={sheetLabel}>Legacy drawing number <Optional /></label>
                <input style={sheetInput} value={legacyNumber} onChange={(e) => setLegacyNumber(e.target.value)} placeholder="Old number, if migrated" maxLength={100} />
              </div>
              <div data-tour="design-docnew-standard" style={{ flex: '1 1 260px', maxWidth: 380 }}>
                <label style={sheetLabel}>Standard <Optional /></label>
                <SearchableSelect value={standardId} onChange={setStandardId} options={toOptions(standards, 'None')} placeholder="Select standard…" />
              </div>
            </div>
            <p style={sheetHint}>Legacy number: only for drawings migrated from the old register — it stays searchable alongside the new number.</p>
            <div data-tour="design-docnew-description" style={{ marginTop: 12 }}>
              <label style={sheetLabel}>Description <Optional /></label>
              <textarea style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Scope, applicable variant, key notes…" />
            </div>
          </SheetSection>

          <SheetSection icon="link" title="Associations" extra={<Optional />}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div data-tour="design-docnew-project" style={{ flex: '1 1 240px', maxWidth: 380 }}>
                <label style={sheetLabel}>Project</label>
                <SearchableSelect value={pmProjectId} onChange={setPmProjectId} options={toOptions(projects, 'None')} placeholder="Select project…" />
              </div>
              <div data-tour="design-docnew-machine" style={{ flex: '1 1 240px', maxWidth: 380 }}>
                <label style={sheetLabel}>Machine (RRV / asset)</label>
                <SearchableSelect value={erpProjectId} onChange={setErpProjectId} options={toOptions(machines, 'None')} placeholder="Select machine…" />
              </div>
              <div data-tour="design-docnew-item" style={{ flex: '1 1 240px', maxWidth: 380 }}>
                <label style={sheetLabel}>Part (Store item)</label>
                <SearchableSelect value={storeItemId} onChange={setStoreItemId} options={toOptions(items, 'None')} placeholder="Select item…" />
              </div>
              <div style={{ flex: '1 1 240px', maxWidth: 380 }}>
                <label style={sheetLabel}>Part not in the list? Search Item Master</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={sheetInput} value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Code, name or part no."
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchItems() } }} />
                  <button type="button" style={sheetBtn('secondary', SHEET.INK, !itemSearch.trim())} disabled={!itemSearch.trim()} onClick={searchItems}><SheetIcon name="search" size={14} />Search</button>
                </div>
                {itemMsg && <p style={sheetHint}>{itemMsg}</p>}
              </div>
              <div data-tour="design-docnew-department" style={{ flex: '1 1 220px', maxWidth: 300 }}>
                <label style={sheetLabel}>Department</label>
                <SearchableSelect value={departmentId} onChange={setDepartmentId} options={toOptions(departments, 'None')} placeholder="Select department…" />
              </div>
              <div data-tour="design-docnew-request" style={{ flex: '1 1 300px', maxWidth: 440 }}>
                <label style={sheetLabel}>Design request</label>
                <SearchableSelect value={requestId} onChange={pickRequest} options={requestOptions} placeholder="Select design request…" />
              </div>
            </div>
            <p style={sheetHint}>Linking a design request makes this drawing one of its deliverables. Only open, accepted, in-progress and on-hold requests are listed.</p>
          </SheetSection>

          <SheetSection icon="building" title="Customer" extra={<Optional />}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <div data-tour="design-docnew-customer" style={{ flex: '1 1 280px', maxWidth: 400 }}>
                <label style={sheetLabel}>Customer</label>
                <SearchableSelect value={customerId} onChange={setCustomerId} options={toOptions(customers, 'None')} placeholder="Select customer…" />
              </div>
              <label data-tour="design-docnew-customer-approval" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SHEET.BODY, cursor: 'pointer', paddingBottom: 10 }}>
                <input type="checkbox" checked={customerApproval} onChange={(e) => setCustomerApproval(e.target.checked)} /> Customer approval required
              </label>
            </div>
            <p style={sheetHint}>When ticked, internal approval stops at “Approved · awaiting customer”. The revision is released only after the customer approves it on a submission (transmittal).</p>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="users" title="R0 — sign-off">
            <div data-tour="design-docnew-owner" style={{ marginBottom: 12 }}>
              <label style={sheetLabel}>Owner (responsible engineer)</label>
              <SearchableSelect value={ownerId} onChange={setOwnerId} options={ownerOptions} placeholder="Select owner…" />
            </div>
            <div data-tour="design-docnew-checker" style={{ marginBottom: 12 }}>
              <label style={sheetLabel}>Checked by</label>
              <SearchableSelect value={reviewerId} onChange={setReviewerId} options={checkerOptions} placeholder="Select checker…" />
            </div>
            <div data-tour="design-docnew-approver">
              <label style={sheetLabel}>Approved by</label>
              <SearchableSelect value={approverId} onChange={setApproverId} options={signatoryOptions} placeholder="Select approver…" />
            </div>
            <p style={sheetHint}>The checker and approver must be two different people, and neither can be you. Only people with Design access are listed.</p>
            <div data-tour="design-docnew-issue-note" style={{ marginTop: 12 }}>
              <label style={sheetLabel}>Issue note <Optional /></label>
              <input style={sheetInput} value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} placeholder="Initial issue" />
            </div>
          </SheetSection>

          <SheetSection icon="clip" title="Files">
            <div data-tour="design-docnew-file-role" style={{ marginBottom: 12 }}>
              <label style={sheetLabel}>Add as</label>
              <Select style={sheetInput} value={nextRole} onChange={(e) => setNextRole(e.target.value)}>
                {Object.entries(FILE_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
            <div data-tour="design-docnew-files">
              <label style={sheetLabel}>Choose files</label>
              <DesignFileDrop onFiles={addFiles} disabled={saving} />
            </div>
            <p style={sheetHint}>Attach the controlled print (PDF) as the primary file, and the DWG/STEP/SolidWorks source as native. Files can still be added or removed until the revision is submitted.</p>
            {staged.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {staged.map((s, idx) => (
                  <div key={`${s.file.name}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, border: `1px solid ${SHEET.LINE}`, background: '#fff', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: SHEET.INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.file.name}</div>
                      <div style={{ fontSize: 11.5, color: SHEET.MUTED }}>{formatBytes(s.file.size)}</div>
                    </div>
                    <Select value={s.role} onChange={(e) => setStaged((prev) => prev.map((p, i) => (i === idx ? { ...p, role: e.target.value } : p)))}
                      style={{ ...sheetInput, width: 170, padding: '6px 8px', fontSize: 12.5 }}>
                      {Object.entries(FILE_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                    <button type="button" onClick={() => setStaged((prev) => prev.filter((_, i) => i !== idx))}
                      style={sheetBtn('ghost', DANGER_RED)} aria-label={`Remove ${s.file.name}`}><SheetIcon name="x" size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </SheetSection>
        </>}
      />
    </FormPage>
  )
}

/** Drag-and-drop / click file picker limited to the Design file types. */
function DesignFileDrop({ onFiles, disabled }: { onFiles: (list: FileList | null) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div onClick={() => !disabled && ref.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) onFiles(e.dataTransfer.files) }}
      style={{ border: `1.5px dashed ${over ? SHEET.BLUE : '#cbd5e1'}`, borderRadius: 12, padding: '18px 12px', textAlign: 'center', cursor: disabled ? 'not-allowed' : 'pointer', background: over ? '#eff6ff' : '#fff' }}>
      <SheetIcon name="upload" size={22} color={SHEET.BLUE} />
      <div style={{ fontSize: 13, color: SHEET.BODY, marginTop: 6 }}>Drag and drop files here, or <span style={{ color: SHEET.BLUE, fontWeight: 600 }}>click to browse</span></div>
      <div style={{ fontSize: 11.5, color: SHEET.MUTED, marginTop: 2 }}>PDF, DWG, DXF, STEP, IGES, SolidWorks, Inventor, Office files or images</div>
      <input ref={ref} type="file" multiple hidden accept={DESIGN_FILE_ACCEPT} onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
    </div>
  )
}
