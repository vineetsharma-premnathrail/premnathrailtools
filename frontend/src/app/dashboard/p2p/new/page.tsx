'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { p2pApi, usersApi } from '@/lib/api'
import { PRCategoryMeta, P2PRequestLineItemInput, DirectoryUser } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BRAND, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { PR_APPROVAL_ROLE_SETS, PO_PICKED_ROLE_SETS, P2P_ROLE_LABELS, P2PProjectType } from '@/lib/p2pRoles'

const PRIORITIES = ['low', 'medium', 'high']

function emptyItem(): P2PRequestLineItemInput {
  return { item_name: '', make: '', part_code: '', unit: '', quantity: 1, project_inhouse: '', category: '', ship_to: '' }
}


const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function NewP2PRequestPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const router = useRouter()
  const searchParams = useSearchParams()

  const [categories, setCategories] = useState<PRCategoryMeta[]>([])
  const [requirementTypes, setRequirementTypes] = useState<string[]>([])
  const [uoms, setUoms] = useState<{ value: string; label: string }[]>([])
  const [projects, setProjects] = useState<{ id: number; label: string }[]>([])
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([])

  // '' until the requester picks; the choice drives the approval role sets
  // AND (later) which roles the PO goes to.
  const [projectType, setProjectType] = useState<'' | P2PProjectType>('')
  const [approverIds, setApproverIds] = useState<Record<string, string>>({})
  const [poApproverIds, setPoApproverIds] = useState<Record<string, string>>({})

  const [projectId, setProjectId] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [categoryCode, setCategoryCode] = useState('')
  const [requiredDate, setRequiredDate] = useState('')
  const [requirementType, setRequirementType] = useState('')
  const [priority, setPriority] = useState('medium')
  const [remarks, setRemarks] = useState('')
  const [items, setItems] = useState<P2PRequestLineItemInput[]>([emptyItem()])
  const [supportingFiles, setSupportingFiles] = useState<File[]>([])
  const [specFiles, setSpecFiles] = useState<File[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  // Pre-fill from Store's "Raise P2P Request" low-stock action — see
  // docs/product/PURCHASE_STORE_INTEGRATION.md integration point 2. Pure
  // UI pre-fill only; nothing is submitted until the requester reviews and
  // clicks Submit themselves.
  useEffect(() => {
    const itemName = searchParams.get('item_name')
    if (!itemName) return
    setItems([{
      item_name: itemName,
      make: searchParams.get('make') || '',
      part_code: searchParams.get('part_code') || '',
      unit: searchParams.get('unit') || '',
      quantity: Number(searchParams.get('quantity')) || 1,
      project_inhouse: 'Inhouse',
      category: searchParams.get('category') || '',
      ship_to: '',
    }])
    // `remarks` lets other callers (e.g. Production's shortage planner) say where the request came from.
    setRemarks(searchParams.get('remarks') || `Auto-suggested from Store low-stock alert${searchParams.get('part_code') ? ` for part ${searchParams.get('part_code')}` : ''}.`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!isAuthorized) return
    ;(async () => {
      try {
        const [meta, projectList, directory] = await Promise.all([p2pApi.getMeta(), p2pApi.listProjects(), usersApi.directory()])
        setCategories(meta.categories)
        setRequirementTypes(meta.requirement_types)
        setUoms(meta.uoms || [])
        setProjects(projectList)
        setDirectoryUsers(directory)
      } catch (err: any) {
        setError(extractErrorMessages(err, 'Failed to load form options.'))
      }
    })()
  }, [isAuthorized])

  // Approvers per role slot: ANY user can be picked, including the requester
  // themselves ("user self select kar sake") — the role just labels the
  // slot. Being named on the PR is what grants the approver access to it.
  const approvalRoles = projectType ? PR_APPROVAL_ROLE_SETS[projectType] : []
  const poApprovalRoles = projectType ? PO_PICKED_ROLE_SETS[projectType] : []
  const approverOptions = directoryUsers
    .map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})${u.department ? ` — ${u.department}` : ''}${u.id === user?.id ? ' — you' : ''}` }))

  const pickProjectType = (value: '' | P2PProjectType) => {
    setProjectType(value)
    // A different project type means a different approval chain — clear picks
    // that no longer apply rather than silently submitting them.
    setApproverIds({})
    setPoApproverIds({})
    if (value === 'existing') setNewProjectName('')
    if (value === 'new') setProjectId('')
  }

  const updateItem = (idx: number, field: keyof P2PRequestLineItemInput, value: string | number | null) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
  }
  const addItem = () => {
    setItems((prev) => [...prev, emptyItem()])
  }
  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleSubmit = async () => {
    setError('')
    if (!projectType) { setError('Please choose whether this requisition is for an existing project or a new project.'); return }
    if (projectType === 'existing' && !projectId) { setError('Please pick the existing project this requisition is for.'); return }
    if (projectType === 'new' && !newProjectName.trim()) { setError('Please give the new project\'s name.'); return }
    if (!categoryCode) { setError('Please select a Purchase Requisition category.'); return }
    if (items.length === 0 || !items[0].item_name) { setError('At least one item is required.'); return }
    for (let i = 0; i < items.length; i++) {
      if (items[i].item_name && !['Project', 'Inhouse'].includes(items[i].project_inhouse || '')) {
        setError(`Line ${i + 1} (${items[i].item_name}): choose Project or Inhouse.`)
        return
      }
    }
    for (const role of approvalRoles) {
      if (!approverIds[role]) { setError(`Please select a ${P2P_ROLE_LABELS[role]}.`); return }
    }
    for (const role of poApprovalRoles) {
      if (!poApproverIds[role]) { setError(`Please select the PO approver for ${P2P_ROLE_LABELS[role]}.`); return }
    }

    setSubmitting(true)
    try {
      const filledItems = items.filter((it) => it.item_name)

      const pr = await p2pApi.create({
        project_type: projectType,
        project_label: projectType === 'existing'
          ? projects.find((p) => p.id === Number(projectId))?.label
          : newProjectName.trim(),
        category_code: categoryCode,
        required_date: requiredDate || undefined,
        requirement_type: requirementType || undefined,
        priority,
        remarks: remarks || undefined,
        approvers: Object.fromEntries(approvalRoles.map((role) => [role, Number(approverIds[role])])),
        po_approvers: Object.fromEntries(poApprovalRoles.map((role) => [role, Number(poApproverIds[role])])),
        items: filledItems.map((it) => ({
          ...it,
          quantity: Number(it.quantity) || 1,
        })),
      })

      const allFiles = [...supportingFiles.map((f) => ({ f, doc: 'supporting' })), ...specFiles.map((f) => ({ f, doc: 'specification' }))]
      for (const doc of ['supporting', 'specification'] as const) {
        const files = allFiles.filter((x) => x.doc === doc).map((x) => x.f)
        if (files.length) {
          try { await p2pApi.uploadAttachments(pr.id, files, doc) } catch { /* upload failure shouldn't block PR creation */ }
        }
      }

      router.push(`/dashboard/p2p/${pr.id}`)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to submit Purchase Requisition.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ width: '100%' }}>
      <P2PNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Procurement Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Purchase Requisition</h1>
        </div>
        <button data-tour="pr-new-back" onClick={() => router.back()} type="button" style={secondaryBtnStyle}>
          ← Back
        </button>
      </div>

      <MessageDialog open={!!error} variant="error" title="Cannot Save Request" message={error} onClose={() => setError('')} />

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Request Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 24 }}>
          <div data-tour="pr-new-project-type" style={{ flex: '0 1 180px', minWidth: 160 }}>
            <label style={labelStyle}>Project Type *</label>
            <select style={inputStyle} value={projectType} onChange={(e) => pickProjectType(e.target.value as '' | P2PProjectType)}>
              <option value="">Select…</option>
              <option value="existing">Existing project</option>
              <option value="new">New project</option>
            </select>
          </div>
          {projectType !== 'new' && (
            <div data-tour="pr-new-project" style={{ flex: '1 1 220px', minWidth: 200 }}>
              <label style={labelStyle}>Project{projectType === 'existing' ? ' *' : ''}</label>
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
              <label style={labelStyle}>New Project Name *</label>
              <input style={inputStyle} value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Name of the new project…" />
            </div>
          )}
          <div style={{ flex: '1 1 200px', minWidth: 180 }}>
            <label style={labelStyle}>Purchase Requisition Category *</label>
            <select data-tour="pr-new-category" style={inputStyle} value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)}>
              <option value="">Select category…</option>
              {categories.map((c) => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Required Date</label>
            <div data-tour="pr-new-required-date"><DateField value={requiredDate} onChange={setRequiredDate} /></div>
          </div>
          <div style={{ flex: '1 1 180px', minWidth: 160 }}>
            <label style={labelStyle}>Requirement Type</label>
            <select data-tour="pr-new-requirement-type" style={inputStyle} value={requirementType} onChange={(e) => setRequirementType(e.target.value)}>
              <option value="">Select type…</option>
              {requirementTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingTop: 20, borderTop: `1px solid ${BORDER.normal}` }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Item Details</h2>
          <button data-tour="pr-new-add-item" onClick={addItem} type="button" style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${BRAND.primaryBorder}`, background: BRAND.primarySoft, color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            + Add Item
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1360 }}>
            <thead>
              <tr>
                {['SL', 'Item Description *', 'Make', 'Part Code', 'UOM', 'Qty', 'Project/Inhouse *', 'Category', 'Ship To', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '6px 8px', fontSize: 12.5, fontWeight: 600, color: TEXT.muted }}>{idx + 1}</td>
                  <td style={{ padding: '6px 8px', minWidth: 160 }}>
                    <input data-tour="pr-new-item-name" style={inputStyle} value={item.item_name} onChange={(e) => updateItem(idx, 'item_name', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 110 }}>
                    <input data-tour="pr-new-item-make" style={inputStyle} value={item.make} onChange={(e) => updateItem(idx, 'make', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 110 }}>
                    <input data-tour="pr-new-item-partcode" style={inputStyle} value={item.part_code} onChange={(e) => updateItem(idx, 'part_code', e.target.value)} />
                  </td>
                  <td data-tour="pr-new-item-unit" style={{ padding: '6px 8px', minWidth: 130 }}>
                    <SearchableSelect
                      value={item.unit || ''}
                      onChange={(v) => updateItem(idx, 'unit', v)}
                      options={item.unit && !uoms.some((u) => u.value === item.unit)
                        ? [{ value: item.unit, label: `${item.unit} (not in list — pick a listed unit)` }, ...uoms]
                        : uoms}
                      placeholder="Select unit…"
                    />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 70 }}>
                    <input data-tour="pr-new-item-qty" type="number" style={inputStyle} value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 130 }}>
                    <select data-tour="pr-new-item-projinhouse" style={inputStyle} value={item.project_inhouse} onChange={(e) => updateItem(idx, 'project_inhouse', e.target.value)}>
                      <option value="">Select…</option>
                      <option value="Project">Project</option>
                      <option value="Inhouse">Inhouse</option>
                    </select>
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 130 }}>
                    <input data-tour="pr-new-item-category" style={inputStyle} value={item.category} onChange={(e) => updateItem(idx, 'category', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 140 }}>
                    <input data-tour="pr-new-item-shipto" style={inputStyle} value={item.ship_to} onChange={(e) => updateItem(idx, 'ship_to', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {items.length > 1 && (
                      <span data-tour="pr-new-item-remove" onClick={() => removeItem(idx)} style={{ fontSize: 11.5, fontWeight: 600, color: '#dc2626', cursor: 'pointer', whiteSpace: 'nowrap' }}>Remove</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px', paddingTop: 20, borderTop: `1px solid ${BORDER.normal}` }}>Priority & Remarks</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 24 }}>
          <div style={{ flex: '0 1 180px', minWidth: 160 }}>
            <label style={labelStyle}>Priority</label>
            <select data-tour="pr-new-priority" style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 320px' }}>
            <label style={labelStyle}>Remarks</label>
            <textarea data-tour="pr-new-remarks" style={{ ...inputStyle, minHeight: 42 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>

        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px', paddingTop: 20, borderTop: `1px solid ${BORDER.normal}` }}>Approval</h2>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>
          {projectType
            ? 'Every approver below must sign before the requisition is approved — pick who acts as each role for this requisition.'
            : 'Pick the Project Type above first — it decides which approvals this requisition needs.'}
        </p>
        <div data-tour="pr-new-approvers" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 24 }}>
          {approvalRoles.map((role) => (
            <div key={role} data-tour={`pr-new-approver-${role}`} style={{ flex: '1 1 220px', minWidth: 200, maxWidth: 340 }}>
              <label style={labelStyle}>{P2P_ROLE_LABELS[role]} *</label>
              <SearchableSelect
                value={approverIds[role] || ''}
                onChange={(v) => setApproverIds((prev) => ({ ...prev, [role]: v }))}
                options={approverOptions}
                placeholder={`Search ${P2P_ROLE_LABELS[role].toLowerCase()}…`}
              />
            </div>
          ))}
        </div>

        {projectType && (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px', paddingTop: 20, borderTop: `1px solid ${BORDER.normal}` }}>PO Approval</h2>
            <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>
              Once a PO is raised it goes to the people picked below and to every Director — any one approval approves the PO.
            </p>
            <div data-tour="pr-new-po-approvers" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 24 }}>
              {poApprovalRoles.map((role) => (
                <div key={role} style={{ flex: '1 1 220px', minWidth: 200, maxWidth: 340 }}>
                  <label style={labelStyle}>{P2P_ROLE_LABELS[role]} *</label>
                  <SearchableSelect
                    value={poApproverIds[role] || ''}
                    onChange={(v) => setPoApproverIds((prev) => ({ ...prev, [role]: v }))}
                    options={approverOptions}
                    placeholder={`Search ${P2P_ROLE_LABELS[role].toLowerCase()}…`}
                  />
                </div>
              ))}
              <div style={{ flex: '1 1 220px', minWidth: 200, maxWidth: 340 }}>
                <label style={labelStyle}>Director</label>
                <p style={{ fontSize: 13, color: TEXT.secondary, margin: '10px 0 0' }}>Every Director — set on the user</p>
              </div>
            </div>
          </>
        )}

        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px', paddingTop: 20, borderTop: `1px solid ${BORDER.normal}` }}>Documents</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ flex: '0 1 280px', minWidth: 240 }}>
            <label style={labelStyle}>Supporting Documents</label>
            <input data-tour="pr-new-supporting-docs" type="file" multiple onChange={(e) => setSupportingFiles(Array.from(e.target.files || []))} style={inputStyle} />
          </div>
          <div style={{ flex: '0 1 280px', minWidth: 240 }}>
            <label style={labelStyle}>Specification / Reference File</label>
            <input data-tour="pr-new-spec-docs" type="file" multiple onChange={(e) => setSpecFiles(Array.from(e.target.files || []))} style={inputStyle} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button data-tour="pr-new-cancel" onClick={() => router.back()} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button data-tour="pr-new-submit" onClick={handleSubmit} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Submitting…' : 'Submit Purchase Requisition'}
        </button>
      </div>
    </div>
  )
}
