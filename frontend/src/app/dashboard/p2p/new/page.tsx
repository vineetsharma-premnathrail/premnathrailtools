'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { p2pApi, storeApi } from '@/lib/api'
import { PRCategoryMeta, P2PRequest, P2PRequestLineItemInput, StoreItem } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { accountAssignmentApi, ACCOUNT_ASSIGNMENTS } from '@/lib/mmLogisticsApi'
import DateField from '@/components/erp/DateField'
import { FormPage, SheetColumns, SheetSection, SheetIcon, FileDropZone, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import P2PNav from '@/components/p2p/P2PNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { P2PProjectType } from '@/lib/p2pRoles'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import OrderProjectPicker from '@/components/sales/OrderProjectPicker'

const PRIORITIES = ['low', 'medium', 'high']

// A line is an Item Master item (store_item_id). Name, part code, UOM and
// category come from the master — shown read-only here and copied onto the
// line by the server. A new item is added in Store › Item Master first.
function emptyItem(): P2PRequestLineItemInput {
  return { store_item_id: null, item_name: '', make: '', part_code: '', unit: '', quantity: 1, project_inhouse: '', category: '', ship_to: '', order_project_id: null, order_project_element_id: null }
}


const inputStyle = sheetInput
const labelStyle = sheetLabel
const readCell: React.CSSProperties = { padding: '6px 8px', fontSize: 13, color: SHEET.BODY, whiteSpace: 'nowrap' }
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: SHEET.MUTED, whiteSpace: 'nowrap', background: SHEET.SOFT, borderBottom: `1px solid ${SHEET.LINE}` }

export default function NewP2PRequestPage() {
  const { isAuthorized, isLoading } = useRequireApp('p2p')
  const router = useRouter()
  const searchParams = useSearchParams()
  // ?edit=<ref>: edit an existing requisition (draft, returned, or one not yet
  // at RFQ) instead of raising a new one.
  const editRef = searchParams.get('edit')
  const { id: editId, error: editLinkError } = useRecordId(editRef)
  const [editing, setEditing] = useState<P2PRequest | null>(null)

  const [categories, setCategories] = useState<PRCategoryMeta[]>([])
  const [requirementTypes, setRequirementTypes] = useState<string[]>([])
  const [masterItems, setMasterItems] = useState<StoreItem[]>([])
  const [loadingMaster, setLoadingMaster] = useState(false)
  const masterById = useMemo(() => new Map(masterItems.map((i) => [i.id, i])), [masterItems])
  // Per-line pickers to narrow the item list: Item Type, then Category
  // (categories offered are the ones used under the chosen type).
  const [lineFilters, setLineFilters] = useState<{ type: string; category: string }[]>([{ type: '', category: '' }])
  const itemTypeOptions = useMemo(
    () => Array.from(new Set(masterItems.map((i) => i.item_type || '').filter(Boolean))).sort(),
    [masterItems],
  )
  const categoriesForType = (type: string) =>
    Array.from(new Set(masterItems.filter((i) => !type || i.item_type === type).map((i) => i.category || '').filter(Boolean))).sort()
  const setLineFilter = (idx: number, patch: Partial<{ type: string; category: string }>) =>
    setLineFilters((prev) => {
      const next = [...prev]
      while (next.length <= idx) next.push({ type: '', category: '' })
      next[idx] = { ...next[idx], ...patch }
      return next
    })
  const [projects, setProjects] = useState<{ id: number; label: string }[]>([])

  // '' until the requester picks (existing vs new project). Approvers no longer
  // depend on it — they come from Procurement → Settings (2026-10-07).
  const [projectType, setProjectType] = useState<'' | P2PProjectType>('')

  const [projectId, setProjectId] = useState('')
  // Account assignment (SAP ME51N): what the purchase is charged to — a real link.
  const [acctKind, setAcctKind] = useState('')
  const [acctId, setAcctId] = useState('')
  const [acctOptions, setAcctOptions] = useState<{ id: number; label: string }[]>([])
  const [newProjectName, setNewProjectName] = useState('')
  const [categoryCode, setCategoryCode] = useState('')
  const [requiredDate, setRequiredDate] = useState('')
  const [requirementType, setRequirementType] = useState('')
  const [priority, setPriority] = useState('medium')
  const [remarks, setRemarks] = useState('')
  const [items, setItems] = useState<P2PRequestLineItemInput[]>([emptyItem()])
  const [supportingFiles, setSupportingFiles] = useState<File[]>([])
  const [specFiles, setSpecFiles] = useState<File[]>([])

  const [submitting, setSubmitting] = useState<'' | 'draft' | 'submit'>('')
  const [error, setError] = useState<string | string[]>('')
  const [uploadWarning, setUploadWarning] = useState<{ prHref: string; message: string } | null>(null)

  // Pre-fill from Store's "Raise P2P Request" low-stock action — see
  // docs/product/PURCHASE_STORE_INTEGRATION.md integration point 2. Pure
  // UI pre-fill only; nothing is submitted until the requester reviews and
  // clicks Submit themselves.
  useEffect(() => {
    if (editRef) return
    // Multi-line pre-fill (e.g. Maintenance › Spares "Raise PR for selected"):
    // ?prefill=session reads { items, remarks } from sessionStorage 'p2p_new_prefill'.
    if (searchParams.get('prefill') === 'session') {
      try {
        const pre = JSON.parse(sessionStorage.getItem('p2p_new_prefill') || 'null')
        if (Array.isArray(pre?.items) && pre.items.length) {
          setItems(pre.items.map((i: Partial<P2PRequestLineItemInput>) => ({
            ...emptyItem(), project_inhouse: i.order_project_element_id ? 'Project' : 'Inhouse', store_item_id: i.store_item_id ?? null,
            make: i.make || '', quantity: Number(i.quantity) || 1,
            // Order Project vehicle / lot the demand is pegged to (MRP / shortage callers).
            order_project_id: i.order_project_id ?? null, order_project_element_id: i.order_project_element_id ?? null,
          })))
          if (pre.remarks) setRemarks(String(pre.remarks))
          return
        }
      } catch { /* bad / missing pre-fill — start with a blank form */ }
    }
    const storeItemId = Number(searchParams.get('store_item_id'))
    if (!storeItemId) return
    // ?order_project_id=&order_project_element_id=: demand pegged to an Order Project vehicle / lot.
    const opElementId = Number(searchParams.get('order_project_element_id')) || null
    setItems([{
      ...emptyItem(),
      store_item_id: storeItemId,
      make: searchParams.get('make') || '',
      quantity: Number(searchParams.get('quantity')) || 1,
      project_inhouse: opElementId ? 'Project' : 'Inhouse',
      order_project_id: opElementId ? Number(searchParams.get('order_project_id')) || null : null,
      order_project_element_id: opElementId,
    }])
    // `remarks` lets other callers (e.g. Production's shortage planner) say where the request came from.
    setRemarks(searchParams.get('remarks') || `Auto-suggested from Store low-stock alert${searchParams.get('part_code') ? ` for part ${searchParams.get('part_code')}` : ''}.`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!isAuthorized || !acctKind) { setAcctOptions([]); return }
    accountAssignmentApi.options(acctKind).then((r) => setAcctOptions(r.options))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the account assignment list.')))
  }, [isAuthorized, acctKind])

  useEffect(() => {
    if (!isAuthorized) return
    ;(async () => {
      try {
        const [meta, projectList] = await Promise.all([p2pApi.getMeta(), p2pApi.listProjects()])
        setCategories(meta.categories)
        setRequirementTypes(meta.requirement_types)
        setProjects(projectList)
      } catch (err) {
        setError(extractErrorMessages(err, 'Failed to load form options.'))
      }
    })()
  }, [isAuthorized])

  // Edit mode: load the requisition and fill the form from it once the form
  // options are in (an existing project is matched back by its label).
  useEffect(() => {
    if (!isAuthorized || !editId || !categories.length) return
    if (editing && editing.id === editId) return
    ;(async () => {
      try {
        const pr: P2PRequest = await p2pApi.get(editId)
        if (!pr.can_edit) {
          setError(pr.edit_block_reason || `${pr.p2p_number} can no longer be edited.`)
          return
        }
        setEditing(pr)
        const ptype = (pr.project_type || '') as '' | P2PProjectType
        setProjectType(ptype)
        if (ptype === 'existing') {
          const match = projects.find((p) => p.label === pr.project_label)
          setProjectId(match ? String(match.id) : '')
        } else if (ptype === 'new') {
          setNewProjectName(pr.project_label || '')
        }
        setCategoryCode(pr.category_code)
        {
          const a = pr as unknown as Record<string, unknown>
          const kind = (a.account_assignment as string) || ''
          setAcctKind(kind)
          const fk = ACCOUNT_ASSIGNMENTS.find((x) => x.value === kind)?.fk
          setAcctId(fk && a[fk] ? String(a[fk]) : '')
        }
        setRequiredDate(pr.required_date || '')
        setRequirementType(pr.requirement_type || '')
        setPriority(pr.priority || 'medium')
        setRemarks(pr.remarks || '')
        setItems(pr.items.length ? pr.items.map((it) => ({
          ...emptyItem(), id: it.id, store_item_id: it.store_item_id ?? null, make: it.make || '',
          quantity: it.quantity, project_inhouse: it.project_inhouse || '', ship_to: it.ship_to || '',
          order_project_id: it.order_project_id ?? null, order_project_element_id: it.order_project_element_id ?? null,
        })) : [emptyItem()])
      } catch (err) {
        setError(extractErrorMessages(err, 'Could not load the requisition to edit.'))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, editId, categories])

  // Active Item Master items. Re-loadable, so an item just added in
  // Store › Item Master (new tab) can be picked without losing the form.
  const loadMasterItems = async () => {
    setLoadingMaster(true)
    try {
      setMasterItems(await storeApi.listItems({ status: 'active' }))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not load the Item Master list.'))
    } finally {
      setLoadingMaster(false)
    }
  }
  useEffect(() => {
    if (isAuthorized) loadMasterItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const pickItem = (idx: number, value: string) => {
    const m = masterById.get(Number(value))
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, store_item_id: m ? m.id : null } : it)))
  }

  const pickProjectType = (value: '' | P2PProjectType) => {
    setProjectType(value)
    if (value === 'existing') setNewProjectName('')
    if (value === 'new') setProjectId('')
  }

  const updateItem = (idx: number, field: keyof P2PRequestLineItemInput, value: string | number | null) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
  }
  const addItem = () => {
    setItems((prev) => [...prev, emptyItem()])
    setLineFilters((prev) => [...prev, { type: '', category: '' }])
  }
  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx))
    setLineFilters((prev) => prev.filter((_, i) => i !== idx))
  }

  // asDraft: keep it as a private draft — only the category is needed, and
  // lines without an item picked yet are left out. Submit checks everything.
  const handleSubmit = async (asDraft: boolean) => {
    setError('')
    if (editRef && !editing) { setError('The requisition is still loading — try again in a moment.'); return }
    if (asDraft) {
      if (!categoryCode) { setError('Pick a Purchase Requisition category before saving the draft — it decides the requisition number.'); return }
      const bad = items.findIndex((it) => it.store_item_id && !(Number(it.quantity) > 0))
      if (bad >= 0) { setError(`Line ${bad + 1}: quantity must be more than 0.`); return }
    } else {
    if (!projectType) { setError('Please choose whether this requisition is for an existing project or a new project.'); return }
    if (projectType === 'existing' && !projectId) { setError('Please pick the existing project this requisition is for.'); return }
    if (projectType === 'new' && !newProjectName.trim()) { setError('Please give the new project\'s name.'); return }
    if (!categoryCode) { setError('Please select a Purchase Requisition category.'); return }
    for (let i = 0; i < items.length; i++) {
      const m = items[i].store_item_id ? masterById.get(items[i].store_item_id!) : undefined
      if (!m) {
        setError(`Line ${i + 1}: pick the item from the Item Master. If it's a new item, add it first in Store › Item Master, then click "refresh items".`)
        return
      }
      if (!['Project', 'Inhouse'].includes(items[i].project_inhouse || '')) {
        setError(`Line ${i + 1} (${m.item_code} ${m.item_name}): choose Project or Inhouse.`)
        return
      }
      if (!(Number(items[i].quantity) > 0)) {
        setError(`Line ${i + 1} (${m.item_code} ${m.item_name}): quantity must be more than 0.`)
        return
      }
      if (acctKind === 'order_project' && items[i].project_inhouse === 'Project' && !items[i].order_project_element_id) {
        setError(`Line ${i + 1} (${m.item_code} ${m.item_name}): pick the vehicle / lot of the order project this item is bought for — project-wise purchase is mandatory for order project items. Mark the line Inhouse if it isn't for the project.`)
        return
      }
    }
    }

    setSubmitting(asDraft ? 'draft' : 'submit')
    try {
      const payload = {
        save_as_draft: asDraft,
        project_type: projectType,
        project_label: projectType === 'existing'
          ? projects.find((p) => p.id === Number(projectId))?.label
          : newProjectName.trim(),
        category_code: categoryCode,
        account_assignment: acctKind || null,
        ...Object.fromEntries(ACCOUNT_ASSIGNMENTS.map((x) => [x.fk, x.value === acctKind && acctId ? Number(acctId) : null])),
        required_date: requiredDate || undefined,
        requirement_type: requirementType || undefined,
        priority,
        remarks: remarks || undefined,
        items: items.filter((it) => !asDraft || it.store_item_id).map((it) => ({
          id: it.id || undefined,
          store_item_id: it.store_item_id,
          quantity: Number(it.quantity),
          project_inhouse: it.project_inhouse,
          ship_to: it.ship_to || undefined,
          order_project_element_id: it.order_project_element_id || null,
        })),
      }
      const pr = editing ? await p2pApi.edit(editing.id, payload) : await p2pApi.create(payload)

      const allFiles = [...supportingFiles.map((f) => ({ f, doc: 'supporting' })), ...specFiles.map((f) => ({ f, doc: 'specification' }))]
      // The PR is already created — an upload failure mustn't undo that, but
      // the requester must be told which files didn't make it and why.
      let failedCount = 0
      const failReasons: string[] = []
      for (const doc of ['supporting', 'specification'] as const) {
        const files = allFiles.filter((x) => x.doc === doc).map((x) => x.f)
        if (files.length) {
          try {
            await p2pApi.uploadAttachments(pr.id, files, doc)
          } catch (err) {
            failedCount += files.length
            failReasons.push(...extractErrorMessages(err, `Upload of ${doc} file(s) failed.`))
          }
        }
      }

      if (failedCount > 0) {
        setUploadWarning({
          prHref: recordPath('/dashboard/p2p', pr),
          message: `Purchase Requisition ${pr.p2p_number} was ${asDraft ? 'saved' : editing ? 'updated' : 'created'}, but ${failedCount} file(s) failed to upload: ${Array.from(new Set(failReasons)).join(' ')} Open the requisition and add them again.`,
        })
        return
      }
      router.push(recordPath('/dashboard/p2p', pr))
    } catch (err) {
      setError(extractErrorMessages(err, asDraft ? 'Failed to save the draft.' : 'Failed to submit Purchase Requisition.'))
    } finally {
      setSubmitting('')
    }
  }

  if (isLoading || !isAuthorized) return null
  if (editLinkError) return <InvalidRecordLink message={editLinkError} listHref="/dashboard/p2p" />

  const inApproval = !!editing && (editing.status === 'submitted' || editing.status === 'approved')
  const heading = !editing ? 'New Purchase Requisition'
    : editing.status === 'draft' ? `Edit Draft ${editing.p2p_number}` : `Edit Purchase Requisition ${editing.p2p_number}`

  const subtitle = !editing ? 'Ask for items from the Item Master — approved requisitions go to stock check, then RFQ and PO.'
    : `${editing.category_label || editing.category_code} · status ${editing.status.replace(/_/g, ' ')}`

  return (
    <FormPage nav={<P2PNav />} icon={editing ? 'edit' : 'cart'} title={heading} subtitle={subtitle} onBack={() => router.back()} backTour="pr-new-back"
      footer={<>
        <button data-tour="pr-new-cancel" onClick={() => router.back()} type="button" style={sheetBtn('secondary', SHEET.INK)}>Cancel</button>
        <button data-tour="pr-new-save-draft" onClick={() => handleSubmit(true)} disabled={!!submitting} type="button" style={sheetBtn('secondary', SHEET.INK, !!submitting)}>
          <SheetIcon name="doc" size={16} />{submitting === 'draft' ? 'Saving…' : 'Save as Draft'}
        </button>
        <button data-tour="pr-new-submit" onClick={() => handleSubmit(false)} disabled={!!submitting} type="button" style={sheetBtn('primary', SHEET.BLUE, !!submitting)}>
          <SheetIcon name="send" size={16} />{submitting === 'submit' ? 'Submitting…' : editing && editing.status !== 'draft' ? 'Save & Submit for Approval' : 'Submit Purchase Requisition'}
        </button>
      </>}>
      <MessageDialog open={!!error} variant="error" title="Cannot Save Request" message={error} onClose={() => setError('')} />
      <MessageDialog
        open={!!uploadWarning}
        variant="warning"
        title="Requisition Created — Some Files Not Uploaded"
        message={uploadWarning?.message || ''}
        actionLabel="Open Requisition"
        onAction={() => { const href = uploadWarning?.prHref; setUploadWarning(null); if (href) router.push(href) }}
        onClose={() => { const href = uploadWarning?.prHref; setUploadWarning(null); if (href) router.push(href) }}
      />

      {inApproval && (
        <div style={{ padding: '10px 14px', margin: '16px 24px 0', borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#92400e', fontSize: 13 }}>
          This requisition is {editing?.status === 'approved' ? 'already approved' : 'waiting for approval'}. Saving your changes withdraws that approval:
          {' '}<b>Save &amp; Submit</b> sends it for approval again, <b>Save as Draft</b> keeps it with you until you submit it.
        </div>
      )}

      <SheetColumns
        left={<>
          <SheetSection icon="building" title="Project & Charging">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div data-tour="pr-new-project-type" style={{ flex: '0 1 180px', minWidth: 160 }}>
                <label style={labelStyle}>Project Type <Req /></label>
                <select style={inputStyle} value={projectType} onChange={(e) => pickProjectType(e.target.value as '' | P2PProjectType)}>
                  <option value="">Select…</option>
                  <option value="existing">Existing project</option>
                  <option value="new">New project</option>
                </select>
              </div>
              {projectType !== 'new' && (
                <div data-tour="pr-new-project" style={{ flex: '1 1 220px', minWidth: 200 }}>
                  <label style={labelStyle}>Project{projectType === 'existing' && <> <Req /></>}</label>
                  <SearchableSelect
                    value={projectId}
                    onChange={setProjectId}
                    options={projects.map((p) => ({ value: String(p.id), label: p.label }))}
                    placeholder="Search existing project…"
                  />
                </div>
              )}
              {projectType === 'new' && (
                <div data-tour="pr-new-project" style={{ flex: '1 1 220px', minWidth: 200 }}>
                  <label style={labelStyle}>New Project Name <Req /></label>
                  <input style={inputStyle} value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Name of the new project…" />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
              <div style={{ flex: '0 1 190px', minWidth: 170 }}>
                <label style={labelStyle}>Charged To</label>
                <select style={inputStyle} value={acctKind} onChange={(e) => { setAcctKind(e.target.value); setAcctId('') }}>
                  <option value="">Not assigned</option>
                  {ACCOUNT_ASSIGNMENTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
              {acctKind && (
                <div style={{ flex: '1 1 220px', minWidth: 200, maxWidth: 340 }}>
                  <label style={labelStyle}>{ACCOUNT_ASSIGNMENTS.find((a) => a.value === acctKind)?.label} <Req /></label>
                  <SearchableSelect value={acctId} onChange={setAcctId}
                    options={acctOptions.map((o) => ({ value: String(o.id), label: o.label }))} placeholder="Search…" />
                </div>
              )}
            </div>
          </SheetSection>
          <SheetSection icon="list" title="Request Details">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                <label style={labelStyle}>Purchase Requisition Category <Req /></label>
                <select data-tour="pr-new-category" style={inputStyle} value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)}>
                  <option value="">Select category…</option>
                  {categories.map((c) => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
                </select>
              </div>
              <div style={{ flex: '1 1 180px', minWidth: 160 }}>
                <label style={labelStyle}>Requirement Type</label>
                <select data-tour="pr-new-requirement-type" style={inputStyle} value={requirementType} onChange={(e) => setRequirementType(e.target.value)}>
                  <option value="">Select type…</option>
                  {requirementTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
              <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                <label style={labelStyle}>Required Date</label>
                <div data-tour="pr-new-required-date"><DateField value={requiredDate} onChange={setRequiredDate} /></div>
              </div>
              <div style={{ flex: '0 1 150px', minWidth: 130 }}>
                <label style={labelStyle}>Priority</label>
                <select data-tour="pr-new-priority" style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
            </div>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea data-tour="pr-new-remarks" style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)}
              placeholder="Why it is needed, references, anything the buyer should know…" />
          </SheetSection>
          <SheetSection icon="clip" title="Documents" extra={<Optional />}>
            <label style={labelStyle}>Supporting Documents</label>
            <div data-tour="pr-new-supporting-docs"><FileDropZone files={supportingFiles} onChange={setSupportingFiles} /></div>
            <label style={{ ...labelStyle, marginTop: 14 }}>Specification / Reference File</label>
            <div data-tour="pr-new-spec-docs"><FileDropZone files={specFiles} onChange={setSpecFiles} /></div>
          </SheetSection>
        </>}
      />

      <div style={{ padding: '20px 24px', borderTop: `1px solid ${SHEET.LINE}` }}>
        <SheetSection icon="box" title="Item Details" extra={
          <button data-tour="pr-new-add-item" onClick={addItem} type="button" style={{ ...sheetBtn('secondary', SHEET.INK), marginLeft: 'auto' }}><SheetIcon name="plus" size={14} />Add Item</button>
        }>
          <div style={{ overflowX: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1900 }}>
              <thead>
                <tr>
                  {['SL', 'Item (from Item Master) *', 'Make', 'Part Code', 'UOM', 'Qty *', 'Project/Inhouse *', 'Order Project (vehicle / lot)', 'Category', 'Ship To', ''].map((h) => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const m = item.store_item_id ? masterById.get(item.store_item_id) : undefined
                  const f = lineFilters[idx] || { type: '', category: '' }
                  // Keep the picked item in the list even if it falls outside the filters.
                  const shown = masterItems.filter((i) =>
                    i.id === item.store_item_id
                    || ((!f.type || i.item_type === f.type) && (!f.category || i.category === f.category)))
                  return (
                  <tr key={idx} style={{ borderTop: idx ? `1px solid ${SHEET.LINE}` : undefined }}>
                    <td style={{ padding: '6px 8px', fontSize: 12.5, fontWeight: 600, color: SHEET.MUTED }}>{idx + 1}</td>
                    <td data-tour="pr-new-item-name" style={{ padding: '6px 8px', minWidth: 560 }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <select
                          title="Item Type"
                          style={{ ...inputStyle, flex: '0 0 120px' }}
                          value={f.type}
                          onChange={(e) => {
                            const type = e.target.value
                            setLineFilter(idx, { type, category: categoriesForType(type).includes(f.category) ? f.category : '' })
                          }}
                        >
                          <option value="">All types</option>
                          {itemTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <select
                          title="Category"
                          style={{ ...inputStyle, flex: '0 0 140px' }}
                          value={f.category}
                          onChange={(e) => setLineFilter(idx, { category: e.target.value })}
                        >
                          <option value="">All categories</option>
                          {categoriesForType(f.type).map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <SearchableSelect
                            value={item.store_item_id ? String(item.store_item_id) : ''}
                            onChange={(v) => pickItem(idx, v)}
                            options={shown.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}${i.part_number ? ` · ${i.part_number}` : ''}` }))}
                            placeholder={loadingMaster ? 'Loading items…' : `Search ${shown.length} item${shown.length === 1 ? '' : 's'} by code, name or part no…`}
                          />
                        </div>
                      </div>
                    </td>
                    <td data-tour="pr-new-item-make" style={readCell}>{m?.make || '—'}</td>
                    <td data-tour="pr-new-item-partcode" style={readCell}>{m?.part_number || m?.manufacturer_part_number || '—'}</td>
                    <td data-tour="pr-new-item-unit" style={readCell}>{m?.uom || '—'}</td>
                    <td style={{ padding: '6px 8px', minWidth: 70 }}>
                      <input data-tour="pr-new-item-qty" type="number" style={inputStyle} value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} />
                    </td>
                    <td style={{ padding: '6px 8px', minWidth: 130 }}>
                      <select data-tour="pr-new-item-projinhouse" style={inputStyle} value={item.project_inhouse} onChange={(e) => {
                        const v = e.target.value
                        // Inhouse items aren't bought for a project — drop the vehicle / lot.
                        setItems((prev) => prev.map((it, i) => (i === idx ? {
                          ...it, project_inhouse: v, ...(v === 'Inhouse' ? { order_project_id: null, order_project_element_id: null } : {}),
                        } : it)))
                      }}>
                        <option value="">Select…</option>
                        <option value="Project">Project</option>
                        <option value="Inhouse">Inhouse</option>
                      </select>
                    </td>
                    <td data-tour="pr-new-item-order-project" style={{ padding: '6px 8px', minWidth: 280 }}>
                      <OrderProjectPicker
                        value={item.order_project_element_id && item.order_project_id ? { projectId: item.order_project_id, elementId: item.order_project_element_id } : null}
                        onChange={(v) => setItems((prev) => prev.map((it, i) => (i === idx ? {
                          ...it,
                          order_project_id: v?.projectId ?? null,
                          order_project_element_id: v?.elementId ?? null,
                          // A line bought for a vehicle / lot is a Project line.
                          project_inhouse: v?.elementId && it.project_inhouse !== 'Project' ? 'Project' : it.project_inhouse,
                        } : it)))}
                        disabled={item.project_inhouse === 'Inhouse'}
                        placeholder={item.project_inhouse === 'Inhouse' ? 'Not for a project (Inhouse)' : 'Pick vehicle / lot…'}
                      />
                    </td>
                    <td data-tour="pr-new-item-category" style={readCell}>{m?.category || '—'}</td>
                    <td style={{ padding: '6px 8px', minWidth: 140 }}>
                      <input data-tour="pr-new-item-shipto" style={inputStyle} value={item.ship_to} onChange={(e) => updateItem(idx, 'ship_to', e.target.value)} />
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {items.length > 1 && (
                        <span data-tour="pr-new-item-remove" onClick={() => removeItem(idx)} style={{ fontSize: 11.5, fontWeight: 600, color: '#dc2626', cursor: 'pointer', whiteSpace: 'nowrap' }}>Remove</span>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p data-tour="pr-new-item-master-hint" style={sheetHint}>
            Item not in the list? Add it in{' '}
            <a href="/dashboard/store/new" target="_blank" rel="noopener noreferrer" style={{ color: SHEET.BLUE, fontWeight: 600 }}>Store › Item Master</a>
            {' '}(opens in a new tab), then{' '}
            <button type="button" onClick={loadMasterItems} disabled={loadingMaster} style={{ border: 'none', background: 'none', padding: 0, color: SHEET.BLUE, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
              {loadingMaster ? 'refreshing…' : 'refresh items'}
            </button>.
          </p>
        </SheetSection>
      </div>
    </FormPage>
  )
}
